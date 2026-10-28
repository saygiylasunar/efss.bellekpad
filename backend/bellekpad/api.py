"""Local-only API; the browser never controls process argv or model paths."""
from __future__ import annotations
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from .comfy import ComfyClient, EngineOffline
from .efss import SourceConflict
from .storage import Workspace
from .supervisor import Supervisor, EngineProfile
from .runtime_settings import RuntimeConfigError, build_comfy_profile, profile_info
from .model_registry import ModelRegistryError, discover
from .model_descriptor import (ModelInspectError, inspect_registered_model,
                               execution_contract)
from .workflow import WorkflowError, compile_graph
from .workflow_store import WorkflowStoreError
from .generation import GenerationError, image_outputs, normalized_engine_state, parse_uuid
from .workspace_backup import BackupError, ARCHIVE_PATTERN, create_backup, verify_backup


class ModelRootCreate(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


class ModelFileListParams(BaseModel):
    root_id: str | None = None


class RuntimeConfiguration(BaseModel):
    comfy_root: str = Field(min_length=1, max_length=2048)
    python_executable: str | None = Field(default=None, max_length=2048)


class GraphRequest(BaseModel):
    nodes: list[dict] = Field(max_length=512)
    edges: list[dict] = Field(max_length=2048)


class WorkflowDraftCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    graph: dict


class WorkflowDraftUpdate(WorkflowDraftCreate):
    expected_revision: int


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    source: str = ""


class NotePatch(BaseModel):
    revision: int
    source_sha: str
    changes: list[dict] = Field(default_factory=list)
    draft: list[dict] | None = None


def build_app(root: str | None = None, comfy=None, profile=None, supervisor_override=None):
    data_root = root if root is not None else os.environ.get("BELLEKPAD_DATA_ROOT")
    if not data_root:
        raise RuntimeError("BELLEKPAD_DATA_ROOT_REQUIRED")
    workspace = Workspace(data_root)
    client = comfy or ComfyClient()
    if profile is None:
        # Saved workspace runtime is preferred over transient shell variables.
        saved = workspace.get_runtime_profile()
        if saved:
            root = Path(saved["comfy_root"])
            profile = EngineProfile(saved["python_executable"], str(root / "main.py"), str(root))
        elif os.environ.get("BELLEKPAD_COMFY_PYTHON") and os.environ.get("BELLEKPAD_COMFY_MAIN"):
            script = os.environ["BELLEKPAD_COMFY_MAIN"]
            profile = EngineProfile(os.environ["BELLEKPAD_COMFY_PYTHON"], script,
                                    os.environ.get("BELLEKPAD_COMFY_CWD", str(Path(script).parent)))
    supervisor = supervisor_override if supervisor_override is not None else Supervisor(client.ready, profile)

    @asynccontextmanager
    async def lifespan(app):
        yield
        await supervisor.close()

    app = FastAPI(title="BellekPad Local API", version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def origin_guard(request: Request, call_next):
        host = request.headers.get("host", "")
        if host not in ("127.0.0.1:8765", "localhost:8765", "testserver"):
            return JSONResponse(status_code=403, content={"error": "UNTRUSTED_HOST"})
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin and origin not in ("http://127.0.0.1:8765", "http://localhost:8765",
                                         "http://127.0.0.1:5173", "http://localhost:5173"):
                return JSONResponse(status_code=403, content={"error": "UNTRUSTED_ORIGIN"})
        return await call_next(request)

    @app.get("/api/health")
    async def health():
        return {"service": "bellekpad", "version": "0.1.0", "engine": supervisor.status()}

    @app.get("/api/engine")
    async def engine():
        return supervisor.status()

    @app.get("/api/runtime/config")
    async def runtime_config():
        return profile_info(getattr(supervisor, "profile", None))

    @app.put("/api/runtime/config")
    async def runtime_config_save(body: RuntimeConfiguration):
        try:
            selected = build_comfy_profile(body.comfy_root, body.python_executable)
        except RuntimeConfigError as exc:
            raise HTTPException(422, detail=exc.code) from exc
        # Profile, backend state and on-disk preference are one ordered change.
        # The browser never supplies process flags or arbitrary script paths.
        try:
            await supervisor.configure(
                selected, persist=lambda p: workspace.save_runtime_profile(
                    p.executable, p.cwd))
        except ValueError as exc:
            raise HTTPException(409, detail=str(exc)) from exc
        return profile_info(selected)

    @app.get("/api/runtime/logs")
    async def runtime_logs():
        return {"lines": supervisor.logs() if hasattr(supervisor, "logs") else []}

    @app.post("/api/engine/start")
    async def engine_start():
        try:
            return await supervisor.start()
        except ValueError as exc:
            raise HTTPException(409, detail=str(exc)) from exc

    @app.post("/api/engine/stop")
    async def engine_stop():
        return await supervisor.stop()

    # Registry is local metadata only; indexing never activates a runner.
    scanning_roots: set[str] = set()

    @app.get("/api/models/roots")
    async def model_roots():
        return workspace.list_model_roots()

    @app.post("/api/models/roots", status_code=201)
    async def add_model_root(body: ModelRootCreate):
        try:
            return await run_in_threadpool(workspace.add_model_root, body.path)
        except ModelRegistryError as exc:
            raise HTTPException(422, detail=exc.code) from exc

    @app.delete("/api/models/roots/{root_id}")
    async def remove_model_root(root_id: str):
        if root_id in scanning_roots:
            raise HTTPException(409, detail="MODEL_SCAN_ACTIVE")
        if not workspace.delete_model_root(root_id):
            raise HTTPException(404, detail="MODEL_ROOT_NOT_FOUND")
        return {"removed": True}

    @app.post("/api/models/roots/{root_id}/scan")
    async def scan_model_root(root_id: str):
        root = workspace.get_model_root(root_id)
        if root is None:
            raise HTTPException(404, detail="MODEL_ROOT_NOT_FOUND")
        if root_id in scanning_roots:
            raise HTTPException(409, detail="MODEL_SCAN_ACTIVE")
        scanning_roots.add(root_id)
        try:
            # No traversal of arbitrary user input: use persisted approved path.
            snapshot = await run_in_threadpool(discover, root["path"])
            return await run_in_threadpool(workspace.replace_model_index, root_id, snapshot)
        except ModelRegistryError as exc:
            code = 404 if exc.code == "MODEL_ROOT_NOT_FOUND" else 409
            raise HTTPException(code, detail=exc.code) from exc
        finally:
            scanning_roots.discard(root_id)

    @app.get("/api/models")
    async def model_files(root_id: str | None = None, query: str = "",
                          format: str = "", limit: int = 100, offset: int = 0):
        if len(query) > 160 or len(format) > 32:
            raise HTTPException(422, detail="MODEL_FILTER_INVALID")
        if root_id is not None and workspace.get_model_root(root_id) is None:
            raise HTTPException(404, detail="MODEL_ROOT_NOT_FOUND")
        try:
            return workspace.list_model_files(root_id, query, format, limit, offset)
        except ModelRegistryError as exc:
            raise HTTPException(422, detail=exc.code) from exc

    @app.get("/api/models/{model_id}/descriptor")
    async def model_descriptor(model_id: str):
        indexed = workspace.get_model_file(model_id)
        if indexed is None:
            raise HTTPException(404, detail="MODEL_NOT_INDEXED")
        try:
            inspected = await run_in_threadpool(
                inspect_registered_model, indexed["root_path"], indexed)
        except ModelInspectError as exc:
            raise HTTPException(409, detail=exc.code) from exc
        return {
            "model_id": indexed["id"], "name": indexed["name"],
            "format": indexed["format"],
            "component_hint": indexed["component_hint"],
            "inspection": inspected,
            "runtime": execution_contract(indexed, inspected),
        }

    @app.get("/api/workflow/nodes")
    async def workflow_nodes():
        if supervisor.status()["state"] != "ready":
            raise HTTPException(409, detail="ENGINE_NOT_READY")
        try:
            return await client.node_registry()
        except EngineOffline as exc:
            raise HTTPException(503, detail=str(exc)) from exc

    @app.post("/api/workflows/compile")
    async def workflows_compile(graph: GraphRequest):
        if supervisor.status()["state"] != "ready":
            raise HTTPException(409, detail="ENGINE_NOT_READY")
        try:
            compiled = compile_graph(graph.model_dump(), await client.node_registry())
            return {"prompt": compiled}
        except WorkflowError as exc:
            raise HTTPException(422, detail=exc.code) from exc
        except EngineOffline as exc:
            raise HTTPException(503, detail=str(exc)) from exc

    @app.get("/api/workflows")
    async def saved_workflows():
        return workspace.list_workflows()

    @app.post("/api/workflows", status_code=201)
    async def create_saved_workflow(body: WorkflowDraftCreate):
        try:
            return workspace.create_workflow(body.name, body.graph)
        except WorkflowStoreError as exc:
            raise HTTPException(422, detail=exc.code) from exc

    @app.get("/api/workflows/{workflow_id}")
    async def get_saved_workflow(workflow_id: str):
        result = workspace.get_workflow(workflow_id)
        if result is None:
            raise HTTPException(404, detail="WORKFLOW_NOT_FOUND")
        return result

    @app.put("/api/workflows/{workflow_id}")
    async def update_saved_workflow(workflow_id: str, body: WorkflowDraftUpdate):
        try:
            return workspace.update_workflow(
                workflow_id, body.expected_revision, body.name, body.graph)
        except WorkflowStoreError as exc:
            code = 404 if exc.code == "WORKFLOW_NOT_FOUND" else (
                409 if exc.code == "WORKFLOW_REVISION_CONFLICT" else 422)
            raise HTTPException(code, detail=exc.code) from exc

    @app.get("/api/generations")
    async def list_generations():
        return workspace.list_generations()

    @app.post("/api/generations", status_code=202)
    async def generations(graph: GraphRequest):
        if supervisor.status()["state"] != "ready":
            raise HTTPException(409, detail="ENGINE_NOT_READY")
        try:
            compiled = compile_graph(graph.model_dump(), await client.node_registry())
        except WorkflowError as exc:
            raise HTTPException(422, detail=exc.code) from exc
        except EngineOffline as exc:
            raise HTTPException(503, detail=str(exc)) from exc

        # The immutable prompt is committed before the remote submit.
        # A network timeout can mean Comfy accepted the work; never say "failed".
        pending = workspace.begin_generation(compiled)
        try:
            result = await client.submit(compiled)
            return workspace.generation_submitted(
                pending["id"], result["job_id"], result.get("queue_number"))
        except EngineOffline as exc:
            workspace.generation_uncertain(pending["id"])
            raise HTTPException(
                503, detail="ENGINE_SUBMISSION_UNCONFIRMED") from exc

    def owned_generation(job_id: str) -> dict:
        try:
            job_id = parse_uuid(job_id)
        except GenerationError as exc:
            raise HTTPException(400, detail=exc.code) from exc
        owned = workspace.get_generation(job_id)
        if owned is None:
            raise HTTPException(404, detail="GENERATION_NOT_FOUND")
        return owned

    @app.get("/api/generations/{job_id}")
    async def generation_status(job_id: str):
        job = owned_generation(job_id)
        if not job["engine_job_id"]:
            return {**job, "engine_reachable": False, "images": [],
                    "archived": workspace.list_generation_assets(job["id"])}
        if supervisor.status()["state"] != "ready":
            return {**job, "engine_reachable": False, "images": [],
                    "archived": workspace.list_generation_assets(job["id"])}
        try:
            upstream = await client.job_status(job["engine_job_id"])
            state = normalized_engine_state(upstream)
            if state is not None and job["state"] != state:
                job = workspace.generation_observed(job["id"], state)
            images = []
            if job["state"] == "completed":
                historical = await client.history(job["engine_job_id"])
                images = [img.public(i, job["id"])
                          for i, img in enumerate(image_outputs(historical))]
            return {**job, "engine_reachable": True, "images": images,
                    "archived": workspace.list_generation_assets(job["id"])}
        except EngineOffline:
            return {**job, "engine_reachable": False, "images": [],
                    "archived": workspace.list_generation_assets(job["id"])}

    @app.get("/api/generations/{job_id}/images/{index}")
    async def generation_image(job_id: str, index: int):
        job = owned_generation(job_id)
        if index < 0 or index >= 256:
            raise HTTPException(404, detail="IMAGE_NOT_FOUND")
        if not job["engine_job_id"]:
            raise HTTPException(409, detail="ENGINE_JOB_NOT_SUBMITTED")
        if supervisor.status()["state"] != "ready":
            raise HTTPException(503, detail="ENGINE_NOT_READY")
        try:
            historical = await client.history(job["engine_job_id"])
            images = image_outputs(historical)
            if index >= len(images):
                raise HTTPException(404, detail="IMAGE_NOT_FOUND")
            entry = images[index]
            body, mime = await client.image(
                entry.filename, entry.subfolder, entry.kind)
            return Response(content=body, media_type=mime, headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            })
        except EngineOffline as exc:
            raise HTTPException(503, detail=str(exc)) from exc

    @app.post("/api/generations/{job_id}/images/{index}/archive", status_code=201)
    async def archive_generation_image(job_id: str, index: int):
        job = owned_generation(job_id)
        if job["state"] != "completed":
            raise HTTPException(409, detail="GENERATION_NOT_COMPLETED")
        if index < 0 or index >= 256:
            raise HTTPException(404, detail="IMAGE_NOT_FOUND")
        if not job["engine_job_id"] or supervisor.status()["state"] != "ready":
            raise HTTPException(503, detail="ENGINE_NOT_READY")
        try:
            historical = await client.history(job["engine_job_id"])
            images = image_outputs(historical)
            if index >= len(images):
                raise HTTPException(404, detail="IMAGE_NOT_FOUND")
            entry = images[index]
            content, mime = await client.image(
                entry.filename, entry.subfolder, entry.kind)
            return workspace.archive_generation_image(
                job["id"], content, mime, entry.node_id, entry.filename)
        except EngineOffline as exc:
            raise HTTPException(503, detail=str(exc)) from exc

    @app.get("/api/assets/{asset_id}")
    async def archived_asset(asset_id: str):
        try:
            normalized = parse_uuid(asset_id)
        except GenerationError as exc:
            raise HTTPException(400, detail=exc.code) from exc
        try:
            stored = workspace.get_generation_asset(normalized)
        except ValueError as exc:
            raise HTTPException(409, detail=str(exc)) from exc
        if stored is None:
            raise HTTPException(404, detail="ASSET_NOT_FOUND")
        body, mime = stored
        return Response(content=body, media_type=mime, headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        })

    @app.post("/api/generations/{job_id}/cancel")
    async def generation_cancel(job_id: str):
        job = owned_generation(job_id)
        if not job["engine_job_id"]:
            raise HTTPException(409, detail="ENGINE_JOB_NOT_SUBMITTED")
        if job["state"] in ("completed","failed","cancelled"):
            return {"accepted": False, "state": job["state"]}
        if supervisor.status()["state"] != "ready":
            raise HTTPException(503, detail="ENGINE_NOT_READY")
        try:
            accepted = await client.cancel(job["engine_job_id"])
            # An accepted cancellation request is NOT terminal state.
            # Follow-up job status must report cancelled.
            return {"accepted": accepted, "state": job["state"]}
        except EngineOffline as exc:
            raise HTTPException(503, detail=str(exc)) from exc

    @app.get("/api/notes")
    async def list_notes():
        return workspace.list_notes()

    @app.post("/api/notes")
    async def new_note(body: NoteCreate):
        return workspace.new_note(body.title, body.source)

    @app.get("/api/notes/{note_id}")
    async def get_note(note_id: str):
        result = workspace.get_note(note_id)
        if result is None:
            raise HTTPException(404, detail="NOTE_NOT_FOUND")
        return result

    @app.patch("/api/notes/{note_id}")
    async def update_note(note_id: str, body: NotePatch):
        try:
            return workspace.patch_note(note_id, body.revision, body.source_sha, body.changes, body.draft)
        except SourceConflict as exc:
            raise HTTPException(409, detail=str(exc)) from exc

    @app.post("/api/backups")
    async def backup():
        # No arbitrary output path accepted from browser.
        path = workspace.backup()
        return {"created": True, "name": path.name}

    @app.get("/api/workspace-backups")
    async def list_workspace_backups():
        folder = workspace.root / "backups"
        names = sorted(folder.iterdir(), key=lambda p: p.name, reverse=True)
        return [{"name": path.name, "size_bytes": path.stat().st_size}
                for path in names if ARCHIVE_PATTERN.fullmatch(path.name)
                and path.is_file() and not path.is_symlink()][:100]

    @app.post("/api/workspace-backups", status_code=201)
    async def create_workspace_backup():
        # Heavy compression must not stall generation-status polling.
        try:
            return await run_in_threadpool(create_backup, workspace)
        except BackupError as exc:
            raise HTTPException(409, detail=exc.code) from exc

    @app.post("/api/workspace-backups/{name}/verify")
    async def verify_workspace_backup(name: str):
        if not ARCHIVE_PATTERN.fullmatch(name):
            raise HTTPException(400, detail="BACKUP_NAME_INVALID")
        path = workspace.root / "backups" / name
        if path.is_symlink():
            raise HTTPException(400, detail="BACKUP_SYMLINK_REJECTED")
        try:
            return await run_in_threadpool(verify_backup, path)
        except BackupError as exc:
            code = 404 if exc.code == "BACKUP_NOT_FOUND" else 409
            raise HTTPException(code, detail=exc.code) from exc

    # Serve the compiled web UI from the same local origin in production.
    # In development Vite proxies /api to this service.
    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if (dist / "index.html").is_file():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="web")

    return app


# Uvicorn factory recommended: --factory bellekpad.api:create_app
def create_app():
    return build_app()

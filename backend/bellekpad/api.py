"""Local-only API; the browser never controls process argv or model paths."""
from __future__ import annotations
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .comfy import ComfyClient, EngineOffline
from .efss import SourceConflict
from .storage import Workspace
from .supervisor import Supervisor, EngineProfile
from .workflow import WorkflowError, compile_graph


class GraphRequest(BaseModel):
    nodes: list[dict] = Field(max_length=512)
    edges: list[dict] = Field(max_length=2048)


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    source: str = ""


class NotePatch(BaseModel):
    revision: int
    source_sha: str
    changes: list[dict]


def build_app(root: str | None = None, comfy=None, profile=None, supervisor_override=None):
    data_root = root if root is not None else os.environ.get("BELLEKPAD_DATA_ROOT")
    if not data_root:
        raise RuntimeError("BELLEKPAD_DATA_ROOT_REQUIRED")
    workspace = Workspace(data_root)
    client = comfy or ComfyClient()
    if profile is None and os.environ.get("BELLEKPAD_COMFY_PYTHON") and os.environ.get("BELLEKPAD_COMFY_MAIN"):
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
            if origin and origin not in ("http://127.0.0.1:8765", "http://localhost:8765", "http://localhost:5173"):
                return JSONResponse(status_code=403, content={"error": "UNTRUSTED_ORIGIN"})
        return await call_next(request)

    @app.get("/api/health")
    async def health():
        return {"service": "bellekpad", "version": "0.1.0", "engine": supervisor.status()}

    @app.get("/api/engine")
    async def engine():
        return supervisor.status()

    @app.post("/api/engine/start")
    async def engine_start():
        try:
            return await supervisor.start()
        except ValueError as exc:
            raise HTTPException(409, detail=str(exc)) from exc

    @app.post("/api/engine/stop")
    async def engine_stop():
        return await supervisor.stop()

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

    @app.post("/api/generations")
    async def generations(graph: GraphRequest):
        if supervisor.status()["state"] != "ready":
            raise HTTPException(409, detail="ENGINE_NOT_READY")
        try:
            compiled = compile_graph(graph.model_dump(), await client.node_registry())
            return await client.submit(compiled)
        except WorkflowError as exc:
            raise HTTPException(422, detail=exc.code) from exc
        except EngineOffline as exc:
            raise HTTPException(503, detail=str(exc)) from exc

    @app.get("/api/generations/{job_id}")
    async def generation_status(job_id: str):
        try:
            return await client.history(job_id)
        except (ValueError, EngineOffline):
            raise HTTPException(404, detail="JOB_NOT_FOUND")

    @app.post("/api/generations/{job_id}/cancel")
    async def generation_cancel(job_id: str):
        try:
            return {"cancelled": await client.cancel(job_id)}
        except (ValueError, EngineOffline):
            raise HTTPException(409, detail="CANCEL_UNAVAILABLE")

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
            return workspace.patch_note(note_id, body.revision, body.source_sha, body.changes)
        except SourceConflict as exc:
            raise HTTPException(409, detail=str(exc)) from exc

    @app.post("/api/backups")
    async def backup():
        # No arbitrary output path accepted from browser.
        path = workspace.backup()
        return {"created": True, "name": path.name}

    # Serve the compiled web UI from the same local origin in production.
    # In development Vite proxies /api to this service.
    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if (dist / "index.html").is_file():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="web")

    return app


# Uvicorn factory recommended: --factory bellekpad.api:create_app
def create_app():
    return build_app()

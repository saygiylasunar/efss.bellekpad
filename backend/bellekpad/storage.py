"""User-controlled workspace root, transactional notes and consistent SQLite backups."""
from __future__ import annotations
import json
import hashlib
import os
import sqlite3
import tempfile
from contextlib import contextmanager, closing
import uuid
from pathlib import Path
from .efss import patch, project, rewrite_blocks, SourceConflict
from .workflow_store import WorkflowStoreError, serialized_draft
from .model_registry import ModelRegistryError, normalize_root


class Workspace:
    def __init__(self, root: str | Path):
        if not root or not str(root).strip():
            raise ValueError("BELLEKPAD_DATA_ROOT_REQUIRED")
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ("database", "backups", "assets"):
            (self.root / name).mkdir(exist_ok=True)
        self.db_path = self.root / "database" / "bellekpad.sqlite3"
        with self.connect() as db:
            schema = db.execute("PRAGMA user_version").fetchone()[0]
            if schema > 4:
                raise RuntimeError("DATA_SCHEMA_NEWER_THAN_APP")
            # v2 is additive to v1: never reset a newer SQLite schema version.
            # All tables are CREATE IF NOT EXISTS for safe retry after interruption.
            db.executescript("""
              CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1);
              CREATE TABLE IF NOT EXISTS workflows (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, graph_json TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1);
              CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, policy TEXT NOT NULL
                  CHECK(policy IN ('parallel','roundtable','orchestrated')));
              CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
                parent_id TEXT, role TEXT NOT NULL, model_id TEXT, body TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id));
              CREATE TABLE IF NOT EXISTS generation_jobs (
                id TEXT PRIMARY KEY,
                engine_job_id TEXT UNIQUE,
                state TEXT NOT NULL CHECK(state IN
                  ('submitting','submission_unknown','queued','running','completed','failed','cancelled')),
                prompt_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                failure_code TEXT,
                queue_number INTEGER
              );
              CREATE TABLE IF NOT EXISTS generation_assets (
                id TEXT PRIMARY KEY,
                generation_id TEXT NOT NULL REFERENCES generation_jobs(id),
                filename TEXT NOT NULL,
                media_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                source_node_id TEXT NOT NULL,
                source_filename TEXT NOT NULL
              );
              CREATE TABLE IF NOT EXISTS runtime_profiles (
                key TEXT PRIMARY KEY CHECK(key = 'comfy'),
                python_executable TEXT NOT NULL,
                comfy_root TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              );
              CREATE TABLE IF NOT EXISTS model_roots (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                indexed_at TEXT,
                file_count INTEGER NOT NULL DEFAULT 0
              );
              CREATE TABLE IF NOT EXISTS model_files (
                id TEXT PRIMARY KEY,
                root_id TEXT NOT NULL REFERENCES model_roots(id) ON DELETE CASCADE,
                relative_path TEXT NOT NULL,
                name TEXT NOT NULL,
                format TEXT NOT NULL,
                component_hint TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                modified_ns INTEGER NOT NULL,
                UNIQUE(root_id, relative_path)
              );
              CREATE INDEX IF NOT EXISTS idx_model_files_root ON model_files(root_id);
              CREATE INDEX IF NOT EXISTS idx_model_files_format ON model_files(format);
            """)
            db.execute("PRAGMA user_version = 4")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db_path, timeout=10)
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA journal_mode=WAL")
            with db:
                yield db
        finally:
            db.close()

    def add_model_root(self, path: str) -> dict:
        canonical = normalize_root(path)
        with self.connect() as db:
            row = db.execute("SELECT id FROM model_roots WHERE path=?", (canonical,)).fetchone()
            if row:
                return self.get_model_root(row[0])
            root_id = str(uuid.uuid4())
            db.execute("INSERT INTO model_roots(id,path) VALUES(?,?)", (root_id, canonical))
        return self.get_model_root(root_id)

    def get_model_root(self, root_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT id,path,indexed_at,file_count FROM model_roots WHERE id=?", (root_id,)
            ).fetchone()
        return (dict(zip(("id","path","indexed_at","file_count"),row))
                if row else None)

    def list_model_roots(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT id,path,indexed_at,file_count FROM model_roots ORDER BY rowid"
            ).fetchall()
        return [dict(zip(("id","path","indexed_at","file_count"),row)) for row in rows]

    def delete_model_root(self, root_id: str) -> bool:
        # Only index rows are deleted; never unlink external model files.
        with self.connect() as db:
            result = db.execute("DELETE FROM model_roots WHERE id=?", (root_id,))
            return result.rowcount == 1

    def replace_model_index(self, root_id: str, snapshot: list[dict]) -> dict:
        """Atomic refresh after complete disk traversal; a failed traversal does
        not remove a previously successful registry snapshot."""
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT path FROM model_roots WHERE id=?", (root_id,)).fetchone()
            if row is None:
                raise ModelRegistryError("MODEL_ROOT_NOT_FOUND")
            db.execute("DELETE FROM model_files WHERE root_id=?", (root_id,))
            db.executemany(
                "INSERT INTO model_files(id,root_id,relative_path,name,format,"
                "component_hint,size_bytes,modified_ns) VALUES(?,?,?,?,?,?,?,?)",
                ((str(uuid.uuid5(uuid.NAMESPACE_URL, root_id + "/" + item["relative_path"])),
                  root_id,item["relative_path"],item["name"],item["format"],
                  item["component_hint"],item["size_bytes"],item["modified_ns"])
                 for item in snapshot)
            )
            db.execute("UPDATE model_roots SET file_count=?,"
                       "indexed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
                       (len(snapshot), root_id))
        return self.get_model_root(root_id)

    def list_model_files(self, root_id: str | None = None,
                         text_filter: str = "", format_filter: str = "",
                         limit: int = 200, offset: int = 0) -> dict:
        if not (1 <= limit <= 500 and 0 <= offset <= 1_000_000):
            raise ModelRegistryError("MODEL_PAGE_INVALID")
        clauses = []
        args: list = []
        if root_id:
            clauses.append("root_id=?")
            args.append(root_id)
        if format_filter:
            clauses.append("format=?")
            args.append(format_filter)
        if text_filter:
            # Parameterized substring filtering, no SQL wildcard injection.
            clauses.append("instr(lower(name),lower(?))>0")
            args.append(text_filter)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connect() as db:
            total = db.execute("SELECT count(*) FROM model_files"+where,args).fetchone()[0]
            rows = db.execute(
                "SELECT id,root_id,relative_path,name,format,component_hint,"
                "size_bytes,modified_ns FROM model_files"+where+
                " ORDER BY name COLLATE NOCASE,id LIMIT ? OFFSET ?",
                [*args,limit,offset]).fetchall()
        keys = ("id","root_id","relative_path","name","format","component_hint",
                "size_bytes","modified_ns")
        return {"total":total,"items":[dict(zip(keys,r)) for r in rows],
                "limit":limit,"offset":offset}

    def get_runtime_profile(self) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT python_executable,comfy_root,updated_at "
                "FROM runtime_profiles WHERE key='comfy'"
            ).fetchone()
        return {"python_executable": row[0], "comfy_root": row[1],
                "updated_at": row[2]} if row else None

    def save_runtime_profile(self, python_executable: str, comfy_root: str) -> dict:
        with self.connect() as db:
            db.execute(
                "INSERT INTO runtime_profiles(key,python_executable,comfy_root) "
                "VALUES('comfy',?,?) ON CONFLICT(key) DO UPDATE SET "
                "python_executable=excluded.python_executable,"
                "comfy_root=excluded.comfy_root,"
                "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                (python_executable, comfy_root)
            )
        return self.get_runtime_profile()

    def new_note(self, title: str, source: str = "") -> dict:
        if not isinstance(title, str) or not title.strip() or len(title) > 160 or not isinstance(source, str):
            raise ValueError("INVALID_NOTE")
        nid = str(uuid.uuid4())
        with self.connect() as db:
            db.execute("INSERT INTO notes(id,title,source) VALUES(?,?,?)", (nid, title, source))
        return {"id": nid, "revision": 1}

    def list_notes(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT id,title,revision FROM notes ORDER BY rowid DESC LIMIT 500").fetchall()
        return [{"id": r[0], "title": r[1], "revision": r[2]} for r in rows]

    def get_note(self, nid: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT title,source,revision FROM notes WHERE id=?", (nid,)).fetchone()
        if row is None:
            return None
        return {"id": nid, "title": row[0], "source": row[1], "revision": row[2], "projection": project(row[1])}

    def patch_note(self, nid: str, revision: int, source_sha: str,
                   changes: list[dict], draft: list[dict] | None = None) -> dict:
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT source,revision FROM notes WHERE id=?", (nid,)).fetchone()
            if row is None:
                raise SourceConflict("NOTE_NOT_FOUND")
            if type(revision) is not int or row[1] != revision:
                raise SourceConflict("NOTE_REVISION_CONFLICT")
            edited = (rewrite_blocks(row[0], source_sha, draft)
                      if draft is not None else patch(row[0], source_sha, changes))
            cursor = db.execute("UPDATE notes SET source=?,revision=revision+1 WHERE id=? AND revision=?",
                                (edited, nid, revision))
            if cursor.rowcount != 1:
                raise SourceConflict("NOTE_REVISION_CONFLICT")
        return {"id": nid, "revision": revision + 1, "projection": project(edited)}

    def create_workflow(self, name: str, graph: object) -> dict:
        if not isinstance(name, str) or not 0 < len(name.strip()) <= 160:
            raise WorkflowStoreError("INVALID_WORKFLOW_NAME")
        data = serialized_draft(graph)
        wid = str(uuid.uuid4())
        with self.connect() as db:
            db.execute("INSERT INTO workflows(id,name,graph_json,revision) VALUES(?,?,?,1)",
                       (wid, name.strip(), data))
        return {"id": wid, "name": name.strip(), "revision": 1, "graph": json.loads(data)}

    def list_workflows(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT id,name,revision FROM workflows ORDER BY rowid DESC LIMIT 500"
            ).fetchall()
        return [{"id": wid, "name": name, "revision": revision}
                for wid, name, revision in rows]

    def get_workflow(self, wid: str) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT name,graph_json,revision FROM workflows WHERE id=?", (wid,)
            ).fetchone()
        if row is None:
            return None
        return {"id": wid, "name": row[0], "revision": row[2],
                "graph": json.loads(row[1])}

    def update_workflow(self, wid: str, expected_revision: int,
                        name: str, graph: object) -> dict:
        if not isinstance(name, str) or not 0 < len(name.strip()) <= 160:
            raise WorkflowStoreError("INVALID_WORKFLOW_NAME")
        if type(expected_revision) is not int or expected_revision < 1:
            raise WorkflowStoreError("INVALID_WORKFLOW_REVISION")
        data = serialized_draft(graph)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute(
                "SELECT revision FROM workflows WHERE id=?", (wid,)
            ).fetchone()
            if current is None:
                raise WorkflowStoreError("WORKFLOW_NOT_FOUND")
            if current[0] != expected_revision:
                raise WorkflowStoreError("WORKFLOW_REVISION_CONFLICT")
            result = db.execute(
                "UPDATE workflows SET name=?,graph_json=?,revision=revision+1 "
                "WHERE id=? AND revision=?",
                (name.strip(), data, wid, expected_revision)
            )
            if result.rowcount != 1:
                raise WorkflowStoreError("WORKFLOW_REVISION_CONFLICT")
        return {"id": wid, "name": name.strip(), "revision": expected_revision + 1,
                "graph": json.loads(data)}

    def begin_generation(self, compiled_prompt: dict) -> dict:
        """Durable intent precedes Comfy submit: remote timeouts cannot become fake failures."""
        jid = str(uuid.uuid4())
        payload = json.dumps(compiled_prompt, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":"), allow_nan=False)
        with self.connect() as db:
            db.execute(
                "INSERT INTO generation_jobs(id,state,prompt_json) VALUES(?,?,?)",
                (jid, "submitting", payload))
        return self.get_generation(jid)

    def get_generation(self, jid: str) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT id,engine_job_id,state,created_at,updated_at,failure_code,queue_number "
                "FROM generation_jobs WHERE id=?", (jid,)).fetchone()
        if row is None:
            return None
        return dict(zip(
            ("id","engine_job_id","state","created_at","updated_at","failure_code","queue_number"), row))

    def list_generations(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT id,engine_job_id,state,created_at,updated_at,failure_code,queue_number "
                "FROM generation_jobs ORDER BY rowid DESC LIMIT 100").fetchall()
        keys = ("id","engine_job_id","state","created_at","updated_at","failure_code","queue_number")
        return [dict(zip(keys, row)) for row in rows]

    def generation_submitted(self, jid: str, engine_id: str, queue_number) -> dict:
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute(
                "UPDATE generation_jobs SET engine_job_id=?,state='queued',queue_number=?,"
                "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') "
                "WHERE id=? AND state='submitting'",
                (engine_id, queue_number if type(queue_number) is int else None, jid))
            if result.rowcount != 1:
                raise ValueError("GENERATION_STATE_CONFLICT")
        return self.get_generation(jid)

    def generation_uncertain(self, jid: str) -> dict:
        # A network error after POST may mean Comfy accepted the prompt but the
        # reply was lost. Never claim the job was safely cancelled or failed.
        with self.connect() as db:
            db.execute(
                "UPDATE generation_jobs SET state='submission_unknown',"
                "failure_code='ENGINE_SUBMISSION_UNCONFIRMED',"
                "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') "
                "WHERE id=? AND state='submitting'", (jid,))
        return self.get_generation(jid)

    def generation_observed(self, jid: str, state: str) -> dict:
        if state not in ("queued","running","completed","failed","cancelled"):
            raise ValueError("INVALID_GENERATION_STATE")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            result = db.execute(
                "UPDATE generation_jobs SET state=?,"
                "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') "
                "WHERE id=? AND engine_job_id IS NOT NULL "
                "AND state NOT IN ('completed','failed','cancelled')",
                (state, jid))
            if result.rowcount != 1 and self.get_generation(jid) is None:
                raise ValueError("GENERATION_NOT_FOUND")
        return self.get_generation(jid)

    def list_generation_assets(self, job_id: str) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT id,filename,media_type,size_bytes,sha256,source_node_id,source_filename "
                "FROM generation_assets WHERE generation_id=? ORDER BY rowid", (job_id,)
            ).fetchall()
        return [{"id": rid, "url": f"/api/assets/{rid}", "filename": original,
                 "mime": mime, "size_bytes": size, "sha256": digest, "node_id": node}
                for rid, file, mime, size, digest, node, original in rows]

    def archive_generation_image(self, job_id: str, body: bytes,
                                  mime: str, node_id: str, source_filename: str) -> dict:
        """Persist file bytes *then* SQLite metadata. Never trust browser paths."""
        suffix = {"image/png":".png","image/jpeg":".jpg",
                  "image/webp":".webp","image/gif":".gif"}.get(mime)
        if suffix is None or not body:
            raise ValueError("INVALID_IMAGE_DATA")
        job = self.get_generation(job_id)
        if job is None or job["state"] != "completed":
            raise ValueError("GENERATION_NOT_COMPLETED")
        asset_id = str(uuid.uuid4())
        folder = self.root / "assets" / "generations" / job_id
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / (asset_id + suffix)
        fd, tempname = tempfile.mkstemp(prefix=".pending-", dir=folder)
        temp = Path(tempname)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(body)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, target)
            try:
                with self.connect() as db:
                    db.execute(
                        "INSERT INTO generation_assets(id,generation_id,filename,"
                        "media_type,size_bytes,sha256,source_node_id,source_filename)"
                        " VALUES(?,?,?,?,?,?,?,?)",
                        (asset_id, job_id, target.name, mime, len(body),
                         hashlib.sha256(body).hexdigest(), node_id, source_filename))
            except Exception:
                target.unlink(missing_ok=True)
                raise
        finally:
            temp.unlink(missing_ok=True)
        return {"id": asset_id, "url": f"/api/assets/{asset_id}",
                "filename": source_filename, "mime":mime,
                "size_bytes":len(body), "sha256":hashlib.sha256(body).hexdigest(),
                "node_id":node_id}

    def get_generation_asset(self, asset_id: str) -> tuple[bytes, str] | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT generation_id,filename,media_type,sha256 "
                "FROM generation_assets WHERE id=?", (asset_id,)
            ).fetchone()
        if row is None:
            return None
        job_id, filename, mime, expected_sha = row
        path = self.root / "assets" / "generations" / job_id / filename
        try:
            content = path.read_bytes()
        except FileNotFoundError:
            return None
        if hashlib.sha256(content).hexdigest() != expected_sha:
            raise ValueError("ASSET_INTEGRITY_ERROR")
        return content, mime

    def backup(self) -> Path:
        fd, path = tempfile.mkstemp(prefix=".snapshot-", suffix=".sqlite3",
                                   dir=self.root / "backups")
        os.close(fd)
        target = Path(path)
        try:
            with self.connect() as source, closing(sqlite3.connect(target)) as destination:
                source.backup(destination)
            final = self.root / "backups" / f"backup-{uuid.uuid4().hex}.sqlite3"
            os.replace(target, final)
            return final
        finally:
            target.unlink(missing_ok=True)

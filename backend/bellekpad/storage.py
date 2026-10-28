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
from .efss import patch, project, SourceConflict
from .workflow_store import WorkflowStoreError, serialized_draft


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
            if schema > 2:
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
            """)
            db.execute("PRAGMA user_version = 2")

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

    def patch_note(self, nid: str, revision: int, source_sha: str, changes: list[dict]) -> dict:
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT source,revision FROM notes WHERE id=?", (nid,)).fetchone()
            if row is None:
                raise SourceConflict("NOTE_NOT_FOUND")
            if type(revision) is not int or row[1] != revision:
                raise SourceConflict("NOTE_REVISION_CONFLICT")
            edited = patch(row[0], source_sha, changes)
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

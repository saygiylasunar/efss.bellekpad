"""User-controlled workspace root, transactional notes and consistent SQLite backups."""
from __future__ import annotations
import json
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
            db.execute("PRAGMA user_version = 1")
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
            """)

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

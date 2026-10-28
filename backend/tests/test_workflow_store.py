"""Workflow draft lifecycle: offline edits -> SQLite -> API -> backup.

No Comfy installation or actual model is required for these contract tests.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad.api import build_app
from bellekpad.storage import Workspace
from bellekpad.workflow_store import WorkflowStoreError, normalize_draft


def graph():
    return {
        "schema_version": 1,
        "nodes": [
            {"id": "model-1", "type": "Unknown Comfy Model",
             "inputs": {"ckpt_name": "D:/Configured/özel.safetensors"},
             "position": {"x": -135.5, "y": 24}},
            {"id": "sampler-2", "type": "Sampler",
             "inputs": {"steps": 24}, "position": {"x": 273, "y": 50}}
        ],
        "edges": [
            {"source": "model-1", "sourceHandle": 0,
             "target": "sampler-2", "targetHandle": "model"}
        ]
    }


class OfflineSupervisor:
    def status(self):
        return {"state": "stopped", "pid": None, "failure": None}

    async def close(self):
        pass


class WorkflowValidationTests(unittest.TestCase):
    def test_drafts_allow_unresolved_engine_types_and_preserve_geometry(self):
        source = graph()
        self.assertEqual(normalize_draft(source), source)

    def test_reject_dangling_edges_and_duplicate_ids(self):
        source = graph()
        source["edges"][0]["target"] = "not-found"
        with self.assertRaisesRegex(WorkflowStoreError, "INVALID_WORKFLOW_EDGE"):
            normalize_draft(source)
        source = graph()
        source["nodes"][1]["id"] = "model-1"
        with self.assertRaisesRegex(WorkflowStoreError, "INVALID_WORKFLOW_NODE"):
            normalize_draft(source)

    def test_reject_nonfinite_and_oversized_drafts(self):
        source = graph()
        source["nodes"][0]["position"]["x"] = float("nan")
        with self.assertRaisesRegex(WorkflowStoreError, "INVALID_WORKFLOW_POSITION"):
            normalize_draft(source)
        source = graph()
        source["nodes"][0]["inputs"]["ckpt_name"] = "x" * (1_048_576 + 1)
        with self.assertRaisesRegex(WorkflowStoreError, "WORKFLOW_DRAFT_TOO_LARGE"):
            normalize_draft(source)

    def test_reject_schema_downgrade(self):
        source = graph()
        source["schema_version"] = 2
        with self.assertRaisesRegex(WorkflowStoreError, "WORKFLOW_SCHEMA_UNSUPPORTED"):
            normalize_draft(source)


class SchemaMigrationTests(unittest.TestCase):
    def test_additive_v1_to_v2_preserves_notes_and_workflows(self):
        with tempfile.TemporaryDirectory() as root:
            first=Workspace(root)
            note=first.new_note("Korunacak", "Kişisel metin\n")
            saved=first.create_workflow("Kayıt", graph())
            with closing(sqlite3.connect(first.db_path)) as db, db:
                db.execute("PRAGMA user_version = 1")
            upgraded=Workspace(root)
            self.assertEqual(upgraded.get_note(note["id"])["source"],"Kişisel metin\n")
            self.assertEqual(upgraded.get_workflow(saved["id"])["graph"],graph())
            with closing(sqlite3.connect(first.db_path)) as db, db:
                self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0],3)
                self.assertIsNotNone(db.execute(
                    "SELECT name FROM sqlite_master WHERE name='generation_assets'").fetchone())

    def test_future_schema_refused_without_destructive_downgrade(self):
        with tempfile.TemporaryDirectory() as root:
            rootpath=Path(root)
            dbdir=rootpath/"database"
            dbdir.mkdir(parents=True)
            with closing(sqlite3.connect(dbdir/"bellekpad.sqlite3")) as db, db:
                db.execute("PRAGMA user_version=99")
                db.execute("CREATE TABLE future_data(secret TEXT)")
                db.execute("INSERT INTO future_data VALUES ('preserved')")
            with self.assertRaisesRegex(RuntimeError,"DATA_SCHEMA_NEWER_THAN_APP"):
                Workspace(rootpath)
            with closing(sqlite3.connect(dbdir/"bellekpad.sqlite3")) as db, db:
                self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0],99)
                self.assertEqual(db.execute("SELECT secret FROM future_data").fetchone()[0],"preserved")


class WorkflowAPITests(unittest.TestCase):
    def test_offline_save_reopen_revision_backup(self):
        with tempfile.TemporaryDirectory() as root:
            with TestClient(build_app(root=root, supervisor_override=OfflineSupervisor())) as client:
                # Draft persistence does not require a running Comfy instance.
                result = client.post("/api/workflows", json={"name": "Özel Flux", "graph": graph()})
                self.assertEqual(result.status_code, 201, result.text)
                current = result.json()
                self.assertEqual(current["revision"], 1)
                self.assertEqual(current["graph"], graph())
                wid = current["id"]
                self.assertEqual(client.get("/api/workflows").json()[0]["name"], "Özel Flux")
                self.assertEqual(client.get("/api/workflows/" + wid).json()["graph"], graph())

                modified = graph()
                modified["nodes"][1]["inputs"]["steps"] = 28
                updated = client.put("/api/workflows/" + wid, json={
                    "expected_revision": 1, "name": "Özel Flux v2", "graph": modified})
                self.assertEqual(updated.status_code, 200, updated.text)
                self.assertEqual(updated.json()["revision"], 2)

                stale = client.put("/api/workflows/" + wid, json={
                    "expected_revision": 1, "name": "Yanlış", "graph": graph()})
                self.assertEqual(stale.status_code, 409, stale.text)
                self.assertEqual(stale.json()["detail"], "WORKFLOW_REVISION_CONFLICT")
                self.assertEqual(client.get("/api/workflows/" + wid).json()["name"], "Özel Flux v2")

                # Cannot execute against an absent engine, even though draft is stored.
                compiled = client.post("/api/workflows/compile", json=modified)
                self.assertEqual(compiled.status_code, 409)
                self.assertEqual(compiled.json()["detail"], "ENGINE_NOT_READY")
                self.assertEqual(client.post("/api/backups").status_code, 200)
                backup = next((Path(root)/"backups").glob("backup-*.sqlite3"))
                with closing(sqlite3.connect(backup)) as db, db:
                    persisted = db.execute("SELECT graph_json,revision FROM workflows WHERE id=?", (wid,)).fetchone()
                    self.assertEqual(persisted[1], 2)
                    self.assertEqual(json.loads(persisted[0]), modified)

    def test_invalid_graph_or_id_is_not_saved(self):
        with tempfile.TemporaryDirectory() as root:
            with TestClient(build_app(root=root, supervisor_override=OfflineSupervisor())) as client:
                bad = graph()
                bad["edges"][0]["source"] = "ghost"
                self.assertEqual(client.post("/api/workflows", json={
                    "name": "Broken", "graph": bad}).status_code, 422)
                self.assertEqual(client.get("/api/workflows").json(), [])
                self.assertEqual(client.get("/api/workflows/does-not-exist").status_code, 404)


if __name__ == "__main__":
    unittest.main()

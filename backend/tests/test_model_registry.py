"""R2.5 indexed-model scope, persistence, API and failure-path tests.

Do not launch model runners or read model payload bytes.
"""
from __future__ import annotations
from contextlib import closing
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad.api import build_app
from bellekpad.model_registry import discover, ModelRegistryError
from bellekpad.storage import Workspace


class NoEngine:
    def status(self):
        return {"state": "unconfigured", "pid": None, "failure": None}
    async def close(self):
        return None


class ModelRegistryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.models = self.root / "User-selected" / "models"
        (self.models / "loras").mkdir(parents=True)
        (self.models / "checkpoints").mkdir()
        (self.models / "diffusion_models").mkdir()
        (self.models / "diffusion_models" / "flux 1.safetensors").write_bytes(b"A" * 7)
        (self.models / "loras" / "bellekpad_lora.safetensors").write_bytes(b"B" * 5)
        (self.models / "checkpoints" / "Model.Q4_K_M.gguf").write_bytes(b"C" * 9)
        (self.models / "unlisted.txt").write_text("not a model")
        self.outside = self.root / "OutsideFolder"
        self.outside.mkdir()
        (self.outside / "private.gguf").write_bytes(b"OUTSIDE")

    def test_explicit_folder_only_and_stable_metadata(self):
        root = Workspace(self.root / "data")
        saved = root.add_model_root(str(self.models))
        self.assertIsNone(saved["indexed_at"])
        self.assertEqual(root.list_model_files()["total"], 0)
        snapshot = discover(saved["path"])
        self.assertEqual(len(snapshot), 3)
        self.assertEqual({s["component_hint"] for s in snapshot},
                         {"lora", "checkpoint", "diffusion"})
        self.assertEqual({s["format"] for s in snapshot}, {"safetensors", "gguf"})
        self.assertNotIn("private.gguf", [s["name"] for s in snapshot])
        self.assertNotIn("unlisted.txt", [s["name"] for s in snapshot])
        counted = root.replace_model_index(saved["id"], snapshot)
        self.assertEqual(counted["file_count"], 3)
        first = root.list_model_files(limit=5)
        self.assertEqual(first["total"], 3)
        self.assertEqual(len({s["id"] for s in first["items"]}), 3)
        root.replace_model_index(saved["id"], discover(saved["path"]))
        second = root.list_model_files(limit=5)
        self.assertEqual(first["items"], second["items"])
        self.assertEqual(len(root.list_model_roots()), 1)
        self.assertEqual(root.add_model_root(str(self.models))["id"], saved["id"])
        self.assertEqual(root.list_model_files(format_filter="gguf")["total"], 1)
        self.assertEqual(root.list_model_files(text_filter="LORA")["total"], 1)
        self.assertEqual(root.list_model_files(text_filter="' OR 1=1 --")["total"], 0)

    def test_symlink_does_not_escape_root(self):
        link = self.models / "outside_link"
        try:
            link.symlink_to(self.outside, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("Directory symlinks unavailable on this runner")
        names = [s["name"] for s in discover(str(self.models))]
        self.assertNotIn("private.gguf", names)

    def test_failed_walk_keeps_previous_snapshot(self):
        workspace = Workspace(self.root / "data")
        root = workspace.add_model_root(str(self.models))
        workspace.replace_model_index(root["id"], discover(root["path"]))
        before = workspace.list_model_files()
        original = os.scandir
        def blocked(path):
            if Path(path).name == "loras":
                raise PermissionError("simulated broken directory")
            return original(path)
        with patch("bellekpad.model_registry.os.scandir", side_effect=blocked):
            with self.assertRaisesRegex(ModelRegistryError,"MODEL_SCAN_INCOMPLETE"):
                discover(root["path"])
        self.assertEqual(workspace.list_model_files(), before)

    def test_root_removal_does_not_delete_weights(self):
        workspace = Workspace(self.root / "data")
        root = workspace.add_model_root(str(self.models))
        workspace.replace_model_index(root["id"], discover(root["path"]))
        self.assertTrue(workspace.delete_model_root(root["id"]))
        self.assertEqual(workspace.list_model_files()["total"], 0)
        self.assertTrue((self.models / "loras" / "bellekpad_lora.safetensors").is_file())
        self.assertFalse(workspace.delete_model_root(root["id"]))

    def test_v3_runtime_settings_migrate_to_v4_without_loss(self):
        workspace = Workspace(self.root / "data")
        workspace.save_runtime_profile("C:/Comfy/python.exe", "C:/ComfyUI")
        note = workspace.new_note("Existing", "Preserved\n")
        with closing(sqlite3.connect(workspace.db_path)) as db:
            with db:
                db.execute("PRAGMA user_version=3")
        upgraded = Workspace(self.root / "data")
        self.assertEqual(upgraded.get_runtime_profile()["comfy_root"], "C:/ComfyUI")
        self.assertEqual(upgraded.get_note(note["id"])["source"], "Preserved\n")
        with closing(sqlite3.connect(workspace.db_path)) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 4)

    def test_failed_scan_endpoint_preserves_index(self):
        with TestClient(build_app(root=str(self.root / "data"),
                                  supervisor_override=NoEngine())) as api:
            created = api.post("/api/models/roots",json={"path":str(self.models)})
            rid = created.json()["id"]
            first = api.post(f"/api/models/roots/{rid}/scan")
            self.assertEqual(first.status_code,200)
            previous = api.get("/api/models").json()
            with patch("bellekpad.api.discover",
                       side_effect=ModelRegistryError("MODEL_SCAN_INCOMPLETE")):
                failed = api.post(f"/api/models/roots/{rid}/scan")
                self.assertEqual(failed.status_code,409,failed.text)
                self.assertEqual(failed.json()["detail"],"MODEL_SCAN_INCOMPLETE")
            self.assertEqual(api.get("/api/models").json(),previous)

    def test_http_contract_and_restore_includes_index_not_weights(self):
        with TestClient(build_app(root=str(self.root / "data"),
                                  supervisor_override=NoEngine())) as api:
            denied = api.post("/api/models/roots", json={"path": str(self.models)},
                headers={"Origin":"https://untrusted.example"})
            self.assertEqual(denied.status_code,403)
            added = api.post("/api/models/roots", json={"path": str(self.models)},
                headers={"Origin":"http://127.0.0.1:5173"})
            self.assertEqual(added.status_code,201,added.text)
            rid = added.json()["id"]
            self.assertEqual(api.get("/api/models").json()["total"], 0)
            missing = api.post("/api/models/roots/missing/scan")
            self.assertEqual(missing.status_code,404)
            result = api.post(f"/api/models/roots/{rid}/scan",
                headers={"Origin":"http://127.0.0.1:5173"})
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()["file_count"],3)
            listing = api.get("/api/models?limit=2&offset=0").json()
            self.assertEqual(listing["total"],3)
            self.assertEqual(len(listing["items"]),2)
            self.assertEqual(api.get("/api/models?limit=2&offset=2").json()["total"],3)
            self.assertEqual(api.get("/api/models?root_id=missing").status_code,404)
            self.assertEqual(api.get("/api/models?limit=9999").status_code,422)
            self.assertEqual(api.get("/api/models?format=gguf").json()["total"],1)
            snap = api.post("/api/workspace-backups")
            self.assertEqual(snap.status_code,201,snap.text)
            backup = self.root / "data" / "backups" / snap.json()["name"]
        from bellekpad.workspace_backup import verify_backup, restore_backup
        self.assertTrue(verify_backup(backup)["valid"])
        newroot = self.root / "restored"
        restore_backup(backup,newroot)
        with closing(sqlite3.connect(newroot / "database" / "bellekpad.sqlite3")) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0],4)
        recovered = Workspace(newroot)
        self.assertEqual(recovered.list_model_files()["total"],3)
        self.assertEqual(recovered.list_model_roots()[0]["path"],str(self.models.resolve()))
        self.assertFalse((newroot / "models").exists())
        # The original folder remains outside both workspaces.
        self.assertTrue((self.models / "checkpoints" / "Model.Q4_K_M.gguf").exists())


if __name__ == "__main__":
    unittest.main()

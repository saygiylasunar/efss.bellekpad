"""Full workspace backup/export/restore contract tests.

Exercises API → online DB snapshot → referenced asset → zip manifest → offline
restore → persisted content. No real ComfyUI or GPU needed.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
import sys
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad.api import build_app
from bellekpad.storage import Workspace
from bellekpad.workspace_backup import BackupError, verify_backup, restore_backup


class OfflineSupervisor:
    def status(self):
        return {"state":"unconfigured","pid":None,"failure":None}
    async def close(self):
        pass


def draft():
    return {"schema_version":1,"nodes":[
        {"id":"saved-node","type":"CustomNode",
         "inputs":{"model":"X:/AI/モデル.safetensors"},
         "position":{"x":48,"y":12}}],
        "edges":[]}


class FullWorkspaceBackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)/"source"

    def create_fixture(self):
        workspace=Workspace(self.root)
        note=workspace.new_note("Türkçe belge","İçerik\r\n&EFSS{variable}\r\n")
        workflow=workspace.create_workflow("Özel model",draft())
        generation=workspace.begin_generation({"node":{"class_type":"SaveImage","inputs":{}}})
        upstream=str(uuid.uuid4())
        workspace.generation_submitted(generation["id"],upstream,0)
        workspace.generation_observed(generation["id"],"completed")
        payload=b"\x89PNG\r\n\x1a\n" + b"deterministic png sample"
        asset=workspace.archive_generation_image(
            generation["id"],payload,"image/png","node-1","örnek.png")
        return workspace,note,workflow,generation,asset,payload

    def test_api_backup_verify_and_offline_restore_roundtrip(self):
        original,note,workflow,generation,asset,payload=self.create_fixture()
        with TestClient(build_app(root=str(self.root),supervisor_override=OfflineSupervisor())) as api:
            created=api.post("/api/workspace-backups")
            self.assertEqual(created.status_code,201,created.text)
            entry=created.json()
            self.assertTrue(entry["name"].endswith(".efss-backup.zip"))
            self.assertEqual(entry["asset_count"],1)
            listed=api.get("/api/workspace-backups").json()
            self.assertEqual(len(listed),1)
            self.assertEqual(listed[0]["name"],entry["name"])
            verified=api.post(f'/api/workspace-backups/{entry["name"]}/verify')
            self.assertEqual(verified.status_code,200,verified.text)
            self.assertTrue(verified.json()["valid"])
            self.assertEqual(verified.json()["asset_count"],1)
            self.assertEqual(
                api.post("/api/workspace-backups/../../secret/verify").status_code,404)
            self.assertEqual(
                api.post("/api/workspace-backups/not-allowed.zip/verify").status_code,400)

        archive=self.root/"backups"/entry["name"]
        with zipfile.ZipFile(archive) as z:
            names=z.namelist()
            self.assertIn("database/bellekpad.sqlite3",names)
            self.assertIn("manifest.json",names)
            self.assertEqual(len(names),3)

        restored=self.root.parent/"restored"
        response=restore_backup(archive,restored)
        self.assertTrue(response["restored"])
        destination=Workspace(restored)
        self.assertEqual(destination.get_note(note["id"])["source"],
                         "İçerik\r\n&EFSS{variable}\r\n")
        self.assertEqual(destination.get_workflow(workflow["id"])["graph"],draft())
        self.assertEqual(destination.get_generation(generation["id"])["state"],"completed")
        self.assertEqual(destination.get_generation_asset(asset["id"])[0],payload)
        self.assertEqual(list((restored/"backups").glob("*.zip")),[])
        with closing(sqlite3.connect(destination.db_path)) as db, db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0],4)

    def test_missing_asset_fails_without_publishing_partial_archive(self):
        workspace,note,workflow,generation,asset,payload=self.create_fixture()
        path=self.root/"assets"/"generations"/generation["id"]/(asset["id"]+".png")
        path.write_bytes(b"external modification")
        with TestClient(build_app(root=str(self.root),supervisor_override=OfflineSupervisor())) as api:
            refused=api.post("/api/workspace-backups")
            self.assertEqual(refused.status_code,409,refused.text)
            self.assertEqual(refused.json()["detail"],"BACKUP_ASSET_INTEGRITY_ERROR")
            self.assertEqual(api.get("/api/workspace-backups").json(),[])
        self.assertEqual(list((self.root/"backups").glob("*.zip")),[])

    def test_corrupted_manifest_rejected_and_restore_wont_overwrite(self):
        workspace,*_=self.create_fixture()
        with TestClient(build_app(root=str(self.root),supervisor_override=OfflineSupervisor())) as api:
            name=api.post("/api/workspace-backups").json()["name"]
            archive=self.root/"backups"/name
            # No overwrite of even a preexisting empty directory.
            exists=self.root.parent/"existing"
            exists.mkdir()
            with self.assertRaisesRegex(BackupError,"RESTORE_TARGET_MUST_NOT_EXIST"):
                restore_backup(archive,exists)
            with zipfile.ZipFile(archive,"r") as source:
                pairs=[(info.filename,source.read(info.filename))
                       for info in source.infolist()]
            with zipfile.ZipFile(archive,"w",compression=zipfile.ZIP_DEFLATED) as dest:
                for filename,body in pairs:
                    dest.writestr(filename,body if not filename.endswith(".png") else b"changed")
            with self.assertRaises(BackupError):
                verify_backup(archive)
            target=self.root.parent/"should-not-exist"
            with self.assertRaises(BackupError):
                restore_backup(archive,target)
            self.assertFalse(target.exists())

    def test_rejects_extra_zip_members_not_in_manifest(self):
        workspace,*_=self.create_fixture()
        with TestClient(build_app(root=str(self.root),supervisor_override=OfflineSupervisor())) as api:
            name=api.post("/api/workspace-backups").json()["name"]
            archive=self.root/"backups"/name
            with zipfile.ZipFile(archive,"a") as z:
                z.writestr("../outside.txt","bad")
            with self.assertRaisesRegex(BackupError,"BACKUP_INVALID_MANIFEST_FILES"):
                verify_backup(archive)


if __name__ == "__main__":
    unittest.main()

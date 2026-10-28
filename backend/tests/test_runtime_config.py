"""Full local Comfy runtime profile: settings → durable v3 DB → supervisor → UI.

Never actually launch an engine; fake subprocess protects the host.
"""
from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad.api import build_app
from bellekpad.storage import Workspace
from bellekpad.runtime_settings import RuntimeConfigError, build_comfy_profile


class OfflineEngine:
    async def ready(self):
        return False


class DummyChild:
    def __init__(self):
        self.pid = 4321
        self.returncode = None

    def terminate(self):
        self.returncode = 0

    def kill(self):
        self.returncode = -9

    async def wait(self):
        return self.returncode


class RuntimeConfigurationTests(unittest.TestCase):
    def create_installation(self, root: Path) -> tuple[Path, Path]:
        comfy = root / "ComfyUI"
        comfy.mkdir(parents=True)
        (comfy / "main.py").write_text("# safe dummy for fake subprocess", encoding="utf-8")
        (comfy / "folder_paths.py").write_text("# marker", encoding="utf-8")
        python = comfy / ".venv" / "Scripts" / "python.exe"
        python.parent.mkdir(parents=True)
        python.touch()
        return comfy, python

    def test_discovery_only_trusted_installation_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comfy, python = self.create_installation(root)
            result = build_comfy_profile(str(comfy))
            self.assertEqual(result.executable, str(python.resolve()))
            self.assertEqual(result.main_script, str(comfy.resolve() / "main.py"))
            self.assertEqual(result.args, ("--listen","127.0.0.1","--port","8188"))
            with self.assertRaisesRegex(RuntimeConfigError,"COMFY_ROOT_MUST_BE_ABSOLUTE"):
                build_comfy_profile("ComfyUI",str(python))
            with self.assertRaisesRegex(RuntimeConfigError,"COMFY_PYTHON_INVALID"):
                other = comfy / "bad.exe"
                other.touch()
                build_comfy_profile(str(comfy),str(other))

    def test_profile_saved_then_reloaded_with_no_engine_running(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            comfy, python=self.create_installation(root)
            ws=root/"data"
            with TestClient(build_app(root=str(ws),comfy=OfflineEngine())) as api:
                unknown=api.get("/api/runtime/config")
                self.assertEqual(unknown.status_code,200)
                self.assertFalse(unknown.json()["configured"])
                invalid=api.put("/api/runtime/config",json={
                    "comfy_root":str(root/"missing")})
                self.assertEqual(invalid.status_code,422)
                self.assertEqual(invalid.json()["detail"],"COMFY_INSTALLATION_NOT_FOUND")
                self.assertIsNone(Workspace(ws).get_runtime_profile())

                denied=api.put("/api/runtime/config",json={
                    "comfy_root":str(comfy)}, headers={"Origin":"https://attack.example"})
                self.assertEqual(denied.status_code,403)
                self.assertIsNone(Workspace(ws).get_runtime_profile())

                configured=api.put("/api/runtime/config",json={
                    "comfy_root":str(comfy),"python_executable":None},
                    headers={"Origin":"http://127.0.0.1:5173"})
                self.assertEqual(configured.status_code,200,configured.text)
                self.assertEqual(configured.json()["python_executable"],str(python.resolve()))
                self.assertEqual(api.get("/api/engine").json()["state"],"stopped")
                self.assertEqual(Workspace(ws).get_runtime_profile()["comfy_root"],
                                 str(comfy.resolve()))

                spawned=[]
                async def fake_spawn(*args,**kwargs):
                    spawned.append((args,kwargs))
                    return DummyChild()
                with patch("bellekpad.supervisor.asyncio.create_subprocess_exec",
                           side_effect=fake_spawn):
                    started=api.post("/api/engine/start",
                                     headers={"Origin":"http://127.0.0.1:5173"})
                    self.assertEqual(started.status_code,200,started.text)
                    self.assertEqual(started.json()["state"],"starting")
                    self.assertEqual(spawned[0][0],(
                        str(python.resolve()),str(comfy.resolve()/"main.py"),
                        "--listen","127.0.0.1","--port","8188"
                    ))
                    second=api.put("/api/runtime/config",json={
                        "comfy_root":str(comfy)})
                    self.assertEqual(second.status_code,409)
                    self.assertEqual(second.json()["detail"],"ENGINE_BUSY")
                    stopped=api.post("/api/engine/stop")
                    self.assertEqual(stopped.status_code,200)
                    self.assertEqual(stopped.json()["state"],"stopped")
                backup=api.post("/api/workspace-backups")
                self.assertEqual(backup.status_code,201,backup.text)

            # Bootstrapping the next process must restore the engine profile.
            with TestClient(build_app(root=str(ws),comfy=OfflineEngine())) as reopened:
                saved=reopened.get("/api/runtime/config").json()
                self.assertTrue(saved["configured"])
                self.assertEqual(saved["comfy_root"],str(comfy.resolve()))
                self.assertEqual(reopened.get("/api/engine").json()["state"],"stopped")

            from bellekpad.workspace_backup import restore_backup
            archive=next((ws/"backups").glob("workspace-*.efss-backup.zip"))
            restored=root/"data-restored"
            restore_backup(archive,restored)
            self.assertEqual(Workspace(restored).get_runtime_profile()["python_executable"],
                             str(python.resolve()))


if __name__=="__main__":
    unittest.main()

"""Full mocked Comfy job lifecycle through local API + durable SQLite.

These tests DO NOT claim real inference, native Windows, or real Comfy is verified.
"""
from __future__ import annotations
import sqlite3
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad.api import build_app
from bellekpad.comfy import EngineOffline


REGISTRY = {
    "Text": {"input": {"required": {"text": ["STRING", {}]}}, "output": ["TEXT"]},
    "Viewer": {"input": {"required": {"data": ["TEXT", {}]}}, "output": []},
}


def graph():
    return {"nodes": [
        {"id": "1", "type": "Text", "inputs": {"text": "Merhaba"}},
        {"id": "2", "type": "Viewer", "inputs": {}}],
        "edges": [{"source": "1", "sourceHandle": 0, "target": "2", "targetHandle": "data"}]}


class FakeSupervisor:
    state = "ready"

    def status(self):
        return {"state": self.state, "pid": 40, "failure": None}

    async def close(self):
        pass


class FakeComfy:
    def __init__(self):
        self.engine_id = str(uuid.uuid4())
        self.submitted = []
        self.current = "pending"
        self.image_requests = []
        self.cancel_calls = []

    async def ready(self):
        return True

    async def node_registry(self):
        return REGISTRY

    async def submit(self, compiled):
        self.submitted.append(compiled)
        return {"job_id": self.engine_id, "queue_number": 7}

    async def job_status(self, job_id):
        assert job_id == self.engine_id
        return {"status": self.current}

    async def history(self, job_id):
        assert job_id == self.engine_id
        if self.current != "completed":
            return {}
        return {"status": {"status_str": "success", "completed": True},
                "outputs": {"4": {"images": [
                    {"filename": "image_001.png", "subfolder": "outputs/2026",
                     "type": "output"},
                    {"filename": "..\\secrets.txt", "subfolder": "",
                     "type": "output"}
                ]}}}

    async def image(self, filename, subfolder, kind):
        self.image_requests.append((filename, subfolder, kind))
        return (b"\x89PNG\r\n\x1a\n" + b"test", "image/png")

    async def cancel(self, job_id):
        self.cancel_calls.append(job_id)
        return True


class GenerationAPITests(unittest.TestCase):
    def test_submit_state_history_gallery_and_backup(self):
        with tempfile.TemporaryDirectory() as root:
            engine=FakeComfy()
            supervisor=FakeSupervisor()
            with TestClient(build_app(root=root,comfy=engine,
                                      supervisor_override=supervisor)) as api:
                started=api.post("/api/generations",json=graph())
                self.assertEqual(started.status_code,202,started.text)
                value=started.json()
                jid=value["id"]
                self.assertEqual(value["engine_job_id"],engine.engine_id)
                self.assertEqual(value["state"],"queued")
                self.assertEqual(len(engine.submitted),1)
                self.assertEqual(api.get("/api/generations").json()[0]["id"],jid)

                self.assertEqual(api.get("/api/generations/"+jid).json()["state"],"queued")
                engine.current="in_progress"
                self.assertEqual(api.get("/api/generations/"+jid).json()["state"],"running")
                cancelled=api.post("/api/generations/"+jid+"/cancel")
                self.assertEqual(cancelled.status_code,200,cancelled.text)
                self.assertTrue(cancelled.json()["accepted"])
                self.assertEqual(cancelled.json()["state"],"running")  # not fabricated
                engine.current="completed"
                detail=api.get("/api/generations/"+jid).json()
                self.assertEqual(detail["state"],"completed")
                self.assertEqual(len(detail["images"]),1)
                uri=detail["images"][0]["url"]
                image=api.get(uri)
                self.assertEqual(image.status_code,200,image.text[:100] if image.status_code>=400 else "")
                self.assertEqual(image.headers["content-type"],"image/png")
                self.assertEqual(image.headers["x-content-type-options"],"nosniff")
                self.assertEqual(engine.image_requests,[("image_001.png","outputs/2026","output")])
                self.assertEqual(api.get("/api/generations/"+jid+"/images/1").status_code,404)
                self.assertFalse(api.post("/api/generations/"+jid+"/cancel").json()["accepted"])
                self.assertEqual(len(engine.cancel_calls),1)

                foreign=str(uuid.uuid4())
                self.assertEqual(api.get("/api/generations/"+foreign).status_code,404)
                self.assertEqual(api.get("/api/generations/"+foreign+"/images/0").status_code,404)
                self.assertEqual(api.post("/api/generations/"+foreign+"/cancel").status_code,404)
                self.assertEqual(api.get("/api/generations/not-a-uuid").status_code,400)
                self.assertEqual(api.post("/api/backups").status_code,200)
                backup=next((Path(root)/"backups").glob("backup-*.sqlite3"))
                with sqlite3.connect(backup) as db:
                    job=db.execute("SELECT state,prompt_json FROM generation_jobs WHERE id=?",
                                   (jid,)).fetchone()
                    self.assertEqual(job[0],"completed")
                    self.assertIn("Viewer",job[1])

                supervisor.state="stopped"
                offline=api.get("/api/generations/"+jid).json()
                self.assertEqual(offline["state"],"completed")
                self.assertFalse(offline["engine_reachable"])
                self.assertEqual(api.get(uri).status_code,503)
            with TestClient(build_app(root=root,comfy=engine,
                                      supervisor_override=supervisor)) as reopened:
                self.assertEqual(reopened.get("/api/generations").json()[0]["state"],"completed")

    def test_invalid_graph_does_not_submit_or_create_job(self):
        with tempfile.TemporaryDirectory() as root:
            engine=FakeComfy()
            with TestClient(build_app(root=root,comfy=engine,
                                      supervisor_override=FakeSupervisor())) as api:
                bad=graph()
                bad["edges"][0]["targetHandle"]="missing"
                self.assertEqual(api.post("/api/generations",json=bad).status_code,422)
                self.assertEqual(api.get("/api/generations").json(),[])
                self.assertEqual(engine.submitted,[])

    def test_network_timeout_never_becomes_false_failure(self):
        class LostReply(FakeComfy):
            async def submit(self, compiled):
                raise EngineOffline("SIMULATED_TIMEOUT")
        with tempfile.TemporaryDirectory() as root:
            with TestClient(build_app(root=root,comfy=LostReply(),
                                      supervisor_override=FakeSupervisor())) as api:
                response=api.post("/api/generations",json=graph())
                self.assertEqual(response.status_code,503)
                self.assertEqual(response.json()["detail"],"ENGINE_SUBMISSION_UNCONFIRMED")
                jobs=api.get("/api/generations").json()
                self.assertEqual(len(jobs),1)
                self.assertEqual(jobs[0]["state"],"submission_unknown")
                self.assertIsNone(jobs[0]["engine_job_id"])
                self.assertFalse(api.get("/api/generations/"+jobs[0]["id"]).json()["engine_reachable"])


if __name__=="__main__":
    unittest.main()

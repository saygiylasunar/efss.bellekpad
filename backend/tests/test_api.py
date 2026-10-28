"""Core → FastAPI → persistence/engine tests; never use real GPU or user paths."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from bellekpad.api import build_app


REGISTRY = {
    "Text": {"input": {"required": {"text": ["STRING", {}]}}, "output": ["TEXT"]},
    "Viewer": {"input": {"required": {"data": ["TEXT", {}]}}, "output": []},
}


class FakeComfy:
    def __init__(self):
        self.last_prompt = None

    async def ready(self):
        return True

    async def node_registry(self):
        return REGISTRY

    async def submit(self, prompt):
        self.last_prompt = prompt
        return {"job_id": "12345678-1234-1234-1234-123456789abc", "queue_number": 1}

    async def history(self, job_id):
        return {"job_id": job_id, "outputs": {}}

    async def cancel(self, job_id):
        return True


class FakeSupervisor:
    def status(self):
        return {"state": "ready", "pid": 123, "failure": None}

    async def close(self):
        pass


class IntegrationTests(unittest.TestCase):
    def test_graph_to_comfy_through_api_and_error_boundary(self):
        with tempfile.TemporaryDirectory() as root:
            fake = FakeComfy()
            with TestClient(build_app(root=root, comfy=fake, supervisor_override=FakeSupervisor())) as client:
                graph = {"nodes": [
                    {"id": "1", "type": "Text", "inputs": {"text": "Merhaba"}},
                    {"id": "2", "type": "Viewer", "inputs": {}}],
                    "edges": [{"source": "1", "sourceHandle": 0, "target": "2", "targetHandle": "data"}]}
                result = client.post("/api/generations", json=graph)
                self.assertEqual(result.status_code, 202, result.text)
                self.assertEqual(fake.last_prompt["2"]["inputs"]["data"], ["1", 0])
                bad = dict(graph, edges=[{"source": [], "target": "2", "sourceHandle": 0, "targetHandle": "data"}])
                self.assertEqual(client.post("/api/workflows/compile", json=bad).status_code, 422)
                self.assertEqual(client.post("/api/generations", json=graph,
                    headers={"Origin": "https://attacker.example"}).status_code, 403)
                self.assertEqual(client.get("/api/health", headers={"Host": "attacker.example"}).status_code, 403)

    def test_actual_vite_127_origin_allows_mutations_but_foreign_origin_does_not(self):
        """Regression: screenshots showed GET working while POST notes/backups failed.

        Browser runs at 127.0.0.1:5173; Vite proxies /api to 127.0.0.1:8765
        and forwards the Origin header on POST/PATCH requests.
        """
        with tempfile.TemporaryDirectory() as root:
            with TestClient(build_app(root=root, comfy=FakeComfy(),
                                      supervisor_override=FakeSupervisor())) as client:
                for origin in ("http://127.0.0.1:5173", "http://localhost:5173"):
                    headers = {"Origin": origin}
                    created = client.post("/api/notes",
                        json={"title": "Başlık", "source": "Satır\n"}, headers=headers)
                    self.assertEqual(created.status_code, 200, created.text)
                    note_id = created.json()["id"]
                    doc = client.get("/api/notes/" + note_id, headers=headers)
                    self.assertEqual(doc.status_code, 200, doc.text)
                    source = doc.json()["projection"]
                    modified = client.patch("/api/notes/" + note_id,
                        json={"revision": doc.json()["revision"],
                              "source_sha": source["revision"],
                              "changes": [{"id": "line-0",
                                           "hash": source["blocks"][0]["hash"],
                                           "text": "Güncel"}]}, headers=headers)
                    self.assertEqual(modified.status_code, 200, modified.text)
                    backup = client.post("/api/workspace-backups", headers=headers)
                    self.assertEqual(backup.status_code, 201, backup.text)
                    self.assertTrue(backup.json()["valid"])
                    checked = client.post("/api/workspace-backups/"
                        + backup.json()["name"] + "/verify", headers=headers)
                    self.assertEqual(checked.status_code, 200, checked.text)

                foreign = client.post("/api/notes",
                    json={"title": "Blocked"}, headers={"Origin": "http://127.0.0.1:6000"})
                self.assertEqual(foreign.status_code, 403)
                self.assertEqual(foreign.json()["error"], "UNTRUSTED_ORIGIN")

    def test_note_edit_and_database_backup_over_http(self):
        with tempfile.TemporaryDirectory() as root:
            with TestClient(build_app(root=root, comfy=FakeComfy(), supervisor_override=FakeSupervisor())) as client:
                note = client.post("/api/notes", json={"title": "Test", "source": "# Başlık\r\nDünya\r\n&x{1}\r\n"})
                self.assertEqual(note.status_code, 200, note.text)
                nid = note.json()["id"]
                doc = client.get("/api/notes/" + nid).json()
                revision = doc["projection"]["revision"]
                blocks = doc["projection"]["blocks"]
                updated = client.patch("/api/notes/" + nid, json={
                    "revision": doc["revision"], "source_sha": revision,
                    "changes": [{"id":"line-1", "hash":blocks[1]["hash"], "text":"Ersen"}]})
                self.assertEqual(updated.status_code, 200, updated.text)
                self.assertIn("Ersen\r\n&x{1}",client.get("/api/notes/" + nid).json()["source"])
                stale = client.patch("/api/notes/" + nid, json={
                    "revision": doc["revision"], "source_sha": revision, "changes":[]})
                self.assertEqual(stale.status_code, 409)
                self.assertTrue(client.post("/api/backups").json()["created"])
                self.assertEqual(len(list((Path(root) / "backups").glob("backup-*.sqlite3"))), 1)


if __name__ == "__main__":
    unittest.main()

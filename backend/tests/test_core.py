import asyncio
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

# No external dependencies are required for the core contract tests.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad.workflow import compile_graph, WorkflowError
from bellekpad.efss import project, patch, SourceConflict
from bellekpad.storage import Workspace


REGISTRY = {
    "Text": {"input": {"required": {"text": ["STRING", {}]}}, "output": ["TEXT"]},
    "Viewer": {"input": {"required": {"data": ["TEXT", {}]}}, "output": []},
}


class WorkflowTests(unittest.TestCase):
    def graph(self):
        return {"nodes": [
            {"id": "1", "type": "Text", "inputs": {"text": "Merhaba"}},
            {"id": "2", "type": "Viewer", "inputs": {}}],
            "edges": [{"source": "1", "sourceHandle": 0, "target": "2", "targetHandle": "data"}]}

    def test_compile(self):
        result = compile_graph(self.graph(), REGISTRY)
        self.assertEqual(result["2"]["inputs"]["data"], ["1", 0])
        self.assertEqual(result["1"]["inputs"]["text"], "Merhaba")

    def test_unauthorized_node_rejected(self):
        graph = self.graph()
        graph["nodes"][0]["type"] = "ExecuteShell"
        with self.assertRaisesRegex(WorkflowError, "UNKNOWN_NODE_TYPE"):
            compile_graph(graph, REGISTRY)

    def test_cycles_rejected(self):
        reg = {"Loop": {"input": {"required": {"item": ["TEXT", {}]}}, "output": ["TEXT"]}}
        graph = {"nodes": [{"id": "a", "type": "Loop"}, {"id": "b", "type": "Loop"}],
                 "edges": [{"source": "a", "sourceHandle": 0, "target": "b", "targetHandle": "item"},
                           {"source": "b", "sourceHandle": 0, "target": "a", "targetHandle": "item"}]}
        with self.assertRaisesRegex(WorkflowError, "CYCLE_DETECTED"):
            compile_graph(graph, reg)

    def test_incompatible_port(self):
        graph = self.graph()
        reg = {**REGISTRY, "Text": {"input": {"required": {"text": ["STRING", {}]}}, "output": ["IMAGE"]}}
        with self.assertRaisesRegex(WorkflowError, "INCOMPATIBLE_PORT"):
            compile_graph(graph, reg)


class EFSSTests(unittest.TestCase):
    def test_opaque_source_survives(self):
        original = "# Başlık\r\nMetin\r\n&Özel{abc}\r\n| a | b |\r\n"
        p = project(original)
        self.assertEqual([b["editable"] for b in p["blocks"]], [True, True, False, False])
        modified = patch(original, p["revision"], [{"id": "line-1", "hash": p["blocks"][1]["hash"], "text": "Yeni metin"}])
        self.assertEqual(modified, "# Başlık\r\nYeni metin\r\n&Özel{abc}\r\n| a | b |\r\n")
        with self.assertRaises(SourceConflict):
            patch(modified, p["revision"], [])
        with self.assertRaisesRegex(SourceConflict, "OPAQUE_OR_STALE_BLOCK"):
            patch(original, p["revision"], [{"id": "line-2", "hash": p["blocks"][2]["hash"], "text": "kaybolsun"}])

    def test_unchanged_source_byte_for_byte(self):
        raw = "İ/ı👩‍💻 \n```efss\r\nunsupported\r\n```\r\n"
        self.assertEqual(patch(raw, project(raw)["revision"], []), raw)


class StorageTests(unittest.TestCase):
    def test_revision_and_online_backup(self):
        with tempfile.TemporaryDirectory() as d:
            vault = Workspace(d)
            item = vault.new_note("Deneme", "# Selam\nDünya\n&x{1}\n")
            opened = vault.get_note(item["id"])
            b = opened["projection"]
            saved = vault.patch_note(item["id"], 1, b["revision"],
                [{"id": "line-1", "hash": b["blocks"][1]["hash"], "text": "Ersen"}])
            self.assertEqual(saved["revision"], 2)
            with self.assertRaises(SourceConflict):
                vault.patch_note(item["id"], 1, b["revision"], [])
            backup = vault.backup()
            self.assertTrue(backup.exists())
            with sqlite3.connect(backup) as db:
                self.assertEqual(db.execute("select revision from notes").fetchone()[0], 2)


if __name__ == "__main__":
    unittest.main()

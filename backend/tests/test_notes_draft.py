"""EFSS note draft tests from actual Windows browser observations.

Never allow visual editor changes to silently rewrite unknown source constructs.
"""
import sys
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad.api import build_app
from bellekpad.efss import SourceConflict, project, rewrite_blocks


def entry(block, **changes):
    return {"id": block["id"], "hash": block["hash"], "kind": block["kind"],
            "text": block["text"], "level": block["level"], **changes}


def fresh(text, kind="paragraph", level=None):
    return {"id": None, "hash": None, "kind": kind, "text": text, "level": level}


class NoteDraftCoreTests(unittest.TestCase):
    def test_multiline_enter_hash_number_and_line_ending(self):
        src = "Yeni not\r\n"
        p = project(src)
        result = rewrite_blocks(src,p["revision"],[
            entry(p["blocks"][0],text="Afdk"),
            fresh("elsire"),
            fresh("#31")])
        self.assertEqual(result, "Afdk\r\nelsire\r\n#31\r\n")
        self.assertEqual([x["kind"] for x in project(result)["blocks"]],
                         ["paragraph","paragraph","paragraph"])

    def test_opaque_line_survives_insertion_safe_line_deletion_and_reordering_refused(self):
        src = "# Başlık\r\nDüz\r\n&Özel{abc}\r\nGereksiz\r\n"
        p=project(src)
        self.assertEqual([b["kind"] for b in p["blocks"]],
                         ["heading","paragraph","opaque","paragraph"])
        updated=rewrite_blocks(src,p["revision"],[
            entry(p["blocks"][0], text="Yeni başlık"),
            fresh("Araya yeni"),
            entry(p["blocks"][1], text="Değişti"),
            entry(p["blocks"][2])])
        self.assertEqual(updated,
                         "# Yeni başlık\r\nAraya yeni\r\nDeğişti\r\n&Özel{abc}\r\n")
        with self.assertRaisesRegex(SourceConflict,"OPAQUE_SOURCE_REMOVED"):
            rewrite_blocks(src,p["revision"],[entry(p["blocks"][0])])
        with self.assertRaisesRegex(SourceConflict,"REORDERED_OR_DUPLICATE_SOURCE_BLOCK"):
            rewrite_blocks(src,p["revision"],[
                entry(p["blocks"][2]),entry(p["blocks"][1]),entry(p["blocks"][0])])
        with self.assertRaisesRegex(SourceConflict,"OPAQUE_SOURCE_CHANGED"):
            rewrite_blocks(src,p["revision"],[
                entry(p["blocks"][0]),entry(p["blocks"][1]),
                entry(p["blocks"][2], text="forget"),entry(p["blocks"][3])])

    def test_newline_after_unterminated_source_and_empty_line(self):
        src="son satır"
        p=project(src)
        result=rewrite_blocks(src,p["revision"],[
            entry(p["blocks"][0]),fresh(""),fresh("devam")])
        self.assertEqual(result, "son satır\n\ndevam\n")
        self.assertEqual([b["kind"] for b in project(result)["blocks"]],
                         ["paragraph","paragraph","paragraph"])

    def test_new_heading_and_unsupported_syntax(self):
        output=rewrite_blocks("",project("")["revision"],[
            fresh("Yeni başlık","heading",2),fresh("açıklama")])
        self.assertEqual(output,"## Yeni başlık\naçıklama\n")
        self.assertEqual(project(output)["blocks"][0]["level"],2)
        with self.assertRaisesRegex(SourceConflict,"UNSUPPORTED_TEXT"):
            rewrite_blocks("",project("")["revision"],[fresh("&EFSS{secret}")])
        with self.assertRaisesRegex(SourceConflict,"SOURCE_REVISION_CONFLICT"):
            rewrite_blocks("not",project("")["revision"],[fresh("yeni")])


class OfflineEngine:
    def status(self):
        return {"state":"unconfigured","pid":None,"failure":None}
    async def close(self):
        pass


class NoteDraftAPITests(unittest.TestCase):
    def test_browser_enter_save_reopen_and_backup_no_comfy(self):
        with tempfile.TemporaryDirectory() as root:
            with TestClient(build_app(root=root,supervisor_override=OfflineEngine())) as api:
                new=api.post("/api/notes",json={"title":"ersen","source":""},
                    headers={"Origin":"http://127.0.0.1:5173"})
                self.assertEqual(new.status_code,200,new.text)
                nid=new.json()["id"]
                doc=api.get("/api/notes/"+nid).json()
                saved=api.patch("/api/notes/"+nid, json={
                    "revision": doc["revision"],"source_sha":doc["projection"]["revision"],
                    "draft":[fresh("Afdk"),fresh("elsire"),fresh("#31")]},
                    headers={"Origin":"http://127.0.0.1:5173"})
                self.assertEqual(saved.status_code,200,saved.text)
                reopened=api.get("/api/notes/"+nid).json()
                self.assertEqual(reopened["source"],"Afdk\nelsire\n#31\n")
                self.assertEqual(reopened["revision"],2)
                stale=api.patch("/api/notes/"+nid,json={
                    "revision":1,"source_sha":doc["projection"]["revision"],
                    "draft":[fresh("should not overwrite")]})
                self.assertEqual(stale.status_code,409)
                backup=api.post("/api/workspace-backups",
                    headers={"Origin":"http://127.0.0.1:5173"})
                self.assertEqual(backup.status_code,201,backup.text)
                name=backup.json()["name"]
                verify=api.post(f"/api/workspace-backups/{name}/verify",
                    headers={"Origin":"http://127.0.0.1:5173"})
                self.assertEqual(verify.status_code,200,verify.text)


if __name__=="__main__":
    unittest.main()

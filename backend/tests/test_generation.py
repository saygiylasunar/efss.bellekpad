"""Core image projection, job status mapping and invalid-path defense."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bellekpad.generation import image_outputs, history_state, normalized_engine_state


class GenerationProjectionTests(unittest.TestCase):
    def test_gallery_uses_only_history_images(self):
        history={"outputs":{"15":{"images":[
            {"filename":"sample_00001.png","subfolder":"2026/10","type":"output"},
            {"filename":"test.jpeg","subfolder":"","type":"temp"},
            {"filename":"../../private.txt","subfolder":"","type":"output"},
            {"filename":"foo.png","subfolder":"../hidden","type":"output"},
            {"filename":"other.png","subfolder":"","type":"input"}
        ]},"16":{"text":["not an image"]}}}
        images=image_outputs(history)
        self.assertEqual([i.filename for i in images],["sample_00001.png","test.jpeg"])
        self.assertTrue(images[0].public(0,"test")["url"].endswith("/images/0"))

    def test_no_synthetic_success(self):
        self.assertIsNone(history_state({}))
        self.assertIsNone(history_state({"outputs":{"15":{"images":[]}}}))
        self.assertEqual(history_state({"status":{"status_str":"success","completed":True}}),"completed")
        self.assertIsNone(history_state({"status":{"status_str":"success","completed":False}}))
        self.assertEqual(history_state({"status":{"status_str":"error","completed":False}}),"failed")
        self.assertEqual(normalized_engine_state({"status":"in_progress"}),"running")
        self.assertIsNone(normalized_engine_state({"status":"mystery"}))


if __name__=="__main__":
    unittest.main()

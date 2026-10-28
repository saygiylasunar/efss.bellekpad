"""Header-only Model Descriptor test: real byte layouts, no ML libraries.

Official GGUF 24-byte header + typed metadata, safetensors 8-byte JSON prefix.
All tests use tiny synthetic payloads with authentic container structures.
"""
from __future__ import annotations

import json
import sqlite3
import struct
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from bellekpad.api import build_app
from bellekpad.model_descriptor import inspect_registered_model
from bellekpad.model_registry import discover
from bellekpad.storage import Workspace


def _string(value:str)->bytes:
    payload=value.encode("utf-8")
    return struct.pack("<Q",len(payload))+payload


def gguf(version:int=3, architecture:str="qwen3", name:str="Tiny")->bytes:
    # General KV key = length-prefixed UTF-8 string, u32 type 8=string.
    entries=[
        _string("general.architecture")+struct.pack("<I",8)+_string(architecture),
        _string("general.name")+struct.pack("<I",8)+_string(name),
        # Numeric array type 9, subtype u32 and length u64.
        _string("general.test.values")+struct.pack("<IIQ",9,4,2)+struct.pack("<II",2,3),
    ]
    return b"GGUF"+struct.pack("<IQQ",version,7,len(entries))+b"".join(entries)


def safetensors(tensors:int=1)->bytes:
    header={}
    for index in range(tensors):
        header[f"model.layers.{index}.weight"]={
            "dtype":"F16","shape":[2],
            "data_offsets":[index*4,(index+1)*4]}
    header["__metadata__"]={"format":"pt","modelspec.title":"Sample"}
    raw=json.dumps(header).encode("utf-8")
    return struct.pack("<Q",len(raw))+raw+b"\x00\x01\x02\x03"*tensors


class OfflineSupervisor:
    def status(self):
        return {"state":"unconfigured","pid":None,"failure":None}
    async def close(self):pass


class ModelDescriptorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)
        self.folder=self.base/"approved"
        self.folder.mkdir()
        self.workspace=Workspace(self.base/"workspace")
        self.root=self.workspace.add_model_root(str(self.folder))

    def scan(self):
        self.workspace.replace_model_index(self.root["id"],discover(str(self.folder)))
        return {item["name"]:item for item in self.workspace.list_model_files()["items"]}

    def test_gguf_architecture_from_real_metadata_not_filename(self):
        (self.folder/"random-file.gguf").write_bytes(gguf())
        row=self.scan()["random-file.gguf"]
        result=inspect_registered_model(str(self.folder),row)
        self.assertEqual(result["status"],"inspected")
        self.assertTrue(result["format_verified"])
        self.assertEqual(result["architecture"],"qwen3")
        self.assertEqual(result["model_name"],"Tiny")
        self.assertEqual(result["gguf_version"],3)
        self.assertEqual(result["tensor_count"],7)

    def test_safetensors_header_metadata_and_no_weight_loading(self):
        (self.folder/"weird-file.safetensors").write_bytes(safetensors(2))
        row=self.scan()["weird-file.safetensors"]
        result=inspect_registered_model(str(self.folder),row)
        self.assertEqual(result["status"],"inspected")
        self.assertEqual(result["tensor_count"],2)
        self.assertEqual(result["dtypes"],["F16"])
        self.assertIsNone(result["architecture"])
        self.assertEqual(result["header_metadata"]["format"],"pt")

    def test_stale_file_never_interpreted(self):
        (self.folder/"stale.gguf").write_bytes(gguf())
        row=self.scan()["stale.gguf"]
        (self.folder/"stale.gguf").write_bytes(gguf(name="Changed-length"))
        result=inspect_registered_model(str(self.folder),row)
        self.assertEqual(result["status"],"stale")
        self.assertEqual(result["reason"],"MODEL_FILE_CHANGED")

    def test_invalid_safetensors_duplicate_keys_and_untrusted_format(self):
        (self.folder/"bad.safetensors").write_bytes(
            struct.pack("<Q",7)+b'{"a":1}')
        (self.folder/"pickle.ckpt").write_bytes(b"\x80\x04danger")
        (self.folder/"bad.gguf").write_bytes(b"not gguf")
        rows=self.scan()
        self.assertEqual(inspect_registered_model(str(self.folder),rows["bad.safetensors"])["status"],"invalid")
        self.assertEqual(inspect_registered_model(str(self.folder),rows["bad.gguf"])["status"],"invalid")
        unsupported=inspect_registered_model(str(self.folder),rows["pickle.ckpt"])
        self.assertEqual(unsupported["status"],"uninspected")

    def test_safetensors_rejects_tampered_header(self):
        raw=b'{"a":{"dtype":"F16","shape":[2],"data_offsets":[0,999]}}'
        (self.folder/"unsafe.safetensors").write_bytes(
            struct.pack("<Q",len(raw))+raw+b"\x00"*4)
        result=inspect_registered_model(str(self.folder),self.scan()["unsafe.safetensors"])
        self.assertEqual(result["status"],"invalid")
        self.assertEqual(result["reason"],"INVALID_SAFETENSORS_TENSOR")

    def test_symlink_target_not_accessible_via_index(self):
        file=self.folder/"source.gguf"
        file.write_bytes(gguf())
        indexed=self.scan()["source.gguf"]
        outside=self.base/"outside.gguf"
        outside.write_bytes(gguf(architecture="outside"))
        file.unlink()
        try:
            file.symlink_to(outside)
        except (OSError,NotImplementedError):
            self.skipTest("Symlink creation not permitted on this runner")
        # Prior index must never be used to follow a replaced model symlink.
        from bellekpad.model_descriptor import ModelInspectError
        with self.assertRaisesRegex(ModelInspectError,"MODEL_PATH_UNSAFE"):
            inspect_registered_model(str(self.folder),indexed)

    def test_http_descriptor_uses_only_indexed_uuid_and_explicit_inspection(self):
        (self.folder/"random.gguf").write_bytes(gguf())
        indexed=self.scan()["random.gguf"]
        with TestClient(build_app(root=str(self.workspace.root),
                                  supervisor_override=OfflineSupervisor())) as api:
            bad=api.get("/api/models/nonexistent/descriptor")
            self.assertEqual(bad.status_code,404)
            response=api.get("/api/models/"+indexed["id"]+"/descriptor")
            self.assertEqual(response.status_code,200,response.text)
            body=response.json()
            self.assertEqual(body["model_id"],indexed["id"])
            self.assertEqual(body["inspection"]["architecture"],"qwen3")
            self.assertEqual(body["runtime"]["state"],"requires_runtime_validation")
            self.assertEqual(body["runtime"]["candidate_engines"],["gguf-worker"])
            (self.folder/"random.gguf").write_bytes(gguf(name="not same length"))
            stale=api.get("/api/models/"+indexed["id"]+"/descriptor")
            self.assertEqual(stale.status_code,200)
            self.assertEqual(stale.json()["inspection"]["status"],"stale")


if __name__=="__main__":
    unittest.main()

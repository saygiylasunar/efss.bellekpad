"""Read-only Model Descriptor, bound to an explicitly indexed model file.

Inspects *headers*, not weights; never imports torch/safetensors inference or
unpickles a PyTorch .pt/.ckpt. Does not promise the model can be loaded.
"""
from __future__ import annotations

import json
import os
import stat
import struct
from pathlib import Path

HEADER_LIMIT = 32 * 1024 * 1024
MAX_GGUF_KV = 100_000
MAX_GGUF_STRING_ARRAY = 100_000
GGUF_PRIMITIVES = {0:1, 1:1, 2:2, 3:2, 4:4, 5:4, 6:4, 7:1,
                   10:8, 11:8, 12:8}
GGUF_KNOWN_TYPES = set(GGUF_PRIMITIVES) | {8, 9}


class ModelInspectError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class HeaderInvalid(Exception):
    pass


class HeaderLimited(Exception):
    pass


def _pairs_unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise HeaderInvalid("DUPLICATE_HEADER_KEY")
        result[key] = value
    return result


def _safetensors(handle, file_size: int) -> dict:
    length_bytes = handle.read(8)
    if len(length_bytes) != 8:
        raise HeaderInvalid("SHORT_SAFETENSORS_HEADER")
    length, = struct.unpack("<Q", length_bytes)
    if length > HEADER_LIMIT:
        raise HeaderLimited("SAFETENSORS_HEADER_LIMIT")
    if length < 2 or length > file_size - 8:
        raise HeaderInvalid("INVALID_SAFETENSORS_LENGTH")
    raw = handle.read(length)
    if len(raw) != length or raw[:1] != b"{":
        raise HeaderInvalid("INVALID_SAFETENSORS_JSON")
    try:
        header = json.loads(raw, object_pairs_hook=_pairs_unique)
    except HeaderInvalid:
        raise
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise HeaderInvalid("INVALID_SAFETENSORS_JSON") from exc
    if not isinstance(header, dict):
        raise HeaderInvalid("INVALID_SAFETENSORS_JSON")
    metadata = header.pop("__metadata__", {})
    if not isinstance(metadata, dict) or any(
            not isinstance(k, str) or not isinstance(v, str)
            for k, v in metadata.items()):
        raise HeaderInvalid("INVALID_SAFETENSORS_METADATA")
    tensor_count = 0
    dtypes: set[str] = set()
    limits = file_size - length - 8
    for name, item in header.items():
        if not isinstance(name, str) or not isinstance(item, dict):
            raise HeaderInvalid("INVALID_SAFETENSORS_TENSOR")
        dtype, shape, offsets = item.get("dtype"), item.get("shape"), item.get("data_offsets")
        if (not isinstance(dtype, str) or not isinstance(shape, list)
                or not all(type(d) is int and d >= 0 for d in shape)
                or not isinstance(offsets, list) or len(offsets) != 2
                or any(type(v) is not int for v in offsets)
                or not 0 <= offsets[0] <= offsets[1] <= limits):
            raise HeaderInvalid("INVALID_SAFETENSORS_TENSOR")
        tensor_count += 1
        dtypes.add(dtype)
    # A valid index is a header structure validation, not a payload checksum.
    return {"format_verified": True, "architecture": None,
            "tensor_count": tensor_count, "dtypes": sorted(dtypes),
            "header_metadata": {k: metadata[k] for k in sorted(metadata)
                                if k in {"format", "modelspec.architecture", "modelspec.title"}},
            "note": "HEADER_ONLY_NOT_INFERENCE_VERIFIED"}


def _read_exact(f, size: int, ceiling: int):
    if size < 0 or f.tell() + size > ceiling:
        raise HeaderLimited("GGUF_METADATA_LIMIT")
    b = f.read(size)
    if len(b) != size:
        raise HeaderInvalid("TRUNCATED_GGUF_METADATA")
    return b


def _u32(f, ceiling: int) -> int:
    return struct.unpack("<I", _read_exact(f, 4, ceiling))[0]


def _u64(f, ceiling: int) -> int:
    return struct.unpack("<Q", _read_exact(f, 8, ceiling))[0]


def _gguf_string(f, ceiling: int, read: bool) -> str | None:
    count = _u64(f, ceiling)
    if count > ceiling - f.tell():
        raise HeaderLimited("GGUF_METADATA_LIMIT")
    if read and count <= 4096:
        try:
            return _read_exact(f, count, ceiling).decode("utf-8")
        except UnicodeError as exc:
            raise HeaderInvalid("GGUF_STRING_INVALID") from exc
    f.seek(count, 1)
    return None


def _gguf_skip_value(f, dtype: int, ceiling: int) -> str | int | None:
    if dtype in GGUF_PRIMITIVES:
        length = GGUF_PRIMITIVES[dtype]
        raw = _read_exact(f, length, ceiling)
        if dtype == 4:
            return struct.unpack("<I", raw)[0]
        return None
    if dtype == 8:
        return _gguf_string(f, ceiling, read=True)
    if dtype == 9:
        subtype = _u32(f, ceiling)
        count = _u64(f, ceiling)
        if subtype in GGUF_PRIMITIVES:
            size = count * GGUF_PRIMITIVES[subtype]
            _read_exact_skip(f, size, ceiling)
        elif subtype == 8:
            if count > MAX_GGUF_STRING_ARRAY:
                raise HeaderLimited("GGUF_STRING_ARRAY_LIMIT")
            for _ in range(count):
                _gguf_string(f, ceiling, read=False)
        else:
            raise HeaderLimited("GGUF_UNKNOWN_ARRAY_TYPE")
        return None
    raise HeaderLimited("GGUF_UNKNOWN_VALUE_TYPE")


def _read_exact_skip(f, length: int, ceiling: int) -> None:
    if length < 0 or f.tell() + length > ceiling:
        raise HeaderLimited("GGUF_METADATA_LIMIT")
    f.seek(length, 1)


def _gguf(handle, file_size: int) -> dict:
    raw = handle.read(24)
    if len(raw) != 24 or raw[:4] != b"GGUF":
        raise HeaderInvalid("INVALID_GGUF_MAGIC")
    _, version, tensor_count, kv_count = struct.unpack("<4sIQQ", raw)
    if version not in (2, 3):
        raise HeaderLimited("GGUF_VERSION_UNSUPPORTED")
    if kv_count > MAX_GGUF_KV:
        raise HeaderLimited("GGUF_TOO_MANY_METADATA_ENTRIES")
    ceiling = min(file_size, HEADER_LIMIT)
    architecture = None
    model_name = None
    for _ in range(kv_count):
        key = _gguf_string(handle, ceiling, read=True)
        if key is None:
            raise HeaderLimited("GGUF_KEY_TOO_LONG")
        dtype = _u32(handle, ceiling)
        value = _gguf_skip_value(handle, dtype, ceiling)
        if key == "general.architecture" and dtype == 8:
            architecture = value
        if key == "general.name" and dtype == 8:
            model_name = value
    return {"format_verified": True, "architecture": architecture,
            "tensor_count": tensor_count, "gguf_version": version,
            "model_name": model_name, "note": "HEADER_ONLY_NOT_INFERENCE_VERIFIED"}


def inspect_registered_model(root_path: str, indexed: dict) -> dict:
    """Server-controlled lookup; the browser never supplies arbitrary file paths."""
    relative = indexed["relative_path"]
    # Index paths are stored as POSIX-style paths even on Windows.
    parts = relative.split("/")
    if (not parts or any(part in ("", ".", "..") for part in parts)
            or any("\\" in part or ":" in part for part in parts)):
        raise ModelInspectError("MODEL_PATH_INVALID")
    root = Path(root_path)
    path = root.joinpath(*parts)
    try:
        if (not root.is_dir() or root.is_symlink()
                or any(root.joinpath(*parts[:i]).is_symlink()
                       for i in range(1, len(parts) + 1))):
            raise ModelInspectError("MODEL_PATH_UNSAFE")
        resolved_root = root.resolve(strict=True)
        resolved_file = path.resolve(strict=True)
        if not resolved_file.is_relative_to(resolved_root):
            raise ModelInspectError("MODEL_PATH_UNSAFE")
        with resolved_file.open("rb") as file:
            info = os.fstat(file.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise ModelInspectError("MODEL_PATH_UNSAFE")
            if info.st_size != indexed["size_bytes"] or info.st_mtime_ns != indexed["modified_ns"]:
                return {"status":"stale", "format_verified": False,
                        "reason":"MODEL_FILE_CHANGED"}
            fmt = indexed["format"]
            try:
                if fmt == "safetensors":
                    result = _safetensors(file, info.st_size)
                elif fmt == "gguf":
                    result = _gguf(file, info.st_size)
                else:
                    return {"status":"uninspected","format_verified":False,
                            "reason":"HEADER_INSPECTOR_NOT_AVAILABLE"}
            except HeaderLimited as exc:
                return {"status":"limited","format_verified":False,
                        "reason":str(exc)}
            except HeaderInvalid as exc:
                return {"status":"invalid","format_verified":False,
                        "reason":str(exc)}
    except ModelInspectError:
        raise
    except (OSError, RuntimeError) as exc:
        raise ModelInspectError("MODEL_FILE_UNAVAILABLE") from exc
    return {"status":"inspected",**result}


def execution_contract(indexed: dict, inspected: dict) -> dict:
    """Possible engines, no fake installed/compatible claim or launch action."""
    if inspected.get("status") != "inspected":
        return {"state":"unverified","candidate_engines":[]}
    possible = {
        "gguf":["gguf-worker"],
        "safetensors":["pytorch-transformers","comfyui"],
    }.get(indexed["format"], [])
    return {"state":"requires_runtime_validation","candidate_engines":possible}

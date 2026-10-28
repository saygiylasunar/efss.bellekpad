"""Opt-in local model-file discovery.

A model registry is an index, not a loader.  It must not infer runtime support
from an extension, read multi-GB payloads, duplicate weights, or scan any path
other than the user-approved roots.  Model family is intentionally unknown.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path

# File formats are hints only; runners decide whether a file can actually load.
MODEL_SUFFIXES = frozenset({
    ".gguf", ".safetensors", ".ckpt", ".pt", ".pth", ".onnx", ".bin"
})
# Hints come from established folder conventions, not verified model metadata.
COMPONENT_FOLDERS = {
    "checkpoints": "checkpoint",
    "diffusion_models": "diffusion",
    "unet": "diffusion",
    "loras": "lora",
    "lora": "lora",
    "vae": "vae",
    "text_encoders": "text_encoder",
    "clip": "text_encoder",
    "controlnet": "controlnet",
    "ipadapter": "adapter",
    "embeddings": "embedding",
    "upscale_models": "upscaler",
}


class ModelRegistryError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def normalize_root(path: str) -> str:
    if not isinstance(path, str) or not path.strip():
        raise ModelRegistryError("MODEL_ROOT_REQUIRED")
    root = Path(path).expanduser()
    if not root.is_absolute():
        raise ModelRegistryError("MODEL_ROOT_MUST_BE_ABSOLUTE")
    try:
        resolved = root.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ModelRegistryError("MODEL_ROOT_UNAVAILABLE") from exc
    if not resolved.is_dir():
        raise ModelRegistryError("MODEL_ROOT_NOT_DIRECTORY")
    return str(resolved)


def discover(root_path: str) -> list[dict]:
    """Return an all-or-nothing local directory snapshot.

    Follow neither directory nor file symlinks.  Descendants come strictly
    from scandir() under the approved root, never global search.
    Any read error aborts the snapshot; callers must retain previous index.
    """
    root = Path(normalize_root(root_path))
    pending = [root]
    found: list[dict] = []
    while pending:
        directory = pending.pop()
        try:
            with os.scandir(directory) as entries:
                for entry in entries:
                    # Descendant links must not expand an approved directory.
                    if entry.is_symlink():
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        pending.append(Path(entry.path))
                        continue
                    if not entry.is_file(follow_symlinks=False):
                        continue
                    suffix = Path(entry.name).suffix.casefold()
                    if suffix not in MODEL_SUFFIXES:
                        continue
                    info = entry.stat(follow_symlinks=False)
                    if not stat.S_ISREG(info.st_mode):
                        continue
                    rel = Path(entry.path).relative_to(root)
                    # Only a hint; never claim model family or runtime support.
                    hint = next((COMPONENT_FOLDERS[p.casefold()]
                                 for p in reversed(rel.parts[:-1])
                                 if p.casefold() in COMPONENT_FOLDERS), None)
                    found.append({
                        "relative_path": rel.as_posix(),
                        "name": entry.name,
                        "format": suffix[1:],
                        "component_hint": hint or "unknown",
                        "size_bytes": info.st_size,
                        "modified_ns": info.st_mtime_ns,
                    })
        except (OSError, PermissionError, RuntimeError) as exc:
            raise ModelRegistryError("MODEL_SCAN_INCOMPLETE") from exc
    found.sort(key=lambda x: x["relative_path"].casefold())
    return found

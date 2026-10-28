"""Generation job contract and safe image-output projection.

A 'submitted' HTTP request is NOT evidence of successful generation.
Only runtime job state/history can complete a job. The image gallery only
exposes image files named in the history of a job owned by this workspace.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

IMAGE_TYPES = frozenset(("output", "temp"))
MAX_GALLERY_IMAGES = 256


class GenerationError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def parse_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise GenerationError("INVALID_JOB_ID") from exc


@dataclass(frozen=True)
class ImageOutput:
    node_id: str
    filename: str
    subfolder: str
    kind: str

    def public(self, index: int, job_id: str) -> dict:
        return {
            "index": index,
            "node_id": self.node_id,
            "filename": self.filename,
            "url": f"/api/generations/{job_id}/images/{index}",
        }


def image_outputs(history: dict) -> list[ImageOutput]:
    """Only ComfyUI history output image entries; no arbitrary UI-provided filenames."""
    if not isinstance(history, dict):
        return []
    outputs = history.get("outputs")
    if not isinstance(outputs, dict):
        return []
    images = []
    for node_id, details in outputs.items():
        if not isinstance(node_id, str) or not isinstance(details, dict):
            continue
        entries = details.get("images")
        if not isinstance(entries, list):
            continue
        for obj in entries:
            if not isinstance(obj, dict):
                continue
            filename = obj.get("filename")
            kind = obj.get("type", "output")
            subfolder = obj.get("subfolder", "")
            if (not isinstance(filename, str) or not filename or len(filename) > 512
                or "/" in filename or "\\" in filename or filename in (".", "..")
                or not isinstance(kind, str) or kind not in IMAGE_TYPES
                or not isinstance(subfolder, str) or len(subfolder) > 1024
                or subfolder.startswith(("/", "\\")) or ".." in subfolder.split("/")
                or "\\" in subfolder):
                continue
            images.append(ImageOutput(node_id, filename, subfolder, kind))
            if len(images) >= MAX_GALLERY_IMAGES:
                return images
    return images


def history_state(history: dict) -> str | None:
    """Conservative legacy fallback: no history means NOT 'complete'."""
    if not isinstance(history, dict) or not history:
        return None
    status = history.get("status")
    if not isinstance(status, dict):
        return None
    name = status.get("status_str")
    if name == "error":
        return "failed"
    if name in ("cancelled", "canceled", "interrupted"):
        return "cancelled"
    if name == "success" and status.get("completed") is True:
        return "completed"
    return None


def normalized_engine_state(raw: dict) -> str | None:
    if not isinstance(raw, dict):
        return None
    value = raw.get("status")
    return {
        "waiting_to_dispatch": "queued",
        "pending": "queued",
        "queued": "queued",
        "in_progress": "running",
        "running": "running",
        "completed": "completed",
        "success": "completed",
        "error": "failed",
        "failed": "failed",
        "cancelled": "cancelled",
        "canceled": "cancelled",
    }.get(value)

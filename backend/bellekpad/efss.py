"""Lossless source boundary for the first EFSS/Tiptap adapter slice.

Only provably safe single-line plain paragraphs and # headings are editable.
Every other source line is an opaque read-only node, *including unknown EFSS*.
No generic markdown serializer is permitted to rewrite such source.
"""
from __future__ import annotations
import hashlib
import re

_HEADING = re.compile(r"^(#{1,6}) (.*)$")
_PLAIN = re.compile(r"^[^\r\n#>&|*/~\`!{}\\\[\]]+$")


class SourceConflict(ValueError):
    pass


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def project(source: str) -> dict:
    lines = source.splitlines(keepends=True)
    blocks = []
    for i, raw in enumerate(lines):
        if raw.endswith("\r\n"):
            body, ending = raw[:-2], "\r\n"
        elif raw.endswith(("\n", "\r")):
            body, ending = raw[:-1], raw[-1]
        else:
            body, ending = raw, ""
        heading = _HEADING.fullmatch(body)
        if heading and _PLAIN.fullmatch(heading.group(2)):
            kind, content, level = "heading", heading.group(2), len(heading.group(1))
        elif body and _PLAIN.fullmatch(body) and not body.startswith((" ", "-", "+", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9")):
            kind, content, level = "paragraph", body, None
        else:
            kind, content, level = "opaque", body, None
        blocks.append({"id": f"line-{i}", "kind": kind, "text": content,
                       "level": level, "editable": kind != "opaque",
                       "hash": _hash(raw), "ending": ending})
    return {"revision": _hash(source), "blocks": blocks}


def patch(source: str, expected_revision: str, changes: list[dict]) -> str:
    if _hash(source) != expected_revision:
        raise SourceConflict("SOURCE_REVISION_CONFLICT")
    lines = source.splitlines(keepends=True)
    snapshot = project(source)["blocks"]
    seen = set()
    for change in changes:
        if not isinstance(change, dict):
            raise SourceConflict("INVALID_CHANGE")
        block_id = change.get("id")
        if not isinstance(block_id, str) or not re.fullmatch(r"line-(0|[1-9][0-9]*)", block_id):
            raise SourceConflict("INVALID_BLOCK")
        i = int(block_id[5:])
        if i >= len(lines) or i in seen:
            raise SourceConflict("INVALID_BLOCK")
        seen.add(i)
        block = snapshot[i]
        if not block["editable"] or change.get("hash") != block["hash"]:
            raise SourceConflict("OPAQUE_OR_STALE_BLOCK")
        text = change.get("text")
        if not isinstance(text, str) or not text or not _PLAIN.fullmatch(text):
            raise SourceConflict("UNSUPPORTED_TEXT")
        prefix = "#" * block["level"] + " " if block["kind"] == "heading" else ""
        lines[i] = prefix + text + block["ending"]
    return "".join(lines)

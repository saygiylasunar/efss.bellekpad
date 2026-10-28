"""Lossless source boundary for the first EFSS/Tiptap adapter slice.

Only provably safe single-line plain paragraphs and # headings are editable.
Every other source line is an opaque read-only node, *including unknown EFSS*.
No generic markdown serializer is permitted to rewrite such source.
"""
from __future__ import annotations
import hashlib
import re

_HEADING = re.compile(r"^(#{1,6}) (.*)$")
_PLAIN = re.compile(r"^[^\r\n>&|*/~\`!{}\\\[\]]*$")


class SourceConflict(ValueError):
    pass


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _is_plain_body(text: str) -> bool:
    # A hashtag without heading whitespace (e.g. "#31") is plain text.
    # Keep list markers, indents and unknown EFSS syntax opaque.
    return (bool(_PLAIN.fullmatch(text))
            and not (text.startswith((" ", "-", "+"))
                     or re.match(r"^\d+[.)]\s", text))
            and not re.match(r"^#{7,}\s", text))


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
        elif _is_plain_body(body):
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


def rewrite_blocks(source: str, expected_revision: str, draft: list[dict]) -> str:
    """Apply a whole ordered editor draft while retaining source-owned opaque lines.

    Existing lines are referenced by stable (revision-scoped) ids and hashes.
    The backend, not the browser, owns original source bytes and line endings.
    New nodes may be plain paragraphs/headings; unknown EFSS source is NEVER
    removed, reordered, transformed, or overwritten by a visual editor.
    """
    if _hash(source) != expected_revision:
        raise SourceConflict("SOURCE_REVISION_CONFLICT")
    if not isinstance(draft, list) or len(draft) > 20_000:
        raise SourceConflict("INVALID_NOTE_DRAFT")
    snapshot = project(source)["blocks"]
    original_lines = source.splitlines(keepends=True)
    used: set[int] = set()
    last_index = -1
    assembled: list[tuple[str, str]] = []
    dominant_end = next((b["ending"] for b in snapshot if b["ending"]), "\n")

    for item in draft:
        if not isinstance(item, dict):
            raise SourceConflict("INVALID_NOTE_DRAFT")
        block_id, kind = item.get("id"), item.get("kind")
        value, level = item.get("text"), item.get("level")
        if kind not in ("paragraph", "heading", "opaque") or not isinstance(value, str):
            raise SourceConflict("INVALID_NOTE_DRAFT")
        if len(value) > 200_000 or "\n" in value or "\r" in value:
            raise SourceConflict("UNSUPPORTED_TEXT")
        if kind == "heading" and (type(level) is not int or not 1 <= level <= 6):
            raise SourceConflict("INVALID_HEADING_LEVEL")
        if kind != "heading" and level is not None:
            raise SourceConflict("INVALID_NOTE_DRAFT")
        if block_id is None:
            if kind == "opaque":
                raise SourceConflict("INVALID_NEW_OPAQUE_BLOCK")
            if not _PLAIN.fullmatch(value):
                raise SourceConflict("UNSUPPORTED_TEXT")
            if kind == "paragraph" and not _is_plain_body(value):
                raise SourceConflict("UNSUPPORTED_TEXT")
            if kind == "paragraph" and _HEADING.fullmatch(value):
                raise SourceConflict("UNSUPPORTED_TEXT")
            prefix = "#" * level + " " if kind == "heading" else ""
            assembled.append((prefix + value, dominant_end))
            continue

        if not isinstance(block_id, str) or not re.fullmatch(r"line-(0|[1-9][0-9]*)", block_id):
            raise SourceConflict("INVALID_BLOCK")
        index = int(block_id[5:])
        if index >= len(snapshot) or index in used or index <= last_index:
            raise SourceConflict("REORDERED_OR_DUPLICATE_SOURCE_BLOCK")
        used.add(index)
        last_index = index
        original = snapshot[index]
        if item.get("hash") != original["hash"]:
            raise SourceConflict("OPAQUE_OR_STALE_BLOCK")
        if original["kind"] == "opaque":
            if kind != "opaque" or value != original["text"]:
                raise SourceConflict("OPAQUE_SOURCE_CHANGED")
            # Preserve original raw line, including CRLF, whitespace and markers.
            assembled.append((original_lines[index][:-len(original["ending"])]
                              if original["ending"] else original_lines[index],
                              original["ending"]))
            continue
        if kind == "opaque":
            raise SourceConflict("EDITABLE_BLOCK_BECAME_OPAQUE")
        if not _PLAIN.fullmatch(value):
            raise SourceConflict("UNSUPPORTED_TEXT")
        if kind == "paragraph" and not _is_plain_body(value):
            raise SourceConflict("UNSUPPORTED_TEXT")
        if kind == "paragraph" and _HEADING.fullmatch(value):
            raise SourceConflict("UNSUPPORTED_TEXT")
        prefix = "#" * level + " " if kind == "heading" else ""
        # If there is no edit, retain the exact body as-is.
        if (kind == original["kind"] and level == original["level"]
                and value == original["text"]):
            raw = original_lines[index]
            body = raw[:-len(original["ending"])] if original["ending"] else raw
        else:
            body = prefix + value
        assembled.append((body, original["ending"]))

    if any(block["kind"] == "opaque" and idx not in used
           for idx, block in enumerate(snapshot)):
        raise SourceConflict("OPAQUE_SOURCE_REMOVED")

    # Insert a delimiter where an originally unterminated last line now has
    # a successor. Do not normalize any other original line ending.
    result: list[str] = []
    for pos, (body, ending) in enumerate(assembled):
        if pos < len(assembled) - 1 and not ending:
            ending = dominant_end
        result.append(body + ending)
    output = "".join(result)
    # Never permit a lossy edit of an opaque source line.
    return output

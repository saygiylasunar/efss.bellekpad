"""Versioned, offline-editable workflow drafts; execution remains engine validated.

R4 core rules:
- Persist draft topology independently of Comfy availability.
- Frontend geometry is metadata, not backend permissions.
- Every run MUST compile against live /object_info; saving != executable.
- sqlite revision compare-and-swap prevents silent overwrites.
"""
from __future__ import annotations

import json
import math
import re

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_DRAFT_BYTES = 1_048_576


class WorkflowStoreError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _text(value, limit=160):
    return (isinstance(value, str) and 0 < len(value.strip()) <= limit
            and not any(ord(c) < 32 for c in value))


def normalize_draft(graph: object) -> dict:
    """Validate a *draft*, not its Comfy-node capabilities.

    Invalid ports and unsupported model classes are checked at actual compile time.
    This allows saving partially-connected workflows even with the engine offline.
    """
    if not isinstance(graph, dict) or type(graph.get("schema_version")) is not int or graph["schema_version"] != 1:
        raise WorkflowStoreError("WORKFLOW_SCHEMA_UNSUPPORTED")
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list) or len(nodes) > 512 or len(edges) > 2048:
        raise WorkflowStoreError("INVALID_WORKFLOW_GRAPH")
    identifiers = set()
    normalized_nodes = []
    for node in nodes:
        if not isinstance(node, dict):
            raise WorkflowStoreError("INVALID_WORKFLOW_NODE")
        nid, kind, inputs, pos = (node.get("id"), node.get("type"),
                                   node.get("inputs"), node.get("position"))
        if not isinstance(nid, str) or not ID.fullmatch(nid) or nid in identifiers:
            raise WorkflowStoreError("INVALID_WORKFLOW_NODE")
        if not _text(kind, 180) or not isinstance(inputs, dict):
            raise WorkflowStoreError("INVALID_WORKFLOW_NODE")
        if any(not _text(k, 180) for k in inputs):
            raise WorkflowStoreError("INVALID_WORKFLOW_INPUT")
        if not isinstance(pos, dict) or type(pos.get("x")) not in (int, float) or type(pos.get("y")) not in (int, float):
            raise WorkflowStoreError("INVALID_WORKFLOW_POSITION")
        if not (math.isfinite(pos["x"]) and math.isfinite(pos["y"])):
            raise WorkflowStoreError("INVALID_WORKFLOW_POSITION")
        identifiers.add(nid)
        normalized_nodes.append({"id": nid, "type": kind, "inputs": inputs,
                                 "position": {"x": pos["x"], "y": pos["y"]}})
    normalized_edges = []
    for edge in edges:
        if not isinstance(edge, dict):
            raise WorkflowStoreError("INVALID_WORKFLOW_EDGE")
        src, dst = edge.get("source"), edge.get("target")
        out, name = edge.get("sourceHandle"), edge.get("targetHandle")
        if (not isinstance(src, str) or not isinstance(dst, str)
                or src not in identifiers or dst not in identifiers
                or type(out) is not int or out < 0 or not _text(name, 180)):
            raise WorkflowStoreError("INVALID_WORKFLOW_EDGE")
        normalized_edges.append({"source": src, "sourceHandle": out,
                                 "target": dst, "targetHandle": name})
    normalized = {"schema_version": 1, "nodes": normalized_nodes, "edges": normalized_edges}
    try:
        encoded = json.dumps(normalized, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise WorkflowStoreError("INVALID_WORKFLOW_INPUT") from exc
    if len(encoded.encode("utf-8")) > MAX_DRAFT_BYTES:
        raise WorkflowStoreError("WORKFLOW_DRAFT_TOO_LARGE")
    return normalized


def serialized_draft(graph: object) -> str:
    return json.dumps(normalize_draft(graph), ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)

"""Compile React Flow-style graphs to Comfy's API prompt.

The live /object_info registry is authoritative; the browser is not.
No renderer-selected executable, hostname, path or arbitrary class loading.
"""
from __future__ import annotations
import re
from collections import deque
from typing import Any

_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class WorkflowError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _shape(entry: Any) -> dict:
    if not isinstance(entry, dict):
        raise WorkflowError("INVALID_GRAPH")
    return entry


def compile_graph(graph: dict, registry: dict) -> dict:
    """Validate nodes, required inputs, ports and cycles; return Comfy API prompt.

    Inputs are plain JSON values; edges address an exact output index and input name.
    A Comfy node's type comes from runtime introspection, not a frontend allowlist.
    """
    graph = _shape(graph)
    registry = _shape(registry)
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list) or not nodes or len(nodes) > 512 or len(edges) > 2048:
        raise WorkflowError("INVALID_GRAPH")
    mapped = {}
    indegree = {}
    outgoing = {}
    for node in nodes:
        node = _shape(node)
        nid, kind, inputs = node.get("id"), node.get("type"), node.get("inputs", {})
        if not isinstance(nid, str) or not _ID.fullmatch(nid) or nid in mapped:
            raise WorkflowError("INVALID_NODE_ID")
        if not isinstance(kind, str) or kind not in registry:
            raise WorkflowError("UNKNOWN_NODE_TYPE")
        if not isinstance(inputs, dict):
            raise WorkflowError("INVALID_INPUT")
        info = _shape(registry[kind])
        input_defs = _shape(info.get("input", {}))
        allowed = {}
        for category in ("required", "optional"):
            allowed.update(_shape(input_defs.get(category, {})))
        if any(k not in allowed for k in inputs):
            raise WorkflowError("UNKNOWN_INPUT")
        for key, value in inputs.items():
            spec = allowed[key]
            if not isinstance(spec, (list, tuple)) or not spec:
                raise WorkflowError("INVALID_NODE_CATALOG")
            typ = spec[0]
            if isinstance(typ, (list, tuple)) and value not in typ:
                raise WorkflowError("INVALID_COMBO_VALUE")
            if isinstance(typ, str) and typ in ("INT", "FLOAT", "BOOLEAN", "STRING"):
                valid = {"INT": lambda x: type(x) is int, "FLOAT": lambda x: type(x) in (int, float),
                         "BOOLEAN": lambda x: type(x) is bool, "STRING": lambda x: isinstance(x, str)}[typ]
                if not valid(value):
                    raise WorkflowError("INVALID_LITERAL_TYPE")
        mapped[nid] = {"class_type": kind, "inputs": dict(inputs)}
        indegree[nid] = 0
        outgoing[nid] = []
    attached = set()
    for edge in edges:
        edge = _shape(edge)
        src, dst = edge.get("source"), edge.get("target")
        index, target_input = edge.get("sourceHandle"), edge.get("targetHandle")
        if not isinstance(src, str) or not isinstance(dst, str):
            raise WorkflowError("INVALID_EDGE")
        if src not in mapped or dst not in mapped or not isinstance(index, int) or isinstance(index, bool) or index < 0 or not isinstance(target_input, str):
            raise WorkflowError("INVALID_EDGE")
        target_kind = mapped[dst]["class_type"]
        source_kind = mapped[src]["class_type"]
        input_defs = registry[target_kind]["input"]
        permitted = {**input_defs.get("required", {}), **input_defs.get("optional", {})}
        if target_input not in permitted:
            raise WorkflowError("INVALID_TARGET_PORT")
        outputs = registry[source_kind].get("output", [])
        if not isinstance(outputs, list) or index >= len(outputs):
            raise WorkflowError("INVALID_SOURCE_PORT")
        expected = permitted[target_input][0]
        supplied = outputs[index]
        if not (isinstance(expected, str) and (supplied == expected or supplied == "*" or expected == "*")):
            raise WorkflowError("INCOMPATIBLE_PORT")
        if (dst, target_input) in attached or target_input in mapped[dst]["inputs"]:
            raise WorkflowError("DUPLICATE_TARGET_INPUT")
        attached.add((dst, target_input))
        mapped[dst]["inputs"][target_input] = [src, index]
        outgoing[src].append(dst)
        indegree[dst] += 1
    for nid, node in mapped.items():
        required = registry[node["class_type"]]["input"].get("required", {})
        if any(name not in node["inputs"] for name in required):
            raise WorkflowError("MISSING_REQUIRED_INPUT")
    q = deque(nid for nid, degree in indegree.items() if degree == 0)
    seen = 0
    while q:
        current = q.popleft()
        seen += 1
        for nxt in outgoing[current]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                q.append(nxt)
    if seen != len(mapped):
        raise WorkflowError("CYCLE_DETECTED")
    return mapped

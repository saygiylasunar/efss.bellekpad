import type { Edge, Node } from "@xyflow/react";

export type InputSpec = [string | string[], Record<string, unknown>?];
export type Definition = {
  input: {required?: Record<string, InputSpec>, optional?: Record<string, InputSpec>};
  output?: string[];
};
export type Catalog = Record<string, Definition>;
export type GraphNode = Node<{
  label: string;
  nodeKind: string;
  definition: Definition;
  inputs: Record<string, unknown>;
}, "comfy">;

export type DraftGraph = {
  schema_version: 1;
  nodes: {id: string; type: string; position: {x: number; y: number}; inputs: Record<string, unknown>}[];
  edges: {source: string; sourceHandle: number; target: string; targetHandle: string}[];
};
export type SavedWorkflow = {id: string; name: string; revision: number; graph: DraftGraph};
export type WorkflowSummary = Pick<SavedWorkflow, "id" | "name" | "revision">;

export function serializeDraft(nodes: GraphNode[], edges: Edge[]): DraftGraph {
  return {
    schema_version: 1,
    nodes: nodes.map(n => ({
      id: n.id, type: n.data.nodeKind, inputs: n.data.inputs,
      position: {x: n.position.x, y: n.position.y}
    })),
    // Missing handles must become a backend validation error, not silently port zero.
    edges: edges.map(e => ({
      source: e.source, target: e.target,
      sourceHandle: e.sourceHandle == null ? -1 : Number(e.sourceHandle),
      targetHandle: e.targetHandle ?? ""
    }))
  };
}

/** When Comfy is offline, reconstruct display ports only from the saved topology.
 * This metadata is for painting the graph, not a claim that a node is executable.
 */
function fallbackDefinition(node: DraftGraph["nodes"][number],
                            edges: DraftGraph["edges"]): Definition {
  const ports = new Set([...Object.keys(node.inputs)]);
  for (const edge of edges) if (edge.target === node.id) ports.add(edge.targetHandle);
  const maxOutput = edges.reduce((max, e) =>
    e.source === node.id ? Math.max(max, e.sourceHandle) : max, -1);
  return {
    input: {required: {}, optional: Object.fromEntries(
      Array.from(ports).map(name => [name, ["*", {}]])
    ) as Record<string, InputSpec>},
    output: Array.from({length: Math.min(maxOutput + 1, 64)}, () => "*")
  };
}

export function restoreDraft(graph: DraftGraph, catalog: Catalog):
  {nodes: GraphNode[]; edges: Edge[]} {
  return {
    nodes: graph.nodes.map(n => ({
      id: n.id, type: "comfy", position: n.position,
      data: {
        label: n.type, nodeKind: n.type, inputs: n.inputs,
        definition: catalog[n.type] ?? fallbackDefinition(n, graph.edges)
      }
    })),
    edges: graph.edges.map((e, index) => ({
      id: `saved-edge-${index}`,
      source: e.source, sourceHandle: String(e.sourceHandle),
      target: e.target, targetHandle: e.targetHandle
    }))
  };
}

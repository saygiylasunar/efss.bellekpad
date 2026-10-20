import { scanSemantics } from "./semantics.js";
import { parseConversationBody } from "./conversation.js";

export function buildGraph(documents, registry) {
  if (!Array.isArray(documents) || !registry) throw new TypeError("Invalid graph input");
  const nodes = new Set();
  const edges = [];
  const unresolved = [];
  const edgeKeys = new Set();
  for (const document of documents) {
    if (!document?.metadata?.id || !document?.metadata?.kind || typeof document.body !== "string") {
      throw new TypeError("Invalid document");
    }
    const from = `${document.metadata.kind}:${document.metadata.id}`;
    nodes.add(from);
    const scan = document.metadata.kind === "conversation"
      ? { tokens: parseConversationBody(document.body).flatMap((turn) => turn.tokens
          .filter((token) => token.type !== "directive")
          .map((token) => ({ ...token, start: token.start + turn.bodyStart }))), diagnostics: [] }
      : scanSemantics(document.body);
    unresolved.push(...scan.diagnostics.map((error) => ({ documentId: from, ...error })));
    for (const token of scan.tokens) {
      if (token.type === "directive" && token.action === "goal") continue;
      const expected = token.type === "variable" ? "variable" :
        token.type === "directive" && token.action === "scope" ? "project" :
        token.type === "directive" && token.action === "mode" ? "mode" : null;
      const resolved = registry.resolve(token.target, expected);
      if (!resolved.entity) {
        unresolved.push({ documentId: from, code: resolved.error, start: token.start });
        continue;
      }
      const to = `${resolved.entity.kind}:${resolved.entity.id}`;
      const relation = token.type === "directive" ? ({ use: "imports", scope: "scopes", mode: "activates" })[token.action] : "mentions";
      const key = `${from}\u0000${to}\u0000${relation}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      nodes.add(to);
      edges.push({ from, to, relation, evidence: { offset: token.start } });
    }
  }
  return { nodes: [...nodes].sort(), edges, unresolved };
}

export function neighbors(graph, id) {
  return graph.edges.filter((edge) => edge.from === id || edge.to === id);
}

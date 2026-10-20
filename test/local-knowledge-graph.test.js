import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDocumentVault } from "../src/local-document-vault.js";
import { LocalKnowledgeGraph } from "../src/local-knowledge-graph.js";
import { VariableTypeRegistry } from "../src/typed-variables.js";
import { FORMAT_VERSION, serializeDocument } from "../src/efss-markdown.js";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "efss-graph-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const vault = new LocalDocumentVault({ root: join(root, "vault") });
  const types = new VariableTypeRegistry();
  types.register({ id: "topic", label: "Topic", value: { type: "text" } });
  const graph = new LocalKnowledgeGraph({ vault, types, root: join(root, "knowledge") });
  return { root, vault, types, graph };
}
const source = (kind, id, body, props = {}) => serializeDocument({
  metadata: { efss_version: FORMAT_VERSION, kind, id, ...props }, body
});
async function save(vault, kind, id, body, props = {}) {
  return vault.save(source(kind, id, body, props));
}
function evidence(saved, text, excerpt = "Topic") {
  const start = text.indexOf(excerpt);
  if (start < 0) throw new Error("Fixture missing evidence");
  return { sourceId: saved.kind + ":" + saved.id, revision: saved.revision,
    start, end: start + excerpt.length };
}
async function proposal({ graph, saved, body, id = "relation1" }) {
  return graph.proposeRelation({
    id, from: "paper:alpha", to: "variable:topic",
    predicate: "illustrates", method: "inference", confidence: 0.72,
    evidence: evidence(saved, body)
  });
}

test("rebuilds Markdown-derived references and variable links from private EFSS files", async t => {
  const { vault, graph } = await setup(t);
  await save(vault, "paper", "beta", "An independent paragraph.");
  await save(vault, "paper", "alpha", "[[paper:beta]] and &Topic appear together.");
  const snap = await graph.snapshot();
  assert.equal(snap.documents, 2);
  assert.ok(snap.edges.some(e => e.from === "paper:alpha" &&
    e.to === "paper:beta" && e.origin === "markdown"));
  assert.ok(snap.edges.some(e => e.from === "paper:alpha" &&
    e.to === "variable:topic" && e.origin === "markdown"));
  assert.ok(snap.edges.every(e => e.evidence.revision && /^[a-f0-9]{64}$/.test(e.evidence.revision)));
  assert.equal(snap.relations.length, 0);
});

test("proposals are not facts; explicit approval persists across restart", async t => {
  const { root, vault, graph, types } = await setup(t);
  const body = "Topic is used as the example term.";
  const saved = await save(vault, "paper", "alpha", body);
  const p = await proposal({ graph, saved, body });
  assert.equal(p.status, "proposed");
  let snap = await graph.snapshot();
  assert.equal(snap.relations[0].status, "proposed");
  assert.equal(snap.edges.filter(e => e.origin === "approved-relation").length, 0);
  await graph.approveRelation(p.id);
  const restarted = new LocalKnowledgeGraph({ vault, types, root: join(root, "knowledge") });
  snap = await restarted.snapshot();
  assert.equal(snap.relations[0].status, "approved");
  assert.equal(snap.edges.filter(e => e.origin === "approved-relation").length, 1);
  assert.equal(snap.edges.find(e => e.relationId === p.id).evidence.revision, saved.revision);
  const ledger = await readFile(join(root, "knowledge", "relations.jsonl"), "utf8");
  assert.equal(ledger.trim().split("\n").length, 2);
  assert.equal(ledger.includes(body), false);
});

test("editing an evidence document invalidates the approved inference but retains its history", async t => {
  const { vault, graph } = await setup(t);
  const body = "Topic is used here.";
  const saved = await save(vault, "paper", "alpha", body);
  await proposal({ graph, saved, body });
  await graph.approveRelation("relation1");
  await vault.save(source("paper", "alpha", "Topic now means something different."), {
    expectedRevision: saved.revision
  });
  const snap = await graph.snapshot();
  assert.equal(snap.relations[0].status, "stale");
  assert.equal(snap.edges.some(e => e.origin === "approved-relation"), false);
  assert.ok(snap.diagnostics.some(d => d.code === "STALE_RELATION_EVIDENCE"));
  // The old observation remains inspectable; it is not silently retargeted.
  assert.equal(snap.relations[0].evidence.revision, saved.revision);
});

test("unreviewed relationships cannot be approved after their evidence changes", async t => {
  const { vault, graph } = await setup(t);
  const body = "Topic appears in this document.";
  const saved = await save(vault, "paper", "alpha", body);
  await proposal({ graph, saved, body });
  await vault.save(source("paper", "alpha", "An edited text."), {
    expectedRevision: saved.revision
  });
  await assert.rejects(graph.approveRelation("relation1"), /RELATION_EVIDENCE_NOT_CURRENT/);
  const snap = await graph.snapshot();
  assert.equal(snap.relations[0].status, "proposed");
  assert.equal(snap.edges.some(e => e.origin === "approved-relation"), false);
});

test("retiring an approved relation records history and removes graph authority", async t => {
  const { vault, graph } = await setup(t);
  const body = "Topic appears.";
  const saved = await save(vault, "paper", "alpha", body);
  await proposal({ graph, saved, body });
  await graph.approveRelation("relation1");
  await graph.retireRelation("relation1");
  const snap = await graph.snapshot();
  assert.equal(snap.relations[0].status, "retired");
  assert.equal(snap.edges.some(e => e.origin === "approved-relation"), false);
  await assert.rejects(graph.approveRelation("relation1"), /RELATION_NOT_PROPOSED/);
  await assert.rejects(graph.retireRelation("relation1"), /RELATION_NOT_APPROVED/);
});

test("unknown endpoints and forged revisions cannot create relationship evidence", async t => {
  const { vault, graph } = await setup(t);
  const body = "Topic appears.";
  const saved = await save(vault, "paper", "alpha", body);
  await assert.rejects(graph.proposeRelation({
    id: "unknown", from: "paper:alpha", to: "paper:absent",
    predicate: "linked", evidence: evidence(saved, body), confidence: 0.7
  }), /UNRESOLVED_RELATION_ENDPOINT/);
  await assert.rejects(graph.proposeRelation({
    id: "forged", from: "paper:alpha", to: "variable:topic",
    predicate: "linked", evidence: { ...evidence(saved, body), revision: "f".repeat(64) }
  }), /INVALID_OR_RESTRICTED_EVIDENCE/);
  await assert.rejects(graph.proposeRelation({
    id: "invalid", from: "paper:alpha", to: "../private",
    predicate: "linked", evidence: evidence(saved, body)
  }), /INVALID_GRAPH_NODE|INVALID_RELATION/);
  assert.equal((await graph.snapshot()).relations.length, 0);
});

test("private source documents are not indexed by default and cannot sponsor new proposals", async t => {
  const { vault, graph } = await setup(t);
  const body = "Topic is restricted.";
  const saved = await save(vault, "paper", "alpha", body, { visibility: "restricted" });
  await assert.rejects(proposal({ graph, saved, body }), /INVALID_OR_RESTRICTED_EVIDENCE/);
  assert.equal((await graph.snapshot()).documents, 0);
  assert.equal((await graph.snapshot({ allowRestricted: true })).documents, 1);
});

test("private targets are omitted from default graph although referenced by a public document", async t => {
  const { vault, graph } = await setup(t);
  await save(vault, "paper", "hidden", "Private.");
  const current = await vault.read("paper", "hidden");
  await vault.save(source("paper", "hidden", "Actually restricted.", {
    visibility: "restricted"
  }), { expectedRevision: current.revision });
  await save(vault, "paper", "alpha", "[[paper:hidden]]");
  const standard = await graph.snapshot();
  assert.equal(standard.nodes.includes("paper:hidden"), false);
  assert.equal(standard.edges.length, 0);
  assert.equal(standard.documents, 1);
  const expanded = await graph.snapshot({ allowRestricted: true });
  assert.equal(expanded.nodes.includes("paper:hidden"), true);
  assert.ok(expanded.edges.some(e => e.to === "paper:hidden"));
});

test("corrupted and partially written event logs fail closed", async t => {
  const { root, graph } = await setup(t);
  await mkdir(join(root, "knowledge"));
  await writeFile(join(root, "knowledge", "relations.jsonl"), '{"schemaVersion":1');
  await assert.rejects(graph.snapshot(), /INCOMPLETE_GRAPH_LEDGER/);
  await writeFile(join(root, "knowledge", "relations.jsonl"), '{"kind":"unexpected"}\n');
  await assert.rejects(graph.snapshot(), /CORRUPT_GRAPH_LEDGER/);
});

test("a stale lock blocks mutation without overwriting the journal", async t => {
  const { root, vault, graph } = await setup(t);
  const body = "Topic appears.";
  const saved = await save(vault, "paper", "alpha", body);
  await mkdir(join(root, "knowledge"));
  await writeFile(join(root, "knowledge", "relations.jsonl.lock"), "test lock");
  await assert.rejects(proposal({ graph, saved, body }), /GRAPH_BUSY/);
  assert.equal((await graph.snapshot()).relations.length, 0);
});

test("symlinked knowledge root is rejected without traversal", async t => {
  const { root, vault, types } = await setup(t);
  const external = await mkdtemp(join(tmpdir(), "efss-other-"));
  t.after(async () => rm(external, { recursive: true, force: true }));
  await symlink(external, join(root, "redirect"));
  const store = new LocalKnowledgeGraph({
    vault, types, root: join(root, "redirect")
  });
  await assert.rejects(store.snapshot(), /UNSAFE_GRAPH_DIRECTORY/);
});

test("node and schema validators refuse malformed identifiers and false evidence", async t => {
  const { vault, graph } = await setup(t);
  const body = "Topic appears.";
  const saved = await save(vault, "paper", "alpha", body);
  await assert.rejects(graph.proposeRelation({
    id: "a", from: "paper:alpha", to: "variable:topic",
    predicate: "has:command", evidence: evidence(saved, body)
  }), /INVALID_RELATION/);
  await assert.rejects(graph.proposeRelation({
    id: "a", from: "paper:alpha", to: "variable:topic",
    predicate: "mentions", evidence: { ...evidence(saved, body), end: 999999 }
  }), /INVALID_RELATION_EVIDENCE/);
});

test("duplicate record ids are rejected rather than merged across sessions", async t => {
  const { vault, graph } = await setup(t);
  const body = "Topic appears.";
  const saved = await save(vault, "paper", "alpha", body);
  await proposal({ graph, saved, body });
  await assert.rejects(proposal({ graph, saved, body }), /DUPLICATE_RELATION/);
  assert.equal((await graph.snapshot()).relations.length, 1);
});

test("graph stores explicit references, not automatic arbitrary values", async t => {
  const { vault, graph, types } = await setup(t);
  types.register({ id: "count", label: "Count", value: { type: "number" } });
  await save(vault, "paper", "alpha", "Collect &Count{26, 48}.");
  const snap = await graph.snapshot();
  assert.ok(snap.edges.some(e => e.to === "variable:count"));
  assert.equal(Object.hasOwn(snap, "valueCandidates"), false);
  assert.equal(Object.hasOwn(snap, "observations"), false);
});

test("conversation text does not create a second automatic observation channel", async t => {
  const { vault, graph } = await setup(t);
  await save(vault, "conversation", "talk",
    "@Person:Demo\n&Topic{person}\n@AI:Example\n&Topic{model}");
  const snap = await graph.snapshot();
  assert.equal(Object.hasOwn(snap, "observations"), false);
  assert.equal(snap.edges.some(e => e.origin === "approved-relation"), false);
});

test("restricted documents do not become graph sources by default", async t => {
  const { vault, graph } = await setup(t);
  await save(vault, "paper", "one", "&Topic{secret}",
    { visibility: "restricted" });
  assert.equal((await graph.snapshot()).documents, 0);
  assert.equal((await graph.snapshot({ allowRestricted: true })).documents, 1);
});

test("restricted variable definitions do not surface through registered aliases", async t => {
  const { vault, graph } = await setup(t);
  await save(vault, "variable", "topic", "Private variable schema.", {
    visibility: "restricted"
  });
  await save(vault, "paper", "alpha", "&Topic");
  const defaultView = await graph.snapshot();
  assert.equal(defaultView.nodes.includes("variable:topic"), false);
  assert.equal(defaultView.edges.some(e => e.to === "variable:topic"), false);
  const privilegedView = await graph.snapshot({ allowRestricted: true });
  assert.equal(privilegedView.nodes.includes("variable:topic"), true);
});

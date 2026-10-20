import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStations, cosineSimilarity } from "../src/memory-stations.js";

const paper = (id, body, options = {}) => ({
  metadata: { kind: "paper", id, title: options.title ?? "",
    visibility: options.visibility ?? "normal" }, body
});

test("source station preserves block ranges and never modifies the original", () => {
  const memory = new MemoryStations();
  const body = "# Başlık\n\nKonu hakkında bilgi.\n\n- ikinci kayıt\n";
  const added = memory.ingest(paper("doc1", body));
  assert.equal(added.segments, 3);
  for (const segment of memory.segments()) {
    assert.equal(body.slice(segment.start, segment.end), segment.text);
    assert.equal(segment.sourceId, "paper:doc1");
  }
  assert.deepEqual(memory.segments().map(x => x.blockType), ["heading", "paragraph", "list_item"]);
  assert.equal(memory.source("paper:doc1").segmentIds.length, 3);
});

test("lexical recall finds relevant source ranges and does not claim semantic inference", () => {
  const memory = new MemoryStations();
  memory.ingest(paper("a", "Ritim ve nota ilişkisi."));
  memory.ingest(paper("b", "Başka bir konu."));
  const results = memory.search({ query: "ritim nota" });
  assert.equal(results.length, 1);
  assert.equal(results[0].sourceId, "paper:a");
  assert.equal(results[0].signals.lexical, 1);
  assert.equal(results[0].signals.semantic, 0);
});

test("recurring unknown terms are proposed without inventing their meaning", () => {
  const memory = new MemoryStations();
  memory.ingest(paper("a", "Luvika için yeni taslak."));
  memory.ingest(paper("b", "Luvika yeniden gündemde."));
  const suggestion = memory.recurringTerms({ minSources: 2 }).find(item => item.term === "luvika");
  assert.equal(suggestion.count, 2);
  assert.equal(suggestion.sourceCount, 2);
  assert.equal(suggestion.status, "candidate");
  assert.equal(suggestion.semanticMeaning, null);
  assert.equal(suggestion.evidence.length, 2);
});

test("restricted sources are not recalled, surfaced or included by default", () => {
  const memory = new MemoryStations();
  memory.ingest(paper("private", "Nadirkelime", { visibility: "restricted" }));
  memory.ingest(paper("public", "Nadirkelime"));
  const results = memory.search({ query: "Nadirkelime" });
  assert.deepEqual(results.map(x => x.sourceId), ["paper:public"]);
  assert.equal(memory.contextTray({ query: "Nadirkelime" }).sources.length, 1);
  assert.equal(memory.recurringTerms().some(x => x.term === "nadirkelime"), false);
});

test("identically sized vectors retrieve related chunks with model isolation", () => {
  const memory = new MemoryStations();
  memory.ingest(paper("a", "Bir konu üzerine kısa not."));
  memory.ingest(paper("b", "Farklı bir belge."));
  const ids = memory.segments().map(x => x.id);
  memory.attachEmbedding({ segmentId: ids[0], model: "local:v1", vector: [1, 0, 0] });
  memory.attachEmbedding({ segmentId: ids[1], model: "local:v1", vector: [0, 1, 0] });
  const hits = memory.search({ vector: [0.9, 0.1, 0], model: "local:v1" });
  assert.equal(hits[0].sourceId, "paper:a");
  assert.equal(hits[0].signals.model, "local:v1");
  assert.ok(hits[0].signals.semantic > hits[1].signals.semantic);
  assert.deepEqual(memory.search({ vector: [1, 0, 0], model: "other" }), []);
  assert.throws(() => memory.search({ vector: [1, 0], model: "local:v1" }), /dimension/);
  assert.throws(() => memory.attachEmbedding({ segmentId: ids[1], model: "local:v1", vector: [1, 0] }), /dimension/);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("embeddings reject malformed or non-finite vectors", () => {
  const memory = new MemoryStations();
  memory.ingest(paper("one", "Bir."));
  const segmentId = memory.segments()[0].id;
  for (const vector of [[0, 0], [NaN, 1], [Infinity], [1, "0"], []]) {
    assert.throws(() => memory.attachEmbedding({ segmentId, model: "v1", vector }));
  }
  assert.throws(() => memory.attachEmbedding({ segmentId: "missing", model: "v1", vector: [1] }));
});

test("context tray remains data-only and retains citation locations", () => {
  const memory = new MemoryStations();
  const body = "Başlık\n\nAraştırma notu.";
  memory.ingest(paper("one", body));
  const tray = memory.contextTray({ query: "araştırma", maxChars: 100 });
  assert.equal(tray.operation, "reference-context");
  assert.equal(tray.effects, "none");
  assert.equal(tray.authority, "none");
  assert.equal(tray.sources.length, 1);
  assert.equal(tray.sources[0].text, body.slice(tray.sources[0].provenance.start, tray.sources[0].provenance.end));
  assert.equal(tray.sources[0].trust, "untrusted-source-data");
  const small = memory.contextTray({ query: "araştırma", maxChars: 1 });
  assert.equal(small.sources.length, 0);
  assert.deepEqual(small.excluded.map(x => x.reason), ["BUDGET"]);
});

test("relationship hypotheses cannot be treated as approved facts until review", () => {
  const memory = new MemoryStations();
  memory.ingest(paper("one", "Kavram B ile birlikte anılıyor."));
  const segmentId = memory.segments()[0].id;
  const proposal = memory.proposeRelation({
    subject: "KavramA", predicate: "related-to", object: "KavramB",
    confidence: 0.55, evidence: [segmentId], method: "inference"
  });
  assert.equal(proposal.status, "proposed");
  assert.equal(memory.relationsFor("kavramb").length, 1);
  assert.equal(memory.relationsFor("KavramB", { approvedOnly: true }).length, 0);
  memory.approveRelation(proposal.id);
  assert.equal(memory.relationsFor("KavramB", { approvedOnly: true }).length, 1);
  assert.throws(() => memory.proposeRelation({
    subject: "A", predicate: "is", object: "B", confidence: 1, evidence: ["invented"]
  }));
});

test("updating a paper invalidates old vectors and unsupported inferences", () => {
  const memory = new MemoryStations();
  memory.ingest(paper("one", "Eski sözcük."));
  const original = memory.segments()[0].id;
  memory.attachEmbedding({ segmentId: original, model: "v1", vector: [1, 0] });
  memory.proposeRelation({ subject: "A", predicate: "supports", object: "B",
    confidence: 0.5, evidence: [original] });
  memory.ingest(paper("one", "Yeni konu."));
  assert.equal(memory.getSegment(original), null);
  assert.equal(memory.relationsFor("A").length, 0);
  assert.deepEqual(memory.search({ model: "v1", vector: [1, 0] }), []);
  assert.equal(memory.search({ query: "yeni" }).length, 1);
});

test("directives and extension data do not become retrieval content", () => {
  const memory = new MemoryStations();
  memory.ingest(paper("one", "::mode \"Demo\"\n:::efss.secret\npassword\n:::\nNot."));
  assert.equal(memory.search({ query: "password" }).length, 0);
  assert.equal(memory.search({ query: "demo" }).length, 0);
  assert.equal(memory.search({ query: "not" }).length, 1);
});

test("invalid arguments do not mutate the station", () => {
  const memory = new MemoryStations();
  assert.throws(() => memory.ingest(paper("../bad", "foo")));
  assert.throws(() => memory.search({ query: 123 }));
  assert.throws(() => memory.contextTray({ query: "", maxChars: -1 }));
  assert.deepEqual(memory.segments(), []);
});

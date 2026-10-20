import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDocumentVault } from "../src/local-document-vault.js";
import { LocalObservationLedger } from "../src/local-observation-ledger.js";
import { LocalKnowledgeGraph } from "../src/local-knowledge-graph.js";
import { FORMAT_VERSION, serializeDocument } from "../src/efss-markdown.js";

const make = (kind, id, body, meta = {}) => serializeDocument({
  metadata: { efss_version: FORMAT_VERSION, kind, id, ...meta }, body
});
const schema = (type = "number", label = "Miktar", attributes = {}) =>
  ":::efss.schema\n" + JSON.stringify({
    schemaVersion: 1, label, value: { type, ...attributes }, properties: {}
  }) + "\n:::";
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "efss-observation-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new LocalDocumentVault({ root: join(root, "vault") });
  const journalRoot = join(root, "knowledge");
  const store = new LocalObservationLedger({ vault, root: journalRoot });
  return { root, vault, journalRoot, store };
}
async function setSchema(vault, options = {}) {
  return vault.save(make("variable", "amount",
    schema(options.type ?? "number", options.label ?? "Miktar",
      options.attributes ?? {}), options.metadata ?? {}));
}
async function writePaper(vault, text, options = {}) {
  return vault.save(make("paper", options.id ?? "example", text,
    options.metadata ?? {}));
}
const evidence = (saved, body, excerpt) => {
  const start = body.indexOf(excerpt);
  assert.ok(start >= 0, "Test fixture must contain an excerpt");
  return { sourceId: saved.kind + ":" + saved.id, revision: saved.revision,
    start, end: start + excerpt.length };
};

test("explicit proposals never mutate a schema or become active without approval", async t => {
  const { store, vault, root } = await setup(t);
  await setSchema(vault);
  const body = "Example &Miktar{26, 48}.";
  const saved = await writePaper(vault, body);
  const result = await store.propose({ id: "obs1", ...evidence(saved, body, "&Miktar{26, 48}") });
  assert.equal(result.status, "proposed");
  const before = await store.snapshot();
  assert.equal(before.active.length, 0);
  assert.equal(before.history[0].status, "proposed");
  assert.equal(Object.hasOwn(before.history[0], "values"), false);
  assert.equal((await vault.read("paper", "example")).revision, saved.revision);
  await store.approve("obs1");
  const restarted = new LocalObservationLedger({
    vault, root: join(root, "knowledge")
  });
  const after = await restarted.snapshot();
  assert.deepEqual(after.active[0].values, [26, 48]);
  assert.equal(after.active[0].variableId, "amount");
  assert.equal(after.active[0].status, "approved");
  const log = await readFile(join(root, "knowledge", "observations.jsonl"), "utf8");
  assert.equal(log.trimEnd().split("\n").length, 2);
  assert.equal(log.includes("Example"), false);
  assert.equal(log.includes("Miktar"), false);
});

test("multiple observations of the same variable coexist, with no overwrite or winner", async t => {
  const { vault, store } = await setup(t);
  await setSchema(vault);
  const body = "&Miktar{26} and then &Miktar{48}.";
  const saved = await writePaper(vault, body);
  await store.propose({ id: "older", ...evidence(saved, body, "&Miktar{26}") });
  await store.propose({ id: "newer", ...evidence(saved, body, "&Miktar{48}") });
  await store.approve("older");
  await store.approve("newer");
  assert.deepEqual((await store.snapshot()).active.map(item => item.values[0]), [26, 48]);
  await store.retire("older");
  const result = await store.snapshot();
  assert.deepEqual(result.active.map(item => item.values[0]), [48]);
  assert.deepEqual(result.history.map(item => item.status), ["retired", "approved"]);
  await assert.rejects(store.approve("older"), /OBSERVATION_NOT_PROPOSED/);
});

test("replacing an EFSS source makes approved observations stale, never silently moves offsets", async t => {
  const { vault, store } = await setup(t);
  await setSchema(vault);
  const body = "&Miktar{26}";
  const saved = await writePaper(vault, body);
  await store.propose({ id: "obs1", ...evidence(saved, body, body) });
  await store.approve("obs1");
  await vault.save(make("paper", "example", "&Miktar{26} and an extra sentence."), {
    expectedRevision: saved.revision
  });
  const after = await store.snapshot();
  assert.equal(after.active.length, 0);
  assert.equal(after.history[0].status, "stale");
  assert.equal(after.history[0].evidenceState, "stale");
  assert.ok(after.diagnostics.some(d => d.code === "STALE_OBSERVATION_EVIDENCE"));
  await assert.rejects(store.approve("obs1"), /OBSERVATION_NOT_PROPOSED/);
});

test("approval fails closed when evidence changed before review", async t => {
  const { vault, store } = await setup(t);
  await setSchema(vault);
  const body = "&Miktar{26}";
  const saved = await writePaper(vault, body);
  await store.propose({ id: "pending", ...evidence(saved, body, body) });
  await vault.save(make("paper", "example", "&Miktar{31}"), {
    expectedRevision: saved.revision
  });
  await assert.rejects(store.approve("pending"), /OBSERVATION_EVIDENCE_NOT_CURRENT/);
  assert.equal((await store.snapshot()).history[0].status, "proposed");
});

test("changing a variable schema invalidates previously approved typed observations", async t => {
  const { vault, store } = await setup(t);
  const savedSchema = await setSchema(vault);
  const body = "&Miktar{26}";
  const saved = await writePaper(vault, body);
  await store.propose({ id: "one", ...evidence(saved, body, body) });
  await store.approve("one");
  await vault.save(make("variable", "amount", schema("number", "Miktar", { min: 30 })),
    { expectedRevision: savedSchema.revision });
  const after = await store.snapshot();
  assert.equal(after.active.length, 0);
  assert.equal(after.history[0].status, "stale");
  assert.equal(after.history[0].evidenceState, "schema-changed");
});

test("typed date candidates are preserved without inventing a calendar context", async t => {
  const { vault, store } = await setup(t);
  await setSchema(vault, { type: "date", label: "Tarih" });
  const body = "Dates: &Tarih{2026-10-26, 2026-11-01}";
  const saved = await writePaper(vault, body);
  await store.propose({ id: "dates", ...evidence(saved, body, "&Tarih{2026-10-26, 2026-11-01}") });
  await store.approve("dates");
  assert.deepEqual((await store.snapshot()).active[0].values,
    ["2026-10-26", "2026-11-01"]);
});

test("conversations, untrusted names and invented source ranges cannot enter ledger", async t => {
  const { vault, store } = await setup(t);
  await setSchema(vault);
  await vault.save(make("conversation", "chat", "@AI:Bot\n&Miktar{999}"));
  await assert.rejects(store.propose({ id: "ai", sourceId: "conversation:chat",
    revision: "a".repeat(64), start: 0, end: 7 }), /INVALID_OBSERVATION_SOURCE/);
  const body = "&Miktar{26}";
  const saved = await writePaper(vault, body);
  await assert.rejects(store.propose({
    id: "bad", ...evidence(saved, body, "&Miktar{26}"),
    start: 1
  }), /OBSERVATION_BINDING_NOT_FOUND/);
  await assert.rejects(store.propose({
    id: "wrongrevision", ...evidence(saved, body, body),
    revision: "f".repeat(64)
  }), /OBSERVATION_SOURCE_CHANGED/);
  assert.equal((await store.snapshot()).history.length, 0);
});

test("restricted sources never show values or historical metadata in normal view", async t => {
  const { vault, store } = await setup(t);
  await setSchema(vault);
  const body = "&Miktar{26}";
  const saved = await writePaper(vault, body);
  await store.propose({ id: "one", ...evidence(saved, body, body) });
  await store.approve("one");
  await vault.save(make("paper", "example", body, { visibility: "restricted" }),
    { expectedRevision: saved.revision });
  const publicSnapshot = await store.snapshot();
  assert.equal(publicSnapshot.active.length, 0);
  assert.equal(publicSnapshot.history.length, 0);
  const privateSnapshot = await store.snapshot({ allowRestricted: true });
  assert.equal(privateSnapshot.active.length, 0);
  assert.equal(privateSnapshot.history.length, 1);
  assert.equal(privateSnapshot.history[0].status, "stale");
  await assert.rejects(store.propose({ id: "two",
    ...evidence(await vault.read("paper", "example"), body, body)
  }), /RESTRICTED_OBSERVATION_SOURCE/);
});

test("schema made restricted cannot leak previously recorded values into public view", async t => {
  const { vault, store } = await setup(t);
  const originalSchema = await setSchema(vault);
  const body = "&Miktar{26}";
  const saved = await writePaper(vault, body);
  await store.propose({ id: "one", ...evidence(saved, body, body) });
  await store.approve("one");
  await vault.save(make("variable", "amount", schema(), { visibility: "restricted" }),
    { expectedRevision: originalSchema.revision });
  const normal = await store.snapshot();
  assert.equal(normal.active.length, 0);
  assert.equal(normal.history.length, 0);
});

test("duplicate IDs and illegal state transitions fail without corrupting journal", async t => {
  const { vault, store } = await setup(t);
  await setSchema(vault);
  const body = "&Miktar{26}";
  const saved = await writePaper(vault, body);
  await store.propose({ id: "one", ...evidence(saved, body, body) });
  await assert.rejects(store.propose({ id: "one", ...evidence(saved, body, body) }),
    /DUPLICATE_OBSERVATION/);
  await assert.rejects(store.retire("one"), /OBSERVATION_NOT_APPROVED/);
  await store.approve("one");
  await assert.rejects(store.approve("one"), /OBSERVATION_NOT_PROPOSED/);
  assert.equal((await store.snapshot()).active.length, 1);
});

test("invalid event journal and incomplete writes are rejected instead of silently dropped", async t => {
  const { root, store } = await setup(t);
  const dir = join(root, "knowledge");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "observations.jsonl"), '{"schemaVersion":1');
  await assert.rejects(store.snapshot(), /INCOMPLETE_OBSERVATION_JOURNAL/);
  await writeFile(join(dir, "observations.jsonl"),
    '{"schemaVersion":1,"at":"2026-01-01","kind":"execute"}\n');
  await assert.rejects(store.snapshot(), /CORRUPT_OBSERVATION_JOURNAL/);
});

test("journal lock and symlink roots fail closed", async t => {
  const { root, vault, store } = await setup(t);
  await setSchema(vault);
  const body = "&Miktar{26}";
  const saved = await writePaper(vault, body);
  const dir = join(root, "knowledge");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "observations.jsonl.lock"), "");
  await assert.rejects(store.propose({ id: "blocked", ...evidence(saved, body, body) }),
    /OBSERVATION_BUSY/);
  const outside = await mkdtemp(join(tmpdir(), "efss-other-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, "symlinked"));
  const other = new LocalObservationLedger({ vault, root: join(root, "symlinked") });
  await assert.rejects(other.snapshot(), /UNSAFE_OBSERVATION_DIRECTORY/);
});

test("two concurrent proposals for one identifier never both succeed", async t => {
  const { vault, store, journalRoot } = await setup(t);
  await setSchema(vault);
  const body = "&Miktar{26}";
  const saved = await writePaper(vault, body);
  const other = new LocalObservationLedger({ vault, root: journalRoot });
  const responses = await Promise.allSettled([
    store.propose({ id: "same", ...evidence(saved, body, body) }),
    other.propose({ id: "same", ...evidence(saved, body, body) })
  ]);
  assert.equal(responses.filter(x => x.status === "fulfilled").length, 1);
  assert.equal((await store.snapshot()).history.length, 1);
});

test("knowledge graph retains observations as reviewed data, not auto-generated edges", async t => {
  const { vault, store, journalRoot } = await setup(t);
  await setSchema(vault);
  const body = "&Miktar{26}";
  const saved = await writePaper(vault, body);
  await store.propose({ id: "obs", ...evidence(saved, body, body) });
  await store.approve("obs");
  const graph = new LocalKnowledgeGraph({ vault, root: journalRoot });
  const snapshot = await graph.snapshot();
  assert.deepEqual(snapshot.observations.map(x => x.values), [[26]]);
  assert.equal(snapshot.edges.some(x => x.origin === "approved-observation"), false);
});

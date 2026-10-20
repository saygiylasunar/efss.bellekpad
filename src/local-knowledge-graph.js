import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { EFSS_CONTRACT } from "./contract.js";
import { EntityRegistry } from "./registry.js";
import { buildGraph } from "./graph.js";
import { LocalDocumentVault } from "./local-document-vault.js";
import { VariableTypeRegistry } from "./typed-variables.js";
import { loadVariableSchemas } from "./variable-schema-documents.js";

const KINDS = new Set(EFSS_CONTRACT.kinds);
const IDENT = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const PREDICATE = /^[a-z][a-z0-9_-]{0,79}$/;
const METHODS = new Set(["user", "inference"]);
const LOG_NAME = "relations.jsonl";
const MAX_LEDGER_SIZE = 6 * 1024 * 1024;
const MAX_EVENTS = 10000;
const MAX_EVIDENCE_CHARS = 4096;
const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(code) { throw new Error(code); }
function validNode(value) {
  if (typeof value !== "string") return false;
  const i = value.indexOf(":");
  return i >= 0 && KINDS.has(value.slice(0, i)) && IDENT.test(value.slice(i + 1));
}
function splitNode(value) {
  if (!validNode(value)) fail("INVALID_GRAPH_NODE");
  const pos = value.indexOf(":");
  return [value.slice(0, pos), value.slice(pos + 1)];
}
function hash(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function assertEvidence(e) {
  if (!e || typeof e !== "object" || Array.isArray(e) ||
    !validNode(e.sourceId) || !SHA.test(e.revision ?? "") ||
    !Number.isSafeInteger(e.start) || !Number.isSafeInteger(e.end) ||
    e.start < 0 || e.end <= e.start ||
    e.end - e.start > MAX_EVIDENCE_CHARS ||
    (e.fingerprint !== undefined && !SHA.test(e.fingerprint))) {
    fail("INVALID_RELATION_EVIDENCE");
  }
  return { sourceId: e.sourceId, revision: e.revision,
    start: e.start, end: e.end, fingerprint: e.fingerprint ?? null };
}
function validateRelation(r) {
  if (!r || typeof r !== "object" || Array.isArray(r) ||
    !IDENT.test(r.id ?? "") || !validNode(r.from) || !validNode(r.to) ||
    !PREDICATE.test(r.predicate ?? "") ||
    typeof r.confidence !== "number" || !Number.isFinite(r.confidence) ||
    r.confidence < 0 || r.confidence > 1 || !METHODS.has(r.method)) {
    fail("INVALID_RELATION");
  }
  const evidence = assertEvidence(r.evidence);
  if (!evidence.fingerprint) fail("INVALID_RELATION_EVIDENCE");
  return { id: r.id, from: r.from, to: r.to, predicate: r.predicate,
    confidence: r.confidence, method: r.method, evidence };
}
function apply(events) {
  const records = new Map();
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
      event.schemaVersion !== 1 || typeof event.at !== "string" ||
      !Number.isFinite(Date.parse(event.at))) fail("CORRUPT_GRAPH_LEDGER");
    if (event.kind === "propose") {
      const r = validateRelation(event.relation);
      if (records.has(r.id)) fail("CORRUPT_GRAPH_LEDGER");
      records.set(r.id, { ...r, status: "proposed" });
    } else if (event.kind === "approve" || event.kind === "retire") {
      if (!IDENT.test(event.id ?? "")) fail("CORRUPT_GRAPH_LEDGER");
      const current = records.get(event.id);
      if (!current || current.status !== (event.kind === "approve" ? "proposed" : "approved")) {
        fail("CORRUPT_GRAPH_LEDGER");
      }
      records.set(event.id, { ...current, status: event.kind === "approve" ? "approved" : "retired" });
    } else {
      fail("CORRUPT_GRAPH_LEDGER");
    }
  }
  return records;
}
async function guardedDirectory(path) {
  const parent = dirname(path);
  // The local graph root must not be reached through a symlinked parent.
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const p = await lstat(parent);
  if (!p.isDirectory() || p.isSymbolicLink()) fail("UNSAFE_GRAPH_DIRECTORY");
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const current = await lstat(path);
  if (!current.isDirectory() || current.isSymbolicLink()) fail("UNSAFE_GRAPH_DIRECTORY");
}
async function safeLedger(path) {
  try {
    const st = await lstat(path);
    if (!st.isFile() || st.isSymbolicLink()) fail("UNSAFE_GRAPH_LEDGER");
    if (st.size > MAX_LEDGER_SIZE) fail("GRAPH_LEDGER_LIMIT");
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
async function readEvents(path) {
  if (!await safeLedger(path)) return [];
  const data = await readFile(path);
  if (data.length > MAX_LEDGER_SIZE) fail("GRAPH_LEDGER_LIMIT");
  const text = decoder.decode(data);
  if (text && !text.endsWith("\n")) fail("INCOMPLETE_GRAPH_LEDGER");
  const lines = text ? text.trimEnd().split("\n") : [];
  if (lines.length > MAX_EVENTS) fail("GRAPH_EVENT_LIMIT");
  try { return lines.map(line => JSON.parse(line)); }
  catch { fail("CORRUPT_GRAPH_LEDGER"); }
}
function currentEntities(documents, types, blockedVariables = new Set()) {
  const registry = new EntityRegistry();
  for (const doc of documents) {
    const m = doc.metadata;
    const definition = m.kind === "variable" ? types.get(m.id) : null;
    registry.register({ kind: m.kind, id: m.id,
      label: definition?.label ?? m.kind + ":" + m.id,
      aliases: definition ? [...definition.aliases] : [],
      body: doc.body, visibility: m.visibility ?? "normal" });
  }
  for (const def of types.list()) {
    if (blockedVariables.has(def.id) || registry.get("variable", def.id)) continue;
    registry.register({ kind: "variable", id: def.id,
      label: def.label, aliases: [...def.aliases] });
  }
  return registry;
}
function redactReason(code) { return { code }; }

/**
 * Append-only, review-gated relationships backed by immutable source evidence.
 * Canonical documents stay in LocalDocumentVault; parsed edges are rebuilt.
 * Only approved + still-current relationships are returned as graph edges.
 */
export class LocalKnowledgeGraph {
  #vault;
  #types;
  #folder;
  #ledger;

  constructor({ vault, types = new VariableTypeRegistry(),
    root = ".efss/knowledge" } = {}) {
    if (!(vault instanceof LocalDocumentVault) ||
      !(types instanceof VariableTypeRegistry) ||
      typeof root !== "string" || !root.trim() || root.includes("\0")) {
      throw new TypeError("INVALID_GRAPH_CONFIG");
    }
    this.#vault = vault;
    this.#types = types;
    this.#folder = resolve(root);
    this.#ledger = join(this.#folder, LOG_NAME);
  }

  async #load() {
    await guardedDirectory(this.#folder);
    return apply(await readEvents(this.#ledger));
  }

  async #withExclusiveMutation(fn) {
    await guardedDirectory(this.#folder);
    const lock = this.#ledger + ".lock";
    let handle;
    try { handle = await open(lock, "wx", 0o600); }
    catch (error) {
      if (error?.code === "EEXIST") fail("GRAPH_BUSY");
      throw error;
    }
    try {
      const records = await this.#load();
      const event = await fn(records);
      if (!event) fail("INVALID_GRAPH_EVENT");
      const line = JSON.stringify({ schemaVersion: 1,
        at: new Date().toISOString(), ...event }) + "\n";
      if (Buffer.byteLength(line) > 8192) fail("GRAPH_EVENT_TOO_LARGE");
      const current = await readEvents(this.#ledger);
      if (current.length >= MAX_EVENTS) fail("GRAPH_EVENT_LIMIT");
      const writer = await open(this.#ledger, "a", 0o600);
      try {
        await writer.writeFile(line, "utf8");
        await writer.sync();
      } finally { await writer.close(); }
      return event;
    } finally {
      await handle.close();
      await unlink(lock);
    }
  }

  async #evidenceState(e, allowRestricted = false) {
    const [kind, id] = splitNode(e.sourceId);
    const doc = await this.#vault.read(kind, id);
    if (!doc) return "missing";
    if (doc.metadata.visibility === "restricted" && !allowRestricted) return "restricted";
    if (doc.revision !== e.revision) return "stale";
    if (e.end > doc.body.length) return "stale";
    if (hash(doc.body.slice(e.start, e.end)) !== e.fingerprint) return "stale";
    return "current";
  }

  async proposeRelation({ id, from, to, predicate, confidence = 0.5,
    method = "inference", evidence } = {}) {
    const initial = validateRelation({ id, from, to, predicate,
      confidence, method, evidence: { ...evidence, fingerprint: "0".repeat(64) } });
    const [kind, docId] = splitNode(initial.evidence.sourceId);
    const doc = await this.#vault.read(kind, docId);
    if (!doc || doc.revision !== initial.evidence.revision ||
      initial.evidence.end > doc.body.length ||
      doc.metadata.visibility === "restricted") fail("INVALID_OR_RESTRICTED_EVIDENCE");
    const fingerprint = hash(doc.body.slice(initial.evidence.start, initial.evidence.end));
    const relation = { ...initial, evidence: { ...initial.evidence, fingerprint } };
    const all = await this.#documentsAndRegistry();
    if (!all.registry.get(...splitNode(from)) || !all.registry.get(...splitNode(to))) {
      fail("UNRESOLVED_RELATION_ENDPOINT");
    }
    await this.#withExclusiveMutation(records => {
      if (records.has(id)) fail("DUPLICATE_RELATION");
      return { kind: "propose", relation };
    });
    return { id, status: "proposed", evidence: relation.evidence };
  }

  async approveRelation(id) {
    if (!IDENT.test(id ?? "")) fail("INVALID_RELATION_ID");
    await this.#withExclusiveMutation(async records => {
      const r = records.get(id);
      if (!r || r.status !== "proposed") fail("RELATION_NOT_PROPOSED");
      if (await this.#evidenceState(r.evidence) !== "current") fail("RELATION_EVIDENCE_NOT_CURRENT");
      const all = await this.#documentsAndRegistry();
      if (!all.registry.get(...splitNode(r.from)) || !all.registry.get(...splitNode(r.to))) {
        fail("UNRESOLVED_RELATION_ENDPOINT");
      }
      return { kind: "approve", id };
    });
    return { id, status: "approved" };
  }

  async retireRelation(id) {
    if (!IDENT.test(id ?? "")) fail("INVALID_RELATION_ID");
    await this.#withExclusiveMutation(records => {
      const r = records.get(id);
      if (!r || r.status !== "approved") fail("RELATION_NOT_APPROVED");
      return { kind: "retire", id };
    });
    return { id, status: "retired" };
  }

  async #documentsAndRegistry({ allowRestricted = false } = {}) {
    const listed = await this.#vault.list();
    const documents = [];
    const revisions = new Map();
    const blockedVariables = new Set(listed.filter(item =>
      !allowRestricted && item.kind === "variable" &&
      item.metadata.visibility === "restricted").map(item => item.id));
    for (const item of listed) {
      if (item.metadata.visibility === "restricted" && !allowRestricted) continue;
      const doc = await this.#vault.read(item.kind, item.id);
      documents.push({ metadata: doc.metadata, body: doc.body });
      revisions.set(item.kind + ":" + item.id, doc.revision);
    }
    const types = await loadVariableSchemas(this.#vault, {
      baseTypes: this.#types, allowRestricted
    });
    return { documents, revisions, types,
      registry: currentEntities(documents, types, blockedVariables) };
  }

  async snapshot({ allowRestricted = false } = {}) {
    if (typeof allowRestricted !== "boolean") throw new TypeError("INVALID_GRAPH_VIEW");
    const { documents, revisions, registry } = await this.#documentsAndRegistry({ allowRestricted });
    const derived = buildGraph(documents, registry);
    const nodes = new Set(derived.nodes);
    const edges = derived.edges.map(edge => ({
      ...edge, origin: "markdown", status: "observed",
      evidence: { sourceId: edge.from, revision: revisions.get(edge.from),
        offset: edge.evidence.offset }
    }));
    const diagnostics = [...derived.unresolved];
    const records = await this.#load();
    const relations = [];
    for (const relation of records.values()) {
      const state = await this.#evidenceState(relation.evidence, allowRestricted);
      const endpointAvailable = !!registry.get(...splitNode(relation.from)) &&
        !!registry.get(...splitNode(relation.to));
      // No relationship metadata from private documents may appear in a public view.
      if (state === "restricted") continue;
      if (state === "missing" && !allowRestricted) {
        diagnostics.push({ code: "RELATION_SOURCE_MISSING", relationId: relation.id });
        continue;
      }
      if (!endpointAvailable && !allowRestricted) continue;
      const effectiveStatus = relation.status === "approved" && state !== "current" ?
        "stale" : relation.status;
      if (effectiveStatus === "stale") {
        diagnostics.push({ code: "STALE_RELATION_EVIDENCE", relationId: relation.id });
      }
      relations.push({
        id: relation.id, from: relation.from, to: relation.to,
        predicate: relation.predicate, confidence: relation.confidence,
        method: relation.method, status: effectiveStatus,
        evidence: { ...relation.evidence, state }
      });
      if (effectiveStatus !== "approved" || state !== "current" || !endpointAvailable) continue;
      nodes.add(relation.from);
      nodes.add(relation.to);
      edges.push({ from: relation.from, to: relation.to,
        relation: relation.predicate, origin: "approved-relation",
        confidence: relation.confidence, evidence: { ...relation.evidence },
        relationId: relation.id });
    }
    return { nodes: [...nodes].sort(), edges, relations, diagnostics,
      documents: documents.length };
  }
}

import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { LocalDocumentVault } from "./local-document-vault.js";
import { VariableTypeRegistry, validateTypedValue } from "./typed-variables.js";
import { loadVariableSchemas } from "./variable-schema-documents.js";
import { inspectVariableBindings } from "./binding-resolver.js";

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const SOURCE = /^(paper|project):[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const FILENAME = "observations.jsonl";
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 10000;
const MAX_EVENT_BYTES = 24576;
const MAX_BINDING_SPAN = 8200;
const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(code) { throw new Error(code); }
function digest(text) { return createHash("sha256").update(text, "utf8").digest("hex"); }
function cleanId(id) { if (!ID.test(id ?? "")) fail("INVALID_OBSERVATION_ID"); return id; }
function cleanSource(sourceId) {
  if (!SOURCE.test(sourceId ?? "")) fail("INVALID_OBSERVATION_SOURCE");
  const colon = sourceId.indexOf(":");
  return [sourceId.slice(0, colon), sourceId.slice(colon + 1)];
}
function schemaDigest(def) {
  return digest(JSON.stringify({
    schemaVersion: def.schemaVersion, id: def.id, label: def.label,
    aliases: [...def.aliases], value: def.value, properties: def.properties
  }));
}
function validEvidence(proof) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) fail("INVALID_OBSERVATION_EVIDENCE");
  cleanSource(proof.sourceId);
  if (!SHA.test(proof.revision ?? "") || !SHA.test(proof.fingerprint ?? "") ||
      !SHA.test(proof.schemaFingerprint ?? "") ||
      !Number.isSafeInteger(proof.start) || !Number.isSafeInteger(proof.end) ||
      proof.start < 0 || proof.end <= proof.start ||
      proof.end - proof.start > MAX_BINDING_SPAN) fail("INVALID_OBSERVATION_EVIDENCE");
  return { sourceId: proof.sourceId, revision: proof.revision,
    start: proof.start, end: proof.end, fingerprint: proof.fingerprint,
    schemaFingerprint: proof.schemaFingerprint };
}
function validRecord(rec) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) fail("CORRUPT_OBSERVATION_JOURNAL");
  cleanId(rec.id);
  if (!ID.test(rec.variableId ?? "") || !Array.isArray(rec.values) ||
      !rec.values.length || rec.values.length > 64 ||
      !["text", "number", "boolean", "date", "enum", "reference"].includes(rec.variableType) ||
      rec.values.some(value => value === null ||
        !["string", "number", "boolean"].includes(typeof value) ||
        typeof value === "number" && !Number.isFinite(value) ||
        typeof value === "string" && value.length > 8192)) {
    fail("CORRUPT_OBSERVATION_JOURNAL");
  }
  const evidence = validEvidence(rec.evidence);
  return { id: rec.id, variableId: rec.variableId, variableType: rec.variableType,
    values: [...rec.values], evidence };
}
function replay(events) {
  const records = new Map();
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        event.schemaVersion !== 1 || typeof event.at !== "string" ||
        !Number.isFinite(Date.parse(event.at))) fail("CORRUPT_OBSERVATION_JOURNAL");
    if (event.kind === "propose") {
      const rec = validRecord(event.record);
      if (records.has(rec.id)) fail("CORRUPT_OBSERVATION_JOURNAL");
      records.set(rec.id, { ...rec, status: "proposed", proposedAt: event.at });
    } else if (event.kind === "approve" || event.kind === "retire") {
      cleanId(event.id);
      const rec = records.get(event.id);
      const expected = event.kind === "approve" ? "proposed" : "approved";
      if (!rec || rec.status !== expected) fail("CORRUPT_OBSERVATION_JOURNAL");
      records.set(rec.id, { ...rec, status: event.kind === "approve" ? "approved" : "retired",
        changedAt: event.at });
    } else {
      fail("CORRUPT_OBSERVATION_JOURNAL");
    }
  }
  return records;
}

async function safeStorage(folder, journal) {
  await mkdir(dirname(folder), { recursive: true, mode: 0o700 });
  const parent = await lstat(dirname(folder));
  if (!parent.isDirectory() || parent.isSymbolicLink()) fail("UNSAFE_OBSERVATION_DIRECTORY");
  try { await mkdir(folder, { mode: 0o700 }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const dir = await lstat(folder);
  if (!dir.isDirectory() || dir.isSymbolicLink()) fail("UNSAFE_OBSERVATION_DIRECTORY");
  try {
    const data = await lstat(journal);
    if (!data.isFile() || data.isSymbolicLink()) fail("UNSAFE_OBSERVATION_JOURNAL");
    if (data.size > MAX_JOURNAL_BYTES) fail("OBSERVATION_JOURNAL_TOO_LARGE");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
async function readEvents(journal) {
  let bytes;
  try { bytes = await readFile(journal); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  if (bytes.length > MAX_JOURNAL_BYTES) fail("OBSERVATION_JOURNAL_TOO_LARGE");
  const text = decoder.decode(bytes);
  if (text && !text.endsWith("\n")) fail("INCOMPLETE_OBSERVATION_JOURNAL");
  const lines = text ? text.slice(0, -1).split("\n") : [];
  if (lines.length > MAX_EVENTS) fail("OBSERVATION_EVENT_LIMIT");
  try { return lines.map(line => JSON.parse(line)); }
  catch { fail("CORRUPT_OBSERVATION_JOURNAL"); }
}

/**
 * Private, append-only observation journal.
 * Paper/project source only; never automatically trusts a conversation or AI turn.
 * An observation is usable only when explicitly approved and its source AND
 * variable schema still match their recorded revisions.
 */
export class LocalObservationLedger {
  #vault;
  #baseTypes;
  #folder;
  #journal;

  constructor({ vault, types = new VariableTypeRegistry(), root = ".efss/knowledge" } = {}) {
    if (!(vault instanceof LocalDocumentVault) ||
        !(types instanceof VariableTypeRegistry) ||
        typeof root !== "string" || !root.trim() || root.includes("\0")) {
      throw new TypeError("INVALID_OBSERVATION_CONFIG");
    }
    this.#vault = vault;
    this.#baseTypes = types;
    this.#folder = resolve(root);
    this.#journal = join(this.#folder, FILENAME);
  }

  async #read() {
    await safeStorage(this.#folder, this.#journal);
    return replay(await readEvents(this.#journal));
  }

  async #mutate(fn) {
    await safeStorage(this.#folder, this.#journal);
    const lockPath = this.#journal + ".lock";
    let lock;
    try { lock = await open(lockPath, "wx", 0o600); }
    catch (error) {
      if (error?.code === "EEXIST") fail("OBSERVATION_BUSY");
      throw error;
    }
    try {
      const records = await this.#read();
      const event = await fn(records);
      const line = JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(),
        ...event }) + "\n";
      if (Buffer.byteLength(line) > MAX_EVENT_BYTES) fail("OBSERVATION_EVENT_TOO_LARGE");
      const events = await readEvents(this.#journal);
      if (events.length >= MAX_EVENTS || Buffer.byteLength(line) +
          Buffer.byteLength(events.map(e => JSON.stringify(e) + "\n").join("")) >
          MAX_JOURNAL_BYTES) fail("OBSERVATION_EVENT_LIMIT");
      const handle = await open(this.#journal, "a", 0o600);
      try { await handle.writeFile(line, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      return event;
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }

  async #inspect(sourceId, revision, start, end, allowRestricted = false) {
    const [kind, id] = cleanSource(sourceId);
    if (!SHA.test(revision ?? "") ||
        !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end <= start || end - start > MAX_BINDING_SPAN) {
      fail("INVALID_OBSERVATION_EVIDENCE");
    }
    const doc = await this.#vault.read(kind, id);
    if (!doc) fail("OBSERVATION_SOURCE_MISSING");
    if (doc.metadata.visibility === "restricted" && !allowRestricted)
      fail("RESTRICTED_OBSERVATION_SOURCE");
    if (doc.revision !== revision || end > doc.body.length)
      fail("OBSERVATION_SOURCE_CHANGED");
    const types = await loadVariableSchemas(this.#vault, {
      baseTypes: this.#baseTypes, allowRestricted
    });
    const inspected = inspectVariableBindings(doc.body, types, { sourceId });
    const matching = inspected.candidates.filter(x =>
      x.provenance.start === start && x.provenance.end === end);
    if (matching.length !== 1) fail("OBSERVATION_BINDING_NOT_FOUND");
    const candidate = matching[0];
    const schema = types.get(candidate.variableId);
    if (!schema) fail("OBSERVATION_SCHEMA_NOT_FOUND");
    const values = candidate.values.map(value => validateTypedValue(schema.value, value));
    return {
      id: candidate.variableId,
      variableType: schema.value.type,
      values,
      evidence: { sourceId, revision, start, end,
        fingerprint: digest(doc.body.slice(start, end)),
        schemaFingerprint: schemaDigest(schema) }
    };
  }

  async propose({ id, sourceId, revision, start, end } = {}) {
    cleanId(id);
    const candidate = await this.#inspect(sourceId, revision, start, end);
    await this.#mutate(async records => {
      if (records.has(id)) fail("DUPLICATE_OBSERVATION");
      // Recheck under journal lock; a concurrently edited source invalidates it.
      const fresh = await this.#inspect(sourceId, revision, start, end);
      if (JSON.stringify(fresh) !== JSON.stringify(candidate))
        fail("OBSERVATION_SOURCE_CHANGED");
      return { kind: "propose", record: {
        id, variableId: candidate.id, variableType: candidate.variableType,
        values: candidate.values, evidence: candidate.evidence
      } };
    });
    return { id, status: "proposed", variableId: candidate.id,
      evidence: candidate.evidence };
  }

  async #state(rec, allowRestricted = false, currentTypes = null) {
    const [kind, docId] = cleanSource(rec.evidence.sourceId);
    const doc = await this.#vault.read(kind, docId);
    if (!doc) return "missing";
    if (doc.metadata.visibility === "restricted" && !allowRestricted) return "restricted";
    const schemaDocument = await this.#vault.read("variable", rec.variableId);
    if (schemaDocument?.metadata.visibility === "restricted" && !allowRestricted)
      return "restricted";
    if (doc.revision !== rec.evidence.revision ||
        rec.evidence.end > doc.body.length ||
        digest(doc.body.slice(rec.evidence.start, rec.evidence.end)) !==
          rec.evidence.fingerprint) return "stale";
    const types = currentTypes ?? await loadVariableSchemas(this.#vault, {
      baseTypes: this.#baseTypes, allowRestricted
    });
    const schema = types.get(rec.variableId);
    if (!schema) return "schema-missing";
    if (schemaDigest(schema) !== rec.evidence.schemaFingerprint ||
        schema.value.type !== rec.variableType) return "schema-changed";
    try {
      for (const value of rec.values) validateTypedValue(schema.value, value);
    } catch { return "schema-changed"; }
    const inspected = inspectVariableBindings(doc.body, types, {
      sourceId: rec.evidence.sourceId
    });
    const found = inspected.candidates.some(x =>
      x.variableId === rec.variableId &&
      x.provenance.start === rec.evidence.start &&
      x.provenance.end === rec.evidence.end &&
      JSON.stringify(x.values) === JSON.stringify(rec.values));
    return found ? "current" : "stale";
  }

  async approve(id) {
    cleanId(id);
    await this.#mutate(async records => {
      const rec = records.get(id);
      if (!rec || rec.status !== "proposed") fail("OBSERVATION_NOT_PROPOSED");
      if (await this.#state(rec) !== "current") fail("OBSERVATION_EVIDENCE_NOT_CURRENT");
      return { kind: "approve", id };
    });
    return { id, status: "approved" };
  }

  async retire(id) {
    cleanId(id);
    await this.#mutate(records => {
      const rec = records.get(id);
      if (!rec || rec.status !== "approved") fail("OBSERVATION_NOT_APPROVED");
      return { kind: "retire", id };
    });
    return { id, status: "retired" };
  }

  async snapshot({ allowRestricted = false } = {}) {
    if (typeof allowRestricted !== "boolean") throw new TypeError("INVALID_OBSERVATION_VIEW");
    const types = await loadVariableSchemas(this.#vault, {
      baseTypes: this.#baseTypes, allowRestricted
    });
    // Hidden variable schemas may have been supplied through app-only baseTypes.
    // The current schema registry only exposes explicitly requested definitions.
    const records = await this.#read();
    const active = [], history = [], diagnostics = [];
    for (const rec of records.values()) {
      const evidenceState = await this.#state(rec, allowRestricted, types);
      if (evidenceState === "restricted" || evidenceState === "missing") continue;
      const effectiveStatus = rec.status === "approved" &&
        evidenceState !== "current" ? "stale" : rec.status;
      const summary = {
        id: rec.id, variableId: rec.variableId, variableType: rec.variableType,
        status: effectiveStatus, evidenceState,
        evidence: { ...rec.evidence }, proposedAt: rec.proposedAt,
        changedAt: rec.changedAt ?? null
      };
      history.push(summary);
      if (effectiveStatus === "stale") diagnostics.push({
        code: "STALE_OBSERVATION_EVIDENCE", observationId: rec.id,
        reason: evidenceState
      });
      if (effectiveStatus === "approved" && evidenceState === "current") {
        active.push({ ...summary, values: [...rec.values] });
      }
    }
    return { active, history, diagnostics, total: records.size };
  }
}

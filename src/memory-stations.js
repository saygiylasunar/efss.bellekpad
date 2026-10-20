import { parseMarkdownAst } from "./ast.js";
import { EFSS_CONTRACT } from "./contract.js";

const KINDS = new Set(EFSS_CONTRACT.kinds);
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const TERMS = /[\p{L}\p{M}\p{N}_]+/gu;
const WORDS_TO_IGNORE = new Set(["ve", "bir", "bu", "ile", "icin", "için", "gibi", "olan",
  "olarak", "ama", "da", "de", "ile", "the", "and", "for", "this", "that"]);

export function lexicalTerms(value) {
  if (typeof value !== "string") throw new TypeError("Expected text");
  return [...value.normalize("NFC").toLocaleLowerCase("tr-TR").matchAll(TERMS)]
    .map(match => ({ term: match[0], start: match.index, end: match.index + match[0].length }))
    .filter(item => item.term.length >= 2);
}

function vectorData(value) {
  if (!Array.isArray(value) && !(value instanceof Float32Array)) {
    throw new TypeError("Expected a vector");
  }
  if (!value.length || value.length > 16384 ||
      [...value].some(number => typeof number !== "number" || !Number.isFinite(number))) {
    throw new Error("Invalid vector");
  }
  const copied = Float32Array.from(value);
  if (!copied.some(number => number !== 0)) throw new Error("Zero vector");
  return copied;
}

export function cosineSimilarity(left, right) {
  const a = vectorData(left), b = vectorData(right);
  if (a.length !== b.length) throw new Error("Vector dimensions differ");
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma += a[i] ** 2;
    mb += b[i] ** 2;
  }
  return Math.max(-1, Math.min(1, dot / Math.sqrt(ma * mb)));
}

export class MemoryStations {
  #documents = new Map();
  #segments = new Map();
  #generations = new Map();
  #vectors = new Map();
  #models = new Map();
  #hypotheses = new Map();
  #nextHypothesis = 0;

  ingest({ metadata, body } = {}) {
    if (!metadata || !KINDS.has(metadata.kind) || !ID.test(metadata.id ?? "") ||
        typeof body !== "string") throw new Error("Invalid memory source");
    const sourceId = metadata.kind + ":" + metadata.id;
    const ast = parseMarkdownAst(body);
    const nextGeneration = (this.#generations.get(sourceId) ?? 0) + 1;
    const old = this.#documents.get(sourceId);
    if (old) {
      for (const segmentId of old.segmentIds) {
        this.#segments.delete(segmentId);
        for (const vectors of this.#vectors.values()) vectors.delete(segmentId);
      }
      for (const [id, hypothesis] of this.#hypotheses) {
        if (hypothesis.evidence.some(segmentId => !this.#segments.has(segmentId))) {
          this.#hypotheses.delete(id);
        }
      }
    }
    this.#generations.set(sourceId, nextGeneration);
    const segmentIds = [];
    for (const block of ast.blocks) {
      if (["blank", "directive", "extension_block"].includes(block.type) ||
          !block.raw.trim()) continue;
      const segmentId = sourceId + "@" + nextGeneration + "#" + segmentIds.length;
      const segment = Object.freeze({
        id: segmentId, sourceId, blockType: block.type,
        start: block.start, end: block.end, text: block.raw,
        title: typeof metadata.title === "string" ? metadata.title : "",
        visibility: metadata.visibility === "restricted" ? "restricted" : "normal"
      });
      this.#segments.set(segmentId, segment);
      segmentIds.push(segmentId);
    }
    this.#documents.set(sourceId, {
      sourceId, metadata: { ...metadata }, segmentIds, diagnostics: ast.diagnostics
    });
    return { sourceId, segments: segmentIds.length, diagnostics: ast.diagnostics };
  }

  getSegment(id) { return this.#segments.get(id) ?? null; }
  segments() { return [...this.#segments.values()]; }
  source(id) {
    const document = this.#documents.get(id);
    return document ? {
      sourceId: document.sourceId, metadata: { ...document.metadata },
      segmentIds: [...document.segmentIds], diagnostics: [...document.diagnostics]
    } : null;
  }

  attachEmbedding({ segmentId, model, vector } = {}) {
    if (!this.#segments.has(segmentId)) throw new Error("Unknown memory segment");
    if (typeof model !== "string" || !model.trim() || model.length > 160) {
      throw new Error("Invalid embedding model id");
    }
    const values = vectorData(vector);
    const dimension = this.#models.get(model);
    if (dimension != null && dimension !== values.length) {
      throw new Error("Embedding model dimension changed");
    }
    this.#models.set(model, values.length);
    if (!this.#vectors.has(model)) this.#vectors.set(model, new Map());
    this.#vectors.get(model).set(segmentId, values);
    return { segmentId, model, dimensions: values.length };
  }

  search({ query = "", vector = null, model = null, limit = 8, canRead = segment =>
    segment.visibility !== "restricted" } = {}) {
    if (typeof query !== "string" || !Number.isSafeInteger(limit) ||
        limit < 0 || limit > 100 || typeof canRead !== "function") {
      throw new TypeError("Invalid memory search");
    }
    if (vector === null && model !== null || vector !== null && typeof model !== "string") {
      throw new Error("Model required with an embedding query");
    }
    const wanted = new Set(lexicalTerms(query).map(item => item.term));
    const embedded = vector !== null ? vectorData(vector) : null;
    if (embedded !== null && this.#models.has(model) &&
        this.#models.get(model) !== embedded.length) throw new Error("Embedding dimension mismatch");
    const results = [];
    for (const segment of this.#segments.values()) {
      if (!canRead(segment)) continue;
      const terms = new Set(lexicalTerms(segment.title + "\n" + segment.text).map(x => x.term));
      const overlapping = [...wanted].filter(word => terms.has(word));
      const lexical = wanted.size ? overlapping.length / wanted.size : 0;
      const stored = embedded !== null ? this.#vectors.get(model)?.get(segment.id) : null;
      const semantic = stored ? Math.max(0, cosineSimilarity(embedded, stored)) : 0;
      const score = embedded ? (0.4 * lexical + 0.6 * semantic) : lexical;
      if (score <= 0) continue;
      results.push({
        id: segment.id, sourceId: segment.sourceId, blockType: segment.blockType,
        title: segment.title, text: segment.text, start: segment.start, end: segment.end,
        score: Number(score.toFixed(6)), signals: {
          lexical: Number(lexical.toFixed(6)),
          semantic: Number(semantic.toFixed(6)),
          model: stored ? model : null
        }
      });
    }
    return results.sort((a, b) => b.score - a.score ||
      a.sourceId.localeCompare(b.sourceId) || a.start - b.start).slice(0, limit);
  }

  recurringTerms({ minSources = 2, minCount = 2, limit = 25,
    ignore = WORDS_TO_IGNORE, canRead = segment => segment.visibility !== "restricted" } = {}) {
    if (![minSources, minCount, limit].every(v => Number.isSafeInteger(v) && v > 0) ||
        typeof canRead !== "function" || !(ignore instanceof Set)) throw new Error("Invalid terms settings");
    const counts = new Map();
    for (const segment of this.#segments.values()) {
      if (!canRead(segment)) continue;
      for (const word of lexicalTerms(segment.text)) {
        if (ignore.has(word.term)) continue;
        if (!counts.has(word.term)) counts.set(word.term, { term: word.term, count: 0, sources: new Set(), evidence: [] });
        const found = counts.get(word.term);
        found.count++;
        found.sources.add(segment.sourceId);
        if (found.evidence.length < 8) found.evidence.push({
          sourceId: segment.sourceId, segmentId: segment.id,
          start: segment.start + word.start, end: segment.start + word.end
        });
      }
    }
    return [...counts.values()].filter(x => x.count >= minCount && x.sources.size >= minSources)
      .sort((a, b) => b.sources.size - a.sources.size || b.count - a.count || a.term.localeCompare(b.term))
      .slice(0, limit)
      .map(x => ({
        term: x.term, count: x.count, sourceCount: x.sources.size,
        evidence: x.evidence, status: "candidate", semanticMeaning: null
      }));
  }

  proposeRelation({ subject, predicate, object, evidence, confidence, method = "inference" } = {}) {
    if (![subject, predicate, object].every(x => typeof x === "string" && x.trim() && x.length < 161) ||
        !Array.isArray(evidence) || evidence.length === 0 ||
        evidence.some(id => !this.#segments.has(id)) ||
        typeof confidence !== "number" || !Number.isFinite(confidence) ||
        confidence < 0 || confidence > 1 ||
        !["inference", "cooccurrence", "user"].includes(method)) {
      throw new Error("Invalid relationship candidate");
    }
    const id = "hypothesis:" + (++this.#nextHypothesis);
    const proposal = Object.freeze({
      id, subject, predicate, object, confidence, method,
      evidence: Object.freeze([...new Set(evidence)]), status: "proposed"
    });
    this.#hypotheses.set(id, proposal);
    return proposal;
  }

  relationsFor(term, { approvedOnly = false } = {}) {
    if (typeof term !== "string") throw new TypeError("Expected term");
    return [...this.#hypotheses.values()].filter(p =>
      (!approvedOnly || p.status === "approved") &&
      [p.subject, p.object].some(v => v.toLocaleLowerCase("tr-TR") === term.toLocaleLowerCase("tr-TR")));
  }

  approveRelation(id) {
    const found = this.#hypotheses.get(id);
    if (!found) throw new Error("Unknown relationship");
    const approved = Object.freeze({ ...found, status: "approved" });
    this.#hypotheses.set(id, approved);
    return approved;
  }

  contextTray({ query, vector = null, model = null, limit = 8, maxChars = 12000,
    canRead } = {}) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 0) throw new Error("Invalid budget");
    const candidates = this.search({ query, vector, model, limit, canRead });
    const sources = [], excluded = [];
    let chars = 0;
    for (const source of candidates) {
      if (chars + source.text.length > maxChars) {
        excluded.push({ id: source.id, reason: "BUDGET" });
        continue;
      }
      chars += source.text.length;
      sources.push({
        id: source.id, sourceId: source.sourceId,
        title: source.title, text: source.text,
        provenance: { sourceId: source.sourceId, start: source.start, end: source.end },
        retrieval: source.signals, rankScore: source.score,
        trust: "untrusted-source-data"
      });
    }
    return {
      operation: "reference-context",
      effects: "none", authority: "none",
      sources, excluded, chars, model: model ?? null
    };
  }
}

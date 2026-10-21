// BellekPad G0.3 — lossless EFSS Markdown block projection.
// Keeps the *original source bytes* authoritative. Block IDs are stable within
// an editing session; they are NOT yet persisted across restart.
// Browser/Node/Electron independent, using our own EFSS AST only.
import { parseMarkdownAst } from "./ast.js";
import { isGraphemeBoundary } from "./editor-text-engine.js";

const MAX_SOURCE_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const INSERTABLE = Object.freeze({
  paragraph: "",
  heading: "# ",
  quote: "> ",
  list_item: "- ",
  thematic_break: "---"
});

function fail(reason) { throw new Error(reason); }
function checkSource(source) {
  if (typeof source !== "string" || source.includes("\0")) fail("INVALID_BLOCK_SOURCE");
  if (encoder.encode(source).length > MAX_SOURCE_BYTES) fail("BLOCK_SOURCE_TOO_LARGE");
  return source;
}
function isPlain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function blockFromAst(block, id) {
  return Object.freeze({
    id, type: block.type, raw: block.raw,
    start: block.start, end: block.end,
    ...(block.level != null ? { level: block.level } : {}),
    // Unknown/extension syntax remains a visible, opaque source block.
    opaque: block.type === "extension_block",
    ...(typeof block.closed === "boolean" ? { closed: block.closed } : {})
  });
}
function snapshot(source, blocks, version, nextId, diagnostics) {
  const frozen = Object.freeze(blocks.map(Object.freeze));
  const doc = Object.freeze({
    source, version, blocks: frozen, nextId,
    diagnostics: Object.freeze(diagnostics.map(d => Object.freeze({ ...d })))
  });
  // Guard against a model transformation changing original source segments.
  if (frozen.map(block => block.raw).join("") !== source) fail("BLOCK_SOURCE_MISMATCH");
  let at = 0;
  for (const block of frozen) {
    if (block.start !== at || block.end !== at + block.raw.length)
      fail("BLOCK_SOURCE_MISMATCH");
    at = block.end;
  }
  return doc;
}
export function createBlockDocument(source) {
  checkSource(source);
  const ast = parseMarkdownAst(source);
  let serial = 0;
  const blocks = ast.blocks.map(block => blockFromAst(block, "block_" + (++serial)));
  return snapshot(source, blocks, 0, serial + 1, ast.diagnostics);
}
function checkDocument(doc) {
  if (!isPlain(doc) || typeof doc.source !== "string" ||
      !Number.isSafeInteger(doc.version) ||
      !Number.isSafeInteger(doc.nextId) ||
      !Array.isArray(doc.blocks) ||
      doc.blocks.map(b => b.raw).join("") !== doc.source) fail("INVALID_BLOCK_DOCUMENT");
}
export function serializeBlockDocument(doc) {
  checkDocument(doc);
  return doc.source;
}
export function reconcileBlockSource(doc, nextSource, { expectedVersion = doc?.version } = {}) {
  checkDocument(doc);
  checkSource(nextSource);
  if (expectedVersion !== doc.version) fail("BLOCK_VERSION_CONFLICT");
  if (nextSource === doc.source) return doc;
  const ast = parseMarkdownAst(nextSource);
  const old = doc.blocks, fresh = ast.blocks;
  const ids = Array(fresh.length).fill(null);
  // Match untouched prefix and suffix blocks, even after intervening edits.
  let left = 0;
  while (left < old.length && left < fresh.length &&
      old[left].raw === fresh[left].raw && old[left].type === fresh[left].type) {
    ids[left] = old[left].id; left++;
  }
  let oi = old.length - 1, ni = fresh.length - 1;
  while (oi >= left && ni >= left &&
      old[oi].raw === fresh[ni].raw && old[oi].type === fresh[ni].type) {
    ids[ni] = old[oi].id;
    oi--; ni--;
  }
  // A single rewritten block retains its selection/inspector identity.
  // Split/merge boundaries create fresh IDs; no guessing across ambiguous edits.
  if (oi === left && ni === left && !ids[left]) ids[left] = old[oi].id;
  let serial = doc.nextId;
  const blocks = fresh.map((block, i) =>
    blockFromAst(block, ids[i] ?? "block_" + serial++));
  return snapshot(nextSource, blocks, doc.version + 1, serial, ast.diagnostics);
}
function lineEnding(text) {
  return text.match(/\r\n|\n|\r/)?.[0] ?? "\n";
}
export function insertBlockAfter(doc, {
  afterId = null, kind = "paragraph", content = "", expectedVersion = doc?.version
} = {}) {
  checkDocument(doc);
  if (expectedVersion !== doc.version) fail("BLOCK_VERSION_CONFLICT");
  if (!Object.hasOwn(INSERTABLE, kind)) fail("UNSUPPORTED_BLOCK_INSERT");
  if (typeof content !== "string" || /[\r\n\0]/.test(content) ||
      encoder.encode(content).length > 4096) fail("INVALID_BLOCK_CONTENT");
  if (kind === "thematic_break" && content) fail("INVALID_BLOCK_CONTENT");
  // Prevent a caller from smuggling a second syntactic block into a paragraph.
  const marker = INSERTABLE[kind];
  if (kind === "paragraph" && /^ {0,3}(?:#|[-+*] |\d+[.)] |>|::|~~~|\\x60\\x60\\x60)/.test(content))
    fail("AMBIGUOUS_PARAGRAPH_CONTENT");
  const index = afterId === null ? doc.blocks.length - 1 :
    doc.blocks.findIndex(block => block.id === afterId);
  if (afterId !== null && index < 0) fail("BLOCK_NOT_FOUND");
  const at = index < 0 ? 0 : doc.blocks[index].end;
  const eol = lineEnding(doc.source);
  const snippet = marker + content;
  const before = doc.source.slice(0, at);
  const after = doc.source.slice(at);
  const prefix = before.length ? (before.endsWith("\n") || before.endsWith("\r") ? eol : eol + eol) : "";
  const suffix = after.length && !after.startsWith("\n") && !after.startsWith("\r") ?
    eol : "";
  const insertion = prefix + snippet + eol + suffix;
  return reconcileBlockSource(doc, before + insertion + after);
}
export function replaceBlockRaw(doc, { id, raw, expectedVersion = doc?.version } = {}) {
  checkDocument(doc);
  if (expectedVersion !== doc.version) fail("BLOCK_VERSION_CONFLICT");
  const block = doc.blocks.find(item => item.id === id);
  if (!block) fail("BLOCK_NOT_FOUND");
  if (block.opaque) fail("OPAQUE_BLOCK_REQUIRES_SOURCE_MODE");
  if (typeof raw !== "string" || raw.includes("\0")) fail("INVALID_BLOCK_CONTENT");
  return reconcileBlockSource(doc, doc.source.slice(0, block.start) + raw +
    doc.source.slice(block.end));
}
export function blockOutline(doc) {
  checkDocument(doc);
  return Object.freeze(doc.blocks.filter(block => block.type !== "blank").map(block =>
    Object.freeze({
      id: block.id, type: block.type, opaque: block.opaque,
      preview: block.raw.split(/\r\n|\n|\r/)[0].slice(0, 120),
      start: block.start, end: block.end
    })));
}

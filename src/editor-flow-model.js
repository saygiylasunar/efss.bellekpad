// G0.4: flow view of the *existing* EFSS source; it is not a second document
// store. Only losslessly representable blocks are editable in this first pass.
import { projectInline } from "./editor-inline-format.js";
import { isGraphemeBoundary } from "./editor-text-engine.js";
import { reconcileBlockSource } from "./editor-block-model.js";

const TYPES = Object.freeze(["paragraph", "heading", "list_item", "quote", "blank"]);
const CALLOUT = /^(info|tip|warning|success|error)$/;
const MARKERS = Object.freeze({
  paragraph: "", heading: "# ", list_item: "- ", quote: "> ",
  callout: ""
});
const STYLE = Object.freeze({
  info: { icon: "ℹ️", title: "Bilgi" },
  tip: { icon: "💡", title: "İpucu" },
  warning: { icon: "⚠️", title: "Uyarı" },
  success: { icon: "✅", title: "Başarılı" },
  error: { icon: "⛔", title: "Hata" }
});
const EOL = /\r\n|\r|\n/;

function fail(message) { throw new Error(message); }
function ending(text) { return text.match(/\r\n|\r|\n/)?.[0] ?? "\n"; }
function trailingEol(text) { return /(\r\n|\r|\n)$/.exec(text)?.[0] ?? ""; }
function singleLineContent(text) {
  return !EOL.test(text) && projectInline(text).editable;
}
function flowCallout(block) {
  if (block.type !== "extension_block") return null;
  const raw = block.raw;
  const first = /^:::efss\.callout type=(info|tip|warning|success|error) icon=("(?:\\.|[^"\\])*") title=("(?:\\.|[^"\\])*")(\r\n|\r|\n)/.exec(raw);
  if (!first) return null;
  let icon, title;
  try { icon = JSON.parse(first[2]); title = JSON.parse(first[3]); }
  catch { return null; }
  if (typeof icon !== "string" || typeof title !== "string") return null;
  const remaining = raw.slice(first[0].length);
  const close = /(\r\n|\r|\n):::(?:\r\n|\r|\n)?$/.exec(remaining);
  if (!close || close.index + close[0].length !== remaining.length) return null;
  const content = remaining.slice(0, close.index);
  return Object.freeze({
    id: block.id, type: "callout", variant: first[1], icon, title,
    text: projectInline(content).text, inline: projectInline(content),
    start: block.start, end: block.end,
    sourceStart: block.start + first[0].length,
    sourceEnd: block.start + first[0].length + content.length,
    editable: !EOL.test(content) && singleLineContent(content),
    raw: raw
  });
}
export function projectFlowBlocks(doc) {
  if (!doc || typeof doc.source !== "string" || !Array.isArray(doc.blocks))
    fail("INVALID_FLOW_DOCUMENT");
  if (!doc.source.length) return Object.freeze([Object.freeze({
    id: "virtual_empty", type: "paragraph", text: "", raw: "",
    start: 0, end: 0, sourceStart: 0, sourceEnd: 0, editable: true, virtual: true
  })]);
  const result = doc.blocks.map(block => {
    const callout = flowCallout(block);
    if (callout) return callout;
    const raw = block.raw;
    const eol = trailingEol(raw);
    const line = raw.slice(0, raw.length - eol.length);
    if (block.type === "blank") return Object.freeze({
      id: block.id, type: "blank", text: "", raw, start: block.start,
      end: block.end, sourceStart: block.start, sourceEnd: block.start,
      editable: true
    });
    if (!TYPES.includes(block.type) || EOL.test(line)) return Object.freeze({
      id: block.id, type: block.type, raw, text: raw,
      start: block.start, end: block.end, editable: false
    });
    let prefix = "";
    if (block.type === "heading") prefix = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(line)?.[0] ?? "";
    if (block.type === "list_item") prefix = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(line)?.[0] ?? "";
    if (block.type === "quote") prefix = /^ {0,3}>[ \t]?/.exec(line)?.[0] ?? "";
    if (block.type !== "paragraph" && !prefix) return Object.freeze({
      id: block.id, type: block.type, raw, text: raw,
      start: block.start, end: block.end, editable: false
    });
    const rawText = line.slice(prefix.length);
    const inline = projectInline(rawText);
    return Object.freeze({
      id: block.id, type: block.type, level: block.level,
      raw, text: inline.text, inline, start: block.start, end: block.end,
      sourceStart: block.start + prefix.length,
      sourceEnd: block.start + prefix.length + rawText.length,
      editable: singleLineContent(rawText)
    });
  });
  return Object.freeze(result);
}
export function flowBlockAt(doc, id) {
  return projectFlowBlocks(doc).find(x => x.id === id) ?? null;
}
export function editFlowText(doc, { id, text, expectedVersion = doc?.version } = {}) {
  if (expectedVersion !== doc?.version) fail("BLOCK_VERSION_CONFLICT");
  if (typeof text !== "string" || EOL.test(text) || text.includes("\0"))
    fail("INVALID_FLOW_TEXT");
  const block = flowBlockAt(doc, id);
  if (!block) fail("FLOW_BLOCK_NOT_FOUND");
  if (!block.editable) fail("FLOW_BLOCK_READ_ONLY");
  if (block.inline?.regions.length) fail("FLOW_MARKED_REQUIRES_TRANSACTION");
  if (!isGraphemeBoundary(doc.source, block.sourceStart) ||
      !isGraphemeBoundary(doc.source, block.sourceEnd)) fail("INVALID_FLOW_BOUNDARY");
  const next = doc.source.slice(0, block.sourceStart) + text +
    doc.source.slice(block.sourceEnd);
  return reconcileBlockSource(doc, next, { expectedVersion });
}
export function calloutMarkdown(variant = "info", eol = "\n") {
  if (!CALLOUT.test(variant) || !["\n", "\r\n", "\r"].includes(eol))
    fail("INVALID_CALLOUT_TYPE");
  const { icon, title } = STYLE[variant];
  return ':::efss.callout type=' + variant + " icon=" + JSON.stringify(icon) +
    " title=" + JSON.stringify(title) + eol + eol + ":::" + eol;
}
export function insertFlowBlock(doc, {
  afterId = null, kind = "paragraph", variant = "info",
  expectedVersion = doc?.version
} = {}) {
  if (!doc || typeof doc.source !== "string" || !Array.isArray(doc.blocks))
    fail("INVALID_FLOW_DOCUMENT");
  if (expectedVersion !== doc.version) fail("BLOCK_VERSION_CONFLICT");
  if (!Object.hasOwn(MARKERS, kind)) fail("UNSUPPORTED_FLOW_BLOCK");
  const anchor = afterId === null ? doc.blocks.at(-1) :
    doc.blocks.find(block => block.id === afterId);
  if (afterId !== null && !anchor) fail("FLOW_BLOCK_NOT_FOUND");
  const eol = ending(doc.source);
  const at = anchor?.end ?? doc.source.length;
  const before = doc.source.slice(0, at);
  const after = doc.source.slice(at);
  const segment = kind === "callout" ? calloutMarkdown(variant, eol) :
    MARKERS[kind] + eol;
  // Blank paragraph is an editable placeholder: its newline is the document
  // separator until the user types, not a hidden nonstandard markup token.
  // Treat CRLF as *one* newline; a regex with \r and \n alternatives can
  // mistakenly count a single CRLF as two separate separators.
  const separator = before.length && !before.endsWith(eol + eol) ?
    before.endsWith(eol) ? eol : eol + eol : "";
  const tail = after.length && !/^(\r\n|\r|\n)/.test(after) ? eol : "";
  const source = before + separator + segment + tail + after;
  return reconcileBlockSource(doc, source, { expectedVersion });
}
export function slashFlowCommand(text) {
  if (typeof text !== "string") return null;
  const commands = {
    "/callout": { kind: "callout", variant: "info" },
    "/uyarı": { kind: "callout", variant: "warning" },
    "/warning": { kind: "callout", variant: "warning" },
    "/ipucu": { kind: "callout", variant: "tip" },
    "/h1": { kind: "heading" },
    "/başlık": { kind: "heading" },
    "/liste": { kind: "list_item" },
    "/list": { kind: "list_item" },
    "/alıntı": { kind: "quote" },
    "/quote": { kind: "quote" }
  };
  return Object.hasOwn(commands, text) ? Object.freeze(commands[text]) : null;
}

// BellekPad G0.5 — own inline Markdown marks, DOM-agnostic.
// The EFSS Markdown source and TextEditorSession remain authoritative.
import { parseInline } from "./ast.js";
import { isGraphemeBoundary } from "./editor-text-engine.js";

export const INLINE_MARKERS = Object.freeze({
  strong: "**", emphasis: "*", strike: "~~"
});
const SENSITIVE = /\[\[paper:|&[\p{L}_][\p{L}\p{N}_]*(?:\{|(?=\b))|::[a-z]/u;
function fail(code) { throw new Error(code); }

export function projectInline(source) {
  if (typeof source !== "string") fail("INVALID_INLINE_SOURCE");
  const parsed = parseInline(source);
  const runs = [];
  const regions = [];
  let supported = !SENSITIVE.test(source);
  function collect(nodes, styles = []) {
    for (const node of nodes) {
      if (node.type === "text") {
        if (node.raw.includes("\\") || node.raw.includes("\r") || node.raw.includes("\n"))
          supported = false; // escapes/multiline need a richer cursor projection
        if (node.raw) runs.push(Object.freeze({
          text: node.raw, from: node.start, to: node.end,
          marks: Object.freeze([...styles])
        }));
      } else if (node.type === "mark" && Object.hasOwn(INLINE_MARKERS, node.rule)) {
        const marker = INLINE_MARKERS[node.rule];
        const contentStart = node.start + marker.length;
        const contentEnd = node.end - marker.length;
        regions.push(Object.freeze({
          mark: node.rule, from: node.start, to: node.end,
          contentStart, contentEnd
        }));
        collect(node.children, [...styles, node.rule]);
      } else {
        supported = false;
        runs.push(Object.freeze({
          text: node.raw, from: node.start, to: node.end,
          marks: Object.freeze([...styles])
        }));
      }
    }
  }
  collect(parsed);
  return Object.freeze({
    text: runs.map(run => run.text).join(""),
    runs: Object.freeze(runs),
    regions: Object.freeze(regions),
    editable: supported
  });
}
export function mapInlineVisibleOffset(projection, offset, bias = "right") {
  if (!projection || !Number.isSafeInteger(offset) || offset < 0 ||
      offset > projection.text.length || !["left", "right"].includes(bias))
    fail("INVALID_INLINE_OFFSET");
  if (projection.runs.length === 0) return 0;
  let visible = 0;
  for (let i = 0; i < projection.runs.length; i++) {
    const run = projection.runs[i];
    const end = visible + run.text.length;
    if (offset < end || offset === end && (bias === "left" || i === projection.runs.length - 1))
      return run.from + offset - visible;
    visible = end;
  }
  return projection.runs.at(-1).to;
}
/**
 * Format an existing, explicitly selected source range inside one projected
 * editable Flow block. Returns a single replaceRange for the shared undo
 * journal. Never silently strips other marks, EFSS tokens, or nested source.
 */
export function planInlineMark({ source, block, start, end, mark }) {
  if (typeof source !== "string" || !block || !block.editable ||
      !Object.hasOwn(INLINE_MARKERS, mark) ||
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start >= end || !isGraphemeBoundary(source, start) ||
      !isGraphemeBoundary(source, end) ||
      start < block.sourceStart || end > block.sourceEnd)
    fail("INVALID_MARK_SELECTION");

  const inline = block.inline;
  if (!inline || !inline.editable) fail("UNSUPPORTED_MARK_SOURCE");
  const absolute = offset => block.sourceStart + offset;
  const contained = inline.regions.find(region =>
    region.mark === mark &&
    absolute(region.contentStart) === start &&
    absolute(region.contentEnd) === end);
  if (contained) {
    const from = absolute(contained.from), to = absolute(contained.to);
    const selected = source.slice(start, end);
    return Object.freeze({
      type: "replaceRange", from, to, text: selected,
      selectionStart: from, selectionEnd: from + selected.length,
      operation: "remove"
    });
  }
  const run = inline.runs.find(item =>
    item.marks.length === 0 &&
    absolute(item.from) <= start && absolute(item.to) >= end);
  if (!run) fail("CROSS_MARK_SELECTION_UNSUPPORTED");
  const selected = source.slice(start, end);
  if (!selected.trim() || /^\s|\s$/.test(selected))
    fail("MARK_WHITESPACE_EDGE");
  const marker = INLINE_MARKERS[mark];
  return Object.freeze({
    type: "replaceRange", from: start, to: end,
    text: marker + selected + marker,
    selectionStart: start + marker.length,
    selectionEnd: end + marker.length,
    operation: "add"
  });
}

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
    sourceLength: source.length,
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
 * Source offsets inside invisible Markdown markers share a visible location.
 * Never use this reverse map alone for edit authorization: it is a caret
 * projection, not permission to replace bytes spanning invisible markers.
 */
export function mapInlineSourceOffset(projection, offset) {
  if (!projection || !Number.isSafeInteger(projection.sourceLength) ||
      !Number.isSafeInteger(offset) || offset < 0 ||
      offset > projection.sourceLength) fail("INVALID_INLINE_SOURCE_OFFSET");
  let visible = 0;
  for (const run of projection.runs) {
    if (offset <= run.from) return visible;
    if (offset <= run.to) return visible + offset - run.from;
    visible += run.text.length;
  }
  return visible;
}

/**
 * Safely plan a visually initiated replacement. Selection endpoints must be
 * actual source text positions, not formatting delimiters. The visible
 * selection must match the source substring EXACTLY: a selection covering
 * mixed marked/plain runs is rejected rather than consuming hidden Markdown.
 * A valid edit may not implicitly change syntax (e.g. typing the closing '*'
 * that turns literal Markdown into a mark). Source view remains available.
 */
export function planInlineTextEdit({
  source, block, from, to = from, text = ""
}) {
  if (typeof source !== "string" || !block?.editable ||
      typeof text !== "string" || /[\r\n\0]/.test(text) ||
      !Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
      from > to || from < block.sourceStart || to > block.sourceEnd ||
      !isGraphemeBoundary(source, from) || !isGraphemeBoundary(source, to))
    fail("INVALID_INLINE_TEXT_EDIT");
  const inline = block.inline;
  if (!inline && block.text === "" && from === to &&
      from === block.sourceStart && from === block.sourceEnd) {
    return Object.freeze({
      type: "replaceRange", from, to, text, selectionAt: from + text.length
    });
  }
  if (!inline?.editable) fail("UNSUPPORTED_MARK_SOURCE");
  const a = from - block.sourceStart, b = to - block.sourceStart;
  if (inline.runs.length &&
      !inline.runs.some(run => from >= block.sourceStart + run.from &&
        from <= block.sourceStart + run.to) &&
      !(from === to && block.text.length === 0)) fail("HIDDEN_MARKER_CARET");
  if (inline.runs.length &&
      !inline.runs.some(run => to >= block.sourceStart + run.from &&
        to <= block.sourceStart + run.to)) fail("HIDDEN_MARKER_CARET");
  const visibleStart = mapInlineSourceOffset(inline, a);
  const visibleEnd = mapInlineSourceOffset(inline, b);
  if (visibleStart > visibleEnd ||
      source.slice(from, to) !== inline.text.slice(visibleStart, visibleEnd))
    fail("HIDDEN_MARKER_SELECTION");
  const raw = source.slice(block.sourceStart, block.sourceEnd);
  const next = raw.slice(0, a) + text + raw.slice(b);
  const projection = projectInline(next);
  const intended = inline.text.slice(0, visibleStart) + text +
    inline.text.slice(visibleEnd);
  if (!projection.editable || projection.text !== intended)
    fail("INLINE_EDIT_CHANGES_MARKUP");
  return Object.freeze({
    type: "replaceRange", from, to, text,
    selectionAt: from + text.length
  });
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

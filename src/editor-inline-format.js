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


/**
 * G0.6A — plan a mark against a *visible* UTF-16 selection, never against
 * blindly sliced Markdown. This augments planInlineMark, it does not create
 * another document, history stack or serialization format.
 *
 * Existing marks are retained only if reparsing the proposed source proves
 * that every visible code unit kept its former style and the selected range
 * gained precisely the requested mark. Ambiguous marker nesting refuses the
 * operation without changing the authoritative source.
 */
function preservesStyleWithAddedMark(before, after, start, end, mark) {
  if (!after.editable || before.text !== after.text) return false;
  let a = 0, b = 0, position = 0, aEnd = 0, bEnd = 0;
  const oldRuns = before.runs, newRuns = after.runs;
  while (position < before.text.length) {
    while (a < oldRuns.length && aEnd <= position) aEnd += oldRuns[a++].text.length;
    while (b < newRuns.length && bEnd <= position) bEnd += newRuns[b++].text.length;
    if (!a || !b || a > oldRuns.length || b > newRuns.length) return false;
    const limit = Math.min(aEnd, bEnd,
      position < start ? start : position < end ? end : before.text.length);
    if (limit <= position) return false;
    const expected = new Set(oldRuns[a - 1].marks);
    if (position >= start && position < end) expected.add(mark);
    const actual = new Set(newRuns[b - 1].marks);
    if (expected.size !== actual.size || [...expected].some(x => !actual.has(x)))
      return false;
    position = limit;
  }
  return true;
}

export function planInlineVisibleMark({ source, block, start, end, mark }) {
  const inline = block?.inline;
  if (typeof source !== "string" || !block?.editable || !inline?.editable ||
      !Object.hasOwn(INLINE_MARKERS, mark) ||
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || start >= end || end > inline.text.length ||
      !isGraphemeBoundary(inline.text, start) ||
      !isGraphemeBoundary(inline.text, end) ||
      !Number.isSafeInteger(block.sourceStart) ||
      !Number.isSafeInteger(block.sourceEnd) ||
      projectInline(source.slice(block.sourceStart, block.sourceEnd)).text !== inline.text)
    fail("INVALID_MARK_SELECTION");

  const selected = inline.text.slice(start, end);
  if (!selected.trim() || /^\\s|\\s$/.test(selected))
    fail("MARK_WHITESPACE_EDGE");

  const from = mapInlineVisibleOffset(inline, start, "right");
  const to = mapInlineVisibleOffset(inline, end, "left");
  const absoluteFrom = block.sourceStart + from;
  const absoluteTo = block.sourceStart + to;
  if (from >= to || !isGraphemeBoundary(source, absoluteFrom) ||
      !isGraphemeBoundary(source, absoluteTo))
    fail("INVALID_MARK_SELECTION");

  // Previous G0.5 full-region unwrap is already a lossless, single undo step.
  const unwrapped = inline.regions.some(region =>
    region.mark === mark && region.contentStart === from && region.contentEnd === to);
  if (unwrapped) {
    return planInlineMark({
      source, block, start: absoluteFrom, end: absoluteTo, mark
    });
  }

  let offset = 0, alreadyMarked = false;
  for (const run of inline.runs) {
    const next = offset + run.text.length;
    if (start < next && end > offset && run.marks.includes(mark))
      alreadyMarked = true;
    offset = next;
  }
  // Do not attempt a partial toggle of existing marks until source-aware
  // split/merge is implemented. A failed action leaves source byte-identical.
  if (alreadyMarked) fail("CROSS_MARK_SELECTION_UNSUPPORTED");

  const marker = INLINE_MARKERS[mark];
  const raw = source.slice(absoluteFrom, absoluteTo);
  const candidate = source.slice(block.sourceStart, absoluteFrom) + marker + raw +
    marker + source.slice(absoluteTo, block.sourceEnd);
  if (!preservesStyleWithAddedMark(inline, projectInline(candidate), start, end, mark))
    fail("CROSS_MARK_SELECTION_UNSUPPORTED");

  return Object.freeze({
    type: "replaceRange", from: absoluteFrom, to: absoluteTo,
    text: marker + raw + marker,
    selectionStart: absoluteFrom + marker.length,
    selectionEnd: absoluteTo + marker.length,
    operation: "add"
  });
}

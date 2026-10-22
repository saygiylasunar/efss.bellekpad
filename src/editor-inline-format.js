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
 * Check that the original unselected characters keep *all* their marks.
 * The source format is allowed to change in the selected region only.
 * Returns compact mark runs without allocating one entry per UTF-16 unit.
 */
function styleTrace(projection, from, to) {
  const result = [];
  let visible = 0;
  for (const run of projection.runs) {
    const stop = visible + run.text.length;
    const a = Math.max(from, visible), b = Math.min(to, stop);
    if (b > a) {
      const marks = run.marks.join("/");
      const text = run.text.slice(a - visible, b - visible);
      const last = result.at(-1);
      if (last && last.marks === marks) last.text += text;
      else result.push({ marks, text });
    }
    visible = stop;
  }
  return result;
}
function preservesOutside(before, after, visibleStart, visibleEnd, insertedLength) {
  const oldLength = before.text.length, newLength = after.text.length;
  return JSON.stringify(styleTrace(before, 0, visibleStart)) ===
      JSON.stringify(styleTrace(after, 0, visibleStart)) &&
    JSON.stringify(styleTrace(before, visibleEnd, oldLength)) ===
      JSON.stringify(styleTrace(after, visibleStart + insertedLength, newLength));
}
function expandFullySelectedRegions(projection, from, to) {
  let left = from, right = to;
  // A marked run can be removed with its wrapper ONLY when its entire
  // visible content lies in the selection. Partially clipped regions fail.
  for (const region of projection.regions) {
    const touches = from < region.contentEnd && to > region.contentStart;
    if (!touches) continue;
    if (from > region.contentStart || to < region.contentEnd)
      fail("PARTIAL_MARK_SELECTION_UNSUPPORTED");
    if (region.contentStart === left) left = region.from;
    if (region.contentEnd === right) right = region.to;
  }
  // Nested wrappers may need a second pass when their inner region was
  // expanded first. This only widens into invisible delimiter bytes.
  for (const region of [...projection.regions].reverse()) {
    if (region.contentStart === left && region.contentEnd <= right &&
        region.contentEnd >= from) left = region.from;
    if (region.contentEnd === right && region.contentStart >= left &&
        region.contentStart <= to) right = region.to;
  }
  return { left, right };
}
function verifyProjectedEdit(inline, raw, from, to, insert, start, end) {
  const nextRaw = raw.slice(0, from) + insert + raw.slice(to);
  const projection = projectInline(nextRaw);
  const visibleStart = mapInlineSourceOffset(inline, start);
  const visibleEnd = mapInlineSourceOffset(inline, end);
  const intended = inline.text.slice(0, visibleStart) + insert +
    inline.text.slice(visibleEnd);
  if (!projection.editable || projection.text !== intended)
    fail("INLINE_EDIT_CHANGES_MARKUP");
  if (!preservesOutside(inline, projection, visibleStart, visibleEnd, insert.length))
    fail("INLINE_EDIT_CHANGES_OUTSIDE_STYLE");
  return projection;
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
  if (visibleStart > visibleEnd)
    fail("INVALID_INLINE_TEXT_EDIT");
  const raw = source.slice(block.sourceStart, block.sourceEnd);
  // A hidden delimiter inside the source selection cannot be handled by
  // direct text replacement: plan a balanced, complete-mark splice below.
  const rawSelectionIsVisible = source.slice(from, to) ===
    inline.text.slice(visibleStart, visibleEnd);
  // Prefer a minimal source splice; it preserves the selected text's own
  // formatting for normal typing. The second path removes complete wrappers
  // when a mixed selection crosses their closing/opening delimiters.
  try {
    if (!rawSelectionIsVisible) fail("HIDDEN_MARKER_SELECTION");
    verifyProjectedEdit(inline, raw, a, b, text, a, b);
    return Object.freeze({
      type: "replaceRange", from, to, text,
      selectionAt: from + text.length, operation: "inline-splice"
    });
  } catch (error) {
    if (from === to || (error.message !== "INLINE_EDIT_CHANGES_MARKUP" &&
        error.message !== "INLINE_EDIT_CHANGES_OUTSIDE_STYLE" &&
        error.message !== "HIDDEN_MARKER_SELECTION"))
      throw error;
  }
  const { left, right } = expandFullySelectedRegions(inline, a, b);
  if (left === a && right === b && !inline.regions.some(region =>
      region.from >= a && region.to <= b)) fail("HIDDEN_MARKER_SELECTION");
  verifyProjectedEdit(inline, raw, left, right, text, a, b);
  return Object.freeze({
    type: "replaceRange", from: block.sourceStart + left,
    to: block.sourceStart + right, text,
    selectionAt: block.sourceStart + left + text.length,
    operation: "balanced-marker-splice"
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
  if (!run) {
    // Controlled G0.6A.2 vertical slice: wrapping mixed *complete* runs,
    // e.g. strike over a bold run plus adjacent plain text. Check the parser's
    // actual styled projection before admitting a command. Adjacent '*'
    // delimiters and partially selected nested marks deliberately fail.
    const raw = source.slice(block.sourceStart, block.sourceEnd);
    const a = start - block.sourceStart, b = end - block.sourceStart;
    const visibleStart = mapInlineSourceOffset(inline, a);
    const visibleEnd = mapInlineSourceOffset(inline, b);
    const selectedVisible = inline.text.slice(visibleStart, visibleEnd);
    if (!selectedVisible.trim() || /^\s|\s$/.test(selectedVisible))
      fail("MARK_WHITESPACE_EDGE");
    const { left, right } = expandFullySelectedRegions(inline, a, b);
    if (left === a && right === b) fail("CROSS_MARK_SELECTION_UNSUPPORTED");
    const marker = INLINE_MARKERS[mark];
    const replacement = marker + raw.slice(left, right) + marker;
    const candidate = projectInline(raw.slice(0, left) + replacement + raw.slice(right));
    if (!candidate.editable || candidate.text !== inline.text ||
        !preservesOutside(inline, candidate, visibleStart, visibleEnd, 0))
      fail("CROSS_MARK_SELECTION_UNSUPPORTED");
    const before = styleTrace(inline, visibleStart, visibleEnd);
    const after = styleTrace(candidate, visibleStart, visibleEnd);
    // All selected characters must acquire the requested mark, keeping every
    // existing mark; no hidden reinterpretation of their other formatting.
    function signature(trace, add) {
      const pieces = [];
      for (const part of trace) {
        const marks = part.marks ? part.marks.split("/") : [];
        if (add && !marks.includes(add)) marks.push(add);
        const signature = marks.sort().join("/");
        const last = pieces.at(-1);
        if (last && last.marks === signature) last.text += part.text;
        else pieces.push({ marks: signature, text: part.text });
      }
      return JSON.stringify(pieces);
    }
    if (signature(before, mark) !== signature(after, null))
      fail("CROSS_MARK_SELECTION_UNSUPPORTED");
    return Object.freeze({
      type: "replaceRange",
      from: block.sourceStart + left,
      to: block.sourceStart + right,
      text: replacement,
      // Logical source selection spans the inserted run. Render maps it to
      // visible text; source syntax remains authoritative.
      selectionStart: block.sourceStart + left + marker.length,
      selectionEnd: block.sourceStart + left + replacement.length - marker.length,
      operation: "add-mixed"
    });
  }
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

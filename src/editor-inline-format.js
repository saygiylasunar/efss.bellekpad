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
function verifyProjectedEdit(inline, raw, from, to, insert, start, end, visibleInsert = insert) {
  const nextRaw = raw.slice(0, from) + insert + raw.slice(to);
  const projection = projectInline(nextRaw);
  const visibleStart = mapInlineSourceOffset(inline, start);
  const visibleEnd = mapInlineSourceOffset(inline, end);
  const intended = inline.text.slice(0, visibleStart) + visibleInsert +
    inline.text.slice(visibleEnd);
  if (!projection.editable || projection.text !== intended)
    fail("INLINE_EDIT_CHANGES_MARKUP");
  if (!preservesOutside(inline, projection, visibleStart, visibleEnd, visibleInsert.length))
    fail("INLINE_EDIT_CHANGES_OUTSIDE_STYLE");
  return projection;
}

/**
 * Balance source wrappers affected by a partial selection. Wrappers spanning
 * both endpoints survive; wrappers ending within the selection close from
 * inner to outer, and wrappers starting within it reopen outer to inner.
 * The caller's parser and visible-text/style oracles authorize the result.
 * Ambiguous adjacent asterisk markers must still fail closed.
 */
function partialBoundarySplice(inline, a, b, text) {
  const affected = inline.regions.filter(r => a < r.contentEnd && b > r.contentStart);
  const nested = affected.some((r, i) => affected.some((other, j) =>
    i !== j && r.from < other.from && r.to > other.to));
  let left = a, right = b;
  const closing = [], opening = [];
  for (const r of affected) {
    const startsBefore = r.contentStart < a;
    const endsAfter = r.contentEnd > b;
    if (startsBefore && endsAfter) continue;
    if (startsBefore) {
      closing.push(r);
      if (r.contentEnd === b) right = Math.max(right, r.to);
    } else if (endsAfter) {
      opening.push(r);
      if (r.contentStart === a) left = Math.min(left, r.from);
    } else {
      if (r.contentStart === a) left = Math.min(left, r.from);
      if (r.contentEnd === b) right = Math.max(right, r.to);
    }
  }
  closing.sort((x, y) => y.contentStart - x.contentStart ||
    x.contentEnd - y.contentEnd);
  opening.sort((x, y) => x.contentStart - y.contentStart ||
    y.contentEnd - x.contentEnd);
  const replacement = closing.map(r => INLINE_MARKERS[r.mark]).join("") +
    text + opening.map(r => INLINE_MARKERS[r.mark]).join("");
  return { left, right, replacement, nested };
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
  let slice, operation = "balanced-marker-splice";
  try {
    const { left, right } = expandFullySelectedRegions(inline, a, b);
    slice = { left, right, replacement: text };
  } catch (error) {
    if (error.message !== "PARTIAL_MARK_SELECTION_UNSUPPORTED") throw error;
    slice = partialBoundarySplice(inline, a, b, text);
    operation = "partial-marker-split";
  }
  if (slice.left === a && slice.right === b && slice.replacement === text &&
      !inline.regions.some(region => region.from >= a && region.to <= b))
    fail("HIDDEN_MARKER_SELECTION");
  try {
    verifyProjectedEdit(inline, raw, slice.left, slice.right,
      slice.replacement, a, b, text);
  } catch (error) {
    // Some nested asterisk boundaries have no safely parseable splice.
    if (slice.nested && ["INLINE_EDIT_CHANGES_MARKUP",
      "INLINE_EDIT_CHANGES_OUTSIDE_STYLE"].includes(error.message))
      fail("NESTED_PARTIAL_MARK_UNSUPPORTED");
    throw error;
  }
  return Object.freeze({
    type: "replaceRange", from: block.sourceStart + slice.left,
    to: block.sourceStart + slice.right, text: slice.replacement,
    selectionAt: block.sourceStart + slice.left + slice.replacement.length,
    operation
  });
}

/**
 * G0.6A.2: construct one reversible source splice for mixed selections.
 * Move endpoints over fully selected invisible wrappers; for a partially
 * intersected wrapper, close it before the requested mark and reopen it
 * inside that mark (or the inverse on the right). Wrappers containing both
 * endpoints stay untouched. The caller reparses every candidate and checks
 * complete per-character styles before authorizing any mutation.
 */
function wrapMixedMarkedSelection(inline, raw, a, b, mark) {
  let left = a, right = b, moved;
  do {
    moved = false;
    for (const region of inline.regions) {
      if (region.contentStart === left && region.contentEnd <= b &&
          region.from < left) {
        left = region.from; moved = true;
      }
      if (region.contentEnd === right && region.contentStart >= a &&
          region.to > right) {
        right = region.to; moved = true;
      }
    }
  } while (moved);
  const atStart = left === a ? inline.regions.filter(r =>
    r.contentStart < a && a < r.contentEnd && r.contentEnd < b) : [];
  const atEnd = right === b ? inline.regions.filter(r =>
    a < r.contentStart && r.contentStart < b && b < r.contentEnd) : [];
  const innerFirst = (x, y) => y.contentStart - x.contentStart ||
    x.contentEnd - y.contentEnd;
  atStart.sort(innerFirst);
  atEnd.sort(innerFirst);
  const markers = regions => regions.map(r => INLINE_MARKERS[r.mark]).join("");
  const replacement = markers(atStart) + INLINE_MARKERS[mark] +
    markers([...atStart].reverse()) + raw.slice(left, right) +
    markers(atEnd) + INLINE_MARKERS[mark] +
    markers([...atEnd].reverse());
  return { left, right, replacement };
}

/**
 * Every inline mark operation must preserve visible bytes and unrelated
 * styles under our own parser, including formerly unchecked plain-run adds.
 */
function styleSignature(trace, mark, action) {
  const normalized = [];
  for (const part of trace) {
    const marks = part.marks ? part.marks.split("/") : [];
    if (action === "add" && !marks.includes(mark)) marks.push(mark);
    if (action === "remove") {
      const index = marks.indexOf(mark);
      if (index >= 0) marks.splice(index, 1);
    }
    const key = marks.sort().join("/");
    const prior = normalized.at(-1);
    if (prior && prior.marks === key) prior.text += part.text;
    else normalized.push({ marks: key, text: part.text });
  }
  return JSON.stringify(normalized);
}
function verifyMarkCandidate(before, nextRaw, start, end, mark, action) {
  const after = projectInline(nextRaw);
  const a = mapInlineSourceOffset(before, start);
  const b = mapInlineSourceOffset(before, end);
  if (!after.editable || after.text !== before.text ||
      !preservesOutside(before, after, a, b, b - a) ||
      styleSignature(styleTrace(before, a, b), mark, action) !==
        styleSignature(styleTrace(after, a, b), null, null))
    fail("MARK_SOURCE_COLLISION");
  return {
    selectionStart: mapInlineVisibleOffset(after, a, "right"),
    selectionEnd: mapInlineVisibleOffset(after, b, "left")
  };
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
    const raw = source.slice(block.sourceStart, block.sourceEnd);
    const { selectionStart, selectionEnd } = verifyMarkCandidate(
      inline, raw.slice(0, contained.from) + selected + raw.slice(contained.to),
      start - block.sourceStart, end - block.sourceStart, mark, "remove");
    return Object.freeze({
      type: "replaceRange", from, to, text: selected,
      selectionStart: absolute(selectionStart),
      selectionEnd: absolute(selectionEnd),
      operation: "remove"
    });
  }
  const run = inline.runs.find(item =>
    item.marks.length === 0 &&
    absolute(item.from) <= start && absolute(item.to) >= end);
  if (!run) {
    // Full-run and partial-run mixed selections are both candidate plans.
    // Asterisk collisions remain non-mutating refusals, never silent edits.
    const raw = source.slice(block.sourceStart, block.sourceEnd);
    const a = start - block.sourceStart, b = end - block.sourceStart;
    const visibleStart = mapInlineSourceOffset(inline, a);
    const visibleEnd = mapInlineSourceOffset(inline, b);
    const selectedVisible = inline.text.slice(visibleStart, visibleEnd);
    if (!selectedVisible.trim() || /^\s|\s$/.test(selectedVisible))
      fail("MARK_WHITESPACE_EDGE");
    const { left, right, replacement } =
      wrapMixedMarkedSelection(inline, raw, a, b, mark);
    const partial = inline.regions.some(r =>
      (r.contentStart < a && a < r.contentEnd && r.contentEnd < b) ||
      (a < r.contentStart && r.contentStart < b && b < r.contentEnd));
    const unsupported = partial ?
      "PARTIAL_MARK_SELECTION_UNSUPPORTED" : "CROSS_MARK_SELECTION_UNSUPPORTED";
    let validated;
    try {
      validated = verifyMarkCandidate(inline,
        raw.slice(0, left) + replacement + raw.slice(right),
        a, b, mark, "add");
    } catch (error) {
      if (error.message === "MARK_SOURCE_COLLISION") fail(unsupported);
      throw error;
    }
    return Object.freeze({
      type: "replaceRange",
      from: block.sourceStart + left,
      to: block.sourceStart + right,
      text: replacement,
      // Map logical visible endpoints back to actual post-edit source runs,
      // never to synthetic wrapper bytes; this also restores reverse DOM
      // selections when the host retains anchor/focus direction.
      selectionStart: absolute(validated.selectionStart),
      selectionEnd: absolute(validated.selectionEnd),
      operation: "add-mixed"
    });
  }
  const selected = source.slice(start, end);
  if (!selected.trim() || /^\s|\s$/.test(selected))
    fail("MARK_WHITESPACE_EDGE");
  const marker = INLINE_MARKERS[mark];
  const text = marker + selected + marker;
  const raw = source.slice(block.sourceStart, block.sourceEnd);
  const a = start - block.sourceStart, b = end - block.sourceStart;
  const { selectionStart, selectionEnd } = verifyMarkCandidate(
    inline, raw.slice(0, a) + text + raw.slice(b), a, b, mark, "add");
  return Object.freeze({
    type: "replaceRange", from: start, to: end, text,
    selectionStart: absolute(selectionStart),
    selectionEnd: absolute(selectionEnd),
    operation: "add"
  });
}

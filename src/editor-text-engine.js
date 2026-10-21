// BellekPad G0.2: pure, immutable single-TextFrame transaction core.
// No DOM, Electron, Node, Markdown formatter or third-party editor dependency.
// All positions use UTF-16 offsets at Unicode grapheme-cluster boundaries.
export const TEXT_FRAME_ID = "body";
export const MAX_TEXT_BYTES = 1024 * 1024;
const HISTORY_LIMIT = 500;
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const encoder = new TextEncoder();

function fail(code) { throw new Error(code); }
function plain(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x) &&
    (Object.getPrototypeOf(x) === Object.prototype ||
      Object.getPrototypeOf(x) === null);
}
function checkText(text) {
  if (typeof text !== "string" || text.includes("\0")) fail("INVALID_TEXT");
  if (encoder.encode(text).length > MAX_TEXT_BYTES) fail("TEXT_TOO_LARGE");
  return text;
}
export function isGraphemeBoundary(text, offset) {
  if (typeof text !== "string" || !Number.isSafeInteger(offset) ||
      offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  return segmenter.segment(text).containing(offset)?.index === offset;
}
export function nearestGraphemeBoundary(text, offset, preference = "nearest") {
  if (typeof text !== "string" || !Number.isSafeInteger(offset) ||
      offset < 0 || offset > text.length) fail("INVALID_TEXT_POSITION");
  if (!["left", "right", "nearest"].includes(preference))
    fail("INVALID_BOUNDARY_PREFERENCE");
  if (isGraphemeBoundary(text, offset)) return offset;
  const segment = segmenter.segment(text).containing(offset);
  const left = segment.index, right = left + segment.segment.length;
  if (preference === "left") return left;
  if (preference === "right") return right;
  return offset - left <= right - offset ? left : right;
}
function previousBoundary(text, offset) {
  return offset <= 0 ? 0 : segmenter.segment(text).containing(offset - 1).index;
}
function nextBoundary(text, offset) {
  if (offset >= text.length) return text.length;
  const found = segmenter.segment(text).containing(offset);
  return found.index + found.segment.length;
}
function position(text, raw) {
  if (!plain(raw) || raw.nodeId !== TEXT_FRAME_ID ||
      !isGraphemeBoundary(text, raw.offset)) fail("INVALID_TEXT_POSITION");
  return Object.freeze({ nodeId: TEXT_FRAME_ID, offset: raw.offset });
}
function selection(text, raw) {
  if (!plain(raw) || !plain(raw.anchor) || !plain(raw.focus))
    fail("INVALID_TEXT_SELECTION");
  return Object.freeze({
    anchor: position(text, raw.anchor),
    focus: position(text, raw.focus)
  });
}
export function textPosition(offset) {
  return Object.freeze({ nodeId: TEXT_FRAME_ID, offset });
}
export function collapsedSelection(offset) {
  return Object.freeze({ anchor: textPosition(offset), focus: textPosition(offset) });
}
export function selectionBounds(sel) {
  const a = sel.anchor.offset, b = sel.focus.offset;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}
/** Translate source UTF-16 offsets across a single replace transaction. */
export function mapTextOffset(offset, from, to, insertedLength, affinity = "right") {
  if (![offset, from, to, insertedLength].every(x => Number.isSafeInteger(x) && x >= 0) ||
      to < from || !["left", "right"].includes(affinity)) fail("INVALID_OFFSET_MAPPING");
  if (offset < from || offset === from && affinity === "left") return offset;
  if (offset > to || offset === to && from !== to && affinity === "right")
    return offset + insertedLength - (to - from);
  if (offset === to && from === to) return affinity === "left" ? from : from + insertedLength;
  return affinity === "left" ? from : from + insertedLength;
}
function state(text, selected, version) {
  return Object.freeze({
    nodeId: TEXT_FRAME_ID, text, selection: selection(text, selected), version
  });
}
function applyStep(before, step, newSelection = null) {
  const { from, to, inserted } = step;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
      !isGraphemeBoundary(before.text, from) ||
      !isGraphemeBoundary(before.text, to) || from > to ||
      typeof inserted !== "string") fail("INVALID_TEXT_CHANGE");
  const text = checkText(before.text.slice(0, from) + inserted + before.text.slice(to));
  // Inserting a combining mark or ZWJ may join its neighboring graphemes.
  // Expand the history step to common *before and after* cluster boundaries,
  // otherwise undo could split a newly formed grapheme.
  let safeFrom = from;
  while (!isGraphemeBoundary(before.text, safeFrom) ||
         !isGraphemeBoundary(text, safeFrom)) safeFrom--;
  let oldEnd = to, newEnd = from + inserted.length;
  while (!isGraphemeBoundary(before.text, oldEnd) ||
         !isGraphemeBoundary(text, newEnd)) {
    oldEnd++;
    newEnd++;
  }
  const cursor = nearestGraphemeBoundary(text, from + inserted.length, "right");
  const selected = newSelection ?? collapsedSelection(cursor);
  return { state: state(text, selected, before.version + 1),
    delta: Object.freeze({
      from: safeFrom, to: oldEnd,
      inserted: text.slice(safeFrom, newEnd),
      removed: before.text.slice(safeFrom, oldEnd)
    }) };
}
function inverseStep(delta) {
  return { from: delta.from, to: delta.from + delta.inserted.length,
    inserted: delta.removed };
}
function cloneSelection(sel) {
  return Object.freeze({
    anchor: textPosition(sel.anchor.offset), focus: textPosition(sel.focus.offset)
  });
}
export class TextEditorSession {
  #state;
  #undo = [];
  #redo = [];
  #openGroup = false;
  #lastEditTime = -Infinity;

  constructor({ text = "", selection: initialSelection = null } = {}) {
    checkText(text);
    this.#state = state(text, initialSelection ?? collapsedSelection(0), 0);
  }
  get snapshot() { return this.#state; }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  get historyDepth() { return this.#undo.length; }

  setSelection(next) {
    const selected = selection(this.#state.text, next);
    const previous = this.#state.selection;
    if (selected.anchor.offset === previous.anchor.offset &&
        selected.focus.offset === previous.focus.offset) return this.#state;
    this.#state = state(this.#state.text, selected, this.#state.version);
    this.#openGroup = false;
    return this.#state;
  }

  dispatch(command, { at = Date.now() } = {}) {
    if (!plain(command) || typeof command.type !== "string")
      fail("INVALID_TEXT_COMMAND");
    const before = this.#state;
    const bounds = selectionBounds(before.selection);
    let from = bounds.start, to = bounds.end, inserted = "";
    let mergeTyping = false;
    switch (command.type) {
      case "insertText": {
        if (typeof command.text !== "string" || !command.text ||
            command.text.includes("\r") || command.text.includes("\0"))
          fail("INVALID_TEXT_INSERT");
        inserted = command.text;
        mergeTyping = from === to && !inserted.includes("\n") &&
          [...segmenter.segment(inserted)].length === 1;
        break;
      }
      case "insertParagraph":
        inserted = "\n";
        break;
      case "deleteBackward":
        if (from === to) from = previousBoundary(before.text, from);
        break;
      case "deleteForward":
        if (from === to) to = nextBoundary(before.text, to);
        break;
      case "replaceRange":
        if (!Number.isSafeInteger(command.from) || !Number.isSafeInteger(command.to) ||
            typeof command.text !== "string" || command.text.includes("\r"))
          fail("INVALID_TEXT_CHANGE");
        from = command.from; to = command.to; inserted = command.text;
        break;
      case "replaceSelection":
        if (typeof command.text !== "string" || command.text.includes("\r"))
          fail("INVALID_TEXT_CHANGE");
        inserted = command.text;
        break;
      default: fail("UNSUPPORTED_TEXT_COMMAND");
    }
    if (from === to && inserted === "") return { changed: false, state: before };
    const applied = applyStep(before, { from, to, inserted });
    if (applied.state.text === before.text) return { changed: false, state: before };
    const now = Number.isFinite(at) ? at : Date.now();
    const previous = this.#undo.at(-1);
    const coalesce = mergeTyping && this.#openGroup && previous &&
      now - this.#lastEditTime <= 750 && now >= this.#lastEditTime &&
      before.selection.anchor.offset === before.selection.focus.offset &&
      previous.after.anchor.offset === from && previous.after.focus.offset === from;
    if (coalesce) {
      previous.deltas.push(applied.delta);
      previous.after = cloneSelection(applied.state.selection);
    } else {
      this.#undo.push({ deltas: [applied.delta],
        before: cloneSelection(before.selection),
        after: cloneSelection(applied.state.selection) });
      if (this.#undo.length > HISTORY_LIMIT) this.#undo.shift();
    }
    this.#openGroup = mergeTyping;
    this.#lastEditTime = now;
    this.#redo = [];
    this.#state = applied.state;
    return { changed: true, state: this.#state, delta: applied.delta };
  }

  undo() {
    this.#openGroup = false;
    const item = this.#undo.pop();
    if (!item) return { changed: false, state: this.#state };
    let current = this.#state;
    for (const delta of [...item.deltas].reverse())
      current = applyStep(current, inverseStep(delta)).state;
    this.#state = state(current.text, item.before, current.version);
    this.#redo.push(item);
    return { changed: true, state: this.#state };
  }

  redo() {
    this.#openGroup = false;
    const item = this.#redo.pop();
    if (!item) return { changed: false, state: this.#state };
    let current = this.#state;
    for (const delta of item.deltas)
      current = applyStep(current, delta).state;
    this.#state = state(current.text, item.after, current.version);
    this.#undo.push(item);
    return { changed: true, state: this.#state };
  }
}

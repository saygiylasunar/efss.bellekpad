import test from "node:test";
import assert from "node:assert/strict";
import {
  TextEditorSession, TEXT_FRAME_ID, MAX_TEXT_BYTES,
  textPosition, collapsedSelection, selectionBounds, mapTextOffset,
  isGraphemeBoundary, nearestGraphemeBoundary
} from "../src/editor-text-engine.js";

function select(start, end = start) {
  return { anchor: textPosition(start), focus: textPosition(end) };
}
function editor(text = "", pos = 0) {
  return new TextEditorSession({ text, selection: select(pos) });
}
function type(session, text, at = 0) {
  return session.dispatch({ type: "insertText", text }, { at });
}

test("immutable text-frame state, typed locations, and selection direction", () => {
  const s = editor("ABCDE", 0);
  assert.equal(s.snapshot.nodeId, TEXT_FRAME_ID);
  assert.equal(s.snapshot.version, 0);
  assert.ok(Object.isFrozen(s.snapshot));
  assert.ok(Object.isFrozen(s.snapshot.selection.anchor));
  s.setSelection(select(4, 1));
  assert.deepEqual(selectionBounds(s.snapshot.selection), { start: 1, end: 4 });
  assert.deepEqual(s.snapshot.selection.anchor, textPosition(4));
  const result = type(s, "ş", 0);
  assert.equal(result.changed, true);
  assert.equal(s.snapshot.text, "AşE");
  assert.equal(s.snapshot.selection.focus.offset, 2);
  assert.equal(s.snapshot.version, 1);
  assert.equal(s.canUndo, true);
  assert.throws(() => s.setSelection({
    anchor: { nodeId: "other", offset: 1 }, focus: textPosition(1)
  }), /INVALID_TEXT_POSITION/);
});


test("rich replaceRange persists typed reverse selection in the same undo/redo transaction", () => {
  const original = "kalın";
  const s = new TextEditorSession({ text: original, selection: select(5, 0) });
  const result = s.dispatch({
    type: "replaceRange", from: 0, to: 5, text: "**kalın**",
    selectionAfter: select(7, 2)
  });
  assert.equal(result.changed, true);
  assert.equal(s.snapshot.text, "**kalın**");
  assert.deepEqual(s.snapshot.selection, select(7, 2));
  assert.equal(s.historyDepth, 1);
  s.undo();
  assert.equal(s.snapshot.text, original);
  assert.deepEqual(s.snapshot.selection, select(5, 0));
  s.redo();
  assert.equal(s.snapshot.text, "**kalın**");
  assert.deepEqual(s.snapshot.selection, select(7, 2));
});
test("invalid post-transaction selection cannot mutate source or history", () => {
  const s = editor("👩‍👧a", 0);
  const before = s.snapshot;
  assert.throws(() => s.dispatch({
    type: "replaceRange", from: 0, to: 0, text: "Z",
    selectionAfter: select(2, 2)
  }), /INVALID_TEXT_POSITION/);
  assert.equal(s.snapshot, before);
  assert.equal(s.historyDepth, 0);
  assert.throws(() => s.dispatch({
    type: "insertText", text: "Z", selectionAfter: select(0, 0)
  }), /INVALID_TEXT_COMMAND/);
  assert.equal(s.snapshot, before);
  assert.equal(s.historyDepth, 0);
});

test("undo restores original content and reverse selection; redo replays exactly", () => {
  const s = editor("abc def");
  s.setSelection(select(7, 4));
  s.dispatch({ type: "replaceSelection", text: "XYZ" });
  assert.equal(s.snapshot.text, "abc XYZ");
  s.undo();
  assert.equal(s.snapshot.text, "abc def");
  assert.equal(s.snapshot.selection.anchor.offset, 7);
  assert.equal(s.snapshot.selection.focus.offset, 4);
  s.redo();
  assert.equal(s.snapshot.text, "abc XYZ");
  s.setSelection(select(0));
  type(s, "!", 500);
  assert.equal(s.canRedo, false);
});

test("typing coalesces in one undo transaction until caret movement or timeout", () => {
  const s = editor();
  type(s, "M", 1);
  type(s, "e", 150);
  s.setSelection(select(2)); // identical selection must not break the group
  type(s, "r", 400);
  assert.equal(s.snapshot.text, "Mer");
  assert.equal(s.historyDepth, 1);
  s.undo();
  assert.equal(s.snapshot.text, "");
  s.redo();
  assert.equal(s.snapshot.text, "Mer");
  type(s, "h", 2000);
  type(s, "a", 2100);
  assert.equal(s.historyDepth, 2);
  s.setSelection(select(2));
  type(s, "!", 2150);
  assert.equal(s.historyDepth, 3);
  s.undo();
  assert.equal(s.snapshot.text, "Merha");
});

test("delete backwards and forwards remove full Unicode graphemes", () => {
  const family = "👩‍👩‍👧‍👦";
  const text = "A" + family + "a\u0301" + "💡" + "Z";
  const s = editor(text, 1 + family.length);
  s.dispatch({ type: "deleteBackward" });
  assert.equal(s.snapshot.text, "Aa\u0301💡Z");
  s.undo();
  assert.equal(s.snapshot.text, text);
  s.setSelection(select(1));
  s.dispatch({ type: "deleteForward" });
  assert.equal(s.snapshot.text, "Aa\u0301💡Z");
  s.undo();
  assert.equal(s.snapshot.text, text);
  assert.equal(isGraphemeBoundary(text, 2), false);
  assert.equal(isGraphemeBoundary(text, 1 + family.length + 1), false);
  assert.equal(nearestGraphemeBoundary(text, 2, "left"), 1);
  assert.equal(nearestGraphemeBoundary(text, 2, "right"), 1 + family.length);
  assert.throws(() => s.setSelection(select(2)), /INVALID_TEXT_POSITION/);
});

test("combining mark insertion and ZWJ joining remains invertible at cluster boundaries", () => {
  const s = editor("ab", 1);
  type(s, "\u0301", 0);
  assert.equal(s.snapshot.text, "a\u0301b");
  assert.equal(s.snapshot.selection.focus.offset, 2);
  s.undo();
  assert.equal(s.snapshot.text, "ab");
  s.redo();
  assert.equal(s.snapshot.text, "a\u0301b");
  const w = editor("👩👧", 2);
  w.dispatch({ type: "insertText", text: "\u200d" });
  assert.equal(w.snapshot.text, "👩‍👧");
  assert.equal(w.snapshot.selection.focus.offset, "👩‍👧".length);
  w.undo();
  assert.equal(w.snapshot.text, "👩👧");
  w.redo();
  assert.equal(w.snapshot.text, "👩‍👧");
});

test("insert paragraph and delete at boundaries never create false history entries", () => {
  const s = editor("Hello", 5);
  s.dispatch({ type: "insertParagraph" });
  assert.equal(s.snapshot.text, "Hello\n");
  assert.equal(s.historyDepth, 1);
  assert.equal(s.dispatch({ type: "deleteForward" }).changed, false);
  s.dispatch({ type: "deleteBackward" });
  assert.equal(s.snapshot.text, "Hello");
  s.undo();
  assert.equal(s.snapshot.text, "Hello\n");
  s.undo();
  assert.equal(s.snapshot.text, "Hello");
  assert.equal(s.dispatch({ type: "deleteBackward" }).changed, true);
});

test("offset mapping preserves positions before/after edits and bias at insertion", () => {
  assert.equal(mapTextOffset(1, 2, 5, 4), 1);
  assert.equal(mapTextOffset(8, 2, 5, 4), 9);
  assert.equal(mapTextOffset(2, 2, 2, 3, "left"), 2);
  assert.equal(mapTextOffset(2, 2, 2, 3, "right"), 5);
  assert.equal(mapTextOffset(5, 2, 5, 3, "right"), 5);
  assert.equal(mapTextOffset(3, 2, 5, 1, "left"), 2);
  assert.equal(mapTextOffset(3, 2, 5, 1, "right"), 3);
  assert.throws(() => mapTextOffset(0, 2, 1, 1), /INVALID_OFFSET_MAPPING/);
});

test("invalid transactions fail before mutating the document", () => {
  const s = editor("hello", 1);
  const original = s.snapshot;
  assert.throws(() => s.dispatch({ type: "insertText", text: "" }), /INVALID_TEXT_INSERT/);
  assert.throws(() => s.dispatch({ type: "insertText", text: "a\r\nb" }), /INVALID_TEXT_INSERT/);
  assert.throws(() => s.dispatch({ type: "replaceRange", from: 0, to: 99, text: "!" }), /INVALID_TEXT_CHANGE/);
  assert.throws(() => s.dispatch({ type: "eval", code: "x" }), /UNSUPPORTED_TEXT_COMMAND/);
  assert.throws(() => s.dispatch({ type: "replaceSelection", text: "\0" }), /INVALID_TEXT/);
  assert.equal(s.snapshot, original);
  const huge = "a".repeat(MAX_TEXT_BYTES + 1);
  assert.throws(() => s.dispatch({ type: "replaceSelection", text: huge }), /TEXT_TOO_LARGE/);
  assert.equal(s.snapshot.text, "hello");
});

test("markdown text is unchanged by edits and not interpreted as executable commands", () => {
  const markdown = "# Test\n\n&Fake{123}\n:::efss.custom\nraw\n:::\n";
  const s = editor(markdown, markdown.length);
  type(s, "😀", 0);
  assert.equal(s.snapshot.text, markdown + "😀");
  s.undo();
  assert.equal(s.snapshot.text, markdown);
});

test("randomized valid Unicode edit sequences are reversible without text loss", () => {
  let seed = 73129;
  const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const chars = ["a", "ğ", "💡", "👩‍👧", "e\u0301", "Z", "\n", "#", "&"];
  const s = editor();
  const states = [];
  for (let k = 0; k < 320; k++) {
    const text = s.snapshot.text;
    const bounds = [0, ...[...new Intl.Segmenter("und", { granularity: "grapheme" })
      .segment(text)].map(part => part.index + part.segment.length)];
    const start = bounds[random(bounds.length)];
    const end = bounds[random(bounds.length)];
    s.setSelection(select(start, end));
    if (random(4) === 0) s.dispatch({ type: "deleteBackward" }, { at: k * 1000 });
    else if (random(4) === 0) s.dispatch({ type: "deleteForward" }, { at: k * 1000 });
    else s.dispatch({ type: "replaceSelection", text: chars[random(chars.length)] },
      { at: k * 1000 });
    states.push(s.snapshot.text);
  }
  const finalText = s.snapshot.text;
  while (s.canUndo) s.undo();
  assert.equal(s.snapshot.text, "");
  while (s.canRedo) s.redo();
  assert.equal(s.snapshot.text, finalText);
  assert.ok(states.some(x => x.length > 0));
});

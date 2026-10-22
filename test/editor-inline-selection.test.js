import test from "node:test";
import assert from "node:assert/strict";
import { TextEditorSession, collapsedSelection, textPosition } from "../src/editor-text-engine.js";
import { createBlockDocument, serializeBlockDocument, reconcileBlockSource } from "../src/editor-block-model.js";
import { projectFlowBlocks } from "../src/editor-flow-model.js";
import {
  projectInline, mapInlineVisibleOffset, mapInlineSourceOffset, planInlineTextEdit
} from "../src/editor-inline-format.js";

function block(source, kind = "paragraph") {
  const found = projectFlowBlocks(createBlockDocument(source)).find(b => b.type === kind);
  assert.ok(found, source);
  return found;
}
function apply(session, expected, from, to, text) {
  const command = planInlineTextEdit({
    source: session.snapshot.text, block: block(session.snapshot.text),
    from, to, text
  });
  const result = session.dispatch(command);
  assert.equal(result.changed, true);
  assert.equal(session.snapshot.text, expected);
}
test("G0.6A source -> visible boundaries never expose hidden markup bytes", () => {
  const s = "**İçerik** ve *sonra*";
  const p = projectInline(s);
  assert.equal(p.sourceLength, s.length);
  assert.equal(p.text, "İçerik ve sonra");
  for (let pos = 0; pos <= s.length; pos++) {
    const visible = mapInlineSourceOffset(p, pos);
    assert.ok(visible >= 0 && visible <= p.text.length);
  }
  assert.equal(mapInlineSourceOffset(p, 0), 0);
  assert.equal(mapInlineSourceOffset(p, 2), 0);
  assert.equal(mapInlineSourceOffset(p, 8), 6);
  assert.equal(mapInlineSourceOffset(p, 10), 6);
  assert.equal(mapInlineVisibleOffset(p, 0, "right"), 2);
  assert.equal(mapInlineVisibleOffset(p, 6, "left"), 8);
  assert.equal(mapInlineVisibleOffset(p, 6, "right"), 10);
  assert.throws(() => mapInlineSourceOffset(p, -1), /INVALID_INLINE_SOURCE_OFFSET/);
  assert.throws(() => mapInlineSourceOffset(p, s.length + 1), /INVALID_INLINE_SOURCE_OFFSET/);
});
test("G0.6A caret at beginning/end of a rich run preserves wrapping syntax", () => {
  const initial = "**İçerik**";
  const session = new TextEditorSession({ text: initial, selection: collapsedSelection(2) });
  apply(session, "**ğİçerik**", 2, 2, "ğ");
  apply(session, "**ğİçerik👩‍👧**", 9, 9, "👩‍👧");
  const completed = session.snapshot.text;
  assert.equal(projectInline(completed).text, "ğİçerik👩‍👧");
  session.undo(); session.undo();
  assert.equal(session.snapshot.text, initial);
  session.redo(); session.redo();
  assert.equal(session.snapshot.text, completed);
  apply(session, "**ğİçerik**", completed.indexOf("👩"), completed.indexOf("👩") + "👩‍👧".length, "");
  assert.equal(projectInline(session.snapshot.text).text, "ğİçerik");
  session.undo();
  assert.equal(session.snapshot.text, completed);
});
test("G0.6A.2 fully-selected bold plus plain can be replaced without hidden marker leaks", () => {
  const src = "A **kalın** B";
  const p = block(src);
  const session = new TextEditorSession({ text: src, selection: {
    anchor: textPosition(src.length), focus: textPosition(4)
  } });
  assert.equal(p.text, "A kalın B");
  const command = planInlineTextEdit({
    source: src, block: p, from: 4, to: src.length, text: "değiştir"
  });
  assert.equal(command.operation, "balanced-marker-splice");
  assert.equal(command.from, 2); // includes the opening ** marker
  assert.equal(command.to, src.length);
  session.dispatch(command);
  assert.equal(session.snapshot.text, "A değiştir");
  assert.equal(projectInline(session.snapshot.text).text, "A değiştir");
  session.undo();
  assert.equal(session.snapshot.text, src);
  assert.equal(session.snapshot.selection.anchor.offset, src.length);
  assert.equal(session.snapshot.selection.focus.offset, 4);
  session.redo();
  assert.equal(session.snapshot.text, "A değiştir");
});
test("G0.6A.2 partial bold/plain cross-selection preserves the outside bold prefix", () => {
  const src = "A **kalın** B";
  const p = block(src);
  const session = new TextEditorSession({ text: src, selection: {
    anchor: textPosition(src.length), focus: textPosition(6)
  } });
  const c = planInlineTextEdit({
    source: src, block: p, from: 6, to: src.length, text: "değiştir"
  });
  assert.equal(c.operation, "partial-marker-split");
  session.dispatch(c);
  assert.equal(session.snapshot.text, "A **ka**değiştir");
  assert.equal(projectInline(session.snapshot.text).text, "A kadeğiştir");
  assert.deepEqual(projectInline(session.snapshot.text).runs.find(r => r.text === "ka").marks, ["strong"]);
  session.undo();
  assert.equal(session.snapshot.text, src);
  assert.equal(session.snapshot.selection.anchor.offset, src.length);
  assert.equal(session.snapshot.selection.focus.offset, 6);
  session.redo();
  assert.equal(session.snapshot.text, "A **ka**değiştir");
});
test("G0.6A.2 partial plain-to-bold replacement reopens styling for preserved suffix", () => {
  const src = "A düz **kalın** B";
  const p = block(src);
  const from = src.indexOf("düz"), to = src.indexOf("lın");
  const c = planInlineTextEdit({ source: src, block: p, from, to, text: "yeni" });
  assert.equal(c.operation, "partial-marker-split");
  const next = src.slice(0, c.from) + c.text + src.slice(c.to);
  assert.equal(next, "A yeni**lın** B");
  assert.equal(projectInline(next).text, "A yenilın B");
  assert.deepEqual(projectInline(next).runs.find(r => r.text === "lın").marks, ["strong"]);
});
test("G0.6A.2 delete a complete styled region without leaving orphan Markdown", () => {
  const src = "A **kalın** B";
  const p = block(src);
  const from = src.indexOf("kalın");
  const to = from + "kalın".length;
  const command = planInlineTextEdit({ source: src, block: p, from, to, text: "" });
  assert.equal(command.operation, "balanced-marker-splice");
  const state = new TextEditorSession({ text: src });
  state.dispatch(command);
  assert.equal(state.snapshot.text, "A  B");
  assert.equal(projectInline(state.snapshot.text).text, "A  B");
  state.undo();
  assert.equal(state.snapshot.text, src);
});
test("G0.6A.2 multiple fully selected style groups can be atomically replaced", () => {
  const src = "A **kalın** B *italik* C";
  const p = block(src);
  const from = src.indexOf("kalın"), to = src.indexOf(" C");
  const change = planInlineTextEdit({ source: src, block: p, from, to, text: "tek" });
  assert.equal(change.operation, "balanced-marker-splice");
  const session = new TextEditorSession({ text: src });
  session.dispatch(change);
  assert.equal(session.snapshot.text, "A tek C");
  session.undo();
  assert.equal(session.snapshot.text, src);
  session.redo();
  assert.equal(session.snapshot.text, "A tek C");
});
test("G0.6A.2 preserves non-selected bold styles during a partial within-run replacement", () => {
  const src = "A **kalın** B";
  const p = block(src);
  const from = src.indexOf("lın"), to = from + "lın".length;
  const change = planInlineTextEdit({ source: src, block: p, from, to, text: "lem" });
  assert.equal(change.operation, "inline-splice");
  const next = src.slice(0, change.from) + change.text + src.slice(change.to);
  assert.equal(next, "A **kalem** B");
  assert.deepEqual(projectInline(next).runs.find(r => r.text === "kalem").marks, ["strong"]);
});
test("G0.6A.2 CRLF and opaque extensions survive balanced mixed replacement", () => {
  const src = "Başlık\r\n\r\nA **kalın** B\r\n\r\n:::efss.unknown\r\nitem: ö\r\n:::\r\n";
  const p = projectFlowBlocks(createBlockDocument(src)).find(b => b.type === "paragraph" && b.text.includes("kalın"));
  const from = src.indexOf("kalın");
  const to = p.sourceEnd;
  const c = planInlineTextEdit({ source: src, block: p, from, to, text: "yenisi" });
  const session = new TextEditorSession({ text: src });
  session.dispatch(c);
  assert.equal(session.snapshot.text, src.replace("A **kalın** B", "A yenisi"));
  assert.ok(session.snapshot.text.includes(":::efss.unknown\r\nitem: ö\r\n:::\r\n"));
  session.undo(); assert.equal(session.snapshot.text, src);
});
test("G0.6A.2 crossing nested partial regions is rejected without mutation", () => {
  const src = "A **kalın *eğik* metin** Z";
  const p = block(src);
  const session = new TextEditorSession({ text: src });
  assert.throws(() => planInlineTextEdit({
    source: src, block: p, from: src.indexOf("eğik") + 1,
    to: src.length, text: "yeni"
  }), /NESTED_PARTIAL_MARK_UNSUPPORTED/);
  assert.equal(session.snapshot.text, src);
  assert.equal(session.historyDepth, 0);
});
test("G0.6A nested mark gaps cannot silently be overwritten", () => {
  const src = "A **kalın *eğik* metin** Z";
  const p = block(src);
  assert.equal(p.editable, true);
  const italic = src.indexOf("eğik");
  const wordEnd = italic + "eğik".length;
  assert.throws(() => planInlineTextEdit({
    source: src, block: p, from: italic, to: src.indexOf(" Z") + 2,
    text: "yeni"
  }), /NESTED_PARTIAL_MARK_UNSUPPORTED/);
  const planned = planInlineTextEdit({
    source: src, block: p, from: italic, to: wordEnd, text: "yeni"
  });
  assert.equal(
    src.slice(0, planned.from) + planned.text + src.slice(planned.to),
    "A **kalın *yeni* metin** Z"
  );
});
test("G0.6A implicit Markdown parsing during typing is rejected, source view stays available", () => {
  const src = "*foo";
  const p = block(src);
  assert.throws(() => planInlineTextEdit({
    source: src, block: p, from: src.length, text: "*"
  }), /INLINE_EDIT_CHANGES_MARKUP/);
  // In Source view, source text can intentionally introduce syntax.
  const changed = reconcileBlockSource(createBlockDocument(src), "*foo*");
  assert.equal(serializeBlockDocument(changed), "*foo*");
});
test("G0.6A empty/new document can receive its first literal text", () => {
  const empty = createBlockDocument("");
  const target = projectFlowBlocks(empty)[0];
  const command = planInlineTextEdit({
    source: "", block: target, from: 0, text: "Başla"
  });
  assert.deepEqual({ from: command.from, to: command.to, text: command.text },
    { from: 0, to: 0, text: "Başla" });
});
test("G0.6A CRLF, EFSS extension and formatted paragraph survive save-source projection", () => {
  const original = "# Üst\r\n\r\nMetin **kalın** ve düz.\r\n\r\n:::efss.unknown\r\npayload: x\r\n:::\r\n";
  const doc = createBlockDocument(original);
  const p = projectFlowBlocks(doc).find(x => x.type === "paragraph");
  const start = original.indexOf("kalın");
  const session = new TextEditorSession({ text: original, selection: collapsedSelection(start) });
  const command = planInlineTextEdit({
    source: original, block: p, from: start, text: "ğ"
  });
  session.dispatch(command);
  const roundTrip = createBlockDocument(session.snapshot.text);
  assert.equal(serializeBlockDocument(roundTrip),
    original.replace("kalın", "ğkalın"));
  assert.equal(roundTrip.source.includes(":::efss.unknown\r\npayload: x\r\n:::"), true);
  session.undo();
  assert.equal(session.snapshot.text, original);
});

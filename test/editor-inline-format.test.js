import test from "node:test";
import assert from "node:assert/strict";
import { projectInline, mapInlineVisibleOffset, planInlineMark } from "../src/editor-inline-format.js";
import { createBlockDocument } from "../src/editor-block-model.js";
import { projectFlowBlocks } from "../src/editor-flow-model.js";
import { TextEditorSession, textPosition } from "../src/editor-text-engine.js";

function paragraph(source) {
  const doc = createBlockDocument(source);
  const block = projectFlowBlocks(doc).find(b => b.type === "paragraph");
  assert.ok(block);
  return block;
}
test("inline projection renders strong, emphasis, strike without changing source", () => {
  const src = "Bir **kalın**, *eğik* ve ~~silinmiş~~ kelime.";
  const inline = projectInline(src);
  assert.equal(inline.text, "Bir kalın, eğik ve silinmiş kelime.");
  assert.equal(inline.editable, true);
  assert.ok(inline.runs.some(r => r.marks.includes("strong") && r.text === "kalın"));
  assert.ok(inline.runs.some(r => r.marks.includes("emphasis") && r.text === "eğik"));
  assert.ok(inline.runs.some(r => r.marks.includes("strike") && r.text === "silinmiş"));
  assert.equal(src, "Bir **kalın**, *eğik* ve ~~silinmiş~~ kelime.");
});
test("nested marks preserve styled runs and raw UTF-16 ranges", () => {
  const src = "A **kalın *iç içe* söz** B";
  const inline = projectInline(src);
  assert.equal(inline.text, "A kalın iç içe söz B");
  assert.ok(inline.runs.some(r =>
    r.text === "iç içe" && r.marks.includes("strong") && r.marks.includes("emphasis")));
  for (const run of inline.runs)
    assert.equal(src.slice(run.from, run.to), run.text);
  assert.equal(mapInlineVisibleOffset(inline, 2), 4);
  assert.equal(mapInlineVisibleOffset(inline, 2, "left"), 2);
});
test("mark selection adds a supported mark and unwrapping is reversible through one transaction", () => {
  const initial = "Seçili metin";
  const block = paragraph(initial);
  const start = 0, end = 6;
  const mark = planInlineMark({ source: initial, block, start, end, mark: "strong" });
  assert.equal(mark.text, "**Seçili**");
  const editor = new TextEditorSession({ text: initial, selection: {
    anchor: textPosition(start), focus: textPosition(end)
  } });
  editor.dispatch(mark);
  assert.equal(editor.snapshot.text, "**Seçili** metin");
  assert.equal(editor.historyDepth, 1);
  const styled = paragraph(editor.snapshot.text);
  assert.equal(styled.editable, true);
  assert.equal(styled.text, initial);
  const removed = planInlineMark({
    source: editor.snapshot.text, block: styled,
    start: mark.selectionStart, end: mark.selectionEnd, mark: "strong"
  });
  assert.equal(removed.operation, "remove");
  editor.dispatch(removed);
  assert.equal(editor.snapshot.text, initial);
  editor.undo();
  assert.equal(editor.snapshot.text, "**Seçili** metin");
  editor.undo();
  assert.equal(editor.snapshot.text, initial);
  editor.redo();
  editor.redo();
  assert.equal(editor.snapshot.text, initial);
});
test("unrelated Markdown and EFSS symbols are never silently reformatted", () => {
  const rich = paragraph("A **bold** outside");
  const src = "A **bold** outside";
  // A partial cut through an existing strong span is deliberately not
  // licensed as an all-run mark operation yet.
  assert.throws(() => planInlineMark({
    source: src, block: rich, start: src.indexOf("old"), end: src.length,
    mark: "emphasis"
  }), /PARTIAL_MARK_SELECTION_UNSUPPORTED/);
  const semantic = paragraph("value &Miktar{22}");
  assert.equal(semantic.editable, false);
  assert.throws(() => planInlineMark({
    source: "value &Miktar{22}", block: semantic,
    start: 0, end: 5, mark: "strong"
  }), /INVALID_MARK_SELECTION/);
  assert.equal(projectInline("inline \`code\`").editable, false);
  assert.equal(projectInline("literal \\\\ escape").editable, false);
  assert.equal(projectInline("[[paper:ABC]]").editable, false);
});
test("grapheme-safe emoji selection and whitespace edge validation", () => {
  const source = "Önce 👩‍👧 sonra";
  const block = paragraph(source);
  const start = source.indexOf("👩"), end = start + "👩‍👧".length;
  const cmd = planInlineMark({ source, block, start, end, mark: "emphasis" });
  assert.equal(cmd.text, "*👩‍👧*");
  assert.throws(() => planInlineMark({
    source, block, start: start + 1, end, mark: "strong"
  }), /INVALID_MARK_SELECTION/);
  assert.throws(() => planInlineMark({
    source, block, start: 0, end: 5, mark: "strike"
  }), /MARK_WHITESPACE_EDGE/);
  assert.throws(() => planInlineMark({
    source, block, start: 0, end: 0, mark: "strong"
  }), /INVALID_MARK_SELECTION/);
});
test("G0.6A.2 strike can wrap whole bold-plus-plain selection without losing bold", () => {
  const original = "A **kalın** B";
  const p = paragraph(original);
  const operation = planInlineMark({
    source: original, block: p,
    start: original.indexOf("kalın"), end: original.length, mark: "strike"
  });
  assert.equal(operation.operation, "add-mixed");
  const state = new TextEditorSession({ text: original });
  state.dispatch(operation);
  assert.equal(state.snapshot.text, "A ~~**kalın** B~~");
  const projected = projectInline(state.snapshot.text);
  assert.equal(projected.text, "A kalın B");
  assert.deepEqual(projected.runs.find(run => run.text === "kalın").marks,
    ["strike", "strong"]);
  assert.deepEqual(projected.runs.find(run => run.text === " B").marks,
    ["strike"]);
  state.undo(); assert.equal(state.snapshot.text, original);
});

test("G0.6A.2 partial bold to plain strike preserves all selected and outside marks", () => {
  const src = "A **kalın** B";
  const from = src.indexOf("lın"), to = src.length;
  const state = new TextEditorSession({ text: src, selection: {
    anchor: textPosition(to), focus: textPosition(from)
  } });
  const op = planInlineMark({ source: src, block: paragraph(src),
    start: from, end: to, mark: "strike" });
  assert.equal(op.operation, "add-mixed");
  state.dispatch(op);
  assert.equal(state.snapshot.text, "A **ka**~~**lın** B~~");
  assert.equal(projectInline(state.snapshot.text).text, "A kalın B");
  const runs = projectInline(state.snapshot.text).runs;
  assert.deepEqual(runs.find(r => r.text === "ka").marks, ["strong"]);
  assert.deepEqual(runs.find(r => r.text === "lın").marks, ["strike", "strong"]);
  assert.deepEqual(runs.find(r => r.text === " B").marks, ["strike"]);
  assert.equal(projectInline(state.snapshot.text).text.slice(4, 9), "lın B");
  state.undo();
  assert.equal(state.snapshot.text, src);
  assert.equal(state.snapshot.selection.anchor.offset, to);
  assert.equal(state.snapshot.selection.focus.offset, from);
  state.redo();
  assert.equal(state.snapshot.text, "A **ka**~~**lın** B~~");
});
test("G0.6A.2 partial plain to bold and inner bold strike keep opposite sides intact", () => {
  const cases = [
    ["A düz **kalın** B", "düz", "ka", "A ~~düz **ka**~~**lın** B"],
    ["A **kalın** B", "al", "al", "A **k~~al~~ın** B"]
  ];
  for (const [src, first, last, expected] of cases) {
    const from = src.indexOf(first);
    const to = src.indexOf(last, from) + last.length;
    const op = planInlineMark({ source: src, block: paragraph(src),
      start: from, end: to, mark: "strike" });
    const result = src.slice(0, op.from) + op.text + src.slice(op.to);
    assert.equal(result, expected);
    assert.equal(projectInline(result).text, projectInline(src).text);
    assert.equal(op.operation, "add-mixed");
  }
});
test("G0.6A.2 supports mixed bold and italic around strike but refuses ambiguous stars", () => {
  const src = "A ~~sil~~ B";
  for (const [mark, expected] of [
    ["strong", "A **~~sil~~ B**"],
    ["emphasis", "A *~~sil~~ B*"]
  ]) {
    const op = planInlineMark({ source: src, block: paragraph(src),
      start: src.indexOf("sil"), end: src.length, mark });
    assert.equal(src.slice(0, op.from) + op.text + src.slice(op.to), expected);
  }
  const collision = "A **kalın** B";
  const pristine = new TextEditorSession({ text: collision });
  assert.throws(() => planInlineMark({ source: collision,
    block: paragraph(collision), start: collision.indexOf("lın"),
    end: collision.length, mark: "emphasis" }),
  /PARTIAL_MARK_SELECTION_UNSUPPORTED/);
  assert.equal(pristine.snapshot.text, collision);
  assert.equal(pristine.historyDepth, 0);
});
test("G0.6A.2 mixed partial formatting respects grapheme and EFSS/CRLF boundaries", () => {
  const src = "Başlık\r\n\r\nA **kalın** 👩‍👧\r\n\r\n:::efss.opaque\r\npayload: Ö\r\n:::\r\n";
  const b = projectFlowBlocks(createBlockDocument(src)).find(x =>
    x.type === "paragraph" && x.text.includes("kalın"));
  const from = src.indexOf("lın"), to = b.sourceEnd;
  const op = planInlineMark({ source: src, block: b, start: from, end: to,
    mark: "strike" });
  const session = new TextEditorSession({ text: src });
  session.dispatch(op);
  assert.ok(session.snapshot.text.includes(":::efss.opaque\r\npayload: Ö\r\n:::\r\n"));
  assert.ok(session.snapshot.text.includes("👩‍👧~~"));
  session.undo(); assert.equal(session.snapshot.text, src);
});


test("G0.6A.2 plain-run marks refuse asterisk collisions without mutation", () => {
  const cases = [
    ["A *x*y", "y", "strong"],
    ["A *x*y", "y", "emphasis"],
    ["x**y**z", "x", "emphasis"],
    ["x*y*z", "z", "emphasis"]
  ];
  for (const [src, selected, mark] of cases) {
    const state = new TextEditorSession({ text: src });
    const from = src.lastIndexOf(selected);
    assert.throws(() => planInlineMark({ source: src, block: paragraph(src),
      start: from, end: from + selected.length, mark }),
      /MARK_SOURCE_COLLISION/, src + " " + mark);
    assert.equal(state.snapshot.text, src);
    assert.equal(state.historyDepth, 0);
  }
});
test("G0.6A.2 safe plain-run formatting verifies the same parser oracle", () => {
  const cases = [
    ["A *x*y", "y", "strike", "A *x*~~y~~"],
    ["A **x**y", "y", "strike", "A **x**~~y~~"],
    ["İlk 👩‍👧 son", "👩‍👧", "strong", "İlk **👩‍👧** son"]
  ];
  for (const [src, selected, mark, expected] of cases) {
    const from = src.indexOf(selected);
    const op = planInlineMark({ source: src, block: paragraph(src),
      start: from, end: from + selected.length, mark });
    const state = new TextEditorSession({ text: src });
    state.dispatch({ ...op, selectionAfter: {
      anchor: textPosition(op.selectionStart), focus: textPosition(op.selectionEnd)
    } });
    assert.equal(state.snapshot.text, expected);
    assert.equal(projectInline(state.snapshot.text).text, projectInline(src).text);
    state.undo(); assert.equal(state.snapshot.text, src);
    state.redo(); assert.equal(state.snapshot.text, expected);
  }
});
test("G0.6A.2 whole-mark unformat proves nested-style preservation", () => {
  const src = "Ö **kalın *eğik* söz** Z";
  const p = paragraph(src);
  const region = p.inline.regions.find(r => r.mark === "strong");
  const op = planInlineMark({ source: src, block: p,
    start: p.sourceStart + region.contentStart,
    end: p.sourceStart + region.contentEnd, mark: "strong" });
  const state = new TextEditorSession({ text: src });
  state.dispatch(op);
  assert.equal(state.snapshot.text, "Ö kalın *eğik* söz Z");
  assert.deepEqual(projectInline(state.snapshot.text).runs
    .find(r => r.text === "eğik").marks, ["emphasis"]);
  state.undo(); assert.equal(state.snapshot.text, src);
});
test("G0.6A.2 refuses partial nested inline styling without changing source", () => {
  const original = "A **kalın *eğik* söz** B";
  const state = new TextEditorSession({ text: original });
  const p = paragraph(original);
  assert.throws(() => planInlineMark({
    source: original, block: p, start: original.indexOf("eğik"),
    end: original.length, mark: "strong"
  }), /PARTIAL_MARK_SELECTION_UNSUPPORTED/);
  assert.equal(state.snapshot.text, original);
  assert.equal(state.historyDepth, 0);
});
test("source-to-visible mapping chooses safe sides of formatting markers", () => {
  const raw = "B **bold** E";
  const p = projectInline(raw);
  assert.equal(p.text, "B bold E");
  assert.equal(mapInlineVisibleOffset(p, 2, "left"), 2);
  assert.equal(mapInlineVisibleOffset(p, 2, "right"), 4);
  assert.equal(mapInlineVisibleOffset(p, 6, "left"), 8);
  assert.equal(mapInlineVisibleOffset(p, 6, "right"), 10);
  assert.equal(mapInlineVisibleOffset(p, p.text.length), raw.length);
});

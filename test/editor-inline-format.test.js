import test from "node:test";
import assert from "node:assert/strict";
import { projectInline, mapInlineVisibleOffset, planInlineMark, planInlineVisibleMark } from "../src/editor-inline-format.js";
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
  assert.throws(() => planInlineMark({
    source: src, block: rich, start: 0, end: src.length, mark: "emphasis"
  }), /CROSS_MARK_SELECTION_UNSUPPORTED/);
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

test("G0.6A: mixed strong/plain range gains strike while preserving nested source bytes", () => {
  const source = "A **kalın** B";
  const block = paragraph(source);
  const operation = planInlineVisibleMark({
    source, block, start: 0, end: block.text.length, mark: "strike"
  });
  assert.deepEqual(
    { type: operation.type, from: operation.from, to: operation.to, text: operation.text },
    { type: "replaceRange", from: 0, to: source.length, text: "~~A **kalın** B~~" }
  );
  const editor = new TextEditorSession({ text: source });
  editor.dispatch(operation);
  assert.equal(editor.snapshot.text, "~~A **kalın** B~~");
  const projected = paragraph(editor.snapshot.text);
  assert.equal(projected.text, "A kalın B");
  assert.ok(projected.inline.runs.every(run => run.marks.includes("strike")));
  assert.ok(projected.inline.runs.some(run =>
    run.text === "kalın" && run.marks.includes("strong")));
  const removal = planInlineVisibleMark({
    source: editor.snapshot.text, block: projected, start: 0,
    end: projected.text.length, mark: "strike"
  });
  editor.dispatch(removal);
  assert.equal(editor.snapshot.text, source);
  editor.undo();
  assert.equal(editor.snapshot.text, "~~A **kalın** B~~");
  editor.undo();
  assert.equal(editor.snapshot.text, source);
  editor.redo();
  editor.redo();
  assert.equal(editor.snapshot.text, source);
});

test("G0.6A: mixed emphasis/plain with CRLF and opaque EFSS source round-trips", () => {
  const opaque = ":::efss.unknown-custom\\r\\nşifreli: **ham** 👩‍👧\\r\\n:::\\r\\n";
  const source = "Baş *ince* son\\r\\n\\r\\n" + opaque;
  const block = paragraph(source);
  const operation = planInlineVisibleMark({
    source, block, start: 0, end: block.text.length, mark: "strike"
  });
  const editor = new TextEditorSession({ text: source });
  editor.dispatch(operation);
  assert.equal(editor.snapshot.text.endsWith(opaque), true);
  assert.equal(editor.snapshot.text.startsWith("~~Baş *ince* son~~\\r\\n\\r\\n"), true);
  assert.equal(projectInline("~~Baş *ince* son~~").text, "Baş ince son");
  editor.undo();
  assert.equal(editor.snapshot.text, source);
  editor.redo();
  assert.equal(editor.snapshot.text.endsWith(opaque), true);
});

test("G0.6A: unsafe crossing/partial same-mark selections fail closed", () => {
  const source = "A **kalın** B";
  const block = paragraph(source);
  const start = block.text.indexOf("kalın");
  const end = block.text.length;
  assert.throws(() => planInlineVisibleMark({
    source, block, start, end, mark: "strong"
  }), /CROSS_MARK_SELECTION_UNSUPPORTED/);
  assert.throws(() => planInlineVisibleMark({
    source, block, start, end, mark: "emphasis"
  }), /CROSS_MARK_SELECTION_UNSUPPORTED/);
  assert.equal(source, "A **kalın** B");
});

test("G0.6A: Unicode grapheme selection and unsupported semantic sources fail closed", () => {
  const source = "Önce 👩‍👧 *ince* sonra";
  const block = paragraph(source);
  const before = block.text.indexOf("👩");
  assert.throws(() => planInlineVisibleMark({
    source, block, start: before + 1, end: before + "👩‍👧".length, mark: "strong"
  }), /INVALID_MARK_SELECTION/);
  const op = planInlineVisibleMark({ source, block, start: 0,
    end: block.text.length, mark: "strike" });
  assert.equal(projectInline(op.text).text, block.text);
  const unsupported = paragraph("value &Miktar{22}");
  assert.throws(() => planInlineVisibleMark({
    source: "value &Miktar{22}", block: unsupported, start: 0, end: 5, mark: "strike"
  }), /INVALID_MARK_SELECTION/);
});

test("G0.6A: single unmarked run keeps previous format/unformat semantics", () => {
  const source = "Güzel içerik";
  const block = paragraph(source);
  const op = planInlineVisibleMark({ source, block, start: 0, end: 5, mark: "strong" });
  assert.equal(op.text, "**Güzel**");
  const marked = paragraph("**Güzel** içerik");
  const reverse = planInlineVisibleMark({
    source: "**Güzel** içerik", block: marked, start: 0, end: 5, mark: "strong"
  });
  assert.equal(reverse.operation, "remove");
});

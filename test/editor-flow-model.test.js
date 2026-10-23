import test from "node:test";
import assert from "node:assert/strict";
import { createBlockDocument } from "../src/editor-block-model.js";
import { TextEditorSession, collapsedSelection } from "../src/editor-text-engine.js";
import { planInlineTextEdit } from "../src/editor-inline-format.js";
import {
  projectFlowBlocks, flowBlockAt, editFlowText, insertFlowBlock,
  calloutMarkdown, slashFlowCommand, planFlowEnter,
  planFlowListIndent, planFlowBackspaceAtStart, planFlowParagraphJoin,
  planFlowSoftBreak, planFlowMultilineEdit
} from "../src/editor-flow-model.js";

const editable = source => projectFlowBlocks(createBlockDocument(source)).filter(b => b.editable);






test("Flow hides only the implicit prose separator, not intentional blank lines", () => {
  const cases = [
    ["Birinci\n\nİkinci", [true], "\n"],
    ["Birinci\r\n\r\nİkinci", [true], "\r\n"],
    ["# Başlık\n\nMetin", [true], "\n"],
    ["Birinci\n\n\nİkinci", [false], "\n\n"],
    ["Birinci\n\n", [false], "\n"],
    ["- Liste\n\nMetin", [false], "\n"],
    ["Birinci\n\n:::efss.unknown\nx: private\n:::\n", [false], "\n"]
  ];
  for (const [source, expected, blankRaw] of cases) {
    const blocks = projectFlowBlocks(createBlockDocument(source));
    const blanks = blocks.filter(b => b.type === "blank");
    assert.deepEqual(blanks.map(b => !!b.separator), expected, source);
    assert.equal(blanks[0]?.raw, blankRaw, source);
    assert.equal(createBlockDocument(source).source, source);
  }
});



test("G0.6B.6 Shift+Enter creates an editable single paragraph soft break", () => {
  for (const eol of ["\n", "\r\n", "\r"]) {
    const source = "Birinciİkinci" + eol;
    const document = createBlockDocument(source);
    const block = projectFlowBlocks(document).find(b => b.type === "paragraph");
    const at = "Birinci".length;
    const session = new TextEditorSession({text:source,selection:collapsedSelection(at)});
    const operation = planFlowSoftBreak({source,document,block,at});
    assert.equal(operation.operation,"flow-soft-break");
    session.dispatch(operation);
    assert.equal(session.snapshot.text,"Birinci" + eol + "İkinci" + eol);
    assert.equal(session.snapshot.selection.focus.offset,at+eol.length);
    const nextDocument = createBlockDocument(session.snapshot.text);
    const projected = projectFlowBlocks(nextDocument);
    const paragraph = projected.find(b => b.type === "paragraph");
    assert.equal(paragraph.multiline,true);
    assert.equal(paragraph.editable,true);
    assert.equal(paragraph.text,"Birinci"+eol+"İkinci");
    assert.equal(paragraph.inline.text,paragraph.text);
    assert.equal(paragraph.inline.runs[0].text,paragraph.text);
    session.undo();
    assert.equal(session.snapshot.text,source);
    session.redo();
    assert.equal(session.snapshot.text,"Birinci"+eol+"İkinci"+eol);
  }
});
test("G0.6B.6 type/backspace inside multiline paragraph stays editable", () => {
  for (const eol of ["\n","\r\n","\r"]) {
    const source = "Birinci" + eol + "İkinci" + eol;
    const doc = createBlockDocument(source), block = projectFlowBlocks(doc)[0];
    assert.equal(block.multiline,true);
    const at = "Birinci".length+eol.length;
    const edit = planFlowMultilineEdit({source,document:doc,block,
      from:at,text:"Güzel "});
    const session = new TextEditorSession({text:source,
      selection:collapsedSelection(at)});
    session.dispatch(edit);
    const after = "Birinci"+eol+"Güzel İkinci"+eol;
    assert.equal(session.snapshot.text,after);
    const current = createBlockDocument(after);
    const paragraph = projectFlowBlocks(current)[0];
    const deletion = planFlowMultilineEdit({
      source:after,document:current,block:paragraph,
      from:"Birinci".length,to:"Birinci".length+eol.length,text:""
    });
    session.dispatch(deletion);
    assert.equal(session.snapshot.text,"BirinciGüzel İkinci"+eol);
    assert.equal(projectFlowBlocks(createBlockDocument(session.snapshot.text))[0].editable,true);
    session.undo();
    assert.equal(session.snapshot.text,after);
    session.undo();
    assert.equal(session.snapshot.text,source);
    session.redo();
    session.redo();
    assert.equal(session.snapshot.text,"BirinciGüzel İkinci"+eol);
  }
});
test("G0.6B.6 multiline soft breaks fail closed at EOF or across EFSS structures", () => {
  for (const source of [
    "- Madde", "# Başlık", "A **kalın** B", "A &Miktar B",
    "A\n\n:::efss.secret\nvalue: private\n:::\n"
  ]) {
    const document=createBlockDocument(source);
    const block=projectFlowBlocks(document)[0];
    const at=block.type==="paragraph" ? Math.min(block.sourceEnd,block.sourceStart+1) :
      block.sourceStart+1;
    const original=new TextEditorSession({text:source});
    assert.throws(()=>planFlowSoftBreak({source,document,block,at}),
      /FLOW_SOFT_BREAK_UNSUPPORTED|FLOW_MULTILINE_REPARSE_FAILED/,source);
    assert.equal(original.snapshot.text,source);
  }
  const src="Üst\n\nBirinciİkinci\n\n:::efss.unknown\nsecret: 💾\n:::\n";
  const document=createBlockDocument(src);
  const block=projectFlowBlocks(document).find(b=>b.text==="Birinciİkinci");
  const at=src.indexOf("İkinci");
  const op=planFlowSoftBreak({source:src,document,block,at});
  const next=src.slice(0,op.from)+op.text+src.slice(op.to);
  assert.ok(next.includes("Birinci\nİkinci"));
  assert.ok(next.endsWith(":::efss.unknown\nsecret: 💾\n:::\n"));
});
test("G0.6B.6 rejects unsafe multiline edits and preserves original byte stream",()=>{
  const examples=[
    "Birinci\n- Liste\n",
    "Birinci\n# Başlık\n",
    "Birinci\n:::efss.opaque\nid:x\n:::\n",
    "Birinci\n**kalın**\n"
  ];
  for (const source of examples) {
    const block=projectFlowBlocks(createBlockDocument(source))[0];
    assert.notEqual(block.multiline,true,source);
  }
  const source="Birinci\nİkinci";
  const document=createBlockDocument(source),block=projectFlowBlocks(document)[0];
  assert.throws(()=>planFlowMultilineEdit({
    source,document,block,from:source.indexOf("İkinci"),
    text:"# "
  }),/FLOW_MULTILINE_EDIT_REPARSE_FAILED/);
  assert.throws(()=>planFlowMultilineEdit({
    source,document,block,from:0,to:0,text:"- "
  }),/FLOW_MULTILINE_EDIT_REPARSE_FAILED/);
  assert.equal(document.source,source);
});

test("G0.6B.5 Backspace/Delete join adjacent plain paragraphs without extra line endings", () => {
  for (const eol of ["\n", "\r\n", "\r"]) {
    for (const direction of ["backward", "forward"]) {
      const source = "Birinci" + eol + eol + "İkinci 🧩" + eol;
      const document = createBlockDocument(source);
      const paragraphs = projectFlowBlocks(document).filter(b => b.type === "paragraph");
      assert.equal(paragraphs.length, 2);
      const block = direction === "backward" ? paragraphs[1] : paragraphs[0];
      const at = direction === "backward" ? block.sourceStart : block.sourceEnd;
      const session = new TextEditorSession({text:source,
        selection:collapsedSelection(at)});
      const plan = planFlowParagraphJoin({source,document,block,at,direction});
      assert.equal(plan.type,"replaceRange");
      assert.equal(plan.text,"");
      assert.equal(plan.to - plan.from, 2 * eol.length);
      session.dispatch(plan);
      assert.equal(session.snapshot.text, "Birinciİkinci 🧩" + eol);
      assert.equal(session.snapshot.selection.focus.offset, "Birinci".length);
      const next = projectFlowBlocks(createBlockDocument(session.snapshot.text));
      assert.equal(next.filter(b => b.type === "paragraph").length, 1);
      assert.equal(next[0].text, "Birinciİkinci 🧩");
      session.undo();
      assert.equal(session.snapshot.text, source);
      assert.equal(session.snapshot.selection.focus.offset, at);
      session.redo();
      assert.equal(session.snapshot.text, "Birinciİkinci 🧩" + eol);
    }
  }
});
test("G0.6B.5 joins middle paragraphs but does not consume external EFSS bytes", () => {
  const source = "# Önce\n\nİlk\n\nİkinci\n\n:::efss.opaque\nprivate: 👩‍👧\n:::\n";
  const doc = createBlockDocument(source);
  const paragraphs = projectFlowBlocks(doc).filter(b => b.type === "paragraph");
  const op = planFlowParagraphJoin({source,document:doc,block:paragraphs[1],
    at:paragraphs[1].sourceStart,direction:"backward"});
  const after = source.slice(0,op.from) + op.text + source.slice(op.to);
  assert.equal(after,"# Önce\n\nİlkİkinci\n\n:::efss.opaque\nprivate: 👩‍👧\n:::\n");
  assert.equal(after.split(":::efss.opaque")[1],
    source.split(":::efss.opaque")[1]);
});
test("G0.6B.5 refuses joins through headings, lists, extra blanks, rich marks or extensions", () => {
  const samples = [
    ["# Başlık\n\nMetin", "backward"],
    ["- Madde\n\nMetin", "backward"],
    ["Metin\n\n> Alıntı", "forward"],
    ["Birinci\n\n\nİkinci", "backward"],
    ["**Kalın**\n\nNormal", "backward"],
    ["Normal\n\n*İtalik*", "forward"],
    ["Birinci\n\n:::efss.opaque\nsecret: 1\n:::\n", "forward"],
    ["Yalnız", "backward"]
  ];
  for (const [source,direction] of samples) {
    const document = createBlockDocument(source);
    const paragraphs = projectFlowBlocks(document).filter(b => b.type === "paragraph");
    const block = direction === "backward" ? paragraphs.at(-1) : paragraphs[0];
    const at = direction === "backward" ? block.sourceStart : block.sourceEnd;
    const session = new TextEditorSession({text:source});
    assert.throws(() => planFlowParagraphJoin({source,document,block,at,direction}),
      /FLOW_PARAGRAPH_JOIN_UNSUPPORTED/,source);
    assert.equal(session.snapshot.text,source);
    assert.equal(session.historyDepth,0);
  }
});
test("G0.6B.5 rejects a stale doc or a caret that is not at the boundary", () => {
  const source = "Birinci\n\nİkinci";
  const document = createBlockDocument(source);
  const second = projectFlowBlocks(document).filter(b => b.type === "paragraph")[1];
  assert.throws(()=>planFlowParagraphJoin({
    source,document,block:second,at:second.sourceStart + 1,direction:"backward"
  }),/FLOW_JOIN_NOT_AT_BOUNDARY/);
  assert.throws(()=>planFlowParagraphJoin({
    source,document:createBlockDocument("Changed\n\nİkinci"),block:second,
    at:second.sourceStart,direction:"backward"
  }),/INVALID_FLOW_PARAGRAPH_JOIN/);
});

test("G0.6B.4 terminal Enter then typing stays in editable Flow, never merges two paragraphs", () => {
  for (const source of [
    "Birinci", "Birinci\n", "Birinci\r\n", "# Başlık\n",
    "**kalın**\n", "A **kalın**\n"
  ]) {
    const original = editable(source).find(b =>
      b.type === "paragraph" || b.type === "heading");
    const at = original.inline?.regions.length ?
      source.indexOf("kalın") + "kalın".length : original.sourceEnd;
    const session = new TextEditorSession({
      text: source, selection: collapsedSelection(at)
    });
    const enter = planFlowEnter({ source, block: original, at });
    session.dispatch(enter);
    const next = session.snapshot.text;
    const terminal = editable(next).at(-1);
    assert.equal(terminal.type, "blank", source);
    assert.equal(terminal.sourceStart, next.length, source);
    assert.equal(session.snapshot.selection.focus.offset, next.length, source);
    const type = planInlineTextEdit({
      source: next, block: terminal, from: next.length, text: "İkinci"
    });
    session.dispatch(type);
    const after = projectFlowBlocks(createBlockDocument(session.snapshot.text));
    const prose = after.filter(b => b.type === "paragraph" || b.type === "heading");
    assert.equal(prose.length, 2, source);
    assert.ok(prose.every(b => b.editable), source);
    assert.equal(prose.at(-1).text, "İkinci", source);
    session.undo();
    assert.equal(session.snapshot.text, next);
    session.undo();
    assert.equal(session.snapshot.text, source);
    session.redo();
    session.redo();
    assert.equal(session.snapshot.text, next + "İkinci");
  }
});

test("G0.6B.4 rich Enter splits visible B/I/S content without touching unrelated source", () => {
  const cases = [
    ["**kalın**\n", "kalın", 5, "paragraph", "**kalın**\n\n"],
    ["A **kalın** B\n", "kalın", 3, "paragraph", "A **kal**\n\n**ın** B\n"],
    ["- **kalın**\n", "kalın", 3, "list_item", "- **kal**\n- **ın**\n"],
    ["> *alıntı*\n", "alıntı", 6, "quote", "> *alıntı*\n> \n"],
    ["# **Başlık**\n", "Başlık", 6, "heading", "# **Başlık**\n\n"],
    ["**kalın**", "kalın", 0, "paragraph", "\n\n**kalın**"],
    ["A ~~silinen~~ B", "silinen", 4, "paragraph", "A ~~sili~~\n\n~~nen~~ B"]
  ];
  for (const [source, token, charOffset, type, expected] of cases) {
    const block = editable(source).find(b => b.type === type);
    assert.ok(block, source);
    const at = source.indexOf(token) + charOffset;
    const session = new TextEditorSession({
      text: source, selection: collapsedSelection(at)
    });
    const op = planFlowEnter({ source, block, at });
    assert.equal(op.operation, "flow-enter-rich");
    session.dispatch(op);
    assert.equal(session.snapshot.text, expected, source);
    assert.equal(session.snapshot.selection.focus.offset, op.selectionAfter.focus.offset);
    session.undo();
    assert.equal(session.snapshot.text, source);
    session.redo();
    assert.equal(session.snapshot.text, expected);
  }
});
test("G0.6B.4 rich Enter preserves CRLF, Unicode and unknown EFSS bytes", () => {
  const source = "Üst\r\n\r\n- **kalın 👩‍👧 metin**\r\n\r\n:::efss.future\r\nid: 🧩\r\n:::\r\n";
  const block = editable(source).find(b => b.type === "list_item");
  const at = source.indexOf("metin") + 2;
  const session = new TextEditorSession({
    text: source, selection: collapsedSelection(at)
  });
  const op = planFlowEnter({ source, block, at });
  session.dispatch(op);
  assert.equal(session.snapshot.text,
    "Üst\r\n\r\n- **kalın 👩‍👧 me**\r\n- **tin**\r\n\r\n:::efss.future\r\nid: 🧩\r\n:::\r\n");
  assert.ok(session.snapshot.text.includes(":::efss.future\r\nid: 🧩\r\n:::\r\n"));
  session.undo();
  assert.equal(session.snapshot.text, source);
  session.redo();
  assert.ok(session.snapshot.text.includes("- **tin**"));
});
test("G0.6B.4 ambiguous nested mark split fails closed", () => {
  const source = "A **kalın *içte* b**\n";
  const block = editable(source)[0];
  const at = source.indexOf("içte") + 2;
  const state = new TextEditorSession({ text: source });
  assert.throws(() => planFlowEnter({ source, block, at }),
    /FLOW_ENTER_RICH_COLLISION/);
  assert.equal(state.snapshot.text, source);
  assert.equal(state.historyDepth, 0);
});

test("G0.6B.3 Tab indents a second bullet to one level and Shift+Tab reverses it", () => {
  for (const [marker,eol] of [["-","\n"],["+","\r\n"],["*","\r"]]) {
    const source = marker + " Ebeveyn" + eol +
      marker + " Çocuk 👩‍👧" + eol;
    const child = editable(source).filter(b => b.type === "list_item")[1];
    const at = child.sourceStart + 2;
    const state = new TextEditorSession({text:source,
      selection: collapsedSelection(at)});
    const indent = planFlowListIndent({ source, block: child, at,
      direction: "indent" });
    assert.equal(indent.operation, "flow-list-indent");
    assert.equal(indent.selectionAfter.focus.offset, at + 2);
    state.dispatch(indent);
    const expected = marker + " Ebeveyn" + eol +
      "  " + marker + " Çocuk 👩‍👧" + eol;
    assert.equal(state.snapshot.text, expected);
    const nested = editable(expected).filter(b => b.type === "list_item")[1];
    assert.equal(nested.list.depth, 1);
    assert.equal(nested.list.indent, 2);
    const outdent = planFlowListIndent({
      source: expected, block: nested, at: indent.selectionAfter.focus.offset,
      direction: "outdent"
    });
    state.dispatch(outdent);
    assert.equal(state.snapshot.text, source);
    state.undo(); assert.equal(state.snapshot.text, expected);
    state.undo(); assert.equal(state.snapshot.text, source);
    state.redo(); assert.equal(state.snapshot.text, expected);
    state.redo(); assert.equal(state.snapshot.text, source);
  }
});
test("G0.6B.3 Tab fails closed without a parent or on unsupported levels", () => {
  for (const [source, index, direction, error] of [
    ["- First\n- Second\n",0,"indent","FLOW_INDENT_PARENT_REQUIRED"],
    ["Paragraph\n- Item\n",0,"indent","FLOW_INDENT_PARENT_REQUIRED"],
    ["- Parent\n\n- Child\n",1,"indent","FLOW_INDENT_PARENT_REQUIRED"],
    ["- Parent\n  - Child\n",1,"indent","FLOW_INDENT_DEPTH_LIMIT"],
    ["- Parent\n- Child\n  - Grandchild\n",1,"indent","FLOW_INDENT_CHILDREN_UNSUPPORTED"],
    ["- Parent\n- Child\n",1,"outdent","FLOW_INDENT_DEPTH_LIMIT"],
    ["1. First\n2. Second\n",1,"indent","INVALID_FLOW_INDENT"]
  ]) {
    const item = editable(source).filter(b => b.type === "list_item")[index];
    const at = item.sourceStart, state = new TextEditorSession({ text: source });
    assert.throws(() => planFlowListIndent({ source, block: item, at, direction }),
      new RegExp(error), source);
    assert.equal(state.snapshot.text, source);
    assert.equal(state.historyDepth, 0);
  }
});
test("G0.6B.3 Backspace at structural start unwraps only marker as one transaction", () => {
  for (const [source, expected, kind] of [
    ["- Madde\n", "Madde\n", "list_item"],
    ["> Alıntı\n", "Alıntı\n", "quote"],
    ["## Başlık\n", "Başlık\n", "heading"],
    ["- Önce\n- Sonra\n", "- Önce\nSonra\n", "list_item"]
  ]) {
    const blocks = editable(source);
    const block = blocks.filter(b => b.type === kind).at(-1);
    const before = source, at = block.sourceStart;
    const session = new TextEditorSession({text:source,
      selection: collapsedSelection(at)});
    const op = planFlowBackspaceAtStart({source,block,at});
    assert.equal(op.operation,"flow-unwrap-marker");
    session.dispatch(op);
    assert.equal(session.snapshot.text,expected);
    assert.equal(session.snapshot.selection.focus.offset,block.start);
    session.undo();
    assert.equal(session.snapshot.text,before);
    session.redo();
    assert.equal(session.snapshot.text,expected);
  }
});
test("G0.6B.3 nested bullet Backspace outdents before unwrapping to paragraph", () => {
  const source = "- Parent\r\n  - Child\r\n\r\n:::efss.hidden\r\nsecret: 123\r\n:::\r\n";
  const child = editable(source).find(b => b.list?.depth === 1);
  assert.ok(child);
  const state = new TextEditorSession({text:source,
    selection:collapsedSelection(child.sourceStart)});
  const first = planFlowBackspaceAtStart({
    source,block:child,at:child.sourceStart
  });
  assert.equal(first.operation,"flow-list-outdent");
  state.dispatch(first);
  assert.ok(state.snapshot.text.startsWith("- Parent\r\n- Child\r\n"));
  const next = editable(state.snapshot.text).find(b => b.text === "Child");
  const second = planFlowBackspaceAtStart({
    source:state.snapshot.text,block:next,at:next.sourceStart
  });
  state.dispatch(second);
  assert.ok(state.snapshot.text.startsWith("- Parent\r\nChild\r\n"));
  assert.ok(state.snapshot.text.endsWith(":::efss.hidden\r\nsecret: 123\r\n:::\r\n"));
  state.undo(); state.undo(); assert.equal(state.snapshot.text,source);
});
test("G0.6B.3 cannot unwrap unsupported ordered item or stale source", () => {
  const numbered = "1. First\n2. Second\n";
  const ordered = editable(numbered).find(b => b.text === "Second");
  assert.throws(() => planFlowBackspaceAtStart({
    source:numbered,block:ordered,at:ordered.sourceStart
  }), /FLOW_BACKSPACE_ORDERED_UNSUPPORTED/);
  const source = "- Ebeveyn\n- Çocuk\n";
  const child = editable(source).find(b => b.text === "Çocuk");
  assert.throws(() => planFlowListIndent({
    source:"- Ebeveyn\n- Başka\n",block:child,
    at:child.sourceStart,direction:"indent"
  }), /FLOW_INDENT_STALE_BLOCK/);
  assert.throws(() => planFlowBackspaceAtStart({
    source,block:child,at:child.sourceStart + 1
  }), /INVALID_FLOW_BACKSPACE/);
});

test("G0.6B.2 ordered Enter renumbers consecutive siblings in one undo transaction", () => {
  const cases = [
    ["1. One\n2. Two\n3. Three\n", "1. One\n2. \n3. Two\n4. Three\n", "2. "],
    ["1. One\r\n2. Two\r\n3. Three\r\n",
      "1. One\r\n2. \r\n3. Two\r\n4. Three\r\n", "2. "],
    ["7) Seven\n8) Eight\n", "7) Seven\n8) \n9) Eight\n", "8) "],
    ["001. One\n002. Two\n", "001. One\n002. \n003. Two\n", "002. "],
    ["  1. A\n  2. B\n", "  1. A\n  2. \n  3. B\n", "  2. "]
  ];
  for (const [source, expected, newPrefix] of cases) {
    const block = editable(source).find(b => b.type === "list_item");
    const at = block.sourceEnd, eol = source.includes("\r\n") ? "\r\n" : "\n";
    const state = new TextEditorSession({ text: source,
      selection: collapsedSelection(at) });
    const op = planFlowEnter({ source, block, at });
    assert.equal(op.operation, "flow-enter-ordered-renumber");
    assert.equal(op.selectionAfter.focus.offset, at + eol.length + newPrefix.length);
    state.dispatch(op);
    assert.equal(state.snapshot.text, expected);
    const list = projectFlowBlocks(createBlockDocument(expected))
      .filter(b => b.type === "list_item");
    assert.ok(list.length >= 3);
    assert.equal(list[1].text, "");
    state.undo();
    assert.equal(state.snapshot.text, source);
    assert.equal(state.snapshot.selection.focus.offset, at);
    state.redo();
    assert.equal(state.snapshot.text, expected);
    assert.equal(state.snapshot.selection.focus.offset, at + eol.length + newPrefix.length);
  }
});
test("G0.6B.2 ordered Enter splits current text and shifts later sibling markers", () => {
  const source = "1. One\n2. Two\n";
  const block = editable(source)[0], at = source.indexOf("n", source.indexOf("One"));
  const op = planFlowEnter({ source, block, at });
  assert.equal(source.slice(0, op.from) + op.text + source.slice(op.to),
    "1. O\n2. ne\n3. Two\n");
  const updated = "1. O\n2. ne\n3. Two\n";
  assert.deepEqual(projectFlowBlocks(createBlockDocument(updated))
    .filter(b => b.type === "list_item").map(b => b.list.ordinal), [1, 2, 3]);
});
test("G0.6B.2 renumber does not cross blank, other family or unknown EFSS", () => {
  const samples = [
    "1. One\n\n2. Separate\n",
    "1. One\n2) Different delimiter\n",
    "1. One\n- Bullet\n2. New run\n",
    "1. One\n:::efss.secret\nprivate: x\n:::\n"
  ];
  for (const source of samples) {
    const block = editable(source)[0], op = planFlowEnter({
      source, block, at: block.sourceEnd
    });
    assert.equal(op.operation, "flow-enter");
    assert.equal(op.to, block.sourceEnd);
    assert.equal(op.text, "\n2. ");
    const updated = source.slice(0, op.from) + op.text + source.slice(op.to);
    assert.ok(updated.endsWith(source.slice(block.sourceEnd)));
  }
});
test("G0.6B.2 invalid ordinal sequence, overflow and stale block refuse mutation", () => {
  for (const source of [
    "1. One\n4. Unexpected\n",
    "999999998. Last\n999999999. Overflow\n",
    "999999999. Overflow\n"
  ]) {
    const block = editable(source)[0], state = new TextEditorSession({ text: source });
    assert.throws(() => planFlowEnter({ source, block, at: block.sourceEnd }),
      /FLOW_ORDERED_SEQUENCE_UNSUPPORTED|FLOW_LIST_NUMBER_LIMIT/);
    assert.equal(state.snapshot.text, source);
    assert.equal(state.historyDepth, 0);
  }
  const source = "1. One\n", block = editable(source)[0];
  assert.throws(() => planFlowEnter({ source: "1. Two\n", block,
    at: block.sourceEnd }), /FLOW_ENTER_STALE_BLOCK/);
});

test("G0.6B.1 bullet Enter continues -, + and * source markers without losing text", () => {
  for (const token of ["-", "+", "*"]) {
    const source = token + " Birinci\n";
    const block = editable(source).find(b => b.type === "list_item");
    const at = block.sourceEnd;
    const op = planFlowEnter({ source, block, at });
    const session = new TextEditorSession({ text: source,
      selection: collapsedSelection(at) });
    session.dispatch(op);
    assert.equal(session.snapshot.text,
      token + " Birinci\n" + token + " \n");
    assert.equal(session.snapshot.selection.focus.offset, at + (token + " \n").length);
    const newBlocks = projectFlowBlocks(createBlockDocument(session.snapshot.text))
      .filter(b => b.type === "list_item");
    assert.equal(newBlocks.length, 2);
    assert.equal(newBlocks[1].editable, true);
    assert.equal(newBlocks[1].text, "");
    session.undo(); assert.equal(session.snapshot.text, source);
    session.redo(); assert.equal(session.snapshot.text,
      token + " Birinci\n" + token + " \n");
  }
});
test("G0.6B.1 Enter in middle of a list item splits into two real list items", () => {
  const source = "- Birinci\n";
  const block = editable(source)[0];
  const at = source.indexOf("inci");
  const op = planFlowEnter({ source, block, at });
  const result = source.slice(0, op.from) + op.text + source.slice(op.to);
  assert.equal(result, "- Bir\n- inci\n");
  const list = projectFlowBlocks(createBlockDocument(result))
    .filter(b => b.type === "list_item");
  assert.deepEqual(list.map(b => b.text), ["Bir", "inci"]);
});
test("G0.6B.1 empty list item exits into a plain paragraph placeholder", () => {
  for (const source of ["- one\n- \n", "1. item\n2. \n", "> quote\n> \n"]) {
    const blocks = projectFlowBlocks(createBlockDocument(source));
    const block = blocks.filter(b => b.editable && b.type !== "blank").at(-1);
    const op = planFlowEnter({ source, block, at: block.sourceStart });
    assert.equal(op.operation, "flow-exit-block");
    const next = source.slice(0, op.from) + op.text + source.slice(op.to);
    assert.ok(next.endsWith("\n\n"));
    const result = projectFlowBlocks(createBlockDocument(next));
    assert.equal(result.at(-1).type, "blank");
    assert.equal(result.at(-1).editable, true);
  }
});
test("G0.6B.1 ordered markers continue at the end; G0.6B.2 renumbers siblings", () => {
  for (const [source, expected] of [
    ["7. Seven\n", "7. Seven\n8. \n"],
    ["7) Seven\r\n", "7) Seven\r\n8) \r\n"]
  ]) {
    const block = editable(source)[0];
    assert.equal(block.list.style, "ordered");
    assert.equal(block.list.ordinal, 7);
    const op = planFlowEnter({ source, block, at: block.sourceEnd });
    assert.equal(source.slice(0, op.from) + op.text + source.slice(op.to), expected);
  }
  const src = "1. One\n2. Two\n";
  const block = editable(src)[0];
  const planned = planFlowEnter({ source: src, block, at: block.sourceEnd });
  assert.equal(planned.operation, "flow-enter-ordered-renumber");
  assert.equal(src.slice(0, planned.from) + planned.text + src.slice(planned.to),
    "1. One\n2. \n3. Two\n");
});
test("G0.6B.1 paragraph and heading Enter create a distinct prose block", () => {
  const cases = [
    ["Merhaba\n", "Merhaba\n\n", "paragraph"],
    ["Merhaba\r\n", "Merhaba\r\n\r\n", "paragraph"],
    ["Merhaba", "Mer\n\nhaba", "paragraph", 3],
    ["# Başlık\n", "# Başlık\n\n", "heading"]
  ];
  for (const [source, expected, kind, atInput] of cases) {
    const block = editable(source).find(b => b.type === kind);
    const op = planFlowEnter({ source, block,
      at: atInput ?? block.sourceEnd });
    const next = source.slice(0, op.from) + op.text + source.slice(op.to);
    assert.equal(next, expected);
    assert.ok(projectFlowBlocks(createBlockDocument(next)).some(b => b.type === "blank"));
  }
});
test("G0.6B.4 rich Enter preserves safe marked list content and guards opaque blocks", () => {
  const src = "- **kalın**\n\n:::efss.secret\nprivate: X\n:::\n";
  const blocks = projectFlowBlocks(createBlockDocument(src));
  const marked = blocks.find(b => b.type === "list_item");
  const at = src.indexOf("kalın") + "kalın".length;
  const op = planFlowEnter({ source: src, block: marked, at });
  const next = src.slice(0, op.from) + op.text + src.slice(op.to);
  assert.equal(next, "- **kalın**\n- \n\n:::efss.secret\nprivate: X\n:::\n");
  assert.equal(op.operation, "flow-enter-rich");
  assert.throws(() => planFlowEnter({ source: src,
    block: blocks.find(b => b.type === "extension_block"),
    at: src.indexOf("private") }), /INVALID_FLOW_ENTER/);
  const plain = "- 👩‍👧\r\n";
  const item = editable(plain)[0];
  assert.throws(() => planFlowEnter({ source: plain, block: item, at: 3 }),
    /INVALID_FLOW_ENTER/);
  assert.equal(next.slice(next.indexOf(":::efss.secret")), src.slice(src.indexOf(":::efss.secret")));
});

test("flow projection hides heading, list and quote delimiters without altering EFSS source", () => {
  const source = "# Başlık\n\n- Madde\n\n> Alıntı\n\nDüz metin 💡\n";
  const doc = createBlockDocument(source);
  const blocks = projectFlowBlocks(doc);
  assert.deepEqual(blocks.filter(b => b.editable && b.text).map(b => [b.type,b.text]), [
    ["heading","Başlık"], ["list_item","Madde"], ["quote","Alıntı"], ["paragraph","Düz metin 💡"]
  ]);
  assert.equal(blocks.find(b => b.type === "heading").sourceStart, 2);
  assert.equal(doc.blocks.map(b => b.raw).join(""), source);
});

test("editing visible paragraph changes only its source span and keeps adjacent raw bytes", () => {
  const source = "# Üst\r\n\r\nİçerik\r\n\r\n:::efss.secret\r\nid: x\r\n:::\r\n";
  const doc = createBlockDocument(source);
  const p = projectFlowBlocks(doc).find(b => b.type === "paragraph");
  const updated = editFlowText(doc, { id: p.id, text: "Güncel içerik" });
  assert.equal(updated.source, source.replace("İçerik", "Güncel içerik"));
  assert.equal(updated.source.includes(":::efss.secret\r\nid: x\r\n:::"), true);
  assert.equal(createBlockDocument(updated.source).source, updated.source);
  assert.equal(doc.source, source);
});

test("complex or unknown EFSS constructs are read-only in flow view, editable in source", () => {
  const source = [
    "Bu **kalın** bir metin.", "", "EFSS &Miktar{22}.", "",
    ":::efss.other", "whatever", ":::", "",
    "Birden çok", "satırlı paragraf", ""
  ].join("\n");
  const doc = createBlockDocument(source);
  const blocks = projectFlowBlocks(doc);
  assert.equal(blocks.find(b => b.type === "extension_block").editable, false);
  const marked = blocks.find(b => b.text.includes("kalın"));
  assert.equal(marked.editable, true);
  assert.equal(marked.inline.runs.some(run => run.marks.includes("strong")), true);
  assert.equal(blocks.find(b => b.text.includes("&Miktar")).editable, false);
  assert.equal(blocks.some(b => !b.editable && b.raw.includes("satırlı paragraf")), true);
  for (const block of blocks.filter(b => !b.editable))
    assert.throws(() => editFlowText(doc, { id: block.id, text: "override" }),
      /FLOW_BLOCK_READ_ONLY/);
});

test("callout insertion creates real EFSS source but presents an editable visual card", () => {
  const raw = calloutMarkdown("warning");
  const doc = createBlockDocument(raw);
  const card = projectFlowBlocks(doc).find(b => b.type === "callout");
  assert.ok(card);
  assert.equal(card.variant, "warning");
  assert.equal(card.icon, "⚠️");
  assert.equal(card.title, "Uyarı");
  assert.equal(card.text, "");
  assert.equal(card.editable, true);
  const modified = editFlowText(doc, { id: card.id, text: "Dosyaları **yedekle**." });
  assert.equal(modified.source.includes("Dosyaları **yedekle**."), true);
  const next = projectFlowBlocks(modified);
  assert.equal(next.find(b => b.type === "callout").text, "Dosyaları yedekle.");
  assert.equal(next.find(b => b.type === "callout").editable, true);
  assert.throws(() => editFlowText(modified, {
    id: next.find(b => b.type === "callout").id, text: "silme"
  }), /FLOW_MARKED_REQUIRES_TRANSACTION/);
  assert.equal(doc.source, raw);
});

test("callouts never claim to edit nested blocks or unsupported attributes", () => {
  assert.throws(() => calloutMarkdown("javascript:"), /INVALID_CALLOUT_TYPE/);
  const nested = [
    ':::efss.callout type=info icon="ℹ️" title="Bilgi"',
    "- item", "", "more", ":::",""
  ].join("\n");
  const doc = createBlockDocument(nested);
  assert.equal(projectFlowBlocks(doc).find(b => b.type === "callout").editable, false);
  const malformed = createBlockDocument(':::efss.callout onclick="bad"\nunsafe\n:::\n');
  const block = projectFlowBlocks(malformed).find(b => b.type === "extension_block");
  assert.equal(block.editable, false);
});

test("visual insert uses CRLF consistently and preserves existing original records", () => {
  const source = "# Başlangıç\r\n\r\nSon satır\r\n";
  const doc = createBlockDocument(source);
  const head = doc.blocks[0];
  const added = insertFlowBlock(doc, { afterId: head.id, kind: "callout", variant: "tip" });
  assert.equal(added.source.startsWith("# Başlangıç\r\n\r\n:::efss.callout"), true);
  assert.equal(added.source.includes('type=tip icon="💡" title="İpucu"'), true);
  assert.equal(added.source.endsWith("Son satır\r\n"), true);
  assert.equal(projectFlowBlocks(added).find(b => b.type === "callout").editable, true);
  assert.equal(doc.source, source);
});

test("empty source has an editable placeholder and creates a real paragraph after typing", () => {
  const doc = createBlockDocument("");
  const one = projectFlowBlocks(doc);
  assert.equal(one.length, 1);
  assert.equal(one[0].virtual, true);
  assert.equal(one[0].editable, true);
  const filled = editFlowText(doc, { id: one[0].id, text: "Merhaba" });
  assert.equal(filled.source, "Merhaba");
  assert.equal(projectFlowBlocks(filled)[0].text, "Merhaba");
  const callout = insertFlowBlock(doc, { kind: "callout" });
  assert.equal(projectFlowBlocks(callout).some(b => b.type === "callout"), true);
});

test("slash commands are specific, Turkish-aware, and do not infer unrelated strings", () => {
  assert.deepEqual(slashFlowCommand("/callout"), { kind: "callout", variant: "info" });
  assert.deepEqual(slashFlowCommand("/uyarı"), { kind: "callout", variant: "warning" });
  assert.deepEqual(slashFlowCommand("/h1"), { kind: "heading" });
  assert.deepEqual(slashFlowCommand("/liste"), { kind: "list_item" });
  assert.equal(slashFlowCommand("/other"), null);
  assert.equal(slashFlowCommand("hello /callout"), null);
});

test("concurrent structural command rejects old revisions and unauthorized variants", () => {
  const doc = createBlockDocument("Hello");
  assert.throws(() => insertFlowBlock(doc, { kind: "callout", variant: "fake" }),
    /INVALID_CALLOUT_TYPE/);
  assert.throws(() => insertFlowBlock(doc, { kind: "script" }),
    /UNSUPPORTED_FLOW_BLOCK/);
  assert.throws(() => insertFlowBlock(doc, { expectedVersion: 7 }),
    /BLOCK_VERSION_CONFLICT/);
  assert.throws(() => editFlowText(doc, { id: "fake", text: "x" }),
    /FLOW_BLOCK_NOT_FOUND/);
  const existing = projectFlowBlocks(doc)[0];
  assert.throws(() => editFlowText(doc, { id: existing.id, text: "a\nb" }),
    /INVALID_FLOW_TEXT/);
});

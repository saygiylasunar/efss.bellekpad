import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownAst, serializeMarkdownAst } from "../src/ast.js";
import { createBlockDocument } from "../src/editor-block-model.js";
import { projectFlowBlocks, insertFlowBlock } from "../src/editor-flow-model.js";
import { parsePipeTable, tableHeaderColumns } from "../src/pipe-table-parser.js";
import { planTableCellEdit, planTableAppendRow } from "../src/editor-table-model.js";
import { TextEditorSession } from "../src/editor-text-engine.js";

const table = eol => [
  "| Başlık 1 | Başlık 2 | Başlık 3 |",
  "| --- | :---: | ---: |",
  "| A | B | C |",
  "|  |  |  |"
].join(eol) + eol;
const fixture = eol => "# Önce" + eol + eol + table(eol) +
  eol + ":::efss.private" + eol + "secret: 👩‍👧" + eol + ":::" + eol;
const read = source => {
  const document = createBlockDocument(source);
  const block = projectFlowBlocks(document).find(b => b.type === "table");
  assert.ok(block?.table);
  return {document,block};
};

test("G0.7A AST recognizes only qualified pipe header, divider and body", () => {
  for(const eol of ["\n","\r\n","\r"]) {
    const source=fixture(eol),ast=parseMarkdownAst(source);
    assert.equal(serializeMarkdownAst(ast),source);
    const b=ast.blocks.find(b=>b.type==="table");
    assert.ok(b,source);
    assert.equal(b.columns,3);
    assert.equal(b.raw,table(eol));
    const parsed=parsePipeTable(b.raw,b.start);
    assert.equal(parsed.columns,3);
    assert.equal(parsed.rows.length,3); // header + 2 data
    assert.deepEqual(parsed.rows[1].cells.map(c=>c.text),["A","B","C"]);
    assert.deepEqual(parsed.rows[2].cells.map(c=>c.text),["","",""]);
    for(const row of parsed.rows)for(const cell of row.cells)
      assert.equal(source.slice(cell.start,cell.end),cell.text);
    assert.ok(ast.blocks.some(b=>b.type==="extension_block"));
  }
  assert.equal(tableHeaderColumns("| a | b |","| --- | --- |"),2);
  assert.equal(tableHeaderColumns("| a | b |","| --- |"),0);
  for(const source of [
    "| a | b |\n| no separator | well |\n| c | d |",
    "| a | b |\n| --- | --- |",
    "A | B\n--- | ---\n1 | 2",
    "Normal text with a | pipe."
  ]) assert.equal(parseMarkdownAst(source).blocks.some(b=>b.type==="table"),false,source);
});

test("G0.7A inserting 3×3 visible table retains unrelated bytes", () => {
  const original="# Başlık\n\n:::efss.hidden\nprivate: 1\n:::\n";
  const doc=createBlockDocument(original);
  const heading=doc.blocks.find(b=>b.type==="heading");
  const updated=insertFlowBlock(doc,{afterId:heading.id,kind:"table"});
  assert.ok(updated.source.startsWith("# Başlık\n\n| Başlık 1 |"));
  assert.equal(updated.source.slice(updated.source.indexOf(":::efss.hidden")),
    original.slice(original.indexOf(":::efss.hidden")));
  const parsed=projectFlowBlocks(updated).find(b=>b.type==="table");
  assert.equal(parsed.table.columns,3);
  assert.equal(parsed.table.rows.length,3);
  assert.equal(updated.blocks.map(b=>b.raw).join(""),updated.source);
});

test("G0.7A cell editing is one source transaction; Undo/Redo and unicode safe", () => {
  for(const eol of ["\n","\r\n","\r"]) {
    const source=fixture(eol),{document,block}=read(source);
    const cell=block.table.rows[2].cells[1];
    const command=planTableCellEdit({
      source,document,block,row:2,col:1,from:cell.start,text:"İzmir 🐟"
    });
    const session=new TextEditorSession({text:source});
    session.dispatch(command);
    const expected=source.slice(0,cell.start)+"İzmir 🐟"+source.slice(cell.start);
    assert.equal(session.snapshot.text,expected);
    assert.equal(session.snapshot.selection.focus.offset,cell.start+"İzmir 🐟".length);
    assert.deepEqual(read(expected).block.table.rows[2].cells.map(c=>c.text),
      ["","İzmir 🐟",""]);
    assert.equal(expected.slice(expected.indexOf(":::efss.private")),
      source.slice(source.indexOf(":::efss.private")));
    session.undo();assert.equal(session.snapshot.text,source);
    session.redo();assert.equal(session.snapshot.text,expected);
  }
});

test("G0.7A Tab at final table cell may append one blank row safely", () => {
  for(const eol of ["\n","\r\n","\r"]) {
    const source=fixture(eol),{document,block}=read(source);
    const plan=planTableAppendRow({source,document,block});
    const session=new TextEditorSession({text:source});
    session.dispatch(plan);
    const next=read(session.snapshot.text).block;
    assert.equal(next.table.rows.length,4);
    assert.equal(next.table.columns,3);
    assert.equal(next.table.rows[3].cells[0].text,"");
    assert.deepEqual(plan.focus,{row:3,col:0});
    assert.equal(session.snapshot.selection.focus.offset,next.table.rows[3].cells[0].start);
    assert.equal(session.snapshot.text.slice(session.snapshot.text.indexOf(":::efss.private")),
      source.slice(source.indexOf(":::efss.private")));
    session.undo();assert.equal(session.snapshot.text,source);
    session.redo();assert.equal(read(session.snapshot.text).block.table.rows.length,4);
  }
});

test("G0.7A unsafe table edits and stale projections never alter source", () => {
  const source=fixture("\n"),{document,block}=read(source);
  const cell=block.table.rows[1].cells[0];
  for(const text of ["|","X\nY","X\rY","\\|","**bold**","~"+"~x"+"~"+"~"]) {
    assert.throws(()=>planTableCellEdit({
      source,document,block,row:1,col:0,from:cell.start,text
    }),/TABLE_CELL_UNSUPPORTED_EDIT/,text);
  }
  assert.throws(()=>planTableCellEdit({
    source,document,block,row:10,col:0,from:cell.start,text:"x"
  }),/TABLE_CELL_UNSUPPORTED_EDIT/);
  assert.throws(()=>planTableCellEdit({
    source,document,block,row:1,col:0,from:cell.start-1,text:"x"
  }),/TABLE_CELL_INVALID_RANGE/);
  assert.throws(()=>planTableCellEdit({
    source:source.replace("Başlık 1","Başka"),document,block,
    row:1,col:0,from:cell.start,text:"x"
  }),/TABLE_STALE_SOURCE/);
  assert.equal(document.source,source);
  assert.equal(parsePipeTable("| a | b |\n| --- | --- |\n",0),null);
});

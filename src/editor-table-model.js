// G0.7A — source-owned table cell transaction planner.
import { parsePipeTable } from "./pipe-table-parser.js";
import { isGraphemeBoundary, collapsedSelection } from "./editor-text-engine.js";
import { reconcileBlockSource } from "./editor-block-model.js";
function fail(code) { throw new Error(code); }
function eolOf(source) { return source.match(/\r\n|\r|\n/)?.[0] ?? "\n"; }
function checkActive(source,document,block) {
  if(typeof source!=="string"||document?.source!==source||
     !Array.isArray(document?.blocks)||block?.type!=="table"||
     source.slice(block.start,block.end)!==block.raw)fail("TABLE_STALE_SOURCE");
  const original=document.blocks.find(b=>b.id===block.id);
  if(!original||original.type!=="table"||original.raw!==block.raw||
     original.start!==block.start||original.end!==block.end)fail("TABLE_STALE_SOURCE");
  const model=parsePipeTable(block.raw,block.start);
  if(!model)fail("TABLE_UNSUPPORTED_SOURCE");
  return model;
}
export function planTableCellEdit({
  source,document,block,row,col,from,to=from,text=""
}={}) {
  const model=checkActive(source,document,block);
  if(!Number.isInteger(row)||!Number.isInteger(col)||row<0||col<0||
     row>=model.rows.length||col>=model.columns||
     typeof text!=="string"||/[\r\n|\\\0]/.test(text)||
     text.includes("**")||text.includes("~~")||
     text.includes(String.fromCharCode(96)))
    fail("TABLE_CELL_UNSUPPORTED_EDIT");
  const cell=model.rows[row].cells[col];
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
     from<cell.start||to>cell.end||from>to||
     !isGraphemeBoundary(source,from)||!isGraphemeBoundary(source,to))
    fail("TABLE_CELL_INVALID_RANGE");
  const intended=source.slice(cell.start,from)+text+source.slice(to,cell.end);
  if(/^[ \t]|[ \t]$/.test(intended))fail("TABLE_CELL_WHITESPACE_BOUNDARY");
  const candidate=source.slice(0,from)+text+source.slice(to);
  const next=reconcileBlockSource(document,candidate);
  const blockAfter=next.blocks.find(b=>b.type==="table"&&b.start===block.start);
  const parsed=blockAfter&&parsePipeTable(blockAfter.raw,blockAfter.start);
  if(!parsed||parsed.columns!==model.columns||parsed.rows.length!==model.rows.length||
     blockAfter.end!==block.end+candidate.length-source.length)
    fail("TABLE_REPARSE_FAILED");
  for(let r=0;r<parsed.rows.length;r++)for(let c=0;c<parsed.columns;c++) {
    const expected=r===row&&c===col?intended:model.rows[r].cells[c].text;
    if(parsed.rows[r].cells[c].text!==expected)fail("TABLE_REPARSE_FAILED");
  }
  return Object.freeze({type:"replaceRange",from,to,text,
    selectionAfter:collapsedSelection(from+text.length),operation:"table-cell-edit"});
}
export function planTableAppendRow({source,document,block}={}) {
  const model=checkActive(source,document,block);
  if(model.rows.length>=100)fail("TABLE_ROW_LIMIT");
  const eol=eolOf(block.raw),prefix=/(?:\r\n|\r|\n)$/.test(block.raw)?"":eol;
  const empty="| "+Array(model.columns).fill(" ").join(" | ")+" |"+eol;
  const from=block.end,text=prefix+empty,candidate=source.slice(0,from)+text+source.slice(from);
  const next=reconcileBlockSource(document,candidate);
  const target=next.blocks.find(b=>b.type==="table"&&b.start===block.start);
  const parsed=target&&parsePipeTable(target.raw,target.start);
  if(!parsed||parsed.rows.length!==model.rows.length+1||
     parsed.columns!==model.columns||target.end!==block.end+text.length)
    fail("TABLE_REPARSE_FAILED");
  for(let r=0;r<model.rows.length;r++)for(let c=0;c<model.columns;c++)
    if(parsed.rows[r].cells[c].text!==model.rows[r].cells[c].text)
      fail("TABLE_REPARSE_FAILED");
  return Object.freeze({type:"replaceRange",from,to:from,text,
    selectionAfter:collapsedSelection(parsed.rows.at(-1).cells[0].start),
    operation:"table-append-row",
    focus:Object.freeze({row:parsed.rows.length-1,col:0})});
}

/**
 * G0.7B: explicit, lossless deletion of the last *body* row.
 * Header and the final body row are structurally protected. A whole source
 * line is removed atomically; all remaining cells must reparse identically.
 */
export function planTableDeleteLastRow({source,document,block}={}) {
  const model=checkActive(source,document,block);
  if(model.rows.length<=2)fail("TABLE_LAST_BODY_ROW_REQUIRED");
  const last=model.rows.at(-1);
  if(last.header || last.start < block.start || last.end > block.end)
    fail("TABLE_DELETE_ROW_INVALID_BOUNDARY");
  const from=last.start,to=last.end,text="";
  const candidate=source.slice(0,from)+source.slice(to);
  const next=reconcileBlockSource(document,candidate);
  const target=next.blocks.find(b=>b.type==="table"&&b.start===block.start);
  const parsed=target&&parsePipeTable(target.raw,target.start);
  if(!parsed || parsed.columns!==model.columns ||
      parsed.rows.length!==model.rows.length-1 ||
      target.end!==block.end-(to-from))
    fail("TABLE_DELETE_ROW_REPARSE_FAILED");
  for(let r=0;r<parsed.rows.length;r++)for(let c=0;c<parsed.columns;c++)
    if(parsed.rows[r].cells[c].text!==model.rows[r].cells[c].text)
      fail("TABLE_DELETE_ROW_REPARSE_FAILED");
  const keep=parsed.rows.at(-1);
  return Object.freeze({
    type:"replaceRange",from,to,text,
    selectionAfter:collapsedSelection(keep.cells[0].start),
    operation:"table-delete-last-row",
    focus:Object.freeze({row:keep.index,col:0})
  });
}

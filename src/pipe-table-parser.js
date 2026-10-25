// G0.7A — conservative, source-accurate GFM-style pipe table surface.
// EFSS Markdown remains authoritative, with no secondary cell database.

function fail(code) { throw new Error(code); }
function eolOf(source) { return source.match(/\r\n|\r|\n/)?.[0] ?? "\n"; }
function linesOf(raw,start) {
  const lines=[];let cursor=0;
  for(const match of raw.matchAll(/\r\n|\r|\n/g)) {
    lines.push({text:raw.slice(cursor,match.index),start:start+cursor,
      end:start+match.index+match[0].length,eol:match[0]});
    cursor=match.index+match[0].length;
  }
  if(cursor<raw.length)lines.push({text:raw.slice(cursor),start:start+cursor,
    end:start+raw.length,eol:""});
  return lines;
}
function cellsOf(line) {
  if(!line.startsWith("|") || !/\|[ \t]*$/.test(line) ||
     line.includes("\\") || line.includes("\0"))return null;
  const final=line.lastIndexOf("|");
  if(final<=1||line.slice(final+1).trim())return null;
  const inner=line.slice(1,final),parts=inner.split("|");
  if(parts.length<2||parts.length>12)return null;
  let cursor=1;
  return parts.map(part=>{
    const left=/^[ \t]*/.exec(part)[0].length;
    const right=/[ \t]*$/.exec(part)[0].length;
    const end=Math.max(left,part.length-right);
    const cell={text:part.slice(left,end),from:cursor+left,to:cursor+end};
    cursor+=part.length+1;
    return cell;
  });
}
function separatorCells(line) {
  const cells=cellsOf(line);
  return cells&&cells.every(c=>/^:?-{3,}:?$/.test(c.text))?cells:null;
}
export function pipeRowColumns(line) { return cellsOf(line)?.length ?? 0; }
export function tableHeaderColumns(header,separator) {
  const one=cellsOf(header),two=separatorCells(separator);
  return one&&two&&one.length===two.length?one.length:0;
}
export function parsePipeTable(raw,start=0) {
  if(typeof raw!=="string"||!Number.isSafeInteger(start)||start<0)
    fail("INVALID_PIPE_TABLE");
  const lines=linesOf(raw,start);
  if(lines.length<3||lines.length>102||
     !tableHeaderColumns(lines[0].text,lines[1].text))return null;
  const columns=tableHeaderColumns(lines[0].text,lines[1].text),rows=[];
  for(let i=0;i<lines.length;i++) {
    const line=lines[i],cells=cellsOf(line.text);
    if(!cells||cells.length!==columns||
       (i===1&&!separatorCells(line.text))||
       (i!==1&&cells.some(c=>/(?:\*\*|~~)/.test(c.text)||
          c.text.includes(String.fromCharCode(96)))))return null;
    if(i===1)continue;
    rows.push(Object.freeze({index:rows.length,header:i===0,
      start:line.start,end:line.end,
      cells:Object.freeze(cells.map((c,col)=>Object.freeze({
        row:rows.length,col,text:c.text,
        start:line.start+c.from,end:line.start+c.to
      })))
    }));
  }
  if(rows.length<2)return null;
  return Object.freeze({columns,rows:Object.freeze(rows),eol:lines[0].eol||eolOf(raw)});
}

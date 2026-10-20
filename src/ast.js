import { InlineRules } from "./inline-rules.js";
import { scanSemantics } from "./semantics.js";

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const DIRECTIVE = /^ {0,3}::[a-z][a-z0-9_-]*(?:\s|$)/;
const EXTENSION = /^ {0,3}:::efss\.[a-z][a-z0-9_.-]*(?:\s|$)/;
const LIST = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/;
const QUOTE = /^ {0,3}>[ \t]?/;
const BREAK = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;

function readLines(source) {
  const lines = [];
  let begin = 0;
  for (const match of source.matchAll(/\r\n|\n|\r/g)) {
    const end = match.index + match[0].length;
    lines.push({ text: source.slice(begin, match.index), start: begin, end });
    begin = end;
  }
  if (begin < source.length) lines.push({ text: source.slice(begin), start: begin, end: source.length });
  return lines;
}

function classify(text) {
  if (!text.trim()) return { type: "blank" };
  const fence = FENCE.exec(text);
  if (fence) return { type: "code_fence", marker: fence[1], info: fence[2].trim() };
  if (EXTENSION.test(text)) return { type: "extension_block" };
  const heading = HEADING.exec(text);
  if (heading) return { type: "heading", level: heading[1].length, prefix: heading[0].length };
  if (BREAK.test(text)) return { type: "thematic_break" };
  if (DIRECTIVE.test(text)) return { type: "directive" };
  const list = LIST.exec(text);
  if (list) return { type: "list_item", prefix: list[0].length };
  const quote = QUOTE.exec(text);
  if (quote) return { type: "quote", prefix: quote[0].length };
  if (/^( {4}|\t)/.test(text)) return { type: "indented_code" };
  return { type: "paragraph" };
}

function matchClosing(text, from, marker) {
  let at = from;
  while (at < text.length) {
    if (text[at] === "\\") { at += 2; continue; }
    if (text[at] === "`") {
      const end = readCode(text, at);
      if (end >= 0) { at = end; continue; }
    }
    if (text.startsWith(marker, at) && !/\s/.test(text[at - 1])) {
      if (marker.length !== 1 || (text[at - 1] !== marker && text[at + 1] !== marker)) return at;
    }
    at++;
  }
  return -1;
}

function readCode(text, at) {
  let run = 1;
  while (text[at + run] === "`") run++;
  const marker = "`".repeat(run);
  let cursor = at + run;
  while ((cursor = text.indexOf(marker, cursor)) >= 0) {
    if (text[cursor - 1] !== "`" && text[cursor + run] !== "`") return cursor + run;
    cursor += run;
  }
  return -1;
}

export function parseInline(source, base = 0, rules = createDefaultRules(), depth = 0) {
  if (typeof source !== "string" || !Number.isSafeInteger(base) || base < 0 ||
      !(rules instanceof InlineRules)) throw new TypeError("Invalid inline input");
  const result = [];
  const definitions = rules.list();
  let cursor = 0;
  let textStart = 0;

  function flush(end) {
    if (end > textStart) result.push({ type: "text", start: base + textStart,
      end: base + end, raw: source.slice(textStart, end) });
  }

  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += Math.min(2, source.length - cursor);
      continue;
    }
    if (source[cursor] === "`") {
      const end = readCode(source, cursor);
      if (end > cursor) {
        flush(cursor);
        result.push({ type: "inline_code", start: base + cursor,
          end: base + end, raw: source.slice(cursor, end) });
        cursor = end;
        textStart = cursor;
        continue;
      }
    }
    if (depth < 32) {
      const found = definitions.find(rule => source.startsWith(rule.marker, cursor));
      if (found) {
        const contentStart = cursor + found.marker.length;
        const close = matchClosing(source, contentStart, found.marker);
        if (close > contentStart && !/\s/.test(source[contentStart]) && source.slice(contentStart, close).trim()) {
          flush(cursor);
          const end = close + found.marker.length;
          result.push({ type: "mark", rule: found.name, start: base + cursor,
            end: base + end, raw: source.slice(cursor, end),
            children: parseInline(source.slice(contentStart, close), base + contentStart, rules, depth + 1) });
          cursor = end;
          textStart = cursor;
          continue;
        }
      }
    }
    cursor++;
  }
  flush(source.length);
  return result;
}

function createDefaultRules() {
  return new InlineRules();
}

export function parseMarkdownAst(source, { rules = createDefaultRules() } = {}) {
  if (typeof source !== "string" || !(rules instanceof InlineRules)) {
    throw new TypeError("Invalid markdown input");
  }
  const lines = readLines(source);
  const blocks = [];
  const diagnostics = [];
  let i = 0;

  while (i < lines.length) {
    const begin = i;
    const kind = classify(lines[i].text);
    let end = i + 1;
    let closed = true;

    if (kind.type === "code_fence") {
      const char = kind.marker[0];
      const length = kind.marker.length;
      while (end < lines.length) {
        const close = FENCE.exec(lines[end].text);
        if (close && close[1][0] === char && close[1].length >= length && !close[2].trim()) {
          end++;
          break;
        }
        end++;
      }
      const last = lines[end - 1].text;
      const check = FENCE.exec(last);
      closed = end > begin + 1 && !!check && check[1][0] === char &&
        check[1].length >= length && !check[2].trim();
    } else if (kind.type === "extension_block") {
      while (end < lines.length && !/^ {0,3}:::[ \t]*$/.test(lines[end].text)) end++;
      closed = end < lines.length;
      if (closed) end++;
    } else if (kind.type === "blank" || kind.type === "indented_code") {
      while (end < lines.length && classify(lines[end].text).type === kind.type) end++;
    } else if (kind.type === "paragraph") {
      while (end < lines.length && classify(lines[end].text).type === "paragraph") end++;
    }

    const start = lines[begin].start;
    const finish = lines[end - 1].end;
    const block = { type: kind.type, start, end: finish, raw: source.slice(start, finish) };
    if (kind.type === "heading") block.level = kind.level;
    if (kind.type === "code_fence") block.info = kind.info;
    if (kind.type === "code_fence" || kind.type === "extension_block") {
      block.closed = closed;
      if (!closed) diagnostics.push({ code: "UNCLOSED_BLOCK", type: kind.type, start });
    }
    if (["heading", "paragraph", "list_item", "quote"].includes(kind.type)) {
      const prefix = kind.prefix ?? 0;
      const inlineSource = block.raw.slice(prefix).replace(/(?:\r\n|\r|\n)$/, "");
      block.inline = parseInline(inlineSource, start + prefix, rules);
    }
    blocks.push(block);
    i = end;
  }

  const excluded = new Set(["code_fence", "extension_block", "indented_code"]);
  const semantics = scanSemantics(source);
  const belongs = token => blocks.find(block =>
    token.start >= block.start && token.end <= block.end && !excluded.has(block.type));
  for (const block of blocks) block.symbols = semantics.tokens.filter(token => belongs(token) === block);
  diagnostics.push(...semantics.diagnostics.filter(token =>
    blocks.some(block => token.start >= block.start && token.start < block.end && !excluded.has(block.type))));
  return { type: "document", source, blocks, diagnostics };
}

export function serializeMarkdownAst(ast) {
  if (!ast || ast.type !== "document" || typeof ast.source !== "string" ||
      !Array.isArray(ast.blocks)) throw new TypeError("Invalid AST");
  let at = 0;
  for (const block of ast.blocks) {
    if (block.start !== at || block.end < at ||
        block.raw !== ast.source.slice(block.start, block.end)) throw new Error("Invalid AST ranges");
    at = block.end;
  }
  if (at !== ast.source.length) throw new Error("Incomplete AST");
  return ast.blocks.map(block => block.raw).join("");
}

function safeBoundary(source, at) {
  if (at <= 0 || at >= source.length) return true;
  const before = source.charCodeAt(at - 1);
  const after = source.charCodeAt(at);
  return !(before === 13 && after === 10) &&
    !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

export function editMarkdownAst(ast, edits, options = {}) {
  const source = serializeMarkdownAst(ast);
  if (!Array.isArray(edits)) throw new TypeError("Edits must be an array");
  let previous = 0;
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const edit of ordered) {
    if (!Number.isSafeInteger(edit?.start) || !Number.isSafeInteger(edit?.end) ||
        edit.start < previous || edit.end < edit.start || edit.end > source.length ||
        typeof edit.text !== "string" || !safeBoundary(source, edit.start) ||
        !safeBoundary(source, edit.end)) throw new Error("Invalid or overlapping edit");
    previous = edit.end;
  }
  let result = source;
  for (const edit of ordered.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return parseMarkdownAst(result, options);
}

// EFSS Markdown positional variable bindings. Independent of the editor, AST and AI runtime.
// This module parses syntax only. Nothing here modifies a variable or document.
export const BINDING_SYNTAX_VERSION = "0.1.0-draft";
const MAX_BINDING_CHARS = 8192;
const MAX_ITEMS = 64;

function parseItem(line, start, end, offset) {
  let a = start;
  let b = end;
  while (a < b && /\s/u.test(line[a])) a++;
  while (b > a && /\s/u.test(line[b - 1])) b--;
  if (a === b) throw new Error("EMPTY_BINDING_VALUE");
  const raw = line.slice(a, b);
  let value;
  let quoted = false;
  if (raw.startsWith('"')) {
    quoted = true;
    try { value = JSON.parse(raw); }
    catch { throw new Error("INVALID_BINDING_STRING"); }
    if (typeof value !== "string") throw new Error("INVALID_BINDING_STRING");
  } else {
    // Quotes, braces and backslashes require JSON-style quotation.
    if (/["{}\\]/u.test(raw)) throw new Error("INVALID_BINDING_ATOM");
    value = raw.normalize("NFC");
  }
  return Object.freeze({ value, quoted, raw, start: offset + a, end: offset + b });
}

/**
 * @param {string} line - One physical source line, without CR/LF.
 * @param {number} open - UTF-16 position of '{' directly after &Variable.
 * @param {number} offset - Source-body offset of this line.
 * @returns {{ binding?: object, end: number, error?: string }}
 */
export function readVariableBinding(line, open, offset = 0) {
  if (typeof line !== "string" || !Number.isSafeInteger(open) || open < 0 ||
      line[open] !== "{" || !Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError("Invalid binding location");
  }
  let cursor = open + 1;
  let insideString = false;
  let escaped = false;
  let partStart = cursor;
  const items = [];
  let error = null;
  for (; cursor < line.length; cursor++) {
    if (cursor - open > MAX_BINDING_CHARS) {
      error = "BINDING_TOO_LONG";
      break;
    }
    const char = line[cursor];
    if (insideString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') insideString = false;
      continue;
    }
    if (char === '"') { insideString = true; continue; }
    if (char === "{") { error = "NESTED_BINDING_NOT_SUPPORTED"; break; }
    if (char !== "," && char !== "}") continue;
    if (items.length >= MAX_ITEMS) { error = "BINDING_TOO_MANY_VALUES"; break; }
    try { items.push(parseItem(line, partStart, cursor, offset)); }
    catch (failure) { error = failure.message; break; }
    if (char === "}") {
      return {
        binding: Object.freeze({ kind: "positional-values", syntaxVersion: BINDING_SYNTAX_VERSION,
          values: Object.freeze(items), start: offset + open, end: offset + cursor + 1 }),
        end: cursor + 1
      };
    }
    partStart = cursor + 1;
  }
  // Fail closed: malformed values never silently degrade into a reference.
  const closing = line.indexOf("}", cursor);
  return { end: closing >= 0 ? closing + 1 : line.length,
    error: error ?? (insideString ? "UNCLOSED_BINDING_STRING" : "UNCLOSED_VARIABLE_BINDING") };
}

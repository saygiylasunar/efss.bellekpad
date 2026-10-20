import { EFSS_CONTRACT } from "./contract.js";

export const SEMANTIC_GRAMMAR = EFSS_CONTRACT.grammarVersion;

const REF = /^&([\p{L}_][\p{L}\p{M}\p{N}_-]*)/u;
const WIKI = new RegExp(`^\\[\\[(${EFSS_CONTRACT.kinds.join("|")}):([A-Za-z][A-Za-z0-9_-]{0,127})\\]\\]`);
const ACTIONS = new Set(EFSS_CONTRACT.actions);

export function normalizeAlias(value) {
  if (typeof value !== "string") throw new TypeError("Expected an alias");
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("tr-TR");
}

export function parseTarget(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Empty target");
  const raw = value.trim();
  if (raw.startsWith('"')) {
    let alias;
    try { alias = JSON.parse(raw); } catch { throw new Error("Invalid quoted target"); }
    if (typeof alias !== "string" || !alias.trim()) throw new Error("Invalid quoted target");
    return { type: "alias", value: alias.normalize("NFC") };
  }
  const wiki = WIKI.exec(raw);
  if (wiki && wiki[0].length === raw.length) return { type: "id", kind: wiki[1], id: wiki[2] };
  const variable = REF.exec(raw);
  if (variable && variable[0].length === raw.length) {
    return { type: "variable", value: variable[1].normalize("NFC") };
  }
  if (/^[\p{L}_][\p{L}\p{M}\p{N}_-]*$/u.test(raw)) {
    return { type: "alias", value: raw.normalize("NFC") };
  }
  throw new Error("Use a typed reference, variable or JSON-quoted alias");
}

function readDirective(line) {
  const found = /^ {0,3}::([a-z][a-z0-9_-]*)(?:\s+(.*))?$/.exec(line);
  if (!found) return null;
  const [, action, argument = ""] = found;
  if (!ACTIONS.has(action)) throw new Error(`Unknown action: ${action}`);
  if (!argument.trim()) throw new Error(`Missing argument: ${action}`);
  if (action === "goal") {
    const parsed = parseTarget(argument);
    if (parsed.type !== "alias") throw new Error("Goal must be quoted text");
    if (!argument.trim().startsWith('"')) throw new Error("Goal must be quoted text");
    return { type: "directive", action, target: { type: "text", value: parsed.value } };
  }
  const target = parseTarget(argument);
  if (action === "scope" && target.type === "id" && target.kind !== "project") {
    throw new Error("Scope must reference a project");
  }
  if (action === "mode" && target.type === "id" && target.kind !== "mode") {
    throw new Error("Mode must reference a mode");
  }
  return { type: "directive", action, target };
}

function skipCodeRun(line, i) {
  let count = 1;
  while (line[i + count] === "`") count++;
  let at = i + count;
  while (at < line.length) {
    if (line[at] !== "`") { at++; continue; }
    let candidate = 1;
    while (line[at + candidate] === "`") candidate++;
    if (candidate === count) return at + candidate;
    at += candidate;
  }
  return i + count;
}

function skipDestination(line, at) {
  let depth = 1;
  let cursor = at + 2;
  while (cursor < line.length && depth) {
    if (line[cursor] === "\\") { cursor += 2; continue; }
    if (line[cursor] === "(") depth++;
    if (line[cursor] === ")") depth--;
    cursor++;
  }
  return depth === 0 ? cursor : at;
}

export function scanSemantics(body) {
  if (typeof body !== "string") throw new TypeError("Body must be a string");
  const tokens = [];
  const diagnostics = [];
  let fence = null;
  let offset = 0;
  const lines = body.split("\n");

  for (const [lineIndex, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.size &&
          marker[2].trim() === "") fence = null;
      offset += line.length + 1;
      continue;
    }
    if (marker) {
      fence = { char: marker[1][0], size: marker[1].length };
      offset += line.length + 1;
      continue;
    }
    if (/^( {4}|\t)/.test(line)) { offset += line.length + 1; continue; }

    const prefix = /^ {0,3}::([a-z][a-z0-9_-]*)/.exec(line);
    if (prefix) {
      try {
        const parsed = readDirective(line);
        if (!parsed) throw new Error("Malformed directive");
        tokens.push({ ...parsed, start: offset, end: offset + line.length, line: lineIndex + 1 });
      } catch (error) {
        diagnostics.push({ code: "BAD_DIRECTIVE", message: error.message, start: offset, line: lineIndex + 1 });
      }
      offset += line.length + 1;
      continue;
    }
    if (/^ {0,3}\\::/.test(line)) { offset += line.length + 1; continue; }

    let i = 0;
    while (i < line.length) {
      if (line[i] === "\\") { i += i + 1 < line.length ? 2 : 1; continue; }
      if (line[i] === "`") { i = skipCodeRun(line, i); continue; }
      if (line.startsWith("](", i)) {
        const end = skipDestination(line, i);
        if (end > i) { i = end; continue; }
      }
      if (/^https?:\/\//.test(line.slice(i))) {
        const gap = line.slice(i).search(/\s/);
        i = gap < 0 ? line.length : i + gap;
        continue;
      }
      if (line[i] === "<" && /^<(?:\/?[A-Za-z]|!|\?)/.test(line.slice(i))) {
        const end = line.indexOf(">", i + 1);
        if (end >= 0) { i = end + 1; continue; }
      }
      if (line.startsWith("[[", i)) {
        const found = WIKI.exec(line.slice(i));
        if (found) {
          tokens.push({ type: "link", target: { type: "id", kind: found[1], id: found[2] },
            start: offset + i, end: offset + i + found[0].length, line: lineIndex + 1 });
          i += found[0].length;
          continue;
        }
        const end = line.indexOf("]]", i + 2);
        if (end >= 0) {
          diagnostics.push({ code: "BAD_LINK", message: "Invalid typed reference", start: offset + i, line: lineIndex + 1 });
          i = end + 2;
          continue;
        }
      }
      if (line[i] === "&") {
        const match = REF.exec(line.slice(i));
        if (match && line[i + match[0].length] !== ";") {
          tokens.push({ type: "variable", target: { type: "variable", value: match[1].normalize("NFC") },
            start: offset + i, end: offset + i + match[0].length, line: lineIndex + 1 });
          i += match[0].length;
          continue;
        }
      }
      i++;
    }
    offset += line.length + 1;
  }
  return { tokens, diagnostics };
}

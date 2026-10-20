import { EFSS_CONTRACT } from "./contract.js";
import { scanSemantics } from "./semantics.js";
import { parseMarkdownAst } from "./ast.js";

export const FORMAT_VERSION = EFSS_CONTRACT.documentVersion;

const KEY = /^[a-z][a-z0-9_]*$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const KINDS = new Set(EFSS_CONTRACT.kinds);
const FIRST = ["efss_version", "kind", "id"];

function validate(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Invalid metadata");
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!KEY.test(key) || typeof value !== "string") {
      throw new TypeError("Invalid metadata entry");
    }
  }
  if (metadata.efss_version !== FORMAT_VERSION) throw new Error("Unsupported EFSS version");
  if (!KINDS.has(metadata.kind)) throw new Error("Unsupported document kind");
  if (!ID.test(metadata.id ?? "")) throw new Error("Invalid document id");
}

function parseValue(source) {
  if (source.startsWith('"')) {
    let value;
    try { value = JSON.parse(source); } catch { throw new Error("Invalid metadata scalar"); }
    if (typeof value !== "string") throw new Error("Invalid metadata scalar");
    return value;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(source)) throw new Error("Invalid metadata scalar");
  return source;
}

export function scanReferences(body) {
  return scanSemantics(body).tokens
    .filter(token => token.type === "variable")
    .map(token => ({ key: token.target.value, start: token.start, end: token.end }));
}

export function parseDocument(source) {
  if (typeof source !== "string") throw new TypeError("Document must be a string");
  const normalized = source.replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match) throw new Error("Missing EFSS envelope");
  const metadata = Object.create(null);
  for (const line of match[1].split("\n")) {
    const entry = /^([a-z][a-z0-9_]*):[ \t]*(.+)$/.exec(line);
    if (!entry || Object.hasOwn(metadata, entry[1])) throw new Error("Invalid EFSS envelope");
    metadata[entry[1]] = parseValue(entry[2]);
  }
  validate(metadata);
  const body = normalized.slice(match[0].length);
  return { metadata, body, references: scanReferences(body) };
}

export function parseDocumentAst(source, options = {}) {
  const document = parseDocument(source);
  return { ...document, ast: parseMarkdownAst(document.body, options) };
}

export function serializeDocument({ metadata, body }) {
  validate(metadata);
  if (typeof body !== "string") throw new TypeError("Body must be a string");
  const fields = [...FIRST, ...Object.keys(metadata).filter(key => !FIRST.includes(key)).sort()];
  const lines = fields.map(key => key + ": " + JSON.stringify(metadata[key]));
  return "---\n" + lines.join("\n") + "\n---\n" + body.replace(/\r\n?/g, "\n");
}

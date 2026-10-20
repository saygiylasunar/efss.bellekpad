export const FORMAT_VERSION = "0.1.0";

const TICK = String.fromCharCode(96);
const REF = /^&([\p{L}_][\p{L}\p{M}\p{N}_-]*)/u;
const KEY = /^[a-z][a-z0-9_]*$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const KINDS = new Set(["paper", "conversation"]);
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
  if (metadata.efss_version !== FORMAT_VERSION) {
    throw new Error("Unsupported EFSS version");
  }
  if (!KINDS.has(metadata.kind)) {
    throw new Error("Unsupported document kind");
  }
  if (!ID.test(metadata.id ?? "")) {
    throw new Error("Invalid document id");
  }
}

function parseValue(source) {
  if (source.startsWith('"')) {
    let value;
    try {
      value = JSON.parse(source);
    } catch {
      throw new Error("Invalid metadata scalar");
    }
    if (typeof value !== "string") throw new Error("Invalid metadata scalar");
    return value;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(source)) {
    throw new Error("Invalid metadata scalar");
  }
  return source;
}

export function scanReferences(body) {
  if (typeof body !== "string") throw new TypeError("Body must be a string");
  const hits = [];
  let offset = 0;
  let fence = null;

  for (const line of body.split("\n")) {
    const rest = line.replace(/^ {0,3}/, "");
    const marker = rest[0];
    const run = marker === TICK || marker === "~"
      ? rest.match(/^([~]+|[\x60]+)/)?.[0]
      : null;

    if (fence) {
      if (run && marker === fence.marker && run.length >= fence.length &&
          rest.slice(run.length).trim() === "") {
        fence = null;
      }
      offset += line.length + 1;
      continue;
    }

    if (run && run.length >= 3) {
      fence = { marker, length: run.length };
      offset += line.length + 1;
      continue;
    }

    if (/^( {4}|\t)/.test(line) || /^ {0,3}:::efss\./.test(line) ||
        /^ {0,3}:::\s*$/.test(line)) {
      offset += line.length + 1;
      continue;
    }

    let i = 0;
    while (i < line.length) {
      if (line[i] === "\\") {
        i += i + 1 < line.length ? 2 : 1;
        continue;
      }

      if (line[i] === TICK) {
        let length = 1;
        while (line[i + length] === TICK) length++;
        let cursor = i + length;
        let end = -1;
        while (cursor < line.length) {
          if (line[cursor] !== TICK) {
            cursor++;
            continue;
          }
          let size = 1;
          while (line[cursor + size] === TICK) size++;
          if (size === length) {
            end = cursor + size;
            break;
          }
          cursor += size;
        }
        i = end >= 0 ? end : i + length;
        continue;
      }

      if (line.startsWith("http://", i) || line.startsWith("https://", i)) {
        const next = line.slice(i).search(/\s/);
        i = next < 0 ? line.length : i + next;
        continue;
      }

      if (line[i] === "<" && /^<(?:\/?[A-Za-z]|!|[?])/.test(line.slice(i))) {
        const end = line.indexOf(">", i + 1);
        if (end >= 0) {
          i = end + 1;
          continue;
        }
      }

      if (line.startsWith("](", i)) {
        let depth = 1;
        let cursor = i + 2;
        while (cursor < line.length && depth > 0) {
          if (line[cursor] === "\\") {
            cursor += 2;
            continue;
          }
          if (line[cursor] === "(") depth++;
          if (line[cursor] === ")") depth--;
          cursor++;
        }
        if (depth === 0) {
          i = cursor;
          continue;
        }
      }

      if (line[i] === "&") {
        const match = REF.exec(line.slice(i));
        if (match && line[i + match[0].length] !== ";") {
          hits.push({
            key: match[1].normalize("NFC"),
            start: offset + i,
            end: offset + i + match[0].length
          });
          i += match[0].length;
          continue;
        }
      }
      i++;
    }
    offset += line.length + 1;
  }
  return hits;
}

export function parseDocument(source) {
  if (typeof source !== "string") throw new TypeError("Document must be a string");
  const normalized = source.replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match) throw new Error("Missing EFSS envelope");

  const metadata = Object.create(null);
  for (const line of match[1].split("\n")) {
    const entry = /^([a-z][a-z0-9_]*):[ \t]*(.+)$/.exec(line);
    if (!entry || Object.hasOwn(metadata, entry[1])) {
      throw new Error("Invalid EFSS envelope");
    }
    metadata[entry[1]] = parseValue(entry[2]);
  }
  validate(metadata);
  const body = normalized.slice(match[0].length);
  return { metadata, body, references: scanReferences(body) };
}

export function serializeDocument({ metadata, body }) {
  validate(metadata);
  if (typeof body !== "string") throw new TypeError("Body must be a string");
  const fields = [...FIRST, ...Object.keys(metadata).filter((k) => !FIRST.includes(k)).sort()];
  const lines = fields.map((key) => key + ": " + JSON.stringify(metadata[key]));
  return "---\n" + lines.join("\n") + "\n---\n" + body.replace(/\r\n?/g, "\n");
}

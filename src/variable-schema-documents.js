import { LocalDocumentVault } from "./local-document-vault.js";
import { VariableTypeRegistry } from "./typed-variables.js";

const VERSION = 1;
const MAX_SCHEMA = 16000;
const WRAPPED = /^:::efss\.schema[ \t]*\n([\s\S]*?)\n:::[ \t]*$/u;

function plain(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x) &&
    (Object.getPrototypeOf(x) === Object.prototype ||
     Object.getPrototypeOf(x) === null);
}

// Reads explicit, inert JSON data embedded in a canonical EFSS variable doc.
// It never executes model output, JavaScript or directives.
export function parseVariableSchemaDocument(document) {
  if (!document?.metadata || document.metadata.kind !== "variable" ||
    typeof document.metadata.id !== "string" || typeof document.body !== "string") {
    throw new TypeError("INVALID_VARIABLE_DOCUMENT");
  }
  const body = document.body.replace(/\r\n?/g, "\n").trim();
  if (!body.startsWith(":::efss.schema")) {
    return null; // Ordinary variable notes are not authoritative schemas.
  }
  if (body.length > MAX_SCHEMA) throw new Error("VARIABLE_SCHEMA_TOO_LARGE");
  const match = WRAPPED.exec(body);
  if (!match) throw new Error("INVALID_VARIABLE_SCHEMA_BLOCK");
  let parsed;
  try { parsed = JSON.parse(match[1]); }
  catch { throw new Error("INVALID_VARIABLE_SCHEMA_JSON"); }
  if (!plain(parsed) || parsed.schemaVersion !== VERSION ||
      typeof parsed.label !== "string" || !parsed.label.trim() ||
      !plain(parsed.value) ||
      Object.keys(parsed).some(key => ![
        "schemaVersion", "label", "aliases", "value", "properties"
      ].includes(key))) {
    throw new Error("INVALID_VARIABLE_SCHEMA");
  }
  const registry = new VariableTypeRegistry();
  try {
    return registry.register({
      id: document.metadata.id, label: parsed.label,
      aliases: parsed.aliases ?? [], value: parsed.value,
      properties: parsed.properties ?? {}
    });
  } catch {
    // Do not echo arbitrary schema keys from private source text to logs.
    throw new Error("INVALID_VARIABLE_SCHEMA");
  }
}

// Recreates typed registries from saved EFSS variable documents.
// A supplied registry is copied; conflicting persistent definitions fail closed.
export async function loadVariableSchemas(vault, {
  baseTypes = new VariableTypeRegistry(), allowRestricted = false
} = {}) {
  if (!(vault instanceof LocalDocumentVault) ||
      !(baseTypes instanceof VariableTypeRegistry) ||
      typeof allowRestricted !== "boolean") {
    throw new TypeError("INVALID_VARIABLE_SCHEMA_SOURCE");
  }
  const loaded = new VariableTypeRegistry();
  for (const def of baseTypes.list()) {
    loaded.register({
      id: def.id, label: def.label, aliases: [...def.aliases],
      value: { ...def.value }, properties: { ...def.properties }
    });
  }
  const records = (await vault.list()).filter(item =>
    item.kind === "variable" &&
    (allowRestricted || item.metadata.visibility !== "restricted"));
  for (const item of records) {
    const source = await vault.read("variable", item.id);
    const def = parseVariableSchemaDocument(source);
    if (!def) continue;
    if (loaded.get(def.id)) throw new Error("VARIABLE_SCHEMA_CONFLICT");
    try {
      loaded.register({
        id: def.id, label: def.label, aliases: [...def.aliases],
        value: { ...def.value }, properties: { ...def.properties }
      });
    } catch {
      throw new Error("VARIABLE_SCHEMA_CONFLICT");
    }
  }
  return loaded;
}

import { VariableTypeRegistry } from "./typed-variables.js";

const SCHEMA_VERSION = 2;
const MAX_SCHEMA = 16000;
const WRAPPED = /^:::efss\.schema[ \t]*\n([\s\S]*?)\n:::[ \t]*$/u;
function plain(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x) &&
    (Object.getPrototypeOf(x) === Object.prototype ||
     Object.getPrototypeOf(x) === null);
}
function duplicate(def) {
  return {
    id: def.id, label: def.label, aliases: [...def.aliases],
    symbolKind: def.symbolKind, cardinality: def.cardinality,
    value: { ...def.value },
    ...(def.symbolKind === "constant" ? { fixedValue: def.fixedValue } : {})
  };
}

/**
 * Schema version 2 explicitly separates constant/variable, type and cardinality.
 * Version 1 remains readable for existing documents. Its old multi-value
 * interpretation is retained, but unsupported property bags require migration.
 */
export function parseVariableSchemaDocument(document) {
  if (!document?.metadata || document.metadata.kind !== "variable" ||
      typeof document.metadata.id !== "string" || typeof document.body !== "string")
    throw new TypeError("INVALID_VARIABLE_DOCUMENT");
  const body = document.body.replace(/\r\n?/g, "\n").trim();
  if (!body.startsWith(":::efss.schema")) return null;
  if (body.length > MAX_SCHEMA) throw new Error("VARIABLE_SCHEMA_TOO_LARGE");
  const match = WRAPPED.exec(body);
  if (!match) throw new Error("INVALID_VARIABLE_SCHEMA_BLOCK");
  let parsed;
  try { parsed = JSON.parse(match[1]); }
  catch { throw new Error("INVALID_VARIABLE_SCHEMA_JSON"); }
  if (!plain(parsed) || typeof parsed.label !== "string" || !parsed.label.trim() ||
      !plain(parsed.value)) throw new Error("INVALID_VARIABLE_SCHEMA");

  let raw;
  if (parsed.schemaVersion === SCHEMA_VERSION) {
    if (!["schemaVersion", "label", "aliases", "symbolKind", "cardinality",
      "value", "fixedValue"].every(x => typeof x === "string") ||
        Object.keys(parsed).some(k => !["schemaVersion", "label", "aliases",
          "symbolKind", "cardinality", "value", "fixedValue"].includes(k)) ||
        !["variable", "constant"].includes(parsed.symbolKind) ||
        !["one", "many"].includes(parsed.cardinality))
      throw new Error("INVALID_VARIABLE_SCHEMA");
    raw = { id: document.metadata.id, label: parsed.label,
      aliases: parsed.aliases ?? [], symbolKind: parsed.symbolKind,
      cardinality: parsed.cardinality, value: parsed.value,
      ...(Object.hasOwn(parsed, "fixedValue") ?
        { fixedValue: parsed.fixedValue } : {}) };
  } else if (parsed.schemaVersion === 1) {
    if (Object.keys(parsed).some(k => !["schemaVersion", "label", "aliases",
      "value", "properties"].includes(k)))
      throw new Error("INVALID_VARIABLE_SCHEMA");
    if (!plain(parsed.properties ?? {}) || Object.keys(parsed.properties ?? {}).length)
      throw new Error("LEGACY_PROPERTIES_REQUIRE_MIGRATION");
    raw = { id: document.metadata.id, label: parsed.label,
      aliases: parsed.aliases ?? [], symbolKind: "variable",
      cardinality: "many", value: parsed.value };
  } else throw new Error("INVALID_VARIABLE_SCHEMA");

  try { return new VariableTypeRegistry().register(raw); }
  catch { throw new Error("INVALID_VARIABLE_SCHEMA"); }
}

export async function loadVariableSchemas(vault, {
  baseTypes = new VariableTypeRegistry(), allowRestricted = false
} = {}) {
  const { LocalDocumentVault } = await import("./local-document-vault.js");
  if (!(vault instanceof LocalDocumentVault) ||
      !(baseTypes instanceof VariableTypeRegistry) ||
      typeof allowRestricted !== "boolean")
    throw new TypeError("INVALID_VARIABLE_SCHEMA_SOURCE");
  const loaded = new VariableTypeRegistry();
  for (const definition of baseTypes.list()) loaded.register(duplicate(definition));
  const records = (await vault.list()).filter(item =>
    item.kind === "variable" &&
    (allowRestricted || item.metadata.visibility !== "restricted"));
  for (const item of records) {
    const source = await vault.read("variable", item.id);
    const def = parseVariableSchemaDocument(source);
    if (!def) continue;
    if (loaded.get(def.id)) throw new Error("VARIABLE_SCHEMA_CONFLICT");
    try { loaded.register(duplicate(def)); }
    catch { throw new Error("VARIABLE_SCHEMA_CONFLICT"); }
  }
  return loaded;
}

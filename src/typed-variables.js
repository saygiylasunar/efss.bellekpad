import { EFSS_CONTRACT } from "./contract.js";
import { normalizeAlias } from "./semantics.js";

export const VARIABLE_SCHEMA_VERSION = "0.1.0-draft";
export const VARIABLE_TYPES = Object.freeze(["text", "number", "boolean", "date", "enum", "reference"]);

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const FIELD = /^[a-z][a-z0-9_]*$/;
const TYPES = new Set(VARIABLE_TYPES);
const KINDS = new Set(EFSS_CONTRACT.kinds);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function allowedFields(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error("Unknown schema field: " + key);
  }
}

function uniqueStrings(values) {
  return new Set(values).size === values.length;
}

export function defineField(raw, primary = false) {
  if (!object(raw) || !TYPES.has(raw.type)) throw new Error("Invalid field type");
  const allowed = ["type", "required"];
  const field = { type: raw.type, required: raw.required ?? primary };
  if (typeof field.required !== "boolean") throw new Error("Invalid required flag");
  if (raw.type === "number") {
    allowed.push("min", "max");
    if (raw.min !== undefined) {
      if (typeof raw.min !== "number" || !Number.isFinite(raw.min)) throw new Error("Invalid minimum");
      field.min = raw.min;
    }
    if (raw.max !== undefined) {
      if (typeof raw.max !== "number" || !Number.isFinite(raw.max)) throw new Error("Invalid maximum");
      field.max = raw.max;
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      throw new Error("Invalid numeric range");
    }
  }
  if (raw.type === "text") {
    allowed.push("maxLength");
    if (raw.maxLength !== undefined) {
      if (!Number.isSafeInteger(raw.maxLength) || raw.maxLength < 1) throw new Error("Invalid maxLength");
      field.maxLength = raw.maxLength;
    }
  }
  if (raw.type === "enum") {
    allowed.push("choices");
    if (!Array.isArray(raw.choices) || !raw.choices.length ||
        raw.choices.some(item => typeof item !== "string" || !item.trim()) ||
        !uniqueStrings(raw.choices)) throw new Error("Invalid enum choices");
    field.choices = Object.freeze([...raw.choices]);
  }
  if (raw.type === "reference") {
    allowed.push("kinds");
    if (raw.kinds !== undefined) {
      if (!Array.isArray(raw.kinds) || !raw.kinds.length ||
          raw.kinds.some(kind => !KINDS.has(kind)) || !uniqueStrings(raw.kinds)) {
        throw new Error("Invalid reference kinds");
      }
      field.kinds = Object.freeze([...raw.kinds]);
    }
  }
  allowedFields(raw, allowed);
  return Object.freeze(field);
}

function validDate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function validateTypedValue(field, value) {
  if (!object(field) || !TYPES.has(field.type)) throw new Error("Invalid field");
  if (value === undefined || value === null) {
    if (field.required) throw new Error("Missing required value");
    return null;
  }
  switch (field.type) {
    case "text":
      if (typeof value !== "string" ||
          (field.maxLength !== undefined && value.length > field.maxLength)) {
        throw new Error("Invalid text value");
      }
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) ||
          (field.min !== undefined && value < field.min) ||
          (field.max !== undefined && value > field.max)) {
        throw new Error("Invalid number value");
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw new Error("Invalid boolean value");
      return value;
    case "date":
      if (!validDate(value)) throw new Error("Invalid calendar date");
      return value;
    case "enum":
      if (typeof value !== "string" || !Array.isArray(field.choices) ||
          !field.choices.includes(value)) throw new Error("Invalid enum value");
      return value;
    case "reference": {
      if (typeof value !== "string") throw new Error("Invalid reference value");
      const match = /^([a-z]+):([A-Za-z][A-Za-z0-9_-]{0,127})$/.exec(value);
      if (!match || !KINDS.has(match[1]) ||
          (field.kinds && !field.kinds.includes(match[1]))) {
        throw new Error("Invalid reference value");
      }
      return value;
    }
    default:
      throw new Error("Unknown type");
  }
}

export class VariableTypeRegistry {
  #definitions = new Map();
  #aliases = new Map();

  register({ id, label, aliases = [], value, properties = {} } = {}) {
    if (!ID.test(id ?? "") || typeof label !== "string" || !label.trim() ||
        !Array.isArray(aliases) || aliases.some(alias => typeof alias !== "string" || !alias.trim()) ||
        !object(properties)) throw new Error("Invalid variable definition");
    if (this.#definitions.has(id)) throw new Error("Duplicate variable id");
    const symbols = [...new Set([label, ...aliases].map(normalizeAlias))];
    for (const alias of symbols) {
      if (this.#aliases.has(alias)) throw new Error("Duplicate variable symbol");
    }
    const descriptor = defineField(value, true);
    const fields = Object.create(null);
    for (const [name, config] of Object.entries(properties)) {
      if (!FIELD.test(name) || name === "value") throw new Error("Invalid property name");
      fields[name] = defineField(config);
    }
    const definition = Object.freeze({
      id, label, aliases: Object.freeze([...aliases]),
      schemaVersion: VARIABLE_SCHEMA_VERSION,
      value: descriptor,
      properties: Object.freeze(fields)
    });
    this.#definitions.set(id, definition);
    for (const alias of symbols) this.#aliases.set(alias, id);
    return definition;
  }

  get(id) { return this.#definitions.get(id) ?? null; }

  resolve(symbol) {
    if (typeof symbol !== "string") throw new TypeError("Invalid variable symbol");
    const normalized = normalizeAlias(symbol.startsWith("&") ? symbol.slice(1) : symbol);
    return this.get(this.#aliases.get(normalized)) ?? null;
  }

  list() { return [...this.#definitions.values()]; }
}

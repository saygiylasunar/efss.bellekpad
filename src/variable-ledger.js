import { VariableTypeRegistry, validateTypedValue } from "./typed-variables.js";
import { scanSemantics } from "./semantics.js";

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const SOURCE = /^(paper|conversation):[A-Za-z][A-Za-z0-9_-]{0,127}$/;

export class VariableLedger {
  #types;
  #records = new Map();

  constructor(types) {
    if (!(types instanceof VariableTypeRegistry)) throw new TypeError("Expected variable type registry");
    this.#types = types;
  }

  record({ id, variableId, value, properties = {}, sourceId, start = null, end = null } = {}) {
    if (!ID.test(id ?? "") || this.#records.has(id)) throw new Error("Invalid or duplicate record id");
    const definition = this.#types.get(variableId);
    if (!definition) throw new Error("Unknown variable");
    if (typeof sourceId !== "string" || !SOURCE.test(sourceId)) throw new Error("Invalid provenance");
    if ((start !== null || end !== null) && (!Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) || start < 0 || end <= start)) {
      throw new Error("Invalid provenance range");
    }
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      throw new Error("Invalid record properties");
    }
    const data = Object.create(null);
    for (const field of Object.keys(properties)) {
      if (!Object.hasOwn(definition.properties, field)) throw new Error("Unknown record property");
    }
    for (const [name, field] of Object.entries(definition.properties)) {
      const normalized = validateTypedValue(field, properties[name]);
      if (normalized !== null) data[name] = normalized;
    }
    const record = Object.freeze({
      id,
      variableId,
      value: validateTypedValue(definition.value, value),
      properties: Object.freeze(data),
      provenance: Object.freeze({ sourceId, start, end })
    });
    this.#records.set(id, record);
    return record;
  }

  get(id) { return this.#records.get(id) ?? null; }
  all() { return [...this.#records.values()]; }
  forVariable(variableId) { return this.all().filter(record => record.variableId === variableId); }
  fromSource(sourceId) { return this.all().filter(record => record.provenance.sourceId === sourceId); }
}

export function inspectTypedMentions(body, types, ledger = null) {
  if (!(types instanceof VariableTypeRegistry) ||
      (ledger !== null && !(ledger instanceof VariableLedger))) throw new TypeError("Invalid registry");
  const scan = scanSemantics(body);
  return {
    mentions: scan.tokens.filter(token => token.type === "variable").map(token => {
      const variable = types.resolve(token.target.value);
      return {
        symbol: token.target.value,
        variableId: variable?.id ?? null,
        valueType: variable?.value.type ?? null,
        observations: variable && ledger ? ledger.forVariable(variable.id).length : 0,
        start: token.start,
        end: token.end
      };
    }),
    diagnostics: scan.diagnostics
  };
}

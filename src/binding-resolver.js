import { scanSemantics } from "./semantics.js";
import { VariableTypeRegistry, validateTypedValue } from "./typed-variables.js";

const DOC_ID = /^(paper|project|conversation):[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const NUMERIC = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

function cast(raw, type) {
  if (type === "number") {
    if (!NUMERIC.test(raw)) throw new Error("VALUE_NOT_NUMERIC");
    const number = Number(raw);
    if (!Number.isFinite(number)) throw new Error("VALUE_NOT_FINITE");
    return number;
  }
  if (type === "boolean") {
    if (raw !== "true" && raw !== "false") throw new Error("VALUE_NOT_BOOLEAN");
    return raw === "true";
  }
  // Dates, references and enums remain explicit strings and are checked by
  // the existing typed schema. No type is inferred from casual prose.
  return raw;
}

/**
 * Parse possible value bindings in text without saving or activating them.
 * Positional only: &Measure{26, 48}; no implicit overwrite and no AI calls.
 */
export function inspectVariableBindings(body, types, { sourceId = null } = {}) {
  if (typeof body !== "string" || !(types instanceof VariableTypeRegistry) ||
      (sourceId !== null && (typeof sourceId !== "string" || !DOC_ID.test(sourceId)))) {
    throw new TypeError("Invalid binding inspection input");
  }
  const scan = scanSemantics(body);
  const diagnostics = [...scan.diagnostics];
  const candidates = [];
  for (const token of scan.tokens) {
    if (token.type !== "variable" || !token.binding) continue;
    const definition = types.resolve(token.target.value);
    if (!definition) {
      diagnostics.push({ code: "UNKNOWN_VARIABLE_BINDING", start: token.start, end: token.end });
      continue;
    }
    try {
      const values = token.binding.values.map(item =>
        validateTypedValue(definition.value, cast(item.value, definition.value.type)));
      candidates.push(Object.freeze({
        variableId: definition.id, variableType: definition.value.type,
        values: Object.freeze(values),
        provenance: Object.freeze({ sourceId, start: token.start, end: token.end }),
        status: "candidate", effect: "none"
      }));
    } catch {
      diagnostics.push({ code: "INVALID_TYPED_BINDING", start: token.start, end: token.end });
    }
  }
  return { candidates, diagnostics };
}

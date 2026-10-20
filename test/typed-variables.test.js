import test from "node:test";
import assert from "node:assert/strict";
import {
  VariableTypeRegistry, defineField, validateTypedValue,
  SYMBOL_KINDS, VARIABLE_TYPES, VALUE_CARDINALITIES
} from "../src/typed-variables.js";

test("only two symbol classes and explicitly bounded type/cardinality sets exist", () => {
  assert.deepEqual(SYMBOL_KINDS, ["variable", "constant"]);
  assert.deepEqual(VALUE_CARDINALITIES, ["one", "many"]);
  assert.deepEqual(VARIABLE_TYPES, ["text", "number", "boolean", "date", "enum", "reference"]);
});

test("variables default to exactly one value, never a guessed list", () => {
  const r = new VariableTypeRegistry();
  const d = r.register({ id: "amount", label: "Miktar", value: { type: "number", min: 0 } });
  assert.equal(d.symbolKind, "variable");
  assert.equal(d.cardinality, "one");
  assert.equal(d.fixedValue, undefined);
  assert.ok(Object.isFrozen(d));
  assert.ok(Object.isFrozen(d.value));
});

test("constants require one correctly typed fixed value and cannot be assigned later", () => {
  const r = new VariableTypeRegistry();
  const def = r.register({ id: "pi", label: "Pi", symbolKind: "constant",
    value: { type: "number" }, fixedValue: 3.14159 });
  assert.equal(def.fixedValue, 3.14159);
  assert.equal(def.cardinality, "one");
  assert.throws(() => { def.fixedValue = 9; }, TypeError);
  assert.throws(() => r.register({ id: "no", label: "No", symbolKind: "constant",
    value: { type: "number" } }), /CONSTANT_REQUIRES/);
  assert.throws(() => r.register({ id: "bad", label: "Bad", symbolKind: "constant",
    value: { type: "number" }, fixedValue: "wrong" }), /number/);
  assert.throws(() => r.register({ id: "list", label: "List", symbolKind: "constant",
    cardinality: "many", value: { type: "text" }, fixedValue: "x" }), /CONSTANT_REQUIRES/);
  assert.throws(() => r.register({ id: "variable", label: "Variable",
    value: { type: "text" }, fixedValue: "x" }), /VARIABLE_CANNOT/);
});

test("multiple values require explicit list cardinality", () => {
  const r = new VariableTypeRegistry();
  const d = r.register({ id: "tags", label: "Etiketler",
    cardinality: "many", value: { type: "text" } });
  assert.equal(d.cardinality, "many");
  assert.throws(() => r.register({ id: "invalid", label: "Invalid",
    cardinality: "possibly", value: { type: "text" } }), /Invalid symbol/);
});

test("types check calendar, bounds, enum, boolean and reference without inference", () => {
  assert.equal(validateTypedValue(defineField({ type: "date" }, true), "2024-02-29"), "2024-02-29");
  for (const date of ["2023-02-29", "2026-04-31", "2026-13-01", "0000-01-01"])
    assert.throws(() => validateTypedValue(defineField({ type: "date" }, true), date));
  const number = defineField({ type: "number", min: 0, max: 3 }, true);
  assert.equal(validateTypedValue(number, 2), 2);
  for (const value of ["2", -1, 4, NaN]) assert.throws(() => validateTypedValue(number, value));
  const enumField = defineField({ type: "enum", choices: ["open", "closed"] }, true);
  assert.equal(validateTypedValue(enumField, "open"), "open");
  assert.throws(() => validateTypedValue(enumField, "other"));
  const ref = defineField({ type: "reference", kinds: ["paper"] }, true);
  assert.equal(validateTypedValue(ref, "paper:one"), "paper:one");
  assert.throws(() => validateTypedValue(ref, "project:one"));
});

test("unknown types, fields, speculative properties and duplicate identities fail", () => {
  const r = new VariableTypeRegistry();
  r.register({ id: "date", label: "Tarih", aliases: ["Date"], value: { type: "date" } });
  assert.equal(r.resolve("&Tarih").id, "date");
  assert.equal(r.resolve("DATE").id, "date");
  assert.throws(() => r.register({ id: "other", label: "tarih", value: { type: "text" } }), /Duplicate/);
  assert.throws(() => r.register({ id: "date", label: "Anything", value: { type: "text" } }), /Duplicate/);
  assert.throws(() => r.register({ id: "props", label: "Unused", value: { type: "number" },
    properties: { something: { type: "text" } } }), /UNKNOWN_SYMBOL_FIELD/);
  assert.throws(() => defineField({ type: "date", choices: ["now"] }), /UNKNOWN_SYMBOL_FIELD/);
  assert.throws(() => defineField({ type: "number", min: 2, max: 1 }), /Invalid/);
  assert.throws(() => defineField({ type: "magic" }), /Invalid/);
  assert.throws(() => r.register({ id: "strange", label: "Strange", value: { type: "text" },
    symbolKind: "event" }), /Invalid symbol/);
});

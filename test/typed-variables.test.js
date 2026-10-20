import test from "node:test";
import assert from "node:assert/strict";
import { defineField, validateTypedValue, VariableTypeRegistry } from "../src/typed-variables.js";
import { VariableLedger, inspectTypedMentions } from "../src/variable-ledger.js";

function setup() {
  const types = new VariableTypeRegistry();
  types.register({
    id: "when", label: "Tarih", aliases: ["Date"], value: { type: "date" },
    properties: {
      accuracy: { type: "number", min: 0, max: 1 },
      confirmed: { type: "boolean" },
      source: { type: "reference", kinds: ["paper"] }
    }
  });
  types.register({ id: "category", label: "Kategori",
    value: { type: "enum", choices: ["music", "science"] } });
  return types;
}

test("typed definitions are independent, versioned and frozen", () => {
  const a = setup(), b = new VariableTypeRegistry();
  const definition = a.resolve("&Tarih");
  assert.equal(definition.id, "when");
  assert.equal(a.resolve("date").id, "when");
  assert.equal(definition.value.type, "date");
  assert.equal(b.resolve("&Tarih"), null);
  assert.ok(Object.isFrozen(definition));
  assert.ok(Object.isFrozen(definition.properties));
  assert.ok(Object.isFrozen(definition.aliases));
  assert.throws(() => a.register({ id: "new", label: "tarih", value: { type: "text" } }), /Duplicate/);
  assert.throws(() => a.register({ id: "when", label: "Another", value: { type: "text" } }), /Duplicate/);
});

test("typed dates validate the calendar without timezone conversion", () => {
  const date = defineField({ type: "date" }, true);
  assert.equal(validateTypedValue(date, "2024-02-29"), "2024-02-29");
  for (const value of ["2023-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "2026-2-3", new Date()]) {
    assert.throws(() => validateTypedValue(date, value), /calendar/);
  }
});

test("numeric, enum and reference constraints work", () => {
  const bounded = defineField({ type: "number", min: 0, max: 1 }, true);
  assert.equal(validateTypedValue(bounded, 0), 0);
  for (const value of [NaN, Infinity, "0.5", -1, 2]) assert.throws(() => validateTypedValue(bounded, value));
  const enumField = defineField({ type: "enum", choices: ["open", "closed"] }, true);
  assert.equal(validateTypedValue(enumField, "open"), "open");
  assert.throws(() => validateTypedValue(enumField, "other"));
  const reference = defineField({ type: "reference", kinds: ["paper"] }, true);
  assert.equal(validateTypedValue(reference, "paper:doc1"), "paper:doc1");
  assert.throws(() => validateTypedValue(reference, "project:p1"));
});

test("field schemas reject unknown or contradictory options", () => {
  assert.throws(() => defineField({ type: "date", choices: ["now"] }));
  assert.throws(() => defineField({ type: "number", min: 2, max: 1 }));
  assert.throws(() => defineField({ type: "enum", choices: ["x", "x"] }));
  assert.throws(() => defineField({ type: "reference", kinds: ["unknown"] }));
  assert.throws(() => defineField({ type: "text", maxLength: 0 }));
  assert.throws(() => defineField({ type: "boolean", required: 1 }));
});

test("observations retain source and typed properties", () => {
  const types = setup(), ledger = new VariableLedger(types);
  const item = ledger.record({
    id: "r1", variableId: "when", value: "2026-10-20",
    properties: { accuracy: 0.9, confirmed: true, source: "paper:doc1" },
    sourceId: "paper:doc1", start: 10, end: 16
  });
  assert.equal(item.value, "2026-10-20");
  assert.equal(item.provenance.start, 10);
  assert.equal(item.properties.confirmed, true);
  assert.ok(Object.isFrozen(item.properties));
  assert.deepEqual(ledger.forVariable("when").map(x => x.id), ["r1"]);
  assert.deepEqual(ledger.fromSource("paper:doc1").map(x => x.id), ["r1"]);
  assert.equal(ledger.get("r1"), item);
  assert.throws(() => ledger.record({ id: "r1", variableId: "when", value: "2026-10-21", sourceId: "paper:doc1" }), /duplicate/);
});

test("observations fail on invalid sources, dates and properties", () => {
  const ledger = new VariableLedger(setup());
  const base = { id: "r1", variableId: "when", value: "2026-10-20", sourceId: "paper:doc1" };
  assert.throws(() => ledger.record({ ...base, sourceId: "../private" }), /provenance/);
  assert.throws(() => ledger.record({ ...base, value: "2026-02-30" }), /calendar/);
  assert.throws(() => ledger.record({ ...base, start: 4, end: 3 }), /range/);
  assert.throws(() => ledger.record({ ...base, properties: { unknown: 5 } }), /Unknown/);
  assert.throws(() => ledger.record({ ...base, properties: { accuracy: 5 } }), /number/);
  assert.throws(() => ledger.record({ ...base, properties: { source: "conversation:chat1" } }), /reference/);
  assert.equal(ledger.all().length, 0);
});

test("required properties must be supplied", () => {
  const types = new VariableTypeRegistry();
  types.register({ id: "score", label: "Skor", value: { type: "number" },
    properties: { unit: { type: "text", required: true } } });
  const ledger = new VariableLedger(types);
  assert.throws(() => ledger.record({ id: "a", variableId: "score", value: 7, sourceId: "paper:d1" }), /Missing/);
  assert.equal(ledger.record({ id: "a", variableId: "score", value: 7,
    properties: { unit: "points" }, sourceId: "paper:d1" }).properties.unit, "points");
});

test("typed mentions cannot inject observation values", () => {
  const types = setup(), ledger = new VariableLedger(types);
  ledger.record({ id: "d1", variableId: "when", value: "2026-10-20", sourceId: "paper:doc1" });
  const found = inspectTypedMentions("&Tarih &Bilinmeyen\n" + String.fromCharCode(96) + "&Tarih" + String.fromCharCode(96), types, ledger);
  assert.equal(found.mentions.length, 2);
  assert.equal(found.mentions[0].variableId, "when");
  assert.equal(found.mentions[0].valueType, "date");
  assert.equal(found.mentions[0].observations, 1);
  assert.equal(found.mentions[1].variableId, null);
  assert.equal(Object.hasOwn(found.mentions[0], "value"), false);
});

test("schema property names cannot shadow value", () => {
  const types = new VariableTypeRegistry();
  assert.throws(() => types.register({ id: "one", label: "One", value: { type: "text" },
    properties: { value: { type: "text" } } }), /property/);
  assert.throws(() => types.register({ id: "one", label: "One", value: { type: "text" },
    properties: { "bad-key": { type: "text" } } }), /property/);
  assert.equal(types.get("one"), null);
});

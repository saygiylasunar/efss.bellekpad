import test from "node:test";
import assert from "node:assert/strict";
import { readVariableBinding } from "../src/binding-syntax.js";

test("multi-value EFSS syntax accepts Unicode, quoted commas and boolean-like atoms", () => {
  const line = '&Ölçüm{ 26 , "iki, üç", true, 2026-10-26 } next';
  const found = readVariableBinding(line, line.indexOf("{"), 50);
  assert.equal(found.error, undefined);
  assert.deepEqual(found.binding.values.map(x => x.value),
    ["26", "iki, üç", "true", "2026-10-26"]);
  assert.deepEqual(found.binding.values.map(x => x.quoted), [false, true, false, false]);
  assert.equal(line.slice(found.binding.values[0].start - 50, found.binding.values[0].end - 50), "26");
  assert.equal(found.binding.end, found.end + 50);
  assert.equal(line.slice(found.end), " next");
});

test("quoted escaped double quotes are decoded safely", () => {
  const line = '&Not{"\\\"alıntı\\\""}';
  const found = readVariableBinding(line, line.indexOf("{"));
  assert.equal(found.error, undefined);
  assert.equal(found.binding.values[0].value, '"alıntı"');
});

test("syntax fails closed on empty, extra, unclosed and nested values", () => {
  const invalid = ["&A{}", "&A{1,}", "&A{,2}", "&A{one", '&A{"broken}', "&A{nested{bad}}",
    "&A{bad\\escape}"];
  for (const line of invalid) {
    const result = readVariableBinding(line, line.indexOf("{"));
    assert.ok(result.error, line);
    assert.equal(result.binding, undefined);
  }
  const tooMany = "&A{" + new Array(65).fill("x").join(",") + "}";
  assert.equal(readVariableBinding(tooMany, 2).error, "BINDING_TOO_MANY_VALUES");
  const tooLong = "&A{" + "x".repeat(8200) + "}";
  assert.equal(readVariableBinding(tooLong, 2).error, "BINDING_TOO_LONG");
});

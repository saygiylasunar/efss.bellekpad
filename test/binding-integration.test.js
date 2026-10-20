import test from "node:test";
import assert from "node:assert/strict";
import { scanSemantics } from "../src/semantics.js";
import { parseMarkdownAst, serializeMarkdownAst } from "../src/ast.js";
import { scanReferences } from "../src/efss-markdown.js";
import { VariableTypeRegistry } from "../src/typed-variables.js";
import { inspectVariableBindings } from "../src/binding-resolver.js";

function registry() {
  const types = new VariableTypeRegistry();
  types.register({ id: "when", label: "Tarih", value: { type: "date" } });
  types.register({ id: "quantity", label: "Miktar", value: { type: "number", min: 0, max: 100 } });
  types.register({ id: "enabled", label: "Açık", value: { type: "boolean" } });
  types.register({ id: "text", label: "Not", value: { type: "text" } });
  types.register({ id: "category", label: "Kategori", value: { type: "enum", choices: ["müzik", "sanat"] } });
  return types;
}
test("semantic scanner sees positional bindings as one reference with source range", () => {
  const body = 'Başla &Not{ilk, "iki, üç", son} ve &Tarih sonra.';
  const scan = scanSemantics(body);
  assert.deepEqual(scan.diagnostics, []);
  const first = scan.tokens[0];
  assert.equal(first.type, "variable");
  assert.equal(first.target.value, "Not");
  assert.equal(body.slice(first.start, first.end), '&Not{ilk, "iki, üç", son}');
  assert.equal(first.binding.kind, "positional-values");
  assert.deepEqual(first.binding.values.map(v => v.value), ["ilk", "iki, üç", "son"]);
  assert.equal(scan.tokens[1].binding, undefined);
  assert.equal(scanReferences(body)[0].end, first.end);
});
test("escaped, quoted-code, URLs, extension blocks and fences remain inert", () => {
  const body = ["\\&Not{kaçış}", "`&Not{kod}`",
    "https://example.org/?data=&Not{adres}", ":::efss.data", "&Not{özel}", ":::",
    "~~~", "&Not{çit}", "~~~", "&Not{gerçek}"].join("\n");
  const scan = scanSemantics(body);
  assert.deepEqual(scan.tokens.filter(t => t.type === "variable").map(t =>
    t.binding?.values[0].value), ["gerçek"]);
  assert.equal(serializeMarkdownAst(parseMarkdownAst(body)), body);
});
test("invalid binding syntax emits diagnostics and never falls back to mention", () => {
  const body = "&Not{one,} and &Not{valid}\n&Not{bad{nested}} &Not{again}";
  const scan = scanSemantics(body);
  assert.equal(scan.diagnostics.filter(d => d.code === "BAD_VARIABLE_BINDING").length, 2);
  assert.deepEqual(scan.tokens.filter(t => t.type === "variable").map(t =>
    t.binding.values[0].value), ["valid", "again"]);
  assert.ok(scan.diagnostics.every(d => !JSON.stringify(d).includes("bad{nested")));
});
test("registered types validate candidate lists without saving any records", () => {
  const body = "&Tarih{2026-10-26, 2026-11-01} &Miktar{26, 42.5} &Açık{true, false}";
  const result = inspectVariableBindings(body, registry(), { sourceId: "paper:example" });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(result.candidates[0].values, ["2026-10-26", "2026-11-01"]);
  assert.deepEqual(result.candidates[1].values, [26, 42.5]);
  assert.deepEqual(result.candidates[2].values, [true, false]);
  assert.equal(result.candidates[0].status, "candidate");
  assert.equal(result.candidates[0].effect, "none");
  const { start, end } = result.candidates[0].provenance;
  assert.equal(body.slice(start, end), "&Tarih{2026-10-26, 2026-11-01}");
});
test("a bad value rejects the entire candidate; other bindings survive", () => {
  const body = '&Miktar{4, fail} &Tarih{2026-02-30} &Açık{yes} &Kategori{müzik, sanat} &Not{"1, 2"}';
  const result = inspectVariableBindings(body, registry());
  assert.deepEqual(result.candidates.map(c => c.variableId), ["category", "text"]);
  assert.equal(result.candidates[1].values[0], "1, 2");
  assert.equal(result.diagnostics.filter(d => d.code === "INVALID_TYPED_BINDING").length, 3);
});
test("unknown definitions don't get invented by scanning prose", () => {
  const result = inspectVariableBindings("&Bilinmeyen{26} &Not{örnek}", registry());
  assert.equal(result.candidates.length, 1);
  assert.equal(result.diagnostics[0].code, "UNKNOWN_VARIABLE_BINDING");
  assert.throws(() => inspectVariableBindings("&Not{x}", registry(), { sourceId: "../secret" }));
});
test("CRLF and Unicode remain lossless through AST serialization", () => {
  const body = '# Başlık\r\n\r\n&Miktar{26, 48} ve &Not{"emoji 😀"}\r\n';
  const ast = parseMarkdownAst(body);
  assert.equal(serializeMarkdownAst(ast), body);
  const tokens = ast.blocks.flatMap(block => block.symbols);
  assert.deepEqual(tokens.map(t => body.slice(t.start, t.end)),
    ['&Miktar{26, 48}', '&Not{"emoji 😀"}']);
});

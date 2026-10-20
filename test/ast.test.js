import test from "node:test";
import assert from "node:assert/strict";
import { InlineRules, createInlineRules } from "../src/inline-rules.js";
import { parseMarkdownAst, serializeMarkdownAst, editMarkdownAst, parseInline } from "../src/ast.js";

const tick = "`";

test("mixed blocks roundtrip byte-for-byte, including CRLF", () => {
  const input = ["# Başlık", "", "&Tarih **vurgu** ve !!özel!!", "", "- satır", "> alıntı", "::use [[paper:sample]]", "", tick.repeat(3) + "ts", "::mode fake", tick.repeat(3), ""].join("\r\n");
  const ast = parseMarkdownAst(input, { rules: createInlineRules().add({ name: "custom", marker: "!!" }) });
  assert.equal(serializeMarkdownAst(ast), input);
  assert.deepEqual(ast.blocks.map(x => x.type), ["heading", "blank", "paragraph", "blank", "list_item", "quote", "directive", "blank", "code_fence"]);
  assert.deepEqual(ast.blocks[2].inline.filter(x => x.type === "mark").map(x => x.rule), ["strong", "custom"]);
  assert.deepEqual(ast.blocks[2].symbols.map(x => x.target?.value), ["Tarih"]);
  assert.deepEqual(ast.blocks[6].symbols.map(x => x.action), ["use"]);
  assert.equal(ast.blocks[8].symbols.length, 0);
  assert.deepEqual(ast.diagnostics, []);
});

test("formatting rules have independent instances and reject collision", () => {
  const a = createInlineRules().add({ name: "custom", marker: "!!" });
  const b = createInlineRules();
  assert.ok(a.list().some(x => x.name === "custom"));
  assert.ok(!b.list().some(x => x.name === "custom"));
  assert.throws(() => a.add({ name: "another", marker: "!!" }), /Duplicate/);
  assert.throws(() => a.add({ name: "custom", marker: "%%" }), /Duplicate/);
  assert.throws(() => a.add({ name: "code", marker: "`" }), /Invalid/);
  assert.throws(() => a.add({ name: "unsafe", marker: "<script>" }), /Invalid/);
  assert.throws(() => new InlineRules({}), TypeError);
});

test("code spans and escaped delimiters never become marks", () => {
  const rules = createInlineRules().add({ name: "custom", marker: "!!" });
  const tokens = parseInline("\\!!escape!! " + tick + "!!code!!" + tick + " !!actual!!", 0, rules);
  assert.deepEqual(tokens.filter(x => x.type === "mark").map(x => x.raw), ["!!actual!!"]);
  assert.equal(tokens.filter(x => x.type === "inline_code").length, 1);
});

test("nested marks retain source spans", () => {
  const raw = "**bir !!iki!! üç**";
  const tokens = parseInline(raw, 20, createInlineRules().add({ name: "custom", marker: "!!" }));
  assert.equal(tokens[0].start, 20);
  assert.equal(tokens[0].end, 20 + raw.length);
  assert.equal(tokens[0].children.find(t => t.type === "mark").raw, "!!iki!!");
});

test("extension payloads are preserved without activating commands", () => {
  const doc = [":::efss.variable", "::use [[paper:sample]]", "&Tarih", ":::"].join("\n");
  const ast = parseMarkdownAst(doc);
  assert.equal(ast.blocks.length, 1);
  assert.equal(ast.blocks[0].type, "extension_block");
  assert.equal(ast.blocks[0].symbols.length, 0);
  assert.equal(serializeMarkdownAst(ast), doc);
});

test("unclosed fenced blocks are lossless and diagnostic", () => {
  const input = tick.repeat(3) + "js\n&Hidden";
  const ast = parseMarkdownAst(input);
  assert.equal(ast.blocks[0].closed, false);
  assert.equal(ast.diagnostics[0].code, "UNCLOSED_BLOCK");
  assert.equal(serializeMarkdownAst(ast), input);
});

test("range edits reparse to a new tree without mutating original", () => {
  const original = parseMarkdownAst("Merhaba &Müzik\n");
  const start = original.source.indexOf("Müzik");
  const updated = editMarkdownAst(original, [{ start, end: start + 5, text: "Tarih" }]);
  assert.equal(serializeMarkdownAst(updated), "Merhaba &Tarih\n");
  assert.equal(serializeMarkdownAst(original), "Merhaba &Müzik\n");
  assert.equal(updated.blocks[0].symbols[0].target.value, "Tarih");
});

test("patches reject overlapping edits and broken unicode/CRLF boundaries", () => {
  const original = parseMarkdownAst("A😀\r\nB");
  assert.throws(() => editMarkdownAst(original, [{ start: 2, end: 2, text: "X" }]), /Invalid/);
  assert.throws(() => editMarkdownAst(original, [{ start: 4, end: 4, text: "X" }]), /Invalid/);
  assert.throws(() => editMarkdownAst(original, [{ start: 0, end: 2, text: "" }, { start: 1, end: 3, text: "" }]), /Invalid/);
});

test("empty document can be roundtripped and edited", () => {
  const ast = parseMarkdownAst("");
  assert.equal(serializeMarkdownAst(ast), "");
  assert.equal(serializeMarkdownAst(editMarkdownAst(ast, [{ start: 0, end: 0, text: "# Yeni" }])), "# Yeni");
});

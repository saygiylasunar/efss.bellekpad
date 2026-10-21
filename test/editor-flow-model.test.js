import test from "node:test";
import assert from "node:assert/strict";
import { createBlockDocument } from "../src/editor-block-model.js";
import {
  projectFlowBlocks, flowBlockAt, editFlowText, insertFlowBlock,
  calloutMarkdown, slashFlowCommand
} from "../src/editor-flow-model.js";

const editable = source => projectFlowBlocks(createBlockDocument(source)).filter(b => b.editable);

test("flow projection hides heading, list and quote delimiters without altering EFSS source", () => {
  const source = "# Başlık\n\n- Madde\n\n> Alıntı\n\nDüz metin 💡\n";
  const doc = createBlockDocument(source);
  const blocks = projectFlowBlocks(doc);
  assert.deepEqual(blocks.filter(b => b.editable && b.text).map(b => [b.type,b.text]), [
    ["heading","Başlık"], ["list_item","Madde"], ["quote","Alıntı"], ["paragraph","Düz metin 💡"]
  ]);
  assert.equal(blocks.find(b => b.type === "heading").sourceStart, 2);
  assert.equal(doc.blocks.map(b => b.raw).join(""), source);
});

test("editing visible paragraph changes only its source span and keeps adjacent raw bytes", () => {
  const source = "# Üst\r\n\r\nİçerik\r\n\r\n:::efss.secret\r\nid: x\r\n:::\r\n";
  const doc = createBlockDocument(source);
  const p = projectFlowBlocks(doc).find(b => b.type === "paragraph");
  const updated = editFlowText(doc, { id: p.id, text: "Güncel içerik" });
  assert.equal(updated.source, source.replace("İçerik", "Güncel içerik"));
  assert.equal(updated.source.includes(":::efss.secret\r\nid: x\r\n:::"), true);
  assert.equal(createBlockDocument(updated.source).source, updated.source);
  assert.equal(doc.source, source);
});

test("complex or unknown EFSS constructs are read-only in flow view, editable in source", () => {
  const source = [
    "Bu **kalın** bir metin.", "", "EFSS &Miktar{22}.", "",
    ":::efss.other", "whatever", ":::", "",
    "Birden çok", "satırlı paragraf", ""
  ].join("\n");
  const doc = createBlockDocument(source);
  const blocks = projectFlowBlocks(doc);
  assert.equal(blocks.find(b => b.type === "extension_block").editable, false);
  assert.equal(blocks.find(b => b.text.includes("**kalın**")).editable, false);
  assert.equal(blocks.find(b => b.text.includes("&Miktar")).editable, false);
  assert.equal(blocks.some(b => !b.editable && b.raw.includes("satırlı paragraf")), true);
  for (const block of blocks.filter(b => !b.editable))
    assert.throws(() => editFlowText(doc, { id: block.id, text: "override" }),
      /FLOW_BLOCK_READ_ONLY/);
});

test("callout insertion creates real EFSS source but presents an editable visual card", () => {
  const raw = calloutMarkdown("warning");
  const doc = createBlockDocument(raw);
  const card = projectFlowBlocks(doc).find(b => b.type === "callout");
  assert.ok(card);
  assert.equal(card.variant, "warning");
  assert.equal(card.icon, "⚠️");
  assert.equal(card.title, "Uyarı");
  assert.equal(card.text, "");
  assert.equal(card.editable, true);
  const modified = editFlowText(doc, { id: card.id, text: "Dosyaları **yedekle**." });
  assert.equal(modified.source.includes("Dosyaları **yedekle**."), true);
  const next = projectFlowBlocks(modified);
  assert.equal(next.find(b => b.type === "callout").text, "Dosyaları **yedekle**.");
  assert.equal(next.find(b => b.type === "callout").editable, false);
  assert.equal(doc.source, raw);
});

test("callouts never claim to edit nested blocks or unsupported attributes", () => {
  assert.throws(() => calloutMarkdown("javascript:"), /INVALID_CALLOUT_TYPE/);
  const nested = [
    ':::efss.callout type=info icon="ℹ️" title="Bilgi"',
    "- item", "", "more", ":::",""
  ].join("\n");
  const doc = createBlockDocument(nested);
  assert.equal(projectFlowBlocks(doc).find(b => b.type === "callout").editable, false);
  const malformed = createBlockDocument(':::efss.callout onclick="bad"\nunsafe\n:::\n');
  const block = projectFlowBlocks(malformed).find(b => b.type === "extension_block");
  assert.equal(block.editable, false);
});

test("visual insert uses CRLF consistently and preserves existing original records", () => {
  const source = "# Başlangıç\r\n\r\nSon satır\r\n";
  const doc = createBlockDocument(source);
  const head = doc.blocks[0];
  const added = insertFlowBlock(doc, { afterId: head.id, kind: "callout", variant: "tip" });
  assert.equal(added.source.startsWith("# Başlangıç\r\n\r\n:::efss.callout"), true);
  assert.equal(added.source.includes('type=tip icon="💡" title="İpucu"'), true);
  assert.equal(added.source.endsWith("Son satır\r\n"), true);
  assert.equal(projectFlowBlocks(added).find(b => b.type === "callout").editable, true);
  assert.equal(doc.source, source);
});

test("empty source has an editable placeholder and creates a real paragraph after typing", () => {
  const doc = createBlockDocument("");
  const one = projectFlowBlocks(doc);
  assert.equal(one.length, 1);
  assert.equal(one[0].virtual, true);
  assert.equal(one[0].editable, true);
  const filled = editFlowText(doc, { id: one[0].id, text: "Merhaba" });
  assert.equal(filled.source, "Merhaba");
  assert.equal(projectFlowBlocks(filled)[0].text, "Merhaba");
  const callout = insertFlowBlock(doc, { kind: "callout" });
  assert.equal(projectFlowBlocks(callout).some(b => b.type === "callout"), true);
});

test("slash commands are specific, Turkish-aware, and do not infer unrelated strings", () => {
  assert.deepEqual(slashFlowCommand("/callout"), { kind: "callout", variant: "info" });
  assert.deepEqual(slashFlowCommand("/uyarı"), { kind: "callout", variant: "warning" });
  assert.deepEqual(slashFlowCommand("/h1"), { kind: "heading" });
  assert.deepEqual(slashFlowCommand("/liste"), { kind: "list_item" });
  assert.equal(slashFlowCommand("/other"), null);
  assert.equal(slashFlowCommand("hello /callout"), null);
});

test("concurrent structural command rejects old revisions and unauthorized variants", () => {
  const doc = createBlockDocument("Hello");
  assert.throws(() => insertFlowBlock(doc, { kind: "callout", variant: "fake" }),
    /INVALID_CALLOUT_TYPE/);
  assert.throws(() => insertFlowBlock(doc, { kind: "script" }),
    /UNSUPPORTED_FLOW_BLOCK/);
  assert.throws(() => insertFlowBlock(doc, { expectedVersion: 7 }),
    /BLOCK_VERSION_CONFLICT/);
  assert.throws(() => editFlowText(doc, { id: "fake", text: "x" }),
    /FLOW_BLOCK_NOT_FOUND/);
  const existing = projectFlowBlocks(doc)[0];
  assert.throws(() => editFlowText(doc, { id: existing.id, text: "a\nb" }),
    /INVALID_FLOW_TEXT/);
});

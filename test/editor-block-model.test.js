import test from "node:test";
import assert from "node:assert/strict";
import {
  createBlockDocument, serializeBlockDocument, reconcileBlockSource,
  insertBlockAfter, replaceBlockRaw, blockOutline
} from "../src/editor-block-model.js";

test("EFSS source is preserved without reformatting CRLF, extension contents or emoji", () => {
  const source = [
    "# Başlık", "", "Metin **kalın** ve 😀.", "",
    ":::efss.custom", "name: &Something{12}", ":::", "",
    "~~~js", "console.log('keep');", "~~~", ""
  ].join("\r\n");
  const doc = createBlockDocument(source);
  assert.equal(serializeBlockDocument(doc), source);
  assert.equal(doc.blocks.map(b => b.raw).join(""), source);
  assert.ok(doc.blocks.some(b => b.opaque && b.raw.includes("name: &Something")));
  assert.ok(Object.isFrozen(doc));
  assert.ok(Object.isFrozen(doc.blocks));
  assert.ok(Object.isFrozen(doc.blocks[0]));
  assert.equal(doc.version, 0);
});

test("unchanged prefix and suffix blocks keep stable session IDs on middle edit", () => {
  const original = "# One\n\nMiddle text.\n\n# Three\n";
  const first = createBlockDocument(original);
  const last = first.blocks.at(-1);
  const heading = first.blocks[0];
  const middle = first.blocks.find(b => b.type === "paragraph");
  const updated = reconcileBlockSource(first, original.replace("Middle text.", "Different middle."));
  assert.equal(updated.blocks[0].id, heading.id);
  assert.equal(updated.blocks.at(-1).id, last.id);
  assert.equal(updated.blocks.find(b => b.type === "paragraph").id, middle.id);
  assert.equal(first.source, original);
  assert.equal(first.version, 0);
  assert.equal(updated.version, 1);
  assert.equal(serializeBlockDocument(updated), "# One\n\nDifferent middle.\n\n# Three\n");
});

test("unknown extensions remain opaque and locked against structural edit", () => {
  const source = "# Title\n\n:::efss.experimental\n**raw**\n:::\n";
  const doc = createBlockDocument(source);
  const extension = doc.blocks.find(b => b.type === "extension_block");
  assert.ok(extension);
  assert.equal(extension.opaque, true);
  assert.throws(() => replaceBlockRaw(doc, { id: extension.id, raw: "oops" }),
    /OPAQUE_BLOCK_REQUIRES_SOURCE_MODE/);
  const sourceModeEdit = reconcileBlockSource(doc,
    source.replace("**raw**", "still raw"));
  assert.equal(sourceModeEdit.source.includes("still raw"), true);
  assert.equal(sourceModeEdit.blocks.find(b => b.type === "extension_block").id,
    extension.id);
});

test("insert operations preserve all existing source and use explicit block grammar", () => {
  const source = "# Merhaba\n\nSonra.\n";
  const doc = createBlockDocument(source);
  const next = insertBlockAfter(doc, {
    afterId: doc.blocks[0].id, kind: "quote", content: "Önemli mesaj"
  });
  assert.equal(next.source, "# Merhaba\n\n> Önemli mesaj\n\nSonra.\n");
  assert.equal(next.blocks[0].id, doc.blocks[0].id);
  assert.equal(next.blocks.some(b => b.type === "quote"), true);
  assert.equal(doc.source, source);
  const appended = insertBlockAfter(next, { kind: "heading", content: "Yeni Bölüm" });
  assert.equal(appended.source.endsWith("\n\n# Yeni Bölüm\n"), true);
  assert.equal(appended.blocks.at(-1).type, "heading");
});

test("block insert uses existing CRLF convention, blank sources and paragraph validation", () => {
  const empty = createBlockDocument("");
  const first = insertBlockAfter(empty, { kind: "paragraph", content: "İlk" });
  assert.equal(first.source, "İlk\n");
  const crlf = createBlockDocument("# Başlangıç\r\n");
  const inserted = insertBlockAfter(crlf, { kind: "list_item", content: "İş" });
  assert.equal(inserted.source, "# Başlangıç\r\n\r\n- İş\r\n");
  assert.throws(() => insertBlockAfter(crlf, { kind: "paragraph", content: "# Başlık" }),
    /AMBIGUOUS_PARAGRAPH_CONTENT/);
  assert.throws(() => insertBlockAfter(crlf, { kind: "callout", content: "x" }),
    /UNSUPPORTED_BLOCK_INSERT/);
});

test("replace source for one paragraph retains identity and does not mutate neighbors", () => {
  const doc = createBlockDocument("# A\n\nText.\n\n> Quote\n");
  const paragraph = doc.blocks.find(b => b.type === "paragraph");
  const after = replaceBlockRaw(doc, { id: paragraph.id, raw: "Yenilenmiş.\n" });
  assert.equal(after.source, "# A\n\nYenilenmiş.\n\n> Quote\n");
  assert.equal(after.blocks.find(b => b.type === "paragraph").id, paragraph.id);
  assert.deepEqual(blockOutline(after).map(b => b.type), ["heading", "paragraph", "quote"]);
  const first = blockOutline(after)[0];
  assert.equal(first.preview, "# A");
  assert.ok(!Object.hasOwn(first, "raw"));
});

test("reject stale versions and invalid blocks atomically", () => {
  const doc = createBlockDocument("Hello.");
  assert.throws(() => reconcileBlockSource(doc, "New", { expectedVersion: 500 }),
    /BLOCK_VERSION_CONFLICT/);
  assert.throws(() => replaceBlockRaw(doc, { id: "missing", raw: "x" }),
    /BLOCK_NOT_FOUND/);
  assert.throws(() => insertBlockAfter(doc, { afterId: "missing" }),
    /BLOCK_NOT_FOUND/);
  assert.throws(() => insertBlockAfter(doc, { kind: "heading", content: "x\ny" }),
    /INVALID_BLOCK_CONTENT/);
  assert.throws(() => reconcileBlockSource(doc, "\0"), /INVALID_BLOCK_SOURCE/);
  assert.equal(reconcileBlockSource(doc, doc.source), doc);
  assert.equal(doc.source, "Hello.");
  assert.equal(doc.version, 0);
});

test("a change that splits a paragraph does not guess persistent identities", () => {
  const source = "First line\nSecond line\n";
  const doc = createBlockDocument(source);
  const next = reconcileBlockSource(doc, "First line\n\nSecond line\n");
  assert.equal(next.source, "First line\n\nSecond line\n");
  assert.equal(next.blocks.filter(b => b.type === "paragraph").length, 2);
  assert.equal(next.blocks.every((b, i, all) => i === 0 ||
    all[i - 1].end === b.start), true);
});

test("block projection stays lossless through randomized markdown-like edits", () => {
  let seed = 73129;
  function rand(max) { seed = (seed * 1103515245 + 12345) >>> 0; return seed % max; }
  const fragments = ["x", "ğ", "😀", "\n", "\n\n", "## ", ">", " ", "*", "&", "\r\n"];
  let doc = createBlockDocument("# Header\n\nText");
  const recorded = [];
  for (let i = 0; i < 175; i++) {
    const at = rand(doc.source.length + 1);
    const fragment = fragments[rand(fragments.length)];
    // A source-mode edit can be syntactically invalid and must remain raw.
    const next = doc.source.slice(0, at) + fragment + doc.source.slice(at);
    doc = reconcileBlockSource(doc, next);
    recorded.push(next);
    assert.equal(doc.blocks.map(b => b.raw).join(""), next);
    assert.equal(serializeBlockDocument(doc), next);
  }
  assert.equal(doc.version, recorded.length);
});

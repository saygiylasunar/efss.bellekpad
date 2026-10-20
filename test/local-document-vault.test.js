import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDocumentVault } from "../src/local-document-vault.js";
import { serializeDocument, FORMAT_VERSION } from "../src/efss-markdown.js";

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "efss-vault-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function document(kind, id, body, extra = {}) {
  return serializeDocument({ metadata: {
    efss_version: FORMAT_VERSION, kind, id, ...extra
  }, body });
}

test("source is preserved byte-for-byte, including CRLF and UTF-8", async t => {
  const root = await temporary(t);
  const vault = new LocalDocumentVault({ root: join(root, "storage") });
  const source = document("paper", "first", "# Deneme\n\nÇalışma ve &Müzik.\n").replace(/\n/g, "\r\n");
  const saved = await vault.save(source);
  assert.equal(saved.replaced, false);
  assert.match(saved.revision, /^[a-f0-9]{64}$/);
  const loaded = await vault.read("paper", "first");
  assert.equal(loaded.source, source);
  assert.equal(loaded.revision, saved.revision);
  assert.equal(loaded.body, "# Deneme\n\nÇalışma ve &Müzik.\n");
  assert.equal((await readFile(join(root, "storage", "paper", "first.md"), "utf8")), source);
});

test("a write requires explicit revision to replace existing content", async t => {
  const vault = new LocalDocumentVault({ root: await temporary(t) });
  const original = document("paper", "revisionTest", "Original.\n");
  const updated = document("paper", "revisionTest", "Updated.\n");
  const first = await vault.save(original);
  await assert.rejects(vault.save(updated), /DOCUMENT_ALREADY_EXISTS/);
  await assert.rejects(vault.save(updated, { expectedRevision: "a".repeat(64) }), /DOCUMENT_VERSION_CONFLICT/);
  const second = await vault.save(updated, { expectedRevision: first.revision });
  assert.equal(second.replaced, true);
  assert.notEqual(first.revision, second.revision);
  await assert.rejects(vault.save(original, { expectedRevision: first.revision }), /DOCUMENT_VERSION_CONFLICT/);
  assert.equal((await vault.read("paper", "revisionTest")).source, updated);
});

test("incompatible identity and unsafe ids fail without writing files", async t => {
  const root = await temporary(t);
  const vault = new LocalDocumentVault({ root });
  await assert.rejects(vault.read("paper", "../outside"), /INVALID_DOCUMENT_IDENTITY/);
  await assert.rejects(vault.save("---\nkind: paper\n---\nMissing required fields\n"));
  await assert.rejects(vault.save(document("paper", "safe", "x"), {
    expectedRevision: "../invalid"
  }), /INVALID_REVISION/);
  await assert.rejects(vault.save(document("paper", "safe", "x".repeat(2 * 1024 * 1024))), /DOCUMENT_TOO_LARGE/);
  assert.deepEqual(await vault.list(), []);
});

test("document types are isolated under their own directories", async t => {
  const root = await temporary(t);
  const vault = new LocalDocumentVault({ root });
  await vault.save(document("paper", "sharedId", "Note."));
  await vault.save(document("conversation", "sharedId", "@Person:User\nHello.\n"));
  assert.equal((await vault.list()).length, 2);
  assert.equal((await vault.read("paper", "sharedId")).metadata.kind, "paper");
  assert.equal((await vault.read("conversation", "sharedId")).metadata.kind, "conversation");
});

test("index is rebuilt entirely from durable EFSS documents", async t => {
  const root = await temporary(t);
  const vault = new LocalDocumentVault({ root });
  await vault.save(document("paper", "one", "# Müzik\n\nRitim öğreniyoruz.\n"));
  await vault.save(document("paper", "two", "# Fen\n\nDeney yapıyoruz.\n"));
  const first = await vault.rebuildIndex();
  assert.equal(first.documents, 2);
  assert.ok(first.memory.search({ query: "ritim" }).length > 0);
  const vaultAfterRestart = new LocalDocumentVault({ root });
  const rebuilt = await vaultAfterRestart.rebuildIndex();
  assert.equal(rebuilt.documents, 2);
  assert.equal(rebuilt.memory.search({ query: "ritim" })[0].sourceId, "paper:one");
});

test("restricted documents stay off the default retrieval index", async t => {
  const vault = new LocalDocumentVault({ root: await temporary(t) });
  await vault.save(document("paper", "privateRecord", "Unpublished concept.", {
    visibility: "restricted"
  }));
  await vault.save(document("paper", "ordinaryRecord", "Public example."));
  const ordinary = await vault.rebuildIndex();
  assert.equal(ordinary.documents, 1);
  assert.equal(ordinary.excluded, 1);
  assert.equal(ordinary.memory.source("paper:privateRecord"), null);
  const withRestricted = await vault.rebuildIndex({ allowRestricted: true });
  assert.equal(withRestricted.documents, 2);
  assert.equal(withRestricted.memory.source("paper:privateRecord").metadata.visibility, "restricted");
  assert.equal(withRestricted.memory.search({ query: "unpublished" }).length, 0);
});

test("corrupted or misplaced files do not silently enter the index", async t => {
  const root = await temporary(t);
  await mkdir(join(root, "paper"));
  await writeFile(join(root, "paper", "wrong.md"), document("paper", "other", "test"));
  const vault = new LocalDocumentVault({ root });
  await assert.rejects(vault.read("paper", "wrong"), /DOCUMENT_IDENTITY_MISMATCH/);
  await assert.rejects(vault.rebuildIndex(), /DOCUMENT_IDENTITY_MISMATCH/);
});

test("invalid UTF-8 and symlinked leaf files are rejected", async t => {
  const root = await temporary(t);
  const vault = new LocalDocumentVault({ root });
  await mkdir(join(root, "paper"));
  await writeFile(join(root, "paper", "broken.md"), Buffer.from([0xff, 0xfe, 0xfd]));
  await assert.rejects(vault.read("paper", "broken"));
  await rm(join(root, "paper", "broken.md"));
  const outside = join(root, "not-the-vault.md");
  await writeFile(outside, document("paper", "safe", "External"));
  await symlink(outside, join(root, "paper", "safe.md"));
  await assert.rejects(vault.read("paper", "safe"), /UNSAFE_DOCUMENT_FILE/);
  await assert.rejects(vault.list(), /UNSAFE_DOCUMENT_FILE/);
});

test("a stale lock fails closed until explicitly recovered", async t => {
  const root = await temporary(t);
  const vault = new LocalDocumentVault({ root });
  await mkdir(join(root, "paper"));
  await writeFile(join(root, "paper", "locked.md.lock"), "");
  await assert.rejects(vault.save(document("paper", "locked", "test")), /DOCUMENT_BUSY/);
  assert.equal(await vault.read("paper", "locked"), null);
});

test("saving does not create temporary files on normal completion", async t => {
  const root = await temporary(t);
  const vault = new LocalDocumentVault({ root });
  await vault.save(document("paper", "saved", "test"));
  assert.deepEqual((await readdir(join(root, "paper"))).sort(), ["saved.md"]);
});

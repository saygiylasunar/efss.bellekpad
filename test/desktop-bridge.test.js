import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDocumentVault } from "../src/local-document-vault.js";
import { createDesktopDocumentService } from "../src/desktop-document-service.js";
import {
  APP_HOME, BUNDLED_PATHS, DESKTOP_CHANNELS,
  resolveBundledAsset, isTrustedEditorFrame
} from "../desktop/security.js";
import {
  createDraft, editDraft, snapshotDraft, confirmDraftSave
} from "../src/editor-draft.js";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "bellekpad-desktop-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new LocalDocumentVault({ root: join(root, "local-vault") });
  return { root, vault, service: createDesktopDocumentService({ vault }) };
}

test("native document API only exposes local EFSS paper/project documents", async t => {
  const { root, service, vault } = await setup(t);
  const created = await service.create({ kind: "paper", title: "Yeni Not" });
  assert.equal(created.kind, "paper");
  assert.match(created.id, /^note_[a-f0-9]{32}$/);
  assert.equal(created.body, "");
  assert.match(created.revision, /^[a-f0-9]{64}$/);
  const listed = await service.list();
  assert.deepEqual(listed.map(d => d.id), [created.id]);
  assert.equal(Object.hasOwn(listed[0], "source"), false);
  assert.equal(Object.hasOwn(listed[0], "path"), false);
  assert.deepEqual(await service.open({ kind: "paper", id: created.id }), created);
  assert.equal(await service.open({ kind: "paper", id: "missing" }), null);
  await assert.rejects(service.create({ kind: "conversation", title: "No" }), /INVALID_DOCUMENT_REQUEST/);
  await assert.rejects(service.open({ kind: "paper", id: "../escape" }), /INVALID_DOCUMENT_REQUEST/);
  await assert.rejects(service.open({ kind: "paper", id: created.id, path: root }),
    /INVALID_DOCUMENT_REQUEST/);
  await assert.rejects(service.create({ kind: "paper", title: "Invalid\nName" }),
    /INVALID_DOCUMENT_TITLE/);
  const disk = await vault.read("paper", created.id);
  assert.equal(disk.metadata.title, "Yeni Not");
});

test("renderer save bridge requires optimistic revision and never clobbers a newer version", async t => {
  const { service, vault } = await setup(t);
  const note = await service.create({ kind: "paper", title: "Taslak" });
  const first = await service.saveDraft({
    kind: note.kind, id: note.id, title: "Çalışma",
    body: "# Not\n\nMetin 😀\n", expectedRevision: note.revision
  });
  assert.notEqual(first.revision, note.revision);
  assert.equal((await service.open({ kind: note.kind, id: note.id })).body,
    "# Not\n\nMetin 😀\n");
  await assert.rejects(service.saveDraft({
    kind: note.kind, id: note.id, title: "Eski",
    body: "Silinmesin", expectedRevision: note.revision
  }), /DOCUMENT_VERSION_CONFLICT/);
  await assert.rejects(service.saveDraft({
    kind: note.kind, id: note.id, title: "Eksik",
    body: "Silinmesin", expectedRevision: null
  }), /DOCUMENT_REVISION_REQUIRED/);
  const actual = await vault.read(note.kind, note.id);
  assert.equal(actual.metadata.title, "Çalışma");
  assert.equal(actual.body, "# Not\n\nMetin 😀\n");
});

test("native bridge rejects arbitrary paths, unknown operations and huge payloads", async t => {
  const { service } = await setup(t);
  const record = await service.create({ kind: "paper" });
  const base = { kind: "paper", id: record.id,
    title: "Test", body: "Hello", expectedRevision: record.revision };
  await assert.rejects(service.saveDraft({ ...base, command: "exec" }),
    /INVALID_DOCUMENT_REQUEST/);
  await assert.rejects(service.saveDraft({ ...base, kind: "conversation" }),
    /INVALID_DOCUMENT_REQUEST/);
  await assert.rejects(service.saveDraft({ ...base, title: "a".repeat(161) }),
    /INVALID_DOCUMENT_TITLE/);
  await assert.rejects(service.saveDraft({ ...base, body: "a".repeat(1048577) }),
    /INVALID_DOCUMENT_BODY/);
  await assert.rejects(service.saveDraft({ ...base, expectedRevision: "invalid" }),
    /INVALID_DOCUMENT_REVISION/);
  assert.equal((await service.open({ kind: "paper", id: record.id })).revision, record.revision);
});

test("renderer always receives explicit result/error; preload exports no arbitrary invoke", () => {
  assert.deepEqual(Object.keys(DESKTOP_CHANNELS).sort(), ["chat", "chatCancel", "create", "list", "models", "open", "save"]);
  assert.equal(isTrustedEditorFrame({
    senderURL: APP_HOME, isMainFrame: true
  }), true);
  for (const value of [
    { senderURL: "https://example.invalid", isMainFrame: true },
    { senderURL: "bellekpad://app/untrusted.html", isMainFrame: true },
    { senderURL: APP_HOME, isMainFrame: false }
  ]) assert.equal(isTrustedEditorFrame(value), false);
});

test("bundled protocol is a static allowlist, not a file server", () => {
  assert.ok(BUNDLED_PATHS.includes("/index.html"));
  assert.ok(BUNDLED_PATHS.includes("/app.js"));
  for(const path of ["/src/pipe-table-parser.js", "/src/editor-table-model.js"])
    assert.equal(resolveBundledAsset("bellekpad://app"+path)?.replaceAll("\\", "/").endsWith(path.slice(1)),true);
  assert.equal(resolveBundledAsset(APP_HOME, "GET")?.endsWith("desktop/ui/index.html"), true);
  assert.equal(resolveBundledAsset("bellekpad://app/src/editor-draft.js")?.endsWith("src/editor-draft.js"), true);
  const forbidden = [
    "bellekpad://app/../../.efss/vault/paper/secret.md",
    "bellekpad://app/.env", "bellekpad://app/package.json",
    "bellekpad://evil/index.html",
    "file:///etc/passwd", "https://example.invalid",
    "bellekpad://app/index.html?query=secret",
    "bellekpad://app/unknown.js"
  ];
  for (const url of forbidden) assert.equal(resolveBundledAsset(url), null, url);
  assert.equal(resolveBundledAsset(APP_HOME, "POST"), null);
});

test("draft updates do not lose edits made during an in-flight save", () => {
  const record = { kind: "paper", id: "note_example",
    title: "İlk", body: "A", revision: "a".repeat(64) };
  let draft = createDraft(record);
  draft = editDraft(draft, "body", "AB");
  const sent = snapshotDraft(draft);
  draft = editDraft(draft, "body", "ABC");
  draft = confirmDraftSave(draft, sent, {
    kind: "paper", id: "note_example", revision: "b".repeat(64)
  });
  assert.equal(draft.dirty, true);
  assert.equal(draft.body, "ABC");
  assert.equal(draft.expectedRevision, "b".repeat(64));
  assert.deepEqual(snapshotDraft(draft).body, "ABC");
  assert.throws(() => confirmDraftSave(draft, sent, {
    kind: "paper", id: "other", revision: "c".repeat(64)
  }), /STALE_SAVE_ACK/);
});

test("unchanged draft edits do not mark dirty or fabricate a history entry", () => {
  const record = { kind: "project", id: "example",
    title: "Title", body: "Çalışma", revision: "f".repeat(64) };
  const initial = createDraft(record);
  assert.equal(editDraft(initial, "body", initial.body), initial);
  assert.equal(initial.dirty, false);
  const modified = editDraft(initial, "title", "Title 2");
  assert.equal(modified.dirty, true);
  const submitted = snapshotDraft(modified);
  const saved = confirmDraftSave(modified, submitted, {
    kind: modified.kind, id: modified.id, revision: "e".repeat(64)
  });
  assert.equal(saved.dirty, false);
  assert.equal(saved.version, 1);
  assert.equal(saved.title, "Title 2");
});

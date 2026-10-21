import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");

test("desktop renderer is a local-only module with a restrictive CSP", () => {
  const html = read("desktop/ui/index.html");
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /type="module" src="\.\/app\.js"/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /contenteditable="plaintext-only"/);
});

test("privileged Electron host enforces sandbox, main-frame and no window escape", () => {
  const main = read("desktop/main.js");
  assert.match(main, /sandbox: true/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /will-navigate/);
  assert.match(main, /will-attach-webview/);
  assert.match(main, /trustedRequest\(event\)/);
  assert.doesNotMatch(main, /shell\.openExternal/);
});

test("preload exposes four guarded actions without generalized remote execution", () => {
  const preload = read("desktop/preload.cjs");
  for (const method of ["listDocuments", "openDocument", "createDocument", "saveDraft"])
    assert.match(preload, new RegExp(method + ":"));
  assert.doesNotMatch(preload, /ipcRenderer\.send\(/);
  assert.doesNotMatch(preload, /on: ipcRenderer\.on/);
  assert.match(preload, /if \(process\.isMainFrame\)/);
});

test("the current editor spike keeps IME composition separate from autosave", () => {
  const source = read("desktop/ui/app.js");
  assert.match(source, /compositionstart/);
  assert.match(source, /compositionend/);
  assert.match(source, /COMPOSITION_IN_PROGRESS/);
  assert.match(source, /saveBeforeLeaving/);
  assert.doesNotMatch(source, /innerHTML/);
  assert.doesNotMatch(source, /eval\(/);
});

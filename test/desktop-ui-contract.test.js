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

test("custom editor input adapter owns typing, IME and undo, not the document vault", () => {
  const ui = read("desktop/ui/app.js");
  const adapter = read("src/editor-input-adapter.js");
  assert.match(ui, /attachTextFrame/);
  assert.match(ui, /TextEditorSession/);
  assert.match(ui, /COMPOSITION_IN_PROGRESS/);
  assert.match(ui, /saveBeforeLeaving/);
  assert.match(adapter, /compositionstart/);
  assert.match(adapter, /compositionend/);
  assert.match(adapter, /beforeinput/);
  assert.match(adapter, /historyUndo/);
  assert.match(adapter, /historyRedo/);
  assert.match(adapter, /clipboardData.getData\("text\/plain"\)/);
  assert.doesNotMatch(adapter, /innerHTML/);
  assert.doesNotMatch(adapter, /eval\(/);
});

test("UI exposes visible undo and redo commands without importing editor frameworks", () => {
  const html = read("desktop/ui/index.html");
  const ui = read("desktop/ui/app.js");
  assert.match(html, /id="undo"/);
  assert.match(html, /id="redo"/);
  assert.match(ui, /editorBinding\?\.undo\(\)/);
  assert.match(ui, /editorBinding\?\.redo\(\)/);
});

test("G0.3 source structure outline uses our own EFSS AST and secure DOM creation", () => {
  const html = read("desktop/ui/index.html");
  const app = read("desktop/ui/app.js");
  assert.match(html, /id="block-outline"/);
  assert.match(html, /id="block-count"/);
  assert.match(app, /createBlockDocument/);
  assert.match(app, /reconcileBlockSource/);
  assert.match(app, /blockOutline/);
  assert.match(app, /selectSourceRange/);
  assert.match(app, /document\.createElement/);
  assert.doesNotMatch(app, /innerHTML/);
});

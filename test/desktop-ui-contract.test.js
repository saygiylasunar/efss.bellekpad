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

test("preload exposes five guarded actions without generalized remote execution", () => {
  const preload = read("desktop/preload.cjs");
  for (const method of ["listDocuments", "openDocument", "createDocument", "saveDraft", "listLocalModels"])
    assert.match(preload, new RegExp(method + ":"));
  assert.doesNotMatch(preload, /ipcRenderer\.send\(/);
  assert.doesNotMatch(preload, /on: ipcRenderer\.on/);
  assert.match(preload, /if \(process\.isMainFrame\)/);
});

test("local model discovery is explicit, IPC-scoped and never requests arbitrary URLs", () => {
  const main=read("desktop/main.js");
  const preload=read("desktop/preload.cjs");
  const html=read("desktop/ui/index.html");
  const ui=read("desktop/ui/app.js");
  assert.match(main,/createDesktopModelService/);
  assert.match(main,/DESKTOP_CHANNELS\.models/);
  assert.match(preload,/listLocalModels: \(\) => ipcRenderer\.invoke\("bellekpad:models:list"\)/);
  assert.match(html,/id="local-model-refresh"/);
  assert.match(html,/id="local-model-select"/);
  assert.match(ui,/nodes\["local-model-refresh"\]\.addEventListener\("click"/);
  assert.doesNotMatch(ui,/fetch\(/);
  assert.match(html,/connect-src 'none'/);
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
  assert.match(ui, /\(flowBinding \?\? editorBinding\)\?\.undo\(\)/);
  assert.match(ui, /\(flowBinding \?\? editorBinding\)\?\.redo\(\)/);
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

test("visual Flow mode and Source mode share the same text session and secured document IPC", () => {
  const html = read("desktop/ui/index.html");
  const ui = read("desktop/ui/app.js");
  const adapter = read("src/editor-flow-adapter.js");
  assert.match(html, /id="flow-pane"/);
  assert.match(html, /id="show-flow"/);
  assert.match(html, /id="show-write"/);
  assert.match(html, /id="insert-block"/);
  assert.match(ui, /attachFlowEditor/);
  assert.match(ui, /sharedTextSession/);
  assert.match(ui, /onTextChanged/);
  assert.match(adapter, /contentEditable = "true"/);
  assert.match(adapter, /beforeinput/);
  assert.match(adapter, /compositionend/);
  assert.match(adapter, /calloutMarkdown/);
  assert.match(adapter, /slashFlowCommand/);
  assert.doesNotMatch(adapter, /innerHTML/);
  assert.doesNotMatch(ui, /innerHTML/);
  assert.doesNotMatch(ui, /eval\(/);
});

test("slash callouts preserve the document's existing newline convention", () => {
  const flow = read("src/editor-flow-adapter.js");
  assert.match(flow, /getStructure\(\)\.source\.match\(/);
  assert.match(flow, /calloutMarkdown/);
});

test("G0.5 renders inline marks via safe DOM without importing a rich-text library", () => {
  const html = read("desktop/ui/index.html");
  const app = read("desktop/ui/app.js");
  const flow = read("src/editor-flow-adapter.js");
  for (const name of ["format-bold", "format-italic", "format-strike"])
    assert.match(html, new RegExp('id="' + name + '"'));
  assert.match(app, /flowBinding\.format\(mark\)/);
  assert.match(flow, /planInlineMark/);
  assert.match(flow, /createElement\(tag\)/);
  assert.match(flow, /textContent/);
  assert.doesNotMatch(flow, /innerHTML/);
  assert.doesNotMatch(flow, /execCommand/);
});

test("visual prose Enter uses one line of spacing, not an extra rendered row", () => {
  const adapter = read("src/editor-flow-adapter.js");
  const css = read("desktop/ui/styles.css");
  const model = read("src/editor-flow-model.js");
  assert.match(model, /separator: true/);
  assert.match(adapter, /flow-syntax-separator/);
  assert.match(css, /\.flow-block\.flow-syntax-separator\{display:none\}/);
});


test("G0.7B table delete-last-row control is source transaction, not DOM removal", () => {
  const adapter=read("src/editor-flow-adapter.js");
  const app=read("desktop/ui/app.js");
  const html=read("desktop/ui/index.html");
  const model=read("src/editor-table-model.js");
  assert.match(model,/planTableDeleteLastRow/);
  assert.match(adapter,/deleteLastTableRow/);
  assert.match(app,/flowBinding.deleteLastTableRow/);
  assert.match(html,/id="inspector-table-delete-row"/);
});

test("G0.7B checklist is source-authored and rendered as interactive checkbox", () => {
  const flow=read("src/editor-flow-adapter.js");
  const model=read("src/editor-flow-model.js");
  const html=read("desktop/ui/index.html");
  const css=read("desktop/ui/styles.css");
  assert.match(model,/planFlowChecklistToggle/);
  assert.match(flow,/flow-check-toggle/);
  assert.match(flow,/planFlowChecklistToggle/);
  assert.match(html,/value="checklist"/);
  assert.match(css,/data-checklist="done"/);
});

test("G0.7A native table surface connects source parser, cell editor, and Inspector", () => {
  const ast = read("src/ast.js");
  const flow = read("src/editor-flow-adapter.js");
  const html = read("desktop/ui/index.html");
  const app = read("desktop/ui/app.js");
  const css = read("desktop/ui/styles.css");
  assert.match(ast,/tableHeaderColumns/);
  assert.match(flow,/planTableCellEdit/);
  assert.match(flow,/planTableAppendRow/);
  assert.match(flow,/data-flow-table-cell/);
  assert.match(html,/value="table"/);
  assert.match(html,/id="inspector-table-add-row"/);
  assert.match(app,/flowBinding\.addTableRow/);
  assert.match(css,/\.flow-table-viewport/);
});

test("contextual Inspector surface is real, semantic and source-backed", () => {
  const app = read("desktop/ui/app.js");
  const html = read("desktop/ui/index.html");
  const styles = read("desktop/ui/styles.css");
  const adapter = read("src/editor-flow-adapter.js");
  for (const id of [
    "block-inspector","inspector-heading-level","inspector-bullet-marker",
    "inspector-callout-variant"
  ]) assert.ok(html.includes('id="' + id + '"'));
  assert.match(app,/setAttribute\(attribute, nodes\[id\]\.value\)/);
  assert.match(adapter,/planFlowBlockAttribute/);
  assert.match(styles,/\.editor-stage\{display:grid/);
});

test("G0.6B.3 single-depth bullet keyboard actions stay local and source-aware", () => {
  const flow = read("src/editor-flow-model.js");
  const adapter = read("src/editor-flow-adapter.js");
  const styles = read("desktop/ui/styles.css");
  assert.match(flow, /planFlowListIndent/);
  assert.match(flow, /planFlowBackspaceAtStart/);
  assert.match(adapter, /event\.key === "Tab"/);
  assert.match(adapter, /planFlowBackspaceAtStart/);
  assert.match(adapter, /card\.dataset\.listDepth/);
  assert.match(styles, /data-list-depth="1"/);
});

test("G0.6B semantic heading/list variants are exposed to the renderer theme", () => {
  const adapter = read("src/editor-flow-adapter.js");
  const css = read("desktop/ui/styles.css");
  assert.match(adapter, /card\.dataset\.headingLevel/);
  assert.match(adapter, /card\.dataset\.listStyle/);
  for (let n = 1; n <= 6; n++)
    assert.ok(css.includes('data-heading-level="' + n + '"'));
  assert.match(css, /data-list-style="ordered"/);
});

test("G0.6A maps native rich spans to exact Markdown source positions", () => {
  const adapter = read("src/editor-flow-adapter.js");
  const format = read("src/editor-inline-format.js");
  assert.match(adapter, /data-inline-run/);
  assert.match(adapter, /domSourcePoint/);
  assert.match(adapter, /sourceDOMPoint/);
  assert.match(adapter, /planInlineTextEdit/);
  assert.match(adapter, /clipboardData\?\.setData\("text\/plain"/);
  assert.match(format, /HIDDEN_MARKER_SELECTION/);
  assert.match(format, /INLINE_EDIT_CHANGES_MARKUP/);
  assert.doesNotMatch(adapter, /innerHTML/);
});

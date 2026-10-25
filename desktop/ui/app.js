import { parseMarkdownAst } from "../../src/ast.js";
import { TextEditorSession, collapsedSelection } from "../../src/editor-text-engine.js";
import { attachTextFrame } from "../../src/editor-input-adapter.js";
import { createBlockDocument, reconcileBlockSource, blockOutline } from "../../src/editor-block-model.js";
import { attachFlowEditor } from "../../src/editor-flow-adapter.js";
import { makeIcon, decorateUI } from "../../src/ui-icons.js";
import {
  createDraft, editDraft, snapshotDraft, confirmDraftSave
} from "../../src/editor-draft.js";

decorateUI(document);

const bridge = window.bellekpadDesktop;
const nodes = Object.fromEntries([
  "document-list", "document-count", "new-document", "start-document",
  "empty-state", "editor-screen", "document-title", "document-id",
  "crumb-title", "save-state", "save", "editor", "write-pane", "preview-pane",
  "show-flow", "show-write", "show-preview", "flow-pane", "character-count", "undo", "redo",
  "insert-kind", "insert-block", "format-bold", "format-italic", "format-strike",
  "block-count", "block-outline", "block-inspector",
  "inspector-block-type", "inspector-block-detail",
  "inspector-heading-group", "inspector-heading-level",
  "inspector-bullet-group", "inspector-bullet-marker",
  "inspector-callout-group", "inspector-callout-variant",
  "inspector-table-group","inspector-table-dimensions","inspector-table-add-row"
].map(id => [id, document.getElementById(id)]));

let current = null;
let documents = [];
let saving = null;
let delayedSave = null;
let blocked = false;
let navigationBusy = false;
let composing = false;
let editorBinding = null;
let flowBinding = null;
let sharedTextSession = null;
let activeMode = "flow";
let structure = null;
let outlineFrame = null;
function scheduleStructureDisplay() {
  if (outlineFrame !== null) return;
  outlineFrame = window.requestAnimationFrame(() => {
    outlineFrame = null;
    showStructure(); // Render the latest projection, not an old keystroke.
  });
}

const BLOCK_NAMES = Object.freeze({
  heading: "Başlık", paragraph: "Paragraf", blank: "Boşluk",
  list_item: "Liste", quote: "Alıntı", directive: "EFSS komutu",
  code_fence: "Kod", indented_code: "Kod", extension_block: "EFSS bloğu",
  thematic_break: "Ayraç", table: "Tablo"
});
function showStructure() {
  if (!structure) return;
  const outline = blockOutline(structure);
  nodes["block-count"].textContent = outline.length + " blok";
  nodes["block-outline"].replaceChildren();
  for (const block of outline) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outline-entry";
    const kind = document.createElement("span");
    kind.className = "outline-kind";
    kind.textContent = BLOCK_NAMES[block.type] ?? block.type;
    const label = document.createElement("span");
    label.className = "outline-caption";
    label.textContent = block.opaque ? "Salt okunur özel EFSS bloğu" : block.preview || "İçeriksiz blok";
    button.append(kind, label);
    button.addEventListener("click", () => {
      showView("write");
      editorBinding?.selectSourceRange(block.start, block.start);
    });
    item.append(button);
    nodes["block-outline"].append(item);
  }
}


/**
 * One selected source-backed block, one relevant property group.
 * Never fabricate custom typography/geometry data that EFSS cannot yet store.
 */
function updateInspector(block) {
  const heading = block?.type === "heading" && block.editable;
  const bullet = block?.type === "list_item" && block.editable &&
    block.list?.style === "bullet";
  const callout = block?.type === "callout" && block.editable;
  const table = block?.type === "table" && !!block.table;
  nodes["inspector-heading-group"].hidden = !heading;
  nodes["inspector-bullet-group"].hidden = !bullet;
  nodes["inspector-callout-group"].hidden = !callout;
  nodes["inspector-table-group"].hidden = !table;
  nodes["inspector-block-type"].textContent = block ?
    BLOCK_NAMES[block.type] ?? block.type : "Blok seçilmedi";
  if (heading) {
    nodes["inspector-heading-level"].value = String(block.level);
    nodes["inspector-block-detail"].textContent =
      "H" + block.level + " · Kaynağı ve metni koruyarak seviye değiştir.";
  } else if (bullet) {
    nodes["inspector-bullet-marker"].value = block.list.token;
    nodes["inspector-block-detail"].textContent =
      "Madde işaretli liste · Seviye " + (block.list.depth + 1);
  } else if (callout) {
    nodes["inspector-callout-variant"].value = block.variant;
    nodes["inspector-block-detail"].textContent =
      "Başlığı ve içeriği koruyan EFSS bilgi kutusu.";
  } else if (table) {
    nodes["inspector-block-detail"].textContent =
      "Hücreye doğrudan yaz; Tab / Shift+Tab hücreler arasında geçer.";
    nodes["inspector-table-dimensions"].textContent =
      block.table.columns + " sütun · " + block.table.rows.length + " satır";
    nodes["inspector-table-add-row"].disabled = block.table.rows.length >= 100;
  } else nodes["inspector-block-detail"].textContent = !block ?
    "Düzenlemek için görsel alandaki bir bloğu seç." :
    block.editable ? "Bu blok için henüz değiştirilebilir özellik yok." :
      "Özel kaynak korunuyor; bu blok salt okunur.";
}

function updateHistoryButtons() {
  nodes["undo"].disabled = !sharedTextSession?.canUndo;
  nodes["redo"].disabled = !sharedTextSession?.canRedo;
}

function status(label, problem = false) {
  nodes["save-state"].textContent = label;
  nodes["save-state"].style.color = problem ? "#f2a49c" : "";
}
function call(name, ...args) {
  if (!bridge || typeof bridge[name] !== "function")
    throw new Error("DESKTOP_BRIDGE_UNAVAILABLE");
  return bridge[name](...args).then(result => {
    if (!result || result.ok !== true) throw new Error(result?.error ?? "BRIDGE_ERROR");
    return result.data;
  });
}
function scheduleSave() {
  clearTimeout(delayedSave);
  if (!current || blocked) return;
  delayedSave = setTimeout(() => {
    void saveCurrent().catch(() => {});
  }, 650);
}
function edited(field, value) {
  if (!current) return;
  current = editDraft(current, field, value);
  nodes["character-count"].textContent = current.body.length + " karakter";
  nodes["save"].disabled = !current.dirty;
  updateHistoryButtons();
  status(current.dirty ? "Kaydedilmedi" : "Kaydedildi");
  if (current.dirty) scheduleSave();
}
async function saveCurrent() {
  clearTimeout(delayedSave);
  if (composing) throw new Error("COMPOSITION_IN_PROGRESS");
  if (blocked) throw new Error("SAVE_BLOCKED");
  if (saving) return saving;
  if (!current || !current.dirty) return;
  const noteIdentity = current.id;
  saving = (async () => {
    while (current?.id === noteIdentity && current.dirty) {
      const submitted = snapshotDraft(current);
      status("Kaydediliyor…");
      try {
        const saved = await call("saveDraft", submitted);
        if (current?.id === noteIdentity) {
          current = confirmDraftSave(current, submitted, saved);
          nodes["save"].disabled = !current.dirty;
          status(current.dirty ? "Değişiklik bekliyor" : "Kaydedildi");
          // Keep newly-entered content dirty while an older save was in flight.
        }
      } catch (error) {
        blocked = true;
        const name = error?.message === "DOCUMENT_VERSION_CONFLICT" ?
          "Sürüm çakışması — belgeyi yeniden açın" :
          "Kaydedilemedi — " + (error?.message ?? "Bilinmeyen hata");
        status(name, true);
        throw error;
      }
    }
    await refreshList();
  })().finally(() => {
    saving = null;
    // An edit can land after the last awaited save but before list refresh.
    // Guarantee a new autosave attempt instead of losing that pending edit.
    if (current?.dirty && !blocked) scheduleSave();
  });
  return saving;
}
async function refreshList() {
  documents = await call("listDocuments");
  nodes["document-count"].textContent = String(documents.length);
  nodes["document-list"].replaceChildren();
  for (const item of documents) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "document-item" +
      (current?.id === item.id && current.kind === item.kind ? " selected" : "");
    const symbol = makeIcon(document, item.kind === "project" ? "layers" : "document");
    const label = document.createElement("span");
    label.textContent = item.title || "Adsız sayfa";
    button.append(symbol, label);
    button.addEventListener("click", () => { void openNote(item.kind, item.id); });
    nodes["document-list"].append(button);
  }
}
function present(record) {
  editorBinding?.destroy();
  flowBinding?.destroy();
  editorBinding = null;
  flowBinding = null;
  current = createDraft(record);
  structure = createBlockDocument(current.body);
  blocked = false;
  nodes["empty-state"].hidden = true;
  nodes["editor-screen"].hidden = false;
  nodes["document-title"].value = current.title;
  nodes["document-id"].textContent = current.kind + ":" + current.id.slice(-7);
  nodes["crumb-title"].textContent = current.title || "Adsız sayfa";
  sharedTextSession = new TextEditorSession({
    text: current.body, selection: collapsedSelection(0)
  });
  nodes["character-count"].textContent = current.body.length + " karakter";
  updateHistoryButtons();
  showStructure();
  nodes["save"].disabled = true;
  status("Kaydedildi");
  showView("flow");
  flowBinding?.focus();
}
async function saveBeforeLeaving() {
  if (composing) throw new Error("COMPOSITION_IN_PROGRESS");
  if (current?.dirty) await saveCurrent();
  if (current?.dirty) await saveCurrent();
  if (current?.dirty) throw new Error("UNSAVED_CHANGES");
}
async function openNote(kind, id) {
  if (navigationBusy || (current?.id === id && current.kind === kind)) return;
  navigationBusy = true;
  try {
    await saveBeforeLeaving();
    const record = await call("openDocument", kind, id);
    if (!record) throw new Error("DOCUMENT_NOT_FOUND");
    present(record);
    await refreshList();
  } catch (error) {
    status("Açılamadı: " + (error?.message ?? "Hata"), true);
  } finally { navigationBusy = false; }
}
async function newNote() {
  if (navigationBusy) return;
  navigationBusy = true;
  try {
    await saveBeforeLeaving();
    const created = await call("createDocument", "paper", "Adsız sayfa");
    present(created);
    await refreshList();
    nodes["document-title"].focus();
    nodes["document-title"].select();
  } catch (error) {
    status("Oluşturulamadı: " + (error?.message ?? "Hata"), true);
  } finally { navigationBusy = false; }
}
function renderInline(into, items) {
  for (const token of items ?? []) {
    let tag = "span";
    if (token.type === "inline_code") tag = "code";
    if (token.type === "mark") {
      tag = { strong: "strong", emphasis: "em", strike: "del" }[token.rule] ?? "span";
    }
    const node = document.createElement(tag);
    if (token.children?.length) renderInline(node, token.children);
    else node.textContent = token.type === "mark" ? token.raw : token.raw ?? "";
    into.append(node);
  }
}
function renderPreview() {
  const preview = nodes["preview-pane"];
  preview.replaceChildren();
  if (!current) return;
  const tree = parseMarkdownAst(current.body);
  for (const block of tree.blocks) {
    if (block.type === "blank") continue;
    let node;
    if (block.type === "heading") node = document.createElement("h" + block.level);
    else if (block.type === "quote") node = document.createElement("blockquote");
    else if (block.type === "code_fence" || block.type === "indented_code") {
      node = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.raw;
      node.append(code);
    } else if (block.type === "list_item") {
      node = document.createElement("p");
      node.style.paddingLeft = "18px";
    } else node = document.createElement("p");
    if (block.inline && !node.firstChild) renderInline(node, block.inline);
    else if (!node.firstChild) node.textContent = block.raw;
    preview.append(node);
  }
  if (!preview.firstChild) preview.textContent = "Önizlenecek içerik yok.";
}
function onTextChanged(text) {
  structure = reconcileBlockSource(structure, text);
  edited("body", text);
  scheduleStructureDisplay();
  updateHistoryButtons();
}
function onCompositionChange(active) {
  composing = active;
  if (active) clearTimeout(delayedSave);
  else if (current?.dirty) scheduleSave();
}
function showView(view) {
  if (composing || !current || !["flow", "write", "preview"].includes(view)) return;
  if (activeMode === view && (editorBinding || flowBinding || view === "preview")) {
    if (view === "preview") renderPreview();
    return;
  }
  editorBinding?.destroy();
  flowBinding?.destroy();
  editorBinding = null;
  flowBinding = null;
  activeMode = view;
  const flow = view === "flow", source = view === "write", preview = view === "preview";
  nodes["block-inspector"].hidden = !flow;
  if (!flow) updateInspector(null);
  nodes["flow-pane"].hidden = !flow;
  nodes["write-pane"].hidden = !source;
  nodes["preview-pane"].hidden = !preview;
  for (const [id, active] of [
    ["show-flow", flow], ["show-write", source], ["show-preview", preview]
  ]) {
    nodes[id].classList.toggle("active", active);
    nodes[id].setAttribute("aria-pressed", String(active));
  }
  for (const id of ["format-bold", "format-italic", "format-strike"])
    nodes[id].disabled = !flow;
  if (source) {
    editorBinding = attachTextFrame(nodes["editor"], {
      session: sharedTextSession, onChange: onTextChanged,
      onCompositionChange
    });
  } else if (flow) {
    flowBinding = attachFlowEditor(nodes["flow-pane"], {
      session: sharedTextSession, getStructure: () => structure,
      onChange: onTextChanged, onCompositionChange,
      onActiveBlock: updateInspector,
      onNavigateSource(offset) {
        showView("write");
        editorBinding?.selectSourceRange(offset);
      },
      onError(message) { status(message, true); }
    });
  } else renderPreview();
  updateHistoryButtons();
}
nodes["document-title"].addEventListener("input", () => {
  edited("title", nodes["document-title"].value);
  nodes["crumb-title"].textContent = nodes["document-title"].value || "Adsız sayfa";
});
nodes["undo"].addEventListener("click", () => {
  (flowBinding ?? editorBinding)?.undo();
  updateHistoryButtons();
});
nodes["redo"].addEventListener("click", () => {
  (flowBinding ?? editorBinding)?.redo();
  updateHistoryButtons();
});
nodes["save"].addEventListener("click", () => { void saveCurrent().catch(() => {}); });
nodes["new-document"].addEventListener("click", () => { void newNote(); });
nodes["start-document"].addEventListener("click", () => { void newNote(); });
nodes["show-flow"].addEventListener("click", () => showView("flow"));
nodes["show-write"].addEventListener("click", () => showView("write"));
nodes["show-preview"].addEventListener("click", () => showView("preview"));
for (const [id, mark] of [
  ["format-bold", "strong"], ["format-italic", "emphasis"], ["format-strike", "strike"]
]) {
  const button = nodes[id];
  // Toolbar clicks must not discard the user's native DOM selection.
  button.addEventListener("pointerdown", event => {
    if (flowBinding) event.preventDefault();
  });
  button.addEventListener("click", () => {
    if (flowBinding) flowBinding.format(mark);
    updateHistoryButtons();
  });
}
for (const [id, attribute] of [
  ["inspector-heading-level", "headingLevel"],
  ["inspector-bullet-marker", "bulletMarker"],
  ["inspector-callout-variant", "calloutVariant"]
]) {
  nodes[id].addEventListener("change", () => {
    if (!flowBinding || blocked || composing) return;
    flowBinding.setAttribute(attribute, nodes[id].value);
    updateHistoryButtons();
    updateInspector(flowBinding.getActiveBlock());
  });
}
nodes["inspector-table-add-row"].addEventListener("click", () => {
  if (!flowBinding || blocked || composing) return;
  flowBinding.addTableRow();
  updateHistoryButtons();
  updateInspector(flowBinding.getActiveBlock());
});
nodes["insert-block"].addEventListener("click", () => {
  if (!current || composing) return;
  showView("flow");
  const [kind, variant = "info"] = nodes["insert-kind"].value.split(":");
  try {
    flowBinding?.insert(kind, variant);
    updateHistoryButtons();
  } catch (error) {
    status("Blok eklenemedi: " + (error?.message ?? "Hata"), true);
  }
});
window.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveCurrent().catch(() => {});
  }
});
window.addEventListener("beforeunload", event => {
  if (current?.dirty || saving || composing) {
    // Before Electron supports a safe close confirmation, do not promise
    // save-on-close; a pending write must not silently disappear.
    event.preventDefault();
    event.returnValue = "";
  }
});
void refreshList().catch(error => {
  status("Bağlantı hatası: " + (error?.message ?? "Bilinmeyen hata"), true);
});

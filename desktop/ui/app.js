import { parseMarkdownAst } from "../../src/ast.js";
import { TextEditorSession, collapsedSelection } from "../../src/editor-text-engine.js";
import { attachTextFrame } from "../../src/editor-input-adapter.js";
import { createBlockDocument, reconcileBlockSource, blockOutline } from "../../src/editor-block-model.js";
import {
  createDraft, editDraft, snapshotDraft, confirmDraftSave
} from "../../src/editor-draft.js";

const bridge = window.bellekpadDesktop;
const nodes = Object.fromEntries([
  "document-list", "document-count", "new-document", "start-document",
  "empty-state", "editor-screen", "document-title", "document-id",
  "crumb-title", "save-state", "save", "editor", "write-pane", "preview-pane",
  "show-write", "show-preview", "character-count", "undo", "redo",
  "block-count", "block-outline"
].map(id => [id, document.getElementById(id)]));

let current = null;
let documents = [];
let saving = null;
let delayedSave = null;
let blocked = false;
let navigationBusy = false;
let composing = false;
let editorBinding = null;
let structure = null;

const BLOCK_NAMES = Object.freeze({
  heading: "Başlık", paragraph: "Paragraf", blank: "Boşluk",
  list_item: "Liste", quote: "Alıntı", directive: "EFSS komutu",
  code_fence: "Kod", indented_code: "Kod", extension_block: "EFSS bloğu",
  thematic_break: "Ayraç"
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

function updateHistoryButtons() {
  nodes["undo"].disabled = !editorBinding?.session.canUndo;
  nodes["redo"].disabled = !editorBinding?.session.canRedo;
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
    const symbol = document.createElement("span");
    symbol.textContent = item.kind === "project" ? "◇" : "▤";
    symbol.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = item.title || "Adsız sayfa";
    button.append(symbol, label);
    button.addEventListener("click", () => { void openNote(item.kind, item.id); });
    nodes["document-list"].append(button);
  }
}
function present(record) {
  editorBinding?.destroy();
  editorBinding = null;
  current = createDraft(record);
  structure = createBlockDocument(current.body);
  blocked = false;
  nodes["empty-state"].hidden = true;
  nodes["editor-screen"].hidden = false;
  nodes["document-title"].value = current.title;
  nodes["document-id"].textContent = current.kind + ":" + current.id.slice(-7);
  nodes["crumb-title"].textContent = current.title || "Adsız sayfa";
  editorBinding = attachTextFrame(nodes["editor"], {
    session: new TextEditorSession({
      text: current.body, selection: collapsedSelection(0)
    }),
    onChange(text) {
      structure = reconcileBlockSource(structure, text);
      edited("body", text);
      showStructure();
      updateHistoryButtons();
    },
    onCompositionChange(active) {
      composing = active;
      if (active) clearTimeout(delayedSave);
      else if (current?.dirty) scheduleSave();
    }
  });
  nodes["character-count"].textContent = current.body.length + " karakter";
  updateHistoryButtons();
  showStructure();
  nodes["save"].disabled = true;
  status("Kaydedildi");
  showView("write");
  editorBinding.focus();
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
function showView(view) {
  const write = view === "write";
  nodes["write-pane"].hidden = !write;
  nodes["preview-pane"].hidden = write;
  nodes["show-write"].classList.toggle("active", write);
  nodes["show-preview"].classList.toggle("active", !write);
  nodes["show-write"].setAttribute("aria-pressed", String(write));
  nodes["show-preview"].setAttribute("aria-pressed", String(!write));
  if (!write) renderPreview();
}

nodes["document-title"].addEventListener("input", () => {
  edited("title", nodes["document-title"].value);
  nodes["crumb-title"].textContent = nodes["document-title"].value || "Adsız sayfa";
});
nodes["undo"].addEventListener("click", () => {
  editorBinding?.undo();
  updateHistoryButtons();
});
nodes["redo"].addEventListener("click", () => {
  editorBinding?.redo();
  updateHistoryButtons();
});
nodes["save"].addEventListener("click", () => { void saveCurrent().catch(() => {}); });
nodes["new-document"].addEventListener("click", () => { void newNote(); });
nodes["start-document"].addEventListener("click", () => { void newNote(); });
nodes["show-write"].addEventListener("click", () => showView("write"));
nodes["show-preview"].addEventListener("click", () => showView("preview"));
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

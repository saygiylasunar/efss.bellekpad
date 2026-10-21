import { parseMarkdownAst } from "../../src/ast.js";
import {
  createDraft, editDraft, snapshotDraft, confirmDraftSave
} from "../../src/editor-draft.js";

const bridge = window.bellekpadDesktop;
const nodes = Object.fromEntries([
  "document-list", "document-count", "new-document", "start-document",
  "empty-state", "editor-screen", "document-title", "document-id",
  "crumb-title", "save-state", "save", "editor", "write-pane", "preview-pane",
  "show-write", "show-preview", "character-count"
].map(id => [id, document.getElementById(id)]));

let current = null;
let documents = [];
let saving = null;
let delayedSave = null;
let blocked = false;
let navigationBusy = false;

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
  status(current.dirty ? "Kaydedilmedi" : "Kaydedildi");
  if (current.dirty) scheduleSave();
}
async function saveCurrent() {
  clearTimeout(delayedSave);
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
  current = createDraft(record);
  blocked = false;
  nodes["empty-state"].hidden = true;
  nodes["editor-screen"].hidden = false;
  nodes["document-title"].value = current.title;
  nodes["document-id"].textContent = current.kind + ":" + current.id.slice(-7);
  nodes["crumb-title"].textContent = current.title || "Adsız sayfa";
  nodes["editor"].textContent = current.body;
  nodes["character-count"].textContent = current.body.length + " karakter";
  nodes["save"].disabled = true;
  status("Kaydedildi");
  showView("write");
  nodes["editor"].focus();
}
async function openNote(kind, id) {
  if (navigationBusy || (current?.id === id && current.kind === kind)) return;
  navigationBusy = true;
  try {
    if (current?.dirty) await saveCurrent();
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
    if (current?.dirty) await saveCurrent();
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
nodes["editor"].addEventListener("input", () => {
  // Native Chromium owns temporary composition DOM; we only read plain text
  // and never replace active content or reset selection on input.
  edited("body", nodes["editor"].innerText.replace(/\r\n?/g, "\n"));
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
  if (current?.dirty || saving) {
    // Before Electron supports a safe close confirmation, do not promise
    // save-on-close; a pending write must not silently disappear.
    event.preventDefault();
    event.returnValue = "";
  }
});
void refreshList().catch(error => {
  status("Bağlantı hatası: " + (error?.message ?? "Bilinmeyen hata"), true);
});

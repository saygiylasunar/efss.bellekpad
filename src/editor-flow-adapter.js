import {
  TextEditorSession, collapsedSelection, nearestGraphemeBoundary,
  selectionBounds, textPosition
} from "./editor-text-engine.js";
import {
  projectFlowBlocks, insertFlowBlock, calloutMarkdown, slashFlowCommand
} from "./editor-flow-model.js";

// Native DOM is the input surface. The global TextEditorSession is still the
// single writable source of truth and owns history in *all* editing modes.
function domCaret(element, node, offset) {
  if (!(node === element || element.contains(node))) return null;
  try {
    const range = element.ownerDocument.createRange();
    range.setStart(element, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch { return null; }
}
function readRange(element, block) {
  const selected = element.ownerDocument.getSelection();
  if (!selected) return null;
  const a = domCaret(element, selected.anchorNode, selected.anchorOffset);
  const b = domCaret(element, selected.focusNode, selected.focusOffset);
  if (a === null || b === null) return null;
  const position = x => nearestGraphemeBoundary(
    block.text, Math.min(block.text.length, Math.max(0, x)), "nearest"
  );
  return {
    anchor: textPosition(block.sourceStart + position(a)),
    focus: textPosition(block.sourceStart + position(b))
  };
}
function focusOffset(element, offset) {
  element.focus();
  const doc = element.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) return;
  let text = element.firstChild;
  if (!text || text.nodeType !== 3) {
    text = doc.createTextNode("");
    element.replaceChildren(text);
  }
  const n = Math.max(0, Math.min(text.textContent.length, offset));
  selection.setBaseAndExtent(text, n, text, n);
}
function noteElement(doc, block, kind) {
  const card = doc.createElement("div");
  card.className = "flow-block flow-" + block.type;
  card.dataset.blockId = block.id;
  if (block.variant) card.dataset.variant = block.variant;
  const gutter = doc.createElement("span");
  gutter.className = "flow-gutter";
  gutter.setAttribute("aria-hidden", "true");
  gutter.textContent = kind;
  card.append(gutter);
  return card;
}
function editPayload(event) {
  if (event.inputType === "insertText" && typeof event.data === "string") {
    return { type: "insertText", text: event.data };
  }
  if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak")
    return { type: "replaceSelection", text: "\n\n" };
  if (event.inputType === "deleteContentBackward")
    return { type: "deleteBackward" };
  if (event.inputType === "deleteContentForward")
    return { type: "deleteForward" };
  if (event.inputType === "deleteByCut")
    return { type: "replaceSelection", text: "" };
  return null;
}
export function attachFlowEditor(host, {
  session, getStructure, onChange, onCompositionChange = () => {},
  onNavigateSource = () => {}
} = {}) {
  if (!host || !(session instanceof TextEditorSession) ||
      typeof getStructure !== "function" || typeof onChange !== "function")
    throw new TypeError("INVALID_FLOW_EDITOR");
  const controller = new AbortController(), signal = controller.signal;
  let composing = false, activeId = null;
  const doc = host.ownerDocument;

  function notify() { onChange(session.snapshot.text); }
  function render({ focusAt = null, preferredId = null } = {}) {
    if (composing) return;
    const blocks = projectFlowBlocks(getStructure());
    const fragment = doc.createDocumentFragment();
    const editors = new Map();
    let nearest = null;
    for (const block of blocks) {
      const label = block.type === "callout" ? block.icon :
        block.type === "heading" ? "H" + (block.level ?? 1) :
        block.type === "list_item" ? "•" :
        block.type === "quote" ? "❝" : "⋮";
      const card = noteElement(doc, block, label);
      if (block.type === "callout") {
        const header = doc.createElement("div");
        header.className = "flow-callout-header";
        header.textContent = block.icon + "  " + block.title;
        card.append(header);
      }
      if (block.editable) {
        const editor = doc.createElement("div");
        editor.className = "flow-editable";
        editor.dataset.flowBlock = block.id;
        editor.contentEditable = "plaintext-only";
        editor.role = "textbox";
        editor.setAttribute("aria-label", block.type === "callout" ?
          "Callout içeriği" : "Düzenlenebilir " + block.type);
        editor.setAttribute("aria-multiline", "false");
        editor.spellcheck = true;
        editor.dataset.placeholder = block.type === "callout" ?
          "Bir şey yaz…" : "Yazmaya başla…";
        editor.textContent = block.text;
        card.append(editor);
        editors.set(block.id, { editor, block });
        editor.addEventListener("focus", () => { activeId = block.id; }, { signal });
        if (focusAt !== null &&
            block.sourceStart <= focusAt && focusAt <= block.sourceEnd) nearest = block.id;
      } else {
        const locked = doc.createElement("div");
        locked.className = "flow-readonly";
        locked.textContent = block.raw.length > 300 ?
          block.raw.slice(0, 300) + "…" : block.raw;
        card.append(locked);
        const source = doc.createElement("button");
        source.className = "flow-source-action";
        source.type = "button";
        source.textContent = "Kaynağı düzenle ↗";
        source.addEventListener("click", () => onNavigateSource(block.start), { signal });
        card.append(source);
      }
      fragment.append(card);
    }
    host.replaceChildren(fragment);
    const toFocus = focusAt !== null ? (editors.get(preferredId) ??
      editors.get(nearest)) : null;
    if (toFocus) {
      activeId = toFocus.block.id;
      focusOffset(toFocus.editor, focusAt - toFocus.block.sourceStart);
    }
  }

  function selectedRange(editor, block) {
    const range = readRange(editor, block);
    if (!range) return null;
    session.setSelection(range);
    activeId = block.id;
    return range;
  }

  function finish(result, { focusAt = null, preferredId = null } = {}) {
    if (!result.changed) return;
    notify();
    render({ focusAt: focusAt ?? session.snapshot.selection.focus.offset,
      preferredId });
  }

  function dispatch(editor, block, command) {
    if (!selectedRange(editor, block)) return;
    const sel = selectionBounds(session.snapshot.selection);
    // Do not reach into the invisible source delimiters at block edges.
    if (command.type === "deleteBackward" && sel.start === sel.end &&
        sel.start <= block.sourceStart) return;
    if (command.type === "deleteForward" && sel.start === sel.end &&
        sel.end >= block.sourceEnd) return;
    const result = session.dispatch(command);
    finish(result, { preferredId: block.id });
  }

  function history(type) {
    if (composing) return;
    const result = type === "undo" ? session.undo() : session.redo();
    finish(result);
  }
  function reconcileNative(editor, block) {
    if (composing) return;
    const text = (editor.childNodes.length <= 1 && editor.firstChild?.nodeType === 3 ?
      editor.textContent : editor.innerText).replace(/\r\n?/g, "\n");
    if (text === block.text) return;
    const rawCaret = domCaret(editor, doc.getSelection()?.focusNode,
      doc.getSelection()?.focusOffset);
    const delta = session.dispatch({
      type: "replaceRange", from: block.sourceStart,
      to: block.sourceEnd, text
    });
    const caret = block.sourceStart + Math.max(0, Math.min(text.length, rawCaret ?? text.length));
    const safe = nearestGraphemeBoundary(session.snapshot.text,
      Math.min(session.snapshot.text.length, caret), "right");
    session.setSelection(collapsedSelection(safe));
    finish(delta, { focusAt: safe });
  }

  host.addEventListener("beforeinput", event => {
    const editor = event.target.closest?.("[data-flow-block]");
    if (!editor || composing || event.isComposing || !event.cancelable) return;
    const block = projectFlowBlocks(getStructure()).find(b => b.id === editor.dataset.flowBlock);
    if (!block?.editable) return;
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      event.preventDefault(); history(event.inputType === "historyUndo" ? "undo" : "redo");
      return;
    }
    const command = editPayload(event);
    if (!command) return;
    event.preventDefault();
    if (command.type === "insertText" && ["paragraph", "blank"].includes(block.type) &&
        block.sourceStart === block.start) {
      const candidate = block.text.slice(0, domCaret(editor,
        doc.getSelection()?.anchorNode, doc.getSelection()?.anchorOffset) ?? block.text.length) +
        command.text +
        block.text.slice(domCaret(editor,
          doc.getSelection()?.focusNode, doc.getSelection()?.focusOffset) ?? block.text.length);
      const slash = slashFlowCommand(candidate);
      if (slash && selectedRange(editor, block)) {
        const raw = slash.kind === "callout" ?
          calloutMarkdown(slash.variant, "\n") :
          ({ heading: "# ", list_item: "- ", quote: "> " })[slash.kind];
        const changed = session.dispatch({
          type: "replaceRange", from: block.start,
          to: block.sourceEnd, text: raw
        });
        finish(changed, { focusAt: block.start + (slash.kind === "callout" ?
          raw.indexOf("\n") + 1 : raw.length) });
        return;
      }
    }
    dispatch(editor, block, command);
  }, { signal });

  host.addEventListener("input", event => {
    const editor = event.target.closest?.("[data-flow-block]");
    if (!editor || composing) return;
    const block = projectFlowBlocks(getStructure()).find(b => b.id === editor.dataset.flowBlock);
    if (block?.editable) reconcileNative(editor, block);
  }, { signal });

  host.addEventListener("compositionstart", event => {
    if (!event.target.closest?.("[data-flow-block]")) return;
    composing = true;
    activeId = event.target.dataset.flowBlock;
    onCompositionChange(true);
  }, { signal });
  host.addEventListener("compositionend", event => {
    const editor = event.target.closest?.("[data-flow-block]");
    if (!editor) return;
    composing = false;
    const block = projectFlowBlocks(getStructure()).find(b => b.id === editor.dataset.flowBlock);
    if (block?.editable) reconcileNative(editor, block);
    onCompositionChange(false);
  }, { signal });

  host.addEventListener("paste", event => {
    const editor = event.target.closest?.("[data-flow-block]");
    if (!editor || composing || !event.clipboardData) return;
    const block = projectFlowBlocks(getStructure()).find(b => b.id === editor.dataset.flowBlock);
    if (!block?.editable) return;
    event.preventDefault();
    const content = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    if (content) dispatch(editor, block, { type: "replaceSelection", text: content });
  }, { signal });

  host.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || composing || event.isComposing) return;
    const k = event.key.toLowerCase();
    if (k === "z" && !event.altKey) {
      event.preventDefault(); history(event.shiftKey ? "redo" : "undo");
    } else if (k === "y" && !event.altKey) {
      event.preventDefault(); history("redo");
    }
  }, { signal });

  function insert(kind, variant = "info") {
    if (composing) return false;
    const before = getStructure();
    const afterId = before.blocks.some(block => block.id === activeId) ? activeId : null;
    const next = insertFlowBlock(before, { afterId, kind, variant });
    if (next.source === before.source) return false;
    const result = session.dispatch({
      type: "replaceRange", from: 0, to: before.source.length,
      text: next.source
    });
    // Choose a *new* block by session identity, not by unreliable DOM indexes.
    const existing = new Set(before.blocks.map(block => block.id));
    const inserted = projectFlowBlocks(next).find(block =>
      !existing.has(block.id) && block.editable);
    notify();
    const offset = inserted?.sourceStart ?? session.snapshot.text.length;
    session.setSelection(collapsedSelection(offset));
    render({ focusAt: offset, preferredId: inserted?.id });
    return result.changed;
  }
  render();
  return Object.freeze({
    get session() { return session; },
    get composing() { return composing; },
    refresh() { render(); },
    insert,
    undo() { history("undo"); },
    redo() { history("redo"); },
    focus() {
      const first = host.querySelector("[data-flow-block]");
      first?.focus();
    },
    destroy() { controller.abort(); host.replaceChildren(); }
  });
}

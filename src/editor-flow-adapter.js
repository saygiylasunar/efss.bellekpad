import {
  TextEditorSession, collapsedSelection, nearestGraphemeBoundary,
  selectionBounds, textPosition
} from "./editor-text-engine.js";
import {
  projectFlowBlocks, insertFlowBlock, calloutMarkdown, slashFlowCommand
} from "./editor-flow-model.js";
import { mapInlineVisibleOffset, planInlineVisibleMark } from "./editor-inline-format.js";

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
  const position = (x, bias) => {
    const visible = nearestGraphemeBoundary(
      block.text, Math.min(block.text.length, Math.max(0, x)), "nearest"
    );
    return block.sourceStart + (block.inline ?
      mapInlineVisibleOffset(block.inline, visible, bias) : visible);
  };
  const collapsed = a === b;
  return {
    anchor: textPosition(position(a, collapsed || a < b ? "right" : "left")),
    focus: textPosition(position(b, collapsed || a > b ? "right" : "left"))
  };
}
function visibleFromSource(block, rawOffset) {
  if (!block.inline) return Math.max(0, rawOffset);
  let at = 0;
  for (const run of block.inline.runs) {
    if (rawOffset < run.from) return at;
    if (rawOffset <= run.to) return at + rawOffset - run.from;
    at += run.text.length;
  }
  return at;
}
function textDOMPoint(element, visible) {
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, 4); // NodeFilter.SHOW_TEXT
  let node, left = Math.max(0, visible);
  while ((node = walker.nextNode())) {
    if (left <= node.textContent.length) return [node, left];
    left -= node.textContent.length;
  }
  const empty = doc.createTextNode("");
  if (!element.firstChild) element.append(empty);
  return [empty, 0];
}
function focusOffset(element, sourceOffset, block, selectionEnd = null) {
  element.focus();
  const selected = element.ownerDocument.getSelection();
  if (!selected) return;
  const visible = visibleFromSource(block, sourceOffset);
  const [node, at] = textDOMPoint(element, visible);
  if (selectionEnd === null) selected.setBaseAndExtent(node, at, node, at);
  else {
    const [endNode, endOffset] = textDOMPoint(element, visibleFromSource(block, selectionEnd));
    selected.setBaseAndExtent(node, at, endNode, endOffset);
  }
}
function renderInlineRuns(doc, editor, block) {
  if (!block.inline) {
    editor.textContent = block.text;
    return;
  }
  for (const run of block.inline.runs) {
    let leaf = doc.createTextNode(run.text);
    for (const mark of [...run.marks].reverse()) {
      const tag = { strong: "strong", emphasis: "em", strike: "s" }[mark];
      if (!tag) continue;
      const wrapper = doc.createElement(tag);
      wrapper.append(leaf);
      leaf = wrapper;
    }
    const span = doc.createElement("span");
    span.className = "flow-run";
    span.append(leaf);
    editor.append(span);
  }
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
  onNavigateSource = () => {}, onError = () => {}
} = {}) {
  if (!host || !(session instanceof TextEditorSession) ||
      typeof getStructure !== "function" || typeof onChange !== "function")
    throw new TypeError("INVALID_FLOW_EDITOR");
  const controller = new AbortController(), signal = controller.signal;
  let composing = false, activeId = null;
  const doc = host.ownerDocument;

  function notify() { onChange(session.snapshot.text); }
  function render({ focusAt = null, preferredId = null, selectionEnd = null } = {}) {
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
        editor.contentEditable = "true";
        editor.role = "textbox";
        editor.setAttribute("aria-label", block.type === "callout" ?
          "Callout içeriği" : "Düzenlenebilir " + block.type);
        editor.setAttribute("aria-multiline", "false");
        editor.spellcheck = true;
        editor.dataset.placeholder = block.type === "callout" ?
          "Bir şey yaz…" : "Yazmaya başla…";
        renderInlineRuns(doc, editor, block);
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
      focusOffset(toFocus.editor, focusAt - toFocus.block.sourceStart, toFocus.block,
        selectionEnd === null ? null : selectionEnd - toFocus.block.sourceStart);
    }
  }

  function selectedRange(editor, block) {
    const range = readRange(editor, block);
    if (!range) return null;
    session.setSelection(range);
    activeId = block.id;
    return range;
  }

  function finish(result, {
    focusAt = null, preferredId = null, preserveSelection = false
  } = {}) {
    if (!result.changed) return;
    notify();
    if (preserveSelection) {
      // History retains anchor/focus in source coordinates. Restore native
      // direction only when both ends belong to one supported Flow block.
      const { anchor, focus } = session.snapshot.selection;
      const block = projectFlowBlocks(getStructure()).find(item =>
        item.editable && item.sourceStart <= anchor.offset &&
        anchor.offset <= item.sourceEnd &&
        item.sourceStart <= focus.offset && focus.offset <= item.sourceEnd);
      if (block) {
        render({ focusAt: anchor.offset, selectionEnd: focus.offset,
          preferredId: block.id });
        return;
      }
    }
    render({ focusAt: focusAt ?? session.snapshot.selection.focus.offset,
      preferredId });
  }

  function dispatch(editor, block, command) {
    if (!selectedRange(editor, block)) return;
    const sel = selectionBounds(session.snapshot.selection);
    const visibleSelection = doc.getSelection()?.toString() ?? "";
    // Selected syntax delimiters must not be silently eaten by a visual edit.
    if (sel.start !== sel.end &&
        session.snapshot.text.slice(sel.start, sel.end) !== visibleSelection) {
      onError("Karma biçim seçimi: Kaynak görünümünü kullan.");
      return;
    }
    if (command.type === "deleteBackward" || command.type === "deleteForward") {
      if (sel.start === sel.end) {
        const active = doc.getSelection();
        const caret = domCaret(editor, active?.focusNode, active?.focusOffset);
        const text = block.text;
        if (caret === null) return;
        const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
        const segments = [...segmenter.segment(text)].map(x => x.index);
        segments.push(text.length);
        const index = segments.indexOf(caret);
        if (index < 0) return;
        if (command.type === "deleteBackward" && index === 0 ||
            command.type === "deleteForward" && index === segments.length - 1) return;
        const fromVisible = command.type === "deleteBackward" ?
          segments[index - 1] : caret;
        const toVisible = command.type === "deleteBackward" ?
          caret : segments[index + 1];
        const from = block.sourceStart + (block.inline ?
          mapInlineVisibleOffset(block.inline, fromVisible, "right") : fromVisible);
        const to = block.sourceStart + (block.inline ?
          mapInlineVisibleOffset(block.inline, toVisible, "left") : toVisible);
        if (session.snapshot.text.slice(from, to) !==
            text.slice(fromVisible, toVisible)) {
          onError("Biçim sınırında silme: Kaynak görünümünü kullan.");
          return;
        }
        command = { type: "replaceRange", from, to, text: "" };
      }
    }
    if (command.type === "insertText" && command.text === "") return;
    const result = session.dispatch(command);
    finish(result, { preferredId: block.id });
  }

  function history(type) {
    if (composing) return;
    const result = type === "undo" ? session.undo() : session.redo();
    finish(result, { preserveSelection: true });
  }
  function reconcileNative(editor, block) {
    if (composing) return;
    const text = (editor.childNodes.length <= 1 && editor.firstChild?.nodeType === 3 ?
      editor.textContent : editor.innerText).replace(/\r\n?/g, "\n");
    if (text === block.text) return;
    const old = block.text;
    let start = 0;
    while (start < old.length && start < text.length && old[start] === text[start]) start++;
    let oldEnd = old.length, newEnd = text.length;
    while (oldEnd > start && newEnd > start &&
      old[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd--; }
    start = nearestGraphemeBoundary(old, start, "left");
    oldEnd = nearestGraphemeBoundary(old, oldEnd, "right");
    const from = block.sourceStart + (block.inline ?
      mapInlineVisibleOffset(block.inline, start, "right") : start);
    const to = block.sourceStart + (block.inline ?
      mapInlineVisibleOffset(block.inline, oldEnd, "left") : oldEnd);
    const replacement = text.slice(start, newEnd);
    // Reconciliation cannot discard an invisible Markdown delimiter.
    if (session.snapshot.text.slice(from, to) !== old.slice(start, oldEnd)) {
      onError("Bu biçim sınırında otomatik giriş desteklenmiyor; Kaynak görünümünü kullan.");
      render({ focusAt: from, preferredId: block.id });
      return;
    }
    const result = session.dispatch({ type: "replaceRange", from, to, text: replacement });
    const sourceCaret = nearestGraphemeBoundary(session.snapshot.text,
      Math.min(session.snapshot.text.length, from + replacement.length), "right");
    session.setSelection(collapsedSelection(sourceCaret));
    finish(result, { focusAt: sourceCaret, preferredId: block.id });
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
    if (command.type === "insertText" && !block.inline?.regions.length &&
        ["paragraph", "blank"].includes(block.type) &&
        block.sourceStart === block.start) {
      const candidate = block.text.slice(0, domCaret(editor,
        doc.getSelection()?.anchorNode, doc.getSelection()?.anchorOffset) ?? block.text.length) +
        command.text +
        block.text.slice(domCaret(editor,
          doc.getSelection()?.focusNode, doc.getSelection()?.focusOffset) ?? block.text.length);
      const slash = slashFlowCommand(candidate);
      if (slash && selectedRange(editor, block)) {
        const raw = slash.kind === "callout" ?
          calloutMarkdown(slash.variant,
            getStructure().source.match(/\r\n|\r|\n/)?.[0] ?? "\n") :
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

  host.addEventListener("drop", event => {
    if (event.target.closest?.("[data-flow-block]")) {
      event.preventDefault();
      onError("Dosya ve zengin içerik sürükleme henüz desteklenmiyor.");
    }
  }, { signal });

  doc.addEventListener("selectionchange", () => {
    if (composing) return;
    const active = doc.activeElement?.closest?.("[data-flow-block]");
    if (!active || !host.contains(active)) return;
    const block = projectFlowBlocks(getStructure()).find(b =>
      b.id === active.dataset.flowBlock);
    if (block?.editable) selectedRange(active, block);
  }, { signal });

  host.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || composing || event.isComposing) return;
    const k = event.key.toLowerCase();
    if (k === "b" && !event.shiftKey && !event.altKey) {
      event.preventDefault(); format("strong");
    } else if (k === "i" && !event.shiftKey && !event.altKey) {
      event.preventDefault(); format("emphasis");
    } else if (k === "z" && !event.altKey) {
      event.preventDefault(); history(event.shiftKey ? "redo" : "undo");
    } else if (k === "y" && !event.altKey) {
      event.preventDefault(); history("redo");
    }
  }, { signal });

  function format(mark) {
    if (composing) return false;
    const block = projectFlowBlocks(getStructure()).find(b => b.id === activeId);
    if (!block?.editable) { onError("Biçimlendirmek için düzenlenebilir metin seç."); return false; }
    const editor = [...host.querySelectorAll("[data-flow-block]")].find(el =>
      el.dataset.flowBlock === block.id);
    // Use the actual *visible* DOM selection. Source selection endpoints
    // can straddle hidden Markdown delimiters across styled runs.
    const selected = doc.getSelection();
    const a = editor && domCaret(editor, selected?.anchorNode, selected?.anchorOffset);
    const b = editor && domCaret(editor, selected?.focusNode, selected?.focusOffset);
    if (a === null || b === null || a === undefined || b === undefined) {
      onError("Biçimlendirmek için Görsel modda metin seç.");
      return false;
    }
    const start = Math.min(a, b), end = Math.max(a, b);
    const backwards = a > b;
    // Capture the source-aware, directional *before* selection in the shared
    // TextEditorSession so Undo can restore it as one atomic transaction.
    if (!selectedRange(editor, block)) return false;
    let operation;
    try {
      operation = planInlineVisibleMark({
        source: session.snapshot.text, block, start, end, mark
      });
    } catch (error) {
      onError("Biçimlendirme desteklenmedi: " + (error?.message ?? "Hata"));
      return false;
    }
    const { type, from, to, text, selectionStart, selectionEnd } = operation;
    const result = session.dispatch({ type, from, to, text });
    // Keep direction of reverse mouse selections when possible. Both
    // endpoints are source offsets in the ONE authoritative text session.
    const anchor = backwards ? selectionEnd : selectionStart;
    const focus = backwards ? selectionStart : selectionEnd;
    session.setSelection({
      anchor: textPosition(anchor),
      focus: textPosition(focus)
    });
    notify();
    render({ focusAt: anchor, selectionEnd: focus, preferredId: block.id });
    return result.changed;
  }

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
    format,
    undo() { history("undo"); },
    redo() { history("redo"); },
    focus() {
      const first = host.querySelector("[data-flow-block]");
      first?.focus();
    },
    destroy() { controller.abort(); host.replaceChildren(); }
  });
}

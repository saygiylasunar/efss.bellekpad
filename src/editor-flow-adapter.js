import {
  TextEditorSession, collapsedSelection, nearestGraphemeBoundary,
  selectionBounds, textPosition
} from "./editor-text-engine.js";
import {
  projectFlowBlocks, insertFlowBlock, calloutMarkdown, slashFlowCommand, planFlowEnter,
  planFlowListIndent, planFlowBackspaceAtStart, planFlowParagraphJoin,
  planFlowSoftBreak, planFlowMultilineEdit, planFlowBlockAttribute
} from "./editor-flow-model.js";
import {
  mapInlineVisibleOffset, mapInlineSourceOffset,
  planInlineMark, planInlineTextEdit
} from "./editor-inline-format.js";
import { makeIcon } from "./ui-icons.js";
import { planTableCellEdit, planTableAppendRow } from "./editor-table-model.js";

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
// A DOM point inside a styled run provides its own source affinity.
// Visible offsets alone cannot distinguish "**bold**plain" at the boundary:
// the caret at the end of bold and the caret at the start of plain have the
// same visible offset but must produce different Markdown source edits.
function domSourcePoint(element, block, node, offset, fallbackBias) {
  const visible = domCaret(element, node, offset);
  if (visible === null) return null;
  const span = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.("[data-inline-run]");
  if (span && element.contains(span) && block.inline) {
    const index = Number(span.dataset.inlineRun);
    const run = block.inline.runs[index];
    if (run) {
      const local = domCaret(span, node, offset);
      if (local !== null && local <= run.text.length) {
        const safe = nearestGraphemeBoundary(run.text, local, "nearest");
        return block.sourceStart + run.from + safe;
      }
    }
  }
  const safe = nearestGraphemeBoundary(block.text,
    Math.max(0, Math.min(block.text.length, visible)), "nearest");
  return block.sourceStart + (block.inline ?
    mapInlineVisibleOffset(block.inline, safe, fallbackBias) : safe);
}
function readRange(element, block) {
  const selected = element.ownerDocument.getSelection();
  if (!selected) return null;
  const a = domCaret(element, selected.anchorNode, selected.anchorOffset);
  const b = domCaret(element, selected.focusNode, selected.focusOffset);
  if (a === null || b === null) return null;
  const collapsed = a === b;
  const anchor = domSourcePoint(element, block, selected.anchorNode,
    selected.anchorOffset, collapsed || a < b ? "right" : "left");
  const focus = domSourcePoint(element, block, selected.focusNode,
    selected.focusOffset, collapsed || a > b ? "right" : "left");
  if (anchor === null || focus === null) return null;
  return { anchor: textPosition(anchor), focus: textPosition(focus) };
}
function visibleFromSource(block, rawOffset) {
  return block.inline ?
    mapInlineSourceOffset(block.inline, Math.max(0, rawOffset)) :
    Math.max(0, rawOffset);
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
function sourceDOMPoint(element, block, rawOffset) {
  const inline = block.inline;
  if (inline) {
    const i = inline.runs.findIndex(run =>
      rawOffset >= run.from && rawOffset <= run.to);
    if (i >= 0) {
      const span = [...element.querySelectorAll("[data-inline-run]")]
        .find(node => Number(node.dataset.inlineRun) === i);
      const leaf = span && element.ownerDocument.createTreeWalker(span, 4).nextNode();
      if (leaf) return [leaf, Math.max(0, Math.min(leaf.length,
        rawOffset - inline.runs[i].from))];
    }
  }
  return textDOMPoint(element, visibleFromSource(block, rawOffset));
}
function focusOffset(element, sourceOffset, block, selectionEnd = null) {
  element.focus();
  const selected = element.ownerDocument.getSelection();
  if (!selected) return;
  const [node, at] = sourceDOMPoint(element, block, sourceOffset);
  if (selectionEnd === null) selected.setBaseAndExtent(node, at, node, at);
  else {
    const [endNode, endOffset] = sourceDOMPoint(element, block, selectionEnd);
    selected.setBaseAndExtent(node, at, endNode, endOffset);
  }
}
function renderInlineRuns(doc, editor, block) {
  if (!block.inline) {
    editor.textContent = block.text;
    return;
  }
  for (const [index, run] of block.inline.runs.entries()) {
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
    span.dataset.inlineRun = String(index);
    span.append(leaf);
    editor.append(span);
  }
}

function noteElement(doc, block, kind) {
  const card = doc.createElement("div");
  card.className = "flow-block flow-" + block.type;
  card.dataset.blockId = block.id;
  if (block.variant) card.dataset.variant = block.variant;
  if (block.separator) {
    card.classList.add("flow-syntax-separator");
    card.setAttribute("aria-hidden", "true");
  }
  if (block.type === "heading" && Number.isInteger(block.level) &&
      block.level >= 1 && block.level <= 6)
    card.dataset.headingLevel = String(block.level);
  if (block.type === "list_item" && block.list) {
    card.dataset.listStyle = block.list.style;
    card.dataset.listDepth = String(block.list.depth);
  }
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
  if (event.inputType === "insertParagraph") return { type: "flowEnter" };
  if (event.inputType === "insertLineBreak") return { type: "softBreak" };
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
  onNavigateSource = () => {}, onError = () => {},
  onActiveBlock = () => {}
} = {}) {
  if (!host || !(session instanceof TextEditorSession) ||
      typeof getStructure !== "function" || typeof onChange !== "function" ||
      typeof onActiveBlock !== "function")
    throw new TypeError("INVALID_FLOW_EDITOR");
  const controller = new AbortController(), signal = controller.signal;
  let composing = false, activeId = null;
  const doc = host.ownerDocument;

  function notify() { onChange(session.snapshot.text); }
  function render({ focusAt = null, preferredId = null, selectionEnd = null, focusCell = null } = {}) {
    if (composing) return;
    const blocks = projectFlowBlocks(getStructure());
    const fragment = doc.createDocumentFragment();
    const editors = new Map();
    let nearest = null;
    for (const block of blocks) {
      const label = block.type === "callout" ? block.icon :
        block.type === "heading" ? "H" + (block.level ?? 1) :
        block.type === "list_item" ?
          (block.list?.style === "ordered" ?
            String(block.list.ordinal) + block.list.delimiter : "•") :
        block.type === "quote" ? "❝" :
        block.type === "table" ? "▦" : "⋮";
      const card = noteElement(doc, block, label);
      if (block.type === "table" && block.table) {
        const viewport = doc.createElement("div");
        viewport.className = "flow-table-viewport";
        const table = doc.createElement("table");
        table.className = "flow-table";
        table.setAttribute("aria-label", "Düzenlenebilir kaynak tablosu");
        const tbody = doc.createElement("tbody");
        for (const row of block.table.rows) {
          const tr = doc.createElement("tr");
          for (const cell of row.cells) {
            const td = doc.createElement(row.header ? "th" : "td");
            const editor = doc.createElement("div");
            editor.className = "flow-table-cell";
            editor.contentEditable = "plaintext-only";
            editor.role = "textbox";
            editor.setAttribute("aria-label",
              (row.header ? "Başlık " : "Hücre ") +
              (row.index + 1) + ", " + (cell.col + 1));
            editor.dataset.flowTableCell = block.id;
            editor.dataset.tableRow = String(row.index);
            editor.dataset.tableCol = String(cell.col);
            editor.dataset.placeholder = row.header ? "Başlık" : "—";
            editor.spellcheck = true;
            editor.textContent = cell.text;
            editor.addEventListener("focus", () => {
              activeId = block.id;
              session.setSelection(collapsedSelection(cell.start));
              onActiveBlock(block);
            }, { signal });
            td.append(editor);
            tr.append(td);
          }
          tbody.append(tr);
        }
        table.append(tbody);
        viewport.append(table);
        card.append(viewport);
      } else if (block.type === "callout") {
        const header = doc.createElement("div");
        header.className = "flow-callout-header";
        if (["info", "tip", "warning", "success", "error"].includes(block.variant))
          header.append(makeIcon(doc, block.variant, { size: 19 }));
        const label = doc.createElement("span");
        label.textContent = block.title;
        header.append(label);
        card.append(header);
      }
      if (block.type === "table" && block.table) {
        // The table's cells are rendered above. Its contents are edited via
        // the same source session, not a second table state or rich editor.
      } else if (block.editable) {
        const editor = doc.createElement("div");
        editor.className = "flow-editable";
        editor.dataset.flowBlock = block.id;
        editor.contentEditable = "true";
        editor.role = "textbox";
        editor.setAttribute("aria-label", block.type === "callout" ?
          "Callout içeriği" : block.type === "list_item" ?
          (block.list?.style === "ordered" ?
            "Sıralı liste öğesi " + block.list.ordinal : "Liste öğesi") :
          "Düzenlenebilir " + block.type);
        editor.setAttribute("aria-multiline", block.multiline ? "true" : "false");
        editor.spellcheck = true;
        editor.dataset.placeholder = block.type === "callout" ?
          "Bir şey yaz…" : "Yazmaya başla…";
        renderInlineRuns(doc, editor, block);
        card.append(editor);
        editors.set(block.id, { editor, block });
        editor.addEventListener("focus", () => {
          activeId = block.id;
          onActiveBlock(block);
        }, { signal });
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
    if (focusCell) {
      const el = [...host.querySelectorAll("[data-flow-table-cell]")].find(node =>
        node.dataset.flowTableCell === focusCell.blockId &&
        Number(node.dataset.tableRow) === focusCell.row &&
        Number(node.dataset.tableCol) === focusCell.col);
      if (el) {
        el.focus();
        const leaf = el.firstChild || el.appendChild(doc.createTextNode(""));
        const offset = Math.max(0, Math.min(leaf.textContent.length,
          focusCell.offset ?? leaf.textContent.length));
        doc.getSelection()?.setBaseAndExtent(leaf, offset, leaf, offset);
        return;
      }
    }
    // New blocks can reuse neither the previous block's ID nor its source
    // range. Resolve the *post-edit* source offset before the old preferred ID.
    const toFocus = focusAt !== null ? (editors.get(nearest) ??
      editors.get(preferredId)) : null;
    if (toFocus) {
      activeId = toFocus.block.id;
      focusOffset(toFocus.editor, focusAt - toFocus.block.sourceStart, toFocus.block,
        selectionEnd === null ? null : selectionEnd - toFocus.block.sourceStart);
    } else if (activeId) {
      onActiveBlock(blocks.find(b => b.id === activeId) ?? null);
    } else onActiveBlock(null);
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
    // The source-aware planner below validates the *visible* selection and
    // balances fully selected Markdown wrappers. Never reject a mixed style
    // selection merely because the raw source includes invisible markers.
    // Partially cut wrappers still fail closed in the pure planner.
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
    // All ordinary visual edits pass this pure source-preservation gate.
    // Explicit slash and toolbar mark transactions are handled separately.
    let planned;
    try {
      const from = command.type === "replaceRange" ? command.from : sel.start;
      const to = command.type === "replaceRange" ? command.to : sel.end;
      const text = command.type === "deleteBackward" ||
        command.type === "deleteForward" ? "" : command.text ?? "";
      planned = block.multiline ?
        planFlowMultilineEdit({source:session.snapshot.text, document:getStructure(),
          block, from, to, text}) :
        planInlineTextEdit({source: session.snapshot.text, block, from, to, text});
    } catch (error) {
      onError("Kaynak korunuyor: " + (error?.message ?? "UNSAFE_EDIT"));
      return false;
    }
    const result = session.dispatch(planned);
    finish(result, { preferredId: block.id });
    return result.changed;
  }

  function history(type) {
    if (composing) return;
    const result = type === "undo" ? session.undo() : session.redo();
    if (!result.changed) return;
    notify();
    // Undo restores the model's original anchor/focus direction. Do not
    // collapse its selection merely because the Flow DOM was rebuilt.
    const { anchor, focus } = session.snapshot.selection;
    render({ focusAt: anchor.offset, selectionEnd: focus.offset });
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
    let planned;
    try {
      planned = block.multiline ?
        planFlowMultilineEdit({source:session.snapshot.text, document:getStructure(),
          block, from, to, text:replacement}) :
        planInlineTextEdit({
          source: session.snapshot.text, block, from, to, text: replacement
        });
    } catch (error) {
      onError("Girdi kaynağı koruyamadı: " + (error?.message ?? "UNSAFE_EDIT"));
      render({ focusAt: from, preferredId: block.id });
      return;
    }
    const result = session.dispatch(planned);
    const sourceCaret = nearestGraphemeBoundary(session.snapshot.text,
      Math.min(session.snapshot.text.length, from + replacement.length), "right");
    session.setSelection(collapsedSelection(sourceCaret));
    finish(result, { focusAt: sourceCaret, preferredId: block.id });
  }



  function tableTarget(editor) {
    const block = projectFlowBlocks(getStructure()).find(b =>
      b.id === editor.dataset.flowTableCell && b.type === "table" && b.table);
    const row = Number(editor.dataset.tableRow),col = Number(editor.dataset.tableCol);
    const cell = block?.table?.rows[row]?.cells[col];
    return block && cell ? {block,cell,row,col} : null;
  }
  function tableCellInput(editor, type, data = "") {
    const item = tableTarget(editor);
    if (!item) return false;
    const {block,cell,row,col} = item,selection = doc.getSelection();
    const anchor=domCaret(editor,selection?.anchorNode,selection?.anchorOffset);
    const focus=domCaret(editor,selection?.focusNode,selection?.focusOffset);
    if(anchor===null||focus===null||anchor>cell.text.length||focus>cell.text.length)
      return false;
    let from=Math.min(anchor,focus),to=Math.max(anchor,focus),text=data;
    if(type==="deleteContentBackward"||type==="deleteContentForward") {
      text="";
      if(from===to) {
        const bounds=[...new Intl.Segmenter("und",{granularity:"grapheme"})
          .segment(cell.text)].map(x=>x.index);
        bounds.push(cell.text.length);
        const index=bounds.indexOf(from);
        if(index<0)return false;
        if(type==="deleteContentBackward" && index>0)from=bounds[index-1];
        else if(type==="deleteContentForward" && index<bounds.length-1)
          to=bounds[index+1];
        else return false;
      }
    }
    try {
      const plan=planTableCellEdit({
        source:session.snapshot.text,document:getStructure(),block,row,col,
        from:cell.start+from,to:cell.start+to,text
      });
      const result=session.dispatch(plan);
      if (!result.changed) return false;
      notify();
      const nextBlock=projectFlowBlocks(getStructure()).find(b =>
        b.type==="table" && b.start===block.start);
      const nextCell=nextBlock?.table?.rows[row]?.cells[col];
      const sourceCaret=plan.selectionAfter.focus.offset;
      const offset=nextCell?sourceCaret-nextCell.start:from+text.length;
      render({focusCell:{blockId:nextBlock?.id ?? block.id,row,col,offset}});
      session.setSelection(collapsedSelection(sourceCaret));
      return true;
    } catch(error) {
      onError("Tablo hücresi korunuyor: " + (error?.message ?? "UNSAFE_TABLE_EDIT"));
      return false;
    }
  }
  function appendTableRow() {
    if (composing || !activeId) return false;
    const document=getStructure();
    const block=projectFlowBlocks(document).find(b=>b.id===activeId&&b.type==="table");
    if(!block?.table)return false;
    try {
      const plan=planTableAppendRow({source:session.snapshot.text,document,block});
      const result=session.dispatch(plan);
      if (!result.changed)return false;
      notify();
      const next=projectFlowBlocks(getStructure()).find(b=>b.type==="table"&&b.start===block.start);
      render({focusCell:{blockId:next?.id??block.id,row:plan.focus.row,col:0,offset:0}});
      return true;
    } catch(error) {
      onError("Tablo satırı eklenemedi: " + (error?.message ?? "UNSAFE_TABLE_ROW"));
      return false;
    }
  }

  host.addEventListener("beforeinput", event => {
    const tableEditor = event.target.closest?.("[data-flow-table-cell]");
    if (tableEditor) {
      if (!event.cancelable || composing || event.isComposing) return;
      event.preventDefault();
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        history(event.inputType === "historyUndo" ? "undo" : "redo");
        return;
      }
      if (event.inputType === "insertText" && typeof event.data === "string") {
        tableCellInput(tableEditor, event.inputType, event.data);
      } else if (event.inputType === "deleteContentBackward" ||
          event.inputType === "deleteContentForward") {
        tableCellInput(tableEditor,event.inputType);
      } else onError("Hücre içinde bu işlem henüz desteklenmiyor.");
      return;
    }
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
    // A paragraph boundary cannot be edited as a single inline run. Before
    // the ordinary character deletion path, attempt a source-verified join.
    // Refusals are no-ops: never erase a separator, opaque extension or mark
    // through native contentEditable's implicit DOM mutation.
    if (block.type === "paragraph" &&
        (command.type === "deleteBackward" || command.type === "deleteForward")) {
      if (!selectedRange(editor, block)) return;
      const sel = selectionBounds(session.snapshot.selection);
      const boundary = command.type === "deleteBackward" ?
        block.sourceStart : block.sourceEnd;
      if (sel.start === sel.end && sel.start === boundary) {
        try {
          const planned = planFlowParagraphJoin({
            source: session.snapshot.text, document: getStructure(),
            block, at: sel.start,
            direction: command.type === "deleteBackward" ? "backward" : "forward"
          });
          const result = session.dispatch(planned);
          finish(result, { focusAt: planned.selectionAfter.focus.offset });
        } catch (error) {
          // At the beginning/end of a document there may simply be no
          // adjoining paragraph; this is a deliberate harmless no-op.
          if (error?.message !== "FLOW_PARAGRAPH_JOIN_UNSUPPORTED")
            onError("Paragraf sınırı korunuyor: " + (error?.message ?? "UNSAFE_JOIN"));
        }
        return;
      }
    }
    if (command.type === "deleteBackward" &&
        ["list_item", "heading", "quote"].includes(block.type)) {
      if (!selectedRange(editor, block)) return;
      const sel = selectionBounds(session.snapshot.selection);
      if (sel.start === sel.end && sel.start === block.sourceStart) {
        try {
          const planned = planFlowBackspaceAtStart({
            source: session.snapshot.text, block, at: sel.start
          });
          const result = session.dispatch(planned);
          finish(result, { focusAt: planned.selectionAfter.focus.offset });
        } catch (error) {
          onError("Blok başlangıcı korunuyor: " + (error?.message ?? "UNSAFE_BACKSPACE"));
        }
        return;
      }
    }
    if (command.type === "flowEnter" || command.type === "softBreak") {
      if (!selectedRange(editor, block)) return;
      const range = selectionBounds(session.snapshot.selection);
      if (range.start !== range.end) {
        onError("Seçili metni Enter ile bölme henüz desteklenmiyor.");
        return;
      }
      try {
        const planned = command.type === "softBreak" ?
          planFlowSoftBreak({
            source:session.snapshot.text, document:getStructure(),
            block, at:range.start
          }) :
          planFlowEnter({
            source: session.snapshot.text, block, at: range.start
          });
        const result = session.dispatch(planned);
        finish(result, { focusAt: planned.selectionAfter.focus.offset });
      } catch (error) {
        onError("Blok satır sonu korunuyor: " + (error?.message ?? "UNSAFE_ENTER"));
      }
      return;
    }
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
    if (event.target.closest?.("[data-flow-table-cell]")) {
      // A native mutation bypassed source authorization (e.g. an unsupported
      // IME path). Restore from the canonical document, never persist it.
      onError("Tablo girdisi güvenli biçimde işlenemedi.");
      render();
      return;
    }
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

  host.addEventListener("cut", event => {
    const editor = event.target.closest?.("[data-flow-block]");
    if (!editor || composing) return;
    const block = projectFlowBlocks(getStructure()).find(b =>
      b.id === editor.dataset.flowBlock);
    if (!block?.editable || !selectedRange(editor, block)) return;
    const selected = doc.getSelection()?.toString() ?? "";
    if (!selected) return;
    // Clipboard is modified ONLY if the source-aware deletion was accepted.
    // A rejected mixed/nested selection must not silently act like cut.
    event.preventDefault();
    if (dispatch(editor, block, { type: "replaceSelection", text: "" }))
      event.clipboardData?.setData("text/plain", selected);
  }, { signal });

  host.addEventListener("paste", event => {
    const tableEditor=event.target.closest?.("[data-flow-table-cell]");
    if(tableEditor) {
      event.preventDefault();
      if(!composing && event.clipboardData)
        tableCellInput(tableEditor,"insertText",event.clipboardData.getData("text/plain"));
      return;
    }
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
    if (composing || event.isComposing) return;
    const tableCell=event.target.closest?.("[data-flow-table-cell]");
    if (tableCell && event.key === "Tab" &&
        !(event.ctrlKey || event.metaKey || event.altKey)) {
      event.preventDefault();
      const cells=[...host.querySelectorAll("[data-flow-table-cell]")];
      const index=cells.indexOf(tableCell),target=index+(event.shiftKey?-1:1);
      if(target>=0&&target<cells.length&&
          cells[target].dataset.flowTableCell===tableCell.dataset.flowTableCell) {
        const next=cells[target];next.focus();
        const leaf=next.firstChild || next.appendChild(doc.createTextNode(""));
        doc.getSelection()?.setBaseAndExtent(leaf,0,leaf,0);
      } else if (target>=cells.length && !event.shiftKey) appendTableRow();
      return;
    }
    if (event.key === "Tab" && !(event.ctrlKey || event.metaKey || event.altKey)) {
      const editor = event.target.closest?.("[data-flow-block]");
      const block = editor && projectFlowBlocks(getStructure())
        .find(b => b.id === editor.dataset.flowBlock);
      if (block?.type === "list_item" && block.editable) {
        event.preventDefault();
        if (!selectedRange(editor, block)) return;
        const sel = selectionBounds(session.snapshot.selection);
        if (sel.start !== sel.end) {
          onError("Birden çok karakter seçiliyken liste girintisi henüz desteklenmiyor.");
          return;
        }
        try {
          const planned = planFlowListIndent({
            source: session.snapshot.text, block, at: sel.start,
            direction: event.shiftKey ? "outdent" : "indent"
          });
          const result = session.dispatch(planned);
          finish(result, { focusAt: planned.selectionAfter.focus.offset });
        } catch (error) {
          onError("Liste girintisi korunuyor: " + (error?.message ?? "UNSAFE_INDENT"));
        }
      }
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
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
    const native = doc.getSelection();
    if (!editor || !native?.anchorNode || !native?.focusNode ||
        !(native.anchorNode === editor || editor.contains(native.anchorNode)) ||
        !(native.focusNode === editor || editor.contains(native.focusNode)) ||
        !selectedRange(editor, block)) {
      onError("Biçimlendirilecek metni görsel blok içinde seç.");
      return false;
    }
    const { start, end } = selectionBounds(session.snapshot.selection);
    const reversed = session.snapshot.selection.anchor.offset >
      session.snapshot.selection.focus.offset;
    let operation;
    try {
      operation = planInlineMark({
        source: session.snapshot.text, block, start, end, mark
      });
    } catch (error) {
      onError("Biçimlendirme desteklenmedi: " + (error?.message ?? "Hata"));
      return false;
    }
    const { type, from, to, text, selectionStart, selectionEnd } = operation;
    const anchor = reversed ? selectionEnd : selectionStart;
    const focus = reversed ? selectionStart : selectionEnd;
    let result;
    try {
      result = session.dispatch({ type, from, to, text, selectionAfter: {
        anchor: textPosition(anchor), focus: textPosition(focus)
      } });
    } catch (error) {
      onError("Biçimlendirme kaydedilemedi: " + (error?.message ?? "Hata"));
      return false;
    }
    if (!result.changed) return false;
    notify();
    render({ focusAt: anchor, selectionEnd: focus });
    return true;
  }

  function setAttribute(attribute, value) {
    if (composing || !activeId) return false;
    const document = getStructure();
    const block = projectFlowBlocks(document).find(b => b.id === activeId);
    if (!block?.editable) { onError("Özelliği değiştirmek için bir blok seç."); return false; }
    const before = session.snapshot.selection;
    const caret = before.focus.offset >= block.sourceStart &&
      before.focus.offset <= block.sourceEnd ? before.focus.offset : block.sourceStart;
    let operation;
    try {
      operation = planFlowBlockAttribute({
        source: session.snapshot.text, document, block, attribute, value, at: caret
      });
    } catch (error) {
      onError("Blok özelliği korunuyor: " + (error?.message ?? "UNSAFE_ATTRIBUTE"));
      return false;
    }
    if (!operation) return false;
    try {
      const result = session.dispatch(operation);
      finish(result, { focusAt: operation.selectionAfter.focus.offset,
        preferredId: block.id });
      return result.changed;
    } catch (error) {
      onError("Blok özelliği kaydedilemedi: " + (error?.message ?? "UNSAFE_ATTRIBUTE"));
      return false;
    }
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
    const insertedTable = kind === "table" ? projectFlowBlocks(next).find(block =>
      !existing.has(block.id) && block.type === "table" && block.table) : null;
    notify();
    const cell = insertedTable?.table.rows[1]?.cells[0];
    const offset = cell?.start ?? inserted?.sourceStart ?? session.snapshot.text.length;
    session.setSelection(collapsedSelection(offset));
    if (cell) render({focusCell:{
      blockId:insertedTable.id,row:1,col:0,offset:0
    }});
    else render({ focusAt: offset, preferredId: inserted?.id });
    return result.changed;
  }
  render();
  return Object.freeze({
    get session() { return session; },
    get composing() { return composing; },
    refresh() { render(); },
    insert,
    format,
    setAttribute,
    addTableRow:appendTableRow,
    getActiveBlock() {
      return projectFlowBlocks(getStructure()).find(b => b.id === activeId) ?? null;
    },
    undo() { history("undo"); },
    redo() { history("redo"); },
    focus() {
      const first = host.querySelector("[data-flow-block], [data-flow-table-cell]");
      first?.focus();
    },
    destroy() { controller.abort(); host.replaceChildren(); }
  });
}

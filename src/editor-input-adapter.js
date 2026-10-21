import {
  TextEditorSession, TEXT_FRAME_ID, collapsedSelection,
  nearestGraphemeBoundary, selectionBounds
} from "./editor-text-engine.js";

// Browser-native keyboard, clipboard and IME adapter for one editable TextFrame.
// No Electron API: the application shell only owns I/O and window capabilities.
function selectionPoint(node, offset) {
  return { nodeId: TEXT_FRAME_ID, offset };
}
function inRoot(root, node) {
  return !!node && (node === root || root.contains(node));
}
function domOffset(root, node, offset) {
  if (!inRoot(root, node)) return null;
  try {
    const range = root.ownerDocument.createRange();
    range.setStart(root, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch { return null; }
}
function readSelection(root, text, { snap = "nearest" } = {}) {
  const selection = root.ownerDocument.getSelection();
  if (!selection || !inRoot(root, selection.anchorNode) ||
      !inRoot(root, selection.focusNode)) return null;
  const anchor = domOffset(root, selection.anchorNode, selection.anchorOffset);
  const focus = domOffset(root, selection.focusNode, selection.focusOffset);
  if (anchor === null || focus === null) return null;
  const within = n => Math.max(0, Math.min(text.length, n));
  return {
    anchor: selectionPoint(TEXT_FRAME_ID,
      nearestGraphemeBoundary(text, within(anchor), snap)),
    focus: selectionPoint(TEXT_FRAME_ID,
      nearestGraphemeBoundary(text, within(focus), snap))
  };
}
function renderSelection(root, selected) {
  if (root.ownerDocument.activeElement !== root) return;
  const domSelection = root.ownerDocument.getSelection();
  if (!domSelection) return;
  const a = selected.anchor.offset, b = selected.focus.offset;
  const node = root.firstChild;
  const container = node?.nodeType === 3 ? node : root;
  const limit = container === root ? 0 : node.length;
  const start = Math.min(a, limit), finish = Math.min(b, limit);
  if (typeof domSelection.setBaseAndExtent === "function")
    domSelection.setBaseAndExtent(container, start, container, finish);
  else {
    const range = root.ownerDocument.createRange();
    range.setStart(container, Math.min(start, finish));
    range.setEnd(container, Math.max(start, finish));
    domSelection.removeAllRanges();
    domSelection.addRange(range);
  }
}
function nativeText(root) {
  // Normal render produces one text node. During browser composition there may
  // be native div/br nodes; innerText better represents visual newline breaks.
  return (root.childNodes.length <= 1 && root.firstChild?.nodeType === 3
    ? root.textContent : root.innerText).replace(/\r\n?/g, "\n");
}
function reconcileChange(previous, next) {
  if (previous === next) return null;
  let from = 0;
  while (from < previous.length && from < next.length &&
      previous[from] === next[from]) from++;
  // A UTF-16 common prefix may end *inside* a combined grapheme.
  from = Math.min(
    nearestGraphemeBoundary(previous, from, "left"),
    nearestGraphemeBoundary(next, from, "left")
  );
  let oldEnd = previous.length, newEnd = next.length;
  while (oldEnd > from && newEnd > from &&
      previous[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--; newEnd--;
  }
  // Common suffix can bisect a cluster. Expand to the right in both versions.
  while (oldEnd < previous.length &&
      (nearestGraphemeBoundary(previous, oldEnd, "right") !== oldEnd ||
       nearestGraphemeBoundary(next, newEnd, "right") !== newEnd)) {
    oldEnd++; newEnd++;
  }
  return { from, to: oldEnd, text: next.slice(from, newEnd) };
}
export function attachTextFrame(element, {
  session = new TextEditorSession(), onChange = () => {},
  onCompositionChange = () => {}
} = {}) {
  if (!element || element.nodeType !== 1 ||
      !(session instanceof TextEditorSession) || typeof onChange !== "function" ||
      typeof onCompositionChange !== "function")
    throw new TypeError("INVALID_TEXT_FRAME_ADAPTER");

  const controller = new AbortController();
  const signal = controller.signal;
  let composing = false;
  let updating = false;
  const doc = element.ownerDocument;

  function paint() {
    if (updating) return;
    updating = true;
    try {
      if (element.textContent !== session.snapshot.text ||
          element.childNodes.length !== (session.snapshot.text.length ? 1 : 0) ||
          (session.snapshot.text.length && element.firstChild?.nodeType !== 3))
        element.textContent = session.snapshot.text;
      renderSelection(element, session.snapshot.selection);
    } finally { updating = false; }
  }
  function updateSelection() {
    if (composing || updating) return;
    const selected = readSelection(element, session.snapshot.text);
    if (selected) session.setSelection(selected);
  }
  function apply(command) {
    updateSelection();
    const result = session.dispatch(command);
    if (result.changed) {
      onChange(result.state.text);
      paint();
    }
    return result;
  }
  function reconcileNative() {
    if (composing || updating) return;
    const text = nativeText(element);
    const old = session.snapshot.text;
    const selected = readSelection(element, text);
    const delta = reconcileChange(old, text);
    if (delta) {
      applyWithoutReadingSelection(delta);
      // Keep browser-created selection rather than forcing focus to end.
      if (selected) session.setSelection(selected);
      onChange(session.snapshot.text);
    } else if (selected) session.setSelection(selected);
    paint();
  }
  function applyWithoutReadingSelection(delta) {
    session.dispatch({ type: "replaceRange", ...delta });
  }
  function onBeforeInput(event) {
    if (composing || event.isComposing || !event.cancelable) return;
    let command = null;
    switch (event.inputType) {
      case "insertText":
        if (typeof event.data === "string" && event.data)
          command = { type: "insertText", text: event.data };
        break;
      case "insertParagraph":
      case "insertLineBreak": command = { type: "insertParagraph" }; break;
      case "deleteContentBackward": command = { type: "deleteBackward" }; break;
      case "deleteContentForward": command = { type: "deleteForward" }; break;
      case "deleteByCut": command = { type: "replaceSelection", text: "" }; break;
      case "historyUndo":
        event.preventDefault(); session.undo();
        onChange(session.snapshot.text); paint(); return;
      case "historyRedo":
        event.preventDefault(); session.redo();
        onChange(session.snapshot.text); paint(); return;
      default: break;
    }
    if (!command) return; // native mutation reconciled in input handler
    event.preventDefault();
    apply(command);
  }
  function onPaste(event) {
    if (composing || !event.clipboardData) return;
    event.preventDefault();
    const pasted = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    if (pasted) apply({ type: "replaceSelection", text: pasted });
  }
  function onCut(event) {
    if (composing || !event.clipboardData) return;
    updateSelection();
    const { start, end } = selectionBounds(session.snapshot.selection);
    if (start === end) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", session.snapshot.text.slice(start, end));
    apply({ type: "replaceSelection", text: "" });
  }
  function onKeyDown(event) {
    if (composing || event.isComposing || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.altKey) {
      event.preventDefault();
      updateSelection();
      if (event.shiftKey) session.redo(); else session.undo();
      onChange(session.snapshot.text); paint();
    } else if (key === "y" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      updateSelection();
      session.redo(); onChange(session.snapshot.text); paint();
    }
  }
  function onCompositionStart() {
    updateSelection();
    composing = true;
    onCompositionChange(true);
  }
  function onCompositionEnd() {
    composing = false;
    reconcileNative();
    onCompositionChange(false);
  }

  element.addEventListener("beforeinput", onBeforeInput, { signal });
  element.addEventListener("input", reconcileNative, { signal });
  element.addEventListener("paste", onPaste, { signal });
  element.addEventListener("cut", onCut, { signal });
  element.addEventListener("keydown", onKeyDown, { signal });
  element.addEventListener("compositionstart", onCompositionStart, { signal });
  element.addEventListener("compositionend", onCompositionEnd, { signal });
  doc.addEventListener("selectionchange", updateSelection, { signal });
  paint();
  function history(action) {
    if (composing) return { changed: false, state: session.snapshot };
    const result = action === "undo" ? session.undo() : session.redo();
    if (result.changed) onChange(result.state.text);
    element.focus();
    paint();
    return result;
  }
  return Object.freeze({
    get session() { return session; },
    get composing() { return composing; },
    destroy() { controller.abort(); },
    undo() { return history("undo"); },
    redo() { return history("redo"); },
    selectSourceRange(from, to = from) {
      if (composing) return false;
      const text = session.snapshot.text;
      if (![from, to].every(value => Number.isSafeInteger(value) &&
          value >= 0 && value <= text.length)) return false;
      session.setSelection({
        anchor: selectionPoint(TEXT_FRAME_ID,
          nearestGraphemeBoundary(text, from, "left")),
        focus: selectionPoint(TEXT_FRAME_ID,
          nearestGraphemeBoundary(text, to, "right"))
      });
      element.focus();
      paint();
      return true;
    },
    focus() { element.focus(); paint(); }
  });
}

// G0.4: flow view of the *existing* EFSS source; it is not a second document
// store. Only losslessly representable blocks are editable in this first pass.
import { projectInline, mapInlineSourceOffset } from "./editor-inline-format.js";
import { collapsedSelection, isGraphemeBoundary } from "./editor-text-engine.js";
import { reconcileBlockSource } from "./editor-block-model.js";

const TYPES = Object.freeze(["paragraph", "heading", "list_item", "quote", "blank"]);
const CALLOUT = /^(info|tip|warning|success|error)$/;
const MARKERS = Object.freeze({
  paragraph: "", heading: "# ", list_item: "- ", quote: "> ",
  callout: ""
});
const STYLE = Object.freeze({
  info: { icon: "ℹ️", title: "Bilgi" },
  tip: { icon: "💡", title: "İpucu" },
  warning: { icon: "⚠️", title: "Uyarı" },
  success: { icon: "✅", title: "Başarılı" },
  error: { icon: "⛔", title: "Hata" }
});
const EOL = /\r\n|\r|\n/;

function fail(message) { throw new Error(message); }
function ending(text) { return text.match(/\r\n|\r|\n/)?.[0] ?? "\n"; }
function trailingEol(text) { return /(\r\n|\r|\n)$/.exec(text)?.[0] ?? ""; }
function singleLineContent(text) {
  return !EOL.test(text) && projectInline(text).editable;
}
function flowCallout(block) {
  if (block.type !== "extension_block") return null;
  const raw = block.raw;
  const first = /^:::efss\.callout type=(info|tip|warning|success|error) icon=("(?:\\.|[^"\\])*") title=("(?:\\.|[^"\\])*")(\r\n|\r|\n)/.exec(raw);
  if (!first) return null;
  let icon, title;
  try { icon = JSON.parse(first[2]); title = JSON.parse(first[3]); }
  catch { return null; }
  if (typeof icon !== "string" || typeof title !== "string") return null;
  const remaining = raw.slice(first[0].length);
  const close = /(\r\n|\r|\n):::(?:\r\n|\r|\n)?$/.exec(remaining);
  if (!close || close.index + close[0].length !== remaining.length) return null;
  const content = remaining.slice(0, close.index);
  return Object.freeze({
    id: block.id, type: "callout", variant: first[1], icon, title,
    text: projectInline(content).text, inline: projectInline(content),
    start: block.start, end: block.end,
    sourceStart: block.start + first[0].length,
    sourceEnd: block.start + first[0].length + content.length,
    editable: !EOL.test(content) && singleLineContent(content),
    raw: raw
  });
}
export function projectFlowBlocks(doc) {
  if (!doc || typeof doc.source !== "string" || !Array.isArray(doc.blocks))
    fail("INVALID_FLOW_DOCUMENT");
  if (!doc.source.length) return Object.freeze([Object.freeze({
    id: "virtual_empty", type: "paragraph", text: "", raw: "",
    start: 0, end: 0, sourceStart: 0, sourceEnd: 0, editable: true, virtual: true
  })]);
  const result = doc.blocks.map((block, index) => {
    const callout = flowCallout(block);
    if (callout) return callout;
    const raw = block.raw;
    const eol = trailingEol(raw);
    const line = raw.slice(0, raw.length - eol.length);
    if (block.type === "blank") {
      // A terminal blank line stands for the next paragraph at EOF.
      // Typing at its *start* instead of after its EOL merges prose into
      // a multiline AST paragraph, making Flow read-only.
      const caret = index === doc.blocks.length - 1 &&
        block.end === doc.source.length ? block.end : block.start;
      return Object.freeze({
        id: block.id, type: "blank", text: "", raw, start: block.start,
        end: block.end, sourceStart: caret, sourceEnd: caret,
        editable: true
      });
    }
    if (!TYPES.includes(block.type) || EOL.test(line)) return Object.freeze({
      id: block.id, type: block.type, raw, text: raw,
      start: block.start, end: block.end, editable: false
    });
    let prefix = "";
    if (block.type === "heading") prefix = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(line)?.[0] ?? "";
    if (block.type === "list_item") prefix = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(line)?.[0] ?? "";
    if (block.type === "quote") prefix = /^ {0,3}>[ \t]?/.exec(line)?.[0] ?? "";
    if (block.type !== "paragraph" && !prefix) return Object.freeze({
      id: block.id, type: block.type, raw, text: raw,
      start: block.start, end: block.end, editable: false
    });
    const rawText = line.slice(prefix.length);
    const inline = projectInline(rawText);
    const listMatch = block.type === "list_item" ?
      /^( {0,3})([-+*]|([0-9]{1,9})([.)]))([ \t]+)$/.exec(prefix) : null;
    const list = listMatch ? Object.freeze({
      style: listMatch[3] ? "ordered" : "bullet",
      token: listMatch[2],
      indent: listMatch[1].length,
      depth: listMatch[1].length === 2 ? 1 : 0,
      ...(listMatch[3] ? { ordinal: Number(listMatch[3]),
        delimiter: listMatch[4] } : {})
    }) : null;
    return Object.freeze({
      id: block.id, type: block.type, level: block.level,
      ...(list ? { list } : {}),
      raw, text: inline.text, inline, start: block.start, end: block.end,
      sourceStart: block.start + prefix.length,
      sourceEnd: block.start + prefix.length + rawText.length,
      editable: singleLineContent(rawText)
    });
  });
  return Object.freeze(result);
}
export function flowBlockAt(doc, id) {
  return projectFlowBlocks(doc).find(x => x.id === id) ?? null;
}
export function editFlowText(doc, { id, text, expectedVersion = doc?.version } = {}) {
  if (expectedVersion !== doc?.version) fail("BLOCK_VERSION_CONFLICT");
  if (typeof text !== "string" || EOL.test(text) || text.includes("\0"))
    fail("INVALID_FLOW_TEXT");
  const block = flowBlockAt(doc, id);
  if (!block) fail("FLOW_BLOCK_NOT_FOUND");
  if (!block.editable) fail("FLOW_BLOCK_READ_ONLY");
  if (block.inline?.regions.length) fail("FLOW_MARKED_REQUIRES_TRANSACTION");
  if (!isGraphemeBoundary(doc.source, block.sourceStart) ||
      !isGraphemeBoundary(doc.source, block.sourceEnd)) fail("INVALID_FLOW_BOUNDARY");
  const next = doc.source.slice(0, block.sourceStart) + text +
    doc.source.slice(block.sourceEnd);
  return reconcileBlockSource(doc, next, { expectedVersion });
}
export function calloutMarkdown(variant = "info", eol = "\n") {
  if (!CALLOUT.test(variant) || !["\n", "\r\n", "\r"].includes(eol))
    fail("INVALID_CALLOUT_TYPE");
  const { icon, title } = STYLE[variant];
  return ':::efss.callout type=' + variant + " icon=" + JSON.stringify(icon) +
    " title=" + JSON.stringify(title) + eol + eol + ":::" + eol;
}
export function insertFlowBlock(doc, {
  afterId = null, kind = "paragraph", variant = "info",
  expectedVersion = doc?.version
} = {}) {
  if (!doc || typeof doc.source !== "string" || !Array.isArray(doc.blocks))
    fail("INVALID_FLOW_DOCUMENT");
  if (expectedVersion !== doc.version) fail("BLOCK_VERSION_CONFLICT");
  if (!Object.hasOwn(MARKERS, kind)) fail("UNSUPPORTED_FLOW_BLOCK");
  const anchor = afterId === null ? doc.blocks.at(-1) :
    doc.blocks.find(block => block.id === afterId);
  if (afterId !== null && !anchor) fail("FLOW_BLOCK_NOT_FOUND");
  const eol = ending(doc.source);
  const at = anchor?.end ?? doc.source.length;
  const before = doc.source.slice(0, at);
  const after = doc.source.slice(at);
  const segment = kind === "callout" ? calloutMarkdown(variant, eol) :
    MARKERS[kind] + eol;
  // Blank paragraph is an editable placeholder: its newline is the document
  // separator until the user types, not a hidden nonstandard markup token.
  // Treat CRLF as *one* newline; a regex with \r and \n alternatives can
  // mistakenly count a single CRLF as two separate separators.
  const separator = before.length && !before.endsWith(eol + eol) ?
    before.endsWith(eol) ? eol : eol + eol : "";
  const tail = after.length && !/^(\r\n|\r|\n)/.test(after) ? eol : "";
  const source = before + separator + segment + tail + after;
  return reconcileBlockSource(doc, source, { expectedVersion });
}


/** Normalize inline styles at adjacent run boundaries before split comparison. */
function flowInlineSignature(runs) {
  const merged = [];
  for (const run of runs) {
    const marks = [...run.marks].sort().join("/");
    const last = merged.at(-1);
    if (last && last.marks === marks) last.text += run.text;
    else merged.push({ marks, text: run.text });
  }
  return JSON.stringify(merged);
}

/**
 * Split a safe rich single-line block without delegating normal Enter to the
 * source editor. The candidate must preserve each visible character and its
 * exact B/I/S mark set. Original source bytes outside this block are untouched.
 * Ambiguous adjacent delimiters continue to fail closed.
 */
function planRichFlowEnter({ source, block, at, eol, continuation }) {
  if (block.type === "list_item" && block.list?.style === "ordered")
    fail("FLOW_ENTER_ORDERED_RICH_UNSUPPORTED");
  const inline = block.inline;
  const raw = source.slice(block.sourceStart, block.sourceEnd);
  const visible = mapInlineSourceOffset(inline, at - block.sourceStart);
  let split = at - block.sourceStart;
  if (visible === 0) split = 0;
  else if (visible === inline.text.length) split = raw.length;
  else {
    // Native caret positions can fall precisely on an invisible delimiter.
    // Place the complete opening/closing marker on its own side of the split.
    for (const region of inline.regions) {
      if (split >= region.from && split <= region.contentStart)
        split = region.from;
      else if (split >= region.contentEnd && split <= region.to)
        split = region.to;
    }
  }
  const active = [...inline.regions].filter(r =>
    r.contentStart < split && split < r.contentEnd)
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const close = [...active].reverse().map(r =>
    r.mark === "strong" ? "**" : r.mark === "emphasis" ? "*" : "~~").join("");
  const open = [...active].map(r =>
    r.mark === "strong" ? "**" : r.mark === "emphasis" ? "*" : "~~").join("");
  const left = raw.slice(0, split) + close;
  const right = open + raw.slice(split);
  const leftInline = projectInline(left), rightInline = projectInline(right);
  const original = flowInlineSignature(inline.runs);
  const combined = flowInlineSignature([...leftInline.runs, ...rightInline.runs]);
  if (!leftInline.editable || !rightInline.editable || combined !== original ||
      leftInline.text + rightInline.text !== inline.text)
    fail("FLOW_ENTER_RICH_COLLISION");

  const hasFollowingEol = split === raw.length &&
    !!trailingEol(block.raw);
  const prose = ["paragraph", "heading"].includes(block.type);
  const separator = prose ? (hasFollowingEol ? eol : eol + eol) :
    eol + continuation;
  // An empty new paragraph occupies the interval between two newlines, not
  // EOF where no editable Flow block's sourceStart can accept the caret.
  const terminalProse = prose && !rightInline.text.length &&
    block.end === source.length;
  const caretGap = terminalProse ?
    separator.length + (hasFollowingEol ? trailingEol(block.raw).length : 0) :
    separator.length;
  const replacement = left + separator + right;
  return Object.freeze({
    type: "replaceRange", from: block.sourceStart, to: block.sourceEnd,
    text: replacement,
    selectionAfter: collapsedSelection(block.sourceStart + left.length + caretGap),
    operation: "flow-enter-rich"
  });
}

/**
 * G0.6B.1: natural Enter in source-authoritative, single-line Flow blocks.
 * Only collapsed, grapheme-safe source positions are accepted. A marked run
 * could require splitting invisible delimiters across the newline and is
 * intentionally deferred; this planner NEVER guesses or loses those bytes.
 * The returned selectionAfter belongs to the same TextEditorSession journal.
 */
export function planFlowEnter({ source, block, at } = {}) {
  if (typeof source !== "string" || !block?.editable ||
      !["paragraph", "heading", "list_item", "quote", "blank"].includes(block.type) ||
      !Number.isSafeInteger(at) || at < block.sourceStart ||
      at > block.sourceEnd || !isGraphemeBoundary(source, at))
    fail("INVALID_FLOW_ENTER");
  if (source.slice(block.start, block.end) !== block.raw)
    fail("FLOW_ENTER_STALE_BLOCK");
  if (block.inline && !block.inline.editable)
    fail("FLOW_ENTER_RICH_UNSUPPORTED");
  if (block.type !== "blank" && (!block.inline ||
      block.inline.text !== block.text ||
      (!block.inline.regions.length &&
        source.slice(block.sourceStart, block.sourceEnd) !== block.text)))
    fail("FLOW_ENTER_SOURCE_MISMATCH");
  const eol = ending(source);
  const prefix = source.slice(block.start, block.sourceStart);
  const token = block.type === "list_item" ? block.list?.token :
    block.type === "quote" ? prefix : "";
  if ((block.type === "list_item" && !token) ||
      (block.type === "quote" && !/^ {0,3}>[ \t]?$/.test(prefix)))
    fail("FLOW_ENTER_PREFIX_UNSUPPORTED");
  // An empty list/quote item is the user's explicit exit gesture.
  if (["list_item", "quote"].includes(block.type) && !block.text.length) {
    const from = block.start, to = block.sourceStart;
    return Object.freeze({
      type: "replaceRange", from, to, text: "",
      selectionAfter: collapsedSelection(from),
      operation: "flow-exit-block"
    });
  }
  const localEol = trailingEol(block.raw) || eol;
  if (block.inline?.regions.length) {
    const indent = block.type === "list_item" ?
      (/^ {0,3}/.exec(prefix)?.[0] ?? "") : "";
    const continuation = block.type === "quote" ? prefix :
      block.type === "list_item" && block.list?.style === "bullet" ?
        indent + block.list.token + " " : "";
    return planRichFlowEnter({ source, block, at, eol: localEol, continuation });
  }
  let continuation = "", to = at, tail = "", operation = "flow-enter";
  if (block.type === "list_item") {
    const indent = /^ {0,3}/.exec(prefix)?.[0] ?? "";
    if (block.list.style === "ordered") {
      const originalDigits = block.list.token.slice(0, -1);
      const format = n => {
        if (!Number.isSafeInteger(n) || n < 1 || n > 999999999)
          fail("FLOW_LIST_NUMBER_LIMIT");
        const digits = String(n);
        const value = originalDigits.startsWith("0") ?
          digits.padStart(originalDigits.length, "0") : digits;
        if (value.length > 9) fail("FLOW_LIST_NUMBER_LIMIT");
        return value;
      };
      continuation = indent + format(block.list.ordinal + 1) +
        block.list.delimiter + " ";
      // Only a contiguous ascending sequence at the same indentation and
      // with the same delimiter can be renumbered without guessing intent.
      let cursor = block.end, previous = block.list.ordinal, pos = at;
      const segments = [];
      while (cursor < source.length) {
        const line = /^( {0,3})(\d{1,9})([.)])([ \t]+)([^\r\n]*)(\r\n|\r|\n|$)/
          .exec(source.slice(cursor));
        if (!line || line[1] !== indent ||
            line[3] !== block.list.delimiter) break;
        const number = Number(line[2]);
        if (number !== previous + 1)
          fail("FLOW_ORDERED_SEQUENCE_UNSUPPORTED");
        const numberAt = cursor + line[1].length;
        segments.push(source.slice(pos, numberAt), format(number + 1));
        pos = numberAt + line[2].length;
        previous = number;
        cursor += line[0].length;
        if (!line[6]) break;
      }
      if (segments.length) {
        segments.push(source.slice(pos, cursor));
        tail = segments.join("");
        to = cursor;
        operation = "flow-enter-ordered-renumber";
      }
    } else continuation = indent + block.list.token + " ";
  } else if (block.type === "quote") continuation = prefix;
  // A trailing EOL already supplies the following paragraph separator.
  const endsWithEol = at === block.sourceEnd && !!trailingEol(block.raw);
  const insertion = ["paragraph", "heading", "blank"].includes(block.type) ?
    (endsWithEol ? localEol : localEol + localEol) :
    localEol + continuation;
  // At document end, put the caret AFTER the blank's trailing EOL.
  // Otherwise the next character merges the new line back into the old
  // Markdown paragraph and the visual projection becomes read-only.
  const terminalProse = ["paragraph", "heading"].includes(block.type) &&
    at === block.sourceEnd && block.end === source.length;
  const caret = at + insertion.length +
    (terminalProse && endsWithEol ? trailingEol(block.raw).length : 0);
  return Object.freeze({
    type: "replaceRange", from: at, to, text: insertion + tail,
    selectionAfter: collapsedSelection(caret),
    operation
  });
}


/**
 * G0.6B.3: one deliberate two-space list indentation level. The EFSS parser
 * recognizes only 0..3 spaces; higher levels must remain unsupported until
 * the AST itself represents them. Parent must precede the item immediately.
 */
export function planFlowListIndent({ source, block, at, direction } = {}) {
  if (typeof source !== "string" || block?.type !== "list_item" ||
      !block.editable || block.list?.style !== "bullet" ||
      !["indent", "outdent"].includes(direction) ||
      !Number.isSafeInteger(at) || at < block.sourceStart ||
      at > block.sourceEnd || !isGraphemeBoundary(source, at))
    fail("INVALID_FLOW_INDENT");
  if (source.slice(block.start, block.end) !== block.raw)
    fail("FLOW_INDENT_STALE_BLOCK");
  const prefix = source.slice(block.start, block.sourceStart);
  const match = /^( *)([-+*])([ \t]+)$/.exec(prefix);
  if (!match || match[1].length !== block.list.indent)
    fail("FLOW_INDENT_PREFIX_UNSUPPORTED");
  const indent = match[1].length;
  let from, to, text, nextOffset;
  if (direction === "indent") {
    if (indent !== 0) fail("FLOW_INDENT_DEPTH_LIMIT");
    const before = source.slice(0, block.start).split(/\r\n|\r|\n/);
    const previous = before.length > 1 ? before.at(-2) : "";
    if (!previous || !(previous.startsWith(match[2] + " ") ||
        previous.startsWith(match[2] + "\t")))
      fail("FLOW_INDENT_PARENT_REQUIRED");
    // Reparenting an existing nested child requires a tree transaction;
    // never leave that child silently attached to a different list item.
    const after = source.slice(block.end).split(/\r\n|\r|\n/, 1)[0];
    if (/^ {2}[-+*][ \t]+/.test(after))
      fail("FLOW_INDENT_CHILDREN_UNSUPPORTED");
    from = block.start; to = from; text = "  "; nextOffset = at + 2;
  } else {
    if (indent !== 2) fail("FLOW_INDENT_DEPTH_LIMIT");
    from = block.start; to = from + 2; text = ""; nextOffset = at - 2;
  }
  return Object.freeze({
    type: "replaceRange", from, to, text,
    selectionAfter: collapsedSelection(nextOffset),
    operation: direction === "indent" ? "flow-list-indent" : "flow-list-outdent"
  });
}

/**
 * Backspace at the visible beginning of a structural line unwraps its
 * marker, without deleting source in the preceding block. A nested bullet
 * first outdents; subsequent Backspace can convert it to plain text.
 */
export function planFlowBackspaceAtStart({ source, block, at } = {}) {
  if (typeof source !== "string" || !block?.editable ||
      !["list_item", "quote", "heading"].includes(block.type) ||
      !Number.isSafeInteger(at) || at !== block.sourceStart ||
      !isGraphemeBoundary(source, at))
    fail("INVALID_FLOW_BACKSPACE");
  if (source.slice(block.start, block.end) !== block.raw)
    fail("FLOW_BACKSPACE_STALE_BLOCK");
  if (block.type === "list_item") {
    if (block.list?.style !== "bullet") fail("FLOW_BACKSPACE_ORDERED_UNSUPPORTED");
    if (block.list?.indent === 2)
      return planFlowListIndent({ source, block, at, direction: "outdent" });
    if (block.list?.indent !== 0) fail("FLOW_BACKSPACE_INDENT_UNSUPPORTED");
  }
  const prefix = source.slice(block.start, block.sourceStart);
  if (!prefix || /[\r\n]/.test(prefix)) fail("FLOW_BACKSPACE_PREFIX_UNSUPPORTED");
  return Object.freeze({
    type: "replaceRange", from: block.start, to: block.sourceStart, text: "",
    selectionAfter: collapsedSelection(block.start),
    operation: "flow-unwrap-marker"
  });
}

export function slashFlowCommand(text) {
  if (typeof text !== "string") return null;
  const commands = {
    "/callout": { kind: "callout", variant: "info" },
    "/uyarı": { kind: "callout", variant: "warning" },
    "/warning": { kind: "callout", variant: "warning" },
    "/ipucu": { kind: "callout", variant: "tip" },
    "/h1": { kind: "heading" },
    "/başlık": { kind: "heading" },
    "/liste": { kind: "list_item" },
    "/list": { kind: "list_item" },
    "/alıntı": { kind: "quote" },
    "/quote": { kind: "quote" }
  };
  return Object.hasOwn(commands, text) ? Object.freeze(commands[text]) : null;
}

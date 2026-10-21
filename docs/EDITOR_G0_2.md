# G0.2 — Own Text Transactions + Native Input Adapter

**Date:** 2026-10-21
**Status:** Implemented in the repository with Node unit tests; **real Electron/Windows IME, caret and accessibility tests are not yet run**.

## What actually runs

The G0.1 Electron shell still owns window/IPC, while a new **framework-free editor core** owns the text buffer, selection, history and actions:

\`\`\`text
desktop/ui/app.js                   document buttons, preview, status
  └── attachTextFrame()             src/editor-input-adapter.js
         ├── native beforeinput / paste / cut / selection / IME
         └── TextEditorSession     src/editor-text-engine.js
                ├── immutable text state + typed position (nodeId="body", UTF-16 offset)
                ├── grapheme boundaries (Intl.Segmenter)
                ├── replace, insert, delete, Enter
                ├── reversible delta steps; grouped typing, undo/redo
                └── selection state, no DOM/Node/Electron dependencies
            ▼
       onChange(text)
            ▼
       src/editor-draft.js           dirty, revision-safe optimistic save
            ▼
       locked desktop IPC → LocalDocumentVault
\`\`\`

The result is a **model-backed plaintext TextFrame experiment**; Markdown source remains verbatim in the writing area and is rendered in a separate limited preview. This is **not** a Word/Notion/Illustrator-grade rich text view, paragraph/node tree, table, callout or artboard engine yet.

## Input rules and tradeoffs

- Intercept cancelable \`beforeinput\` for insert, Enter, Backspace/Delete and undo/redo. Use our own transaction operations and render the resulting text/selection.
- Use native \`contenteditable="plaintext-only"\` as **input host only**, not the canonical document. Reconcile unexpected browser mutations through an atomic diff step.
- On IME composition, **do not** modify the composing DOM or autosave intermediate states; reconcile when composition ends.
- Accept clipboard **plain text only** at this stage; rich pasted HTML is not executed or interpolated.
- UTF-16 source offsets remain compatible with the EFSS parser, while deletion/selection boundaries use user-perceived grapheme clusters. Typing a combining accent can extend a neighbor cluster; history deltas are expanded to common cluster boundaries for reversibility.
- Undo stores **delta steps**, not whole document snapshots per keystroke, and coalesces adjacent typed graphemes within 750ms unless caret is moved or a command boundary intervenes.
- Selection and input adaptation use DOM Selection/Range only in the renderer. The pure core is unit-tested without DOM; the Electron app remains an optional shell.
- Saving remains independently revision-checked. Undoing a saved change creates a new unsaved draft revision, not an overwrite of someone else's version.
- No UI/editor packages added. The existing Electron host is the only third-party declared package.

## Tests

\`test/editor-text-engine.test.js\` covers:
- Immutable state, typed positions, selection direction, offset mapping.
- Undo/redo inverse and redo invalidation; adjacent typing grouping.
- Full grapheme deletion for emoji sequences, combining characters and Turkish text.
- Edit of combining marks and zero-width joiners, with reversible undo/redo.
- Invalid commands, controls and oversized payload rejection.
- Deterministic randomized Unicode insert/delete/replace sequences, then full undo/redo.
- Markdown literal preservation (we do not interpret user text as instructions).

\`test/desktop-ui-contract.test.js\` verifies that the UI now connects to the model-backed adapter, exposes undo/redo controls and keeps the Chromium security gates. These are **static/unit checks**; UI runtime correctness still requires manual or automation-backed browser testing.

## Remaining known risks

1. Browser native input behaviors **vary**, especially IME, autocorrect, selection within complex native DOM, mobile virtual keyboards, clipboard and accessibility. The DOM reconciliation adapter is first cut only.
2. The engine currently models a **single plain TextFrame** with \`nodeId="body"\`. Structured paragraph/block IDs, multi-TextFrame selections, rich formatting, layout and full AST integration still need their own design iterations.
3. Large documents currently re-render their active text node and validate length on each edit. Profiling is required before calling this performant.
4. Browser crash/force-kill can still lose not-yet-autosaved text. Durable journal/backup is a separate milestone.
5. Some Markdown preview constructs are intentionally incomplete. The source remains authoritative.
6. The custom scheme, Windows native Electron preload and real autosave behavior are not covered by GUI CI; **Node tests alone do not validate them**.

## Next gate

Run the actual Windows Electron app and record:
- Turkish combining letters + emoji family insert/delete/undo.
- Selection forward/backward, replace, long text, paste/cut, Ctrl+Z/Y and toolbar undo/redo.
- IME composition + autosave + rapid note navigation.
- Reload persistence and revision conflict.
Then extract the existing TextFrame model into **stable paragraph/block identities** and a focused renderer so clicking \`/callout\` and making tables can later use a common command/transaction pipeline without importing a third-party editor.

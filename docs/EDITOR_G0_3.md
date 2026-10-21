# BellekPad — G0.3 block projection & desktop window policy

**Status (2026-10-22):** Pure EFSS block projection implemented and connected to the desktop outline. Electron default menus/DevTools are disabled in the application configuration. Automated Node tests verify serialization and the configuration, **not actual Windows user interactions**.

## Editor contract (G0.3, first slice)

- \`src/editor-block-model.js\` projects the original EFSS AST into an **immutable, ordered list of blocks**: headings, paragraphs, blank separators, quotes, lists, fenced code, extension blocks and other recognized AST units.
- Every block receives an **in-session stable ID**. Unchanged prefix and suffix blocks retain IDs when editing another block; a uniquely changed block keeps its ID; splits/merges or ambiguous changes receive new IDs. IDs are **not yet persisted across application restarts** and must not be presented as durable external links.
- The original source string, including line endings, EFSS constructs, whitespace, unknown extensions and Markdown syntax, remains authoritative. Structural operations produce a new source and reparse via the **existing own AST**. Serializer reconstructs the original source *without normalizing it*.
- An unknown \`:::efss...\` extension is **opaque**: its text remains readable in source view and byte-preserved. Structure-mode replacement fails closed, while deliberate direct source edits can still change it.
- An explicit insertion API supports simple paragraphs, headings, quotes, list items and dividers. The operation does **not** silently claim callout, tables, complex layout or typography are already editable.
- Input still uses the G0.2 single model-backed TextFrame. \`desktop/ui/app.js\` keeps a synchronized source-block projection after each text change and exposes a collapsible **Belge yapısı** navigator. Clicking an item navigates to its text location. This is NOT a full multi-contenteditable rich-text renderer.
- Structural model APIs use optimistic version validation and never write files. The storage path remains the existing restricted Electron IPC → local vault.
- Known limitations: reparsing a full source and redrawing the outline for every keystroke is not optimized; next step is incremental parser/renderer invalidation and real per-block input/selection mapping. Text insertion commands are not exposed as visual block insertion buttons yet; they need a genuine block renderer rather than revealing Markdown delimiters.

## Desktop controls policy

- \`desktop/main.js\` explicitly sets \`webPreferences.devTools = false\`. Electron documentation states this prevents in-window \`webContents.openDevTools()\`. We additionally close a DevTools surface if opened unexpectedly.
- \`Menu.setApplicationMenu(null)\` suppresses Electron's default File/Edit/View/Developer menu. Window menu bar is hidden. Browser reload and inspector shortcut variants are cancelled at the window level by testable \`desktop/window-controls.js\`.
- A custom **editing-only** right-click menu exposes cut/copy/paste/select-all in editable areas but no Inspect/Reload/View Source entries. Native OS window minimize/maximize/close controls remain available.
- No generic Electron/Node APIs were exposed to the renderer. The existing preload/main-frame IPC security boundary remains unchanged.
- This **does not constitute tamperproof DRM**: someone with local OS process rights, modified executable/source, remote debugger flags or independent inspection tools cannot be unconditionally blocked by an application configuration. It only removes **built-in Electron/Chromium developer UI** from the standard running app. Future packaged distribution should separately assess Electron fuses, signing, debugging flags and threat model; these are not yet implemented.

Official references:
- https://www.electronjs.org/docs/latest/api/structures/web-preferences
- https://www.electronjs.org/docs/latest/api/menu
- https://www.electronjs.org/docs/latest/tutorial/security
- https://www.electronjs.org/docs/latest/tutorial/performance

## Verification

The Node test suite covers exact source roundtrips (including CRLF, emoji and unknown EFSS extension blocks), block identity after localized edits, valid/invalid insertion, optimistic version conflicts, randomized source insertion, window control policy and preservation of Ctrl+S/Z/V/C.

**Still needed:** actual Electron launch on Windows, manual menu/F12/Ctrl+Shift+I/J/C and right-click checks, caret/IME/Unicode tests, autosave under tab-close/race. No packaged executable or cross-platform native smoke test yet.

## Next G0.4

Move from an outline built *alongside* the single source-text host to independently selectable and editable **visual paragraph/TextFrame nodes** with common transactional undo across blocks. The same document model must drive both Flow and later Artboard Layout; preserve unknown EFSS blocks and source bytes on every structural edit. Do not mount an imported rich-text editor.

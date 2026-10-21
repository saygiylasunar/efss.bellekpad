# G0.5 — Inline formatting and source-offset bridge

**Implemented:** 2026-10-22. The shared EFSS Markdown string remains the single source of truth. No imported rich-text editor, UI framework, or separate document schema.

## Main code

- \`src/editor-inline-format.js\` projects plain/strong/emphasis/strike Markdown source into styled text runs and reversible UTF-16 source ranges. Its \`planInlineMark()\` creates a **single** replace operation for the existing TextEditorSession history.
- \`src/editor-flow-model.js\` now projects supported inline marks into visible text, retaining source delimiters in the underlying document. Inline code, escaped Markdown, semantic EFSS symbols and complex/multiline constructs still use the deliberately conservative read-only/Source fallback.
- \`src/editor-flow-adapter.js\` creates native styled DOM elements via \`createElement\`/\`textContent\`, never unsafe \`innerHTML\`. DOM visible caret/selection positions are mapped back into source offsets; marker insertion/removal, normal typing inside a marked run, undo/redo and source switching all use one shared TextEditorSession.
- Visual B/I/S toolbar and Ctrl+B/Ctrl+I are wired into the Flow mode. Clicks preserve native selection via pointerdown. The toolbar intentionally stays compact rather than becoming a Word-like command ribbon.
- Standard and unsupported native input reconciliations are checked against source text. Edits that would consume hidden formatting delimiters are rejected with an explicit status message, not silently saved.
- Style boundaries and cross-run replacements remain **deliberately limited**. This initial slice handles selections entirely inside one unmarked run and toggles a mark when exactly the marked region is selected. It is not arbitrary nested formatting on mixed source spans.

## Interface

\`\`\`text
Görsel Flow markup presentation ----\
                                     +-- TextEditorSession --> EFSS draft
Kaynak raw Markdown editing --------/                       --> Electron IPC
                                                              --> Local Vault
\`\`\`

Bold is serialized as \`**selected**\`, italic as \`*selected*\`, and strike as \`~~selected~~\`. This does **not** imply complete CommonMark/GFM support or full accessibility/IME correctness; unsupported constructs do not lose source fidelity.

## Validation

Unit tests target:
- Nested and single marks, source ↔ visible offset mapping at delimiters.
- Apply/unapply formatting with single-step undo/redo.
- Emoji grapheme boundary checks and leading/trailing whitespace constraints.
- Fail-closed mixed/unknown/EFSS content.
- Plaintext/source preservation through the existing file vault.

The existing \`desktop-smoke\` runs the actual Electron UI on Windows and Linux. It now attempts visual selection formatting, typing within bold, Undo/Redo, and local disk roundtrip in addition to G0.4 scenarios. Real IME, native physical keyboard and assistive technology still need hands-on checks.

## Known risks / next tasks

1. Selection spanning separate rich runs (e.g. part bold and part plain) requires a proper run-splitting/merge transaction before accepting replacement. For now refuse when hidden delimiters would be affected.
2. Same-block native IME composition is reconciled conservatively. Some browser-specific input events are not cancelable and may fail at a formatting boundary; a Source fallback remains available.
3. Full DOM re-render per transaction remains an optimization and caret stability risk. Next slice should reconcile only affected blocks/runs and add comprehensive native keyboard/IME integration tests.
4. The rich Flow view remains a single-line-per-editable-block experiment. Multi-line paragraphs, robust Enter/Backspace across blocks, table cells, callout nesting, layout/artboard and PDF export are not completed.
5. Syntax like \`&Symbol\`, \`[[paper:ID]]\`, user escape sequences and unknown EFSS extensions must never silently be normalized by the formatted view.

**Decision:** keep user-authored Markdown accessible, implement our own source-aware rich-text operations, avoid an external editor dependency.

## CI confirmation (2026-10-22)

- **Node core:** 211/211 tests pass, sanity gate passes.
- **Electron Linux (Xvfb):** passing real GUI smoke.
- **Electron Windows:** passing real GUI smoke.
- Verified commit: `be3bfa0` via `desktop-smoke` and `core-checks` workflows. GUI coverage is a tested vertical slice rather than a general no-bugs guarantee.

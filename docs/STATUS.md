# EFSS BellekPad — Current status

**Active stage: P1.4 contract cleanup (schema version 2)**

Core present: EFSS Markdown lexer and AST, source-referenced documents, typed variable inspection, immutable constants, Node local document vault, lexical memory search, explicit reviewed relation graph, optional local AI/ComfyUI adapters, model-directory manifests and privacy checks.

## Critical design correction

There are only two symbol mutability classes: **variable** and **constant**. Six explicit value types and two explicit cardinalities (`one` default, `many` opt-in for variables). Every typed symbol must have a definition. An inline list of values is never assumed to be the history of a changing quantity.

The overlapping `VariableLedger` and `LocalObservationLedger` APIs and their automatic graph observation view have been retired. No local user files are modified or deleted. Previous source code remains recoverable via Git history. Legacy version-1 schema documents with empty property bags remain readable; nonempty legacy properties require explicit migration.

See [SYMBOL_CONTRACT.md](SYMBOL_CONTRACT.md) for normative rules.

## Previous implementation milestones

- P0.x: Original parser, semantic references, AST, memory stations, local model connectors and evaluation framework.
- P1.0–P1.1: Configured multi-disk ComfyUI model-folder map, restricted model discovery, separate LoRA/ancillary discovery.
- P1.2: Private revision-aware Node document vault.
- P1.3: Typed EFSS `&Variable{...}` syntax.
- P1.4: Source-scoped, review-gated persistent relation graph and EFSS type schema documents.
- P1.4b (retired): Overly broad observation journaling; kept only in Git history, not the current product API.

## Pending

Browser IndexedDB storage and migration tools; portable secure backup/restore; an actual note/editor UI; relation-review interface; local real-hardware model tests; real semantic retrieval evaluated on representative user-approved data. **Working CI tests validate code paths, not product usefulness or model inference quality.**

## UI scope lock — visual editor takes priority

Editor requirements and release slices are captured in [EDITOR_BLUEPRINT.md](EDITOR_BLUEPRINT.md): callouts with icons, editable tables, emoji/page icon picker, rich formatting, slash menu, source/visual/preview modes, and later media/layout features. The user-facing app and these blocks are **not yet implemented**. Next delivery should build E0a/E0b frontend, not introduce more speculative memory subsystems.

## Rights and artboard editor scope (2026-10-21)

The repository declares **all rights reserved / no public software license** in root LICENSE, with npm `private: true` and `license: UNLICENSED`. This does not block GitHub ToS view/fork rights; public source remains accessible. See [RIGHTS_AND_DISTRIBUTION.md](RIGHTS_AND_DISTRIBUTION.md).

The editor requirements have superseded the earlier third-party-library experiment. Own ES-module text engine, AST integration, native input composition, transaction/undo, flow and artboard layout frames, precision geometry, text frames, glyph/typographic controls, preset sizes, collision/overflow rules and contextual controls are now the design contract. No external editor packages/runtime UI frameworks. PDF/DPI/optimized exports are deferred behind a working text editor.

Specs: [EDITOR_ENGINE.md](EDITOR_ENGINE.md), [ARTBOARD_LAYOUT_SPEC.md](ARTBOARD_LAYOUT_SPEC.md), [EDITOR_BLUEPRINT.md](EDITOR_BLUEPRINT.md). The app/editor/layout engine itself **has not been implemented yet**.

## Research gate — editor engine, 2026-10-21

Completed technical research against standards and editor architectures. Recommended first proof: a browser-native active-text-frame input spike with cross-browser IME reconciliation, plus our own pure operation/transaction/selection-mapping core. The detailed trade-offs, measured-vs-unmeasured limits and verification matrix are recorded in [EDITOR_RESEARCH_2026-10-21.md](EDITOR_RESEARCH_2026-10-21.md). Editor implementation and cross-browser manual tests are pending.

## Host-neutral direction — desktop, web and mobile

The application is **not committed to browser-only distribution**. Researching Electron/Discord/Slack shows that a portable web-rendered UI can be packaged as an installable desktop application while keeping the underlying editor logic independent. Electron is a shell candidate; Tauri v2 is an alternative. No shell dependency, desktop binary or file bridge is implemented yet. See [PLATFORM_ARCHITECTURE.md](PLATFORM_ARCHITECTURE.md).

## G0.1 — Electron desktop bridge implementation

Implemented `desktop/main.js` + sandboxed `desktop/preload.cjs` + whitelisted `bellekpad://app` asset handler, a simple application shell in `desktop/ui/`, and `src/desktop-document-service.js` for restricted CRUD-ish paper/project operations. Node tests verify source persistence, optimistic revision conflict, request validation, static asset boundary and draft save race handling. Electron 44.9.3 is a pinned dev dependency but **native GUI launch has not been tested** in CI. Callout/table/visual formatting/flow artboards and full selection engine are not implemented. See [DESKTOP_SPIKE.md](DESKTOP_SPIKE.md).

## G0.2 — First own editor transactions

Implemented `src/editor-text-engine.js` (immutable single TextFrame, UTF-16 typed offsets, grapheme-boundary edits, undo/redo delta history, typing grouping) and `src/editor-input-adapter.js` (cancelable native input, clipboard plain text, selection, composition reconcile). Connected both to the Electron UI with undo/redo controls. **Not full rich text/paragraph/artboard rendering.** See [EDITOR_G0_2.md](EDITOR_G0_2.md). Real Windows Electron/IME GUI verification pending.

## G0.3 — Structural document foundation and native chrome policy

Added `src/editor-block-model.js` (lossless source-block projection, session-stable IDs, version checks, source-preserving inserts and opaque extension safety) and connected block outline navigation to the Electron G0.2 text session. Electron's application/developer menus and built-in DevTools are disabled, and native right-click offers only basic edit actions. Pure Node tests added; **Windows GUI usability and real keyboard/IME verification remain pending**. See [EDITOR_G0_3.md](EDITOR_G0_3.md).

## G0.4 — İlk gerçek görsel Flow modunun kodlanması

Üç görünüm (Görsel/Kaynak/Önizleme) tek metin oturumunu ve EFSS kaynak kaydını kullanıyor. Görsel Flow, basit blokların Markdown işaretlerini gizleyerek doğrudan yazma, Türkçe slash komutları ve tıklayarak callout ekleme sunuyor. Kod/özel EFSS/nested/inline-mark durumlarında *lossless* garantisi için Flow içindeki içerikler salt okunur ve Kaynak moduna yönleniyor. Henüz gerçek GUI testleri veya tam görsel Markdown, layout, tablo, artboard, DPI export yok. [EDITOR_G0_4.md](EDITOR_G0_4.md).

## G0.4 runtime verification

GitHub Actions `desktop-smoke` passed on Windows and Ubuntu/Xvfb for commit `a16a15e`: real Electron startup, trusted local renderer + preload, `/callout`, editable callout body, block insertion, undo/redo, revision-safe save/open and Görsel/Kaynak/Önizleme switching. Core Node tests: 204/204. Limitations: synthetic `beforeinput` is used for deterministic smoke; manual physical keyboard/IME testing and screenreader/performance measurements remain pending. Source: [desktop-smoke workflow](../.github/workflows/desktop-smoke.yml).

## G0.5 — Kaynak-aralıklı inline biçimlendirme

Own inline run projection + B/I/S commands, source-aware range map and mark toggling implemented in visual Flow via shared TextEditorSession. Existing Electron IPC, sandbox and DevTools policy unchanged. Mixed cross-mark selections, rich multi-line text, proper table/layout and comprehensive IME remain unimplemented. [G0.5](EDITOR_G0_5.md).

**G0.5 verification:** Core Node 211/211; real Electron smoke passed on Windows and Linux including bold mark selection, edit inside a bold run, Undo/Redo and EFSS save/open. Physical keyboard/IME and full visual editing are still not validated.

# EFSS BellekPad — Current status

> **25 Ekim 2026 güncel ürün yönü ve devir:** [DEV_HANDOFF.md](DEV_HANDOFF.md). Bu dosya kronolojik uygulama notlarını saklar; ilerleme önceliği ve eksikler için devir belgesine bak.

**Active editor delivery: G0.7A source-backed pipe table + early G0.9 Inspector + G0.6B.6 partial / v0.2.8 (25.10.2026).** P1.4 schema version 2 remains the EFSS semantic core milestone; the older sections below are chronological implementation history, not the current editor state. Current mainline handoff is [DEV_HANDOFF.md](DEV_HANDOFF.md).

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

## G0.6A.1 — Rich caret ve kayıpsız inline edit (22.10.2026)

`src/editor-inline-format.js` kaynak↔görünür offset ters eşleme ve `planInlineTextEdit()` doğrulaması kazandı. `src/editor-flow-adapter.js` DOM span başı/sonu için doğru kaynak run'ını seçiyor; karma mark bölgesinde görünmeyen Markdown işaretini tüketecek delete/replace korumalı reddediliyor; cut güvenli bağlantıda. 219/219 Node, Windows+Ubuntu GUI smoke başarılı (commit `dfac015`). Hâlâ karma style split/merge ve cross-block editing yapılmadı. [EDITOR_G0_6A.md](EDITOR_G0_6A.md).


## UI Tipografi ve Özgün SVG İkonları (v0.2.7)

Arayüz için merkezi, **offline** font stack'leri eklendi: All Round Gothic (UI), Noka (görüntüleme/başlık), Exo (teknik/metin), Türkçe harfler için sistem fallback'leri. Lisanslı font dosyası repoda yoktur; ailelerin makinede bulunması gerekir, web kit içeriği ayrıca doğrulanmalıdır. Electron UI'de yerel SVG ikon sözlüğü (src/ui-icons.js) ile araç çubuğu, belge gezgini ve callout başlıkları değiştirildi. Adobe Fonts web-project URL `https://use.typekit.net/aww8lcp.css` yalnız **web-only** örneğinde yer alır; CSP ve `connect-src 'none'` ile desktop'ta harici ağ fontu yüklenmez. `src/editor-text-engine.js` ve not verisi değiştirilmedi. [Ayrıntılı tipografi/lisans/ikon notları](docs/TYPOGRAPHY_ICONOGRAPHY.md).

## G0.6A.2 — Karma mark seçimi

Tam seçilen Markdown işaretlerini ve düz metni bir işlemde değiştirme/silme, Undo/Redo ve kısıtlı karma strike eklendi. 230/230 Node ve Windows/Linux Electron smoke başarılı (commit 2c31b07). Kısmen seçilmiş stilleri kesme ve genel B/I henüz güvenle desteklenmiyor. [Teknik kayıt](EDITOR_G0_6A_2.md).

**G0.6A.2 ek doğrulama:** Tek seviyeli partial mark split/reopen tamamlandı; kalan stil korunuyor. Nested partial marklar korunarak reddediliyor. 232/232 Node, Windows/Linux Electron smoke başarılı (`7ecb9e7`). [Ayrıntı](EDITOR_G0_6A_2.md).

## G0.6A.2 — verified bounded nested partial editing

Commit `6f27e29` expands partial text replacement from single-level Markdown marks to a verified subset of nested wrappers (strike plus strong), preserving all unselected mark traces and opaque source bytes. Unsupported ambiguous nested B/I delimiters still reject without changing source. 235/235 Node checks and Windows/Linux Electron smoke succeeded; physical keyboard, IME and generalized mixed formatting remain open. [Implementation detail](EDITOR_G0_6A_2.md).

## G0.6A.2 — safe mixed-partial marks and reverse formatting Undo/Redo

`a41c246` adds parser-validated balanced B/I/S marking over supported partial strong/plain and strike/plain selections without rewriting outside source. `9e534eb` persists format operation selection anchor/focus in the same undo entry, so reverse selection survives undo and redo. `***` collisions remain fail-closed. Latest code: **241/241 Node + sanity/check, Windows and Linux real Electron smoke passed.** G0.6A is not fully accepted; continue the remaining B/I collision gate in [DEV_HANDOFF.md](DEV_HANDOFF.md).

## G0.6B.2 — verified atomic ordered-list Enter and heading tiers (22.10.2026)

Commit `c045a1a` passes 259 Node tests, sanity gate and real Electron Windows/Linux smoke. A numbered list Enter increments contiguous valid siblings as one source transaction with Undo/Redo, including CRLF, leading zeros and ordered delimiter variants, without rewriting unknown EFSS blocks. Six heading levels receive separate semantic CSS tiers. Electron smoke CI now terminates cleanly after success. Remaining list hierarchy, cross-block edits, rich split and Inspector are not accepted.

## G0.6B.3 — one-level bullet hierarchy and marker unwrap (22.10.2026)

Code `4297d04`, smoke syntax fix `cd661ad`: **265/265 Node tests**, source sanity and real Windows/Linux Electron smoke passed. Supported bullet list `Tab`/`Shift+Tab` moves one two-space depth with correct caret + atomic Undo/Redo; Backspace at the visible start of a bullet/quote/heading unwraps its markup, first outdenting nested bullets. UI shows list depth and preserves opaque EFSS. Higher nesting, ordered list outdent, arbitrary block merges and Inspector controls remain unimplemented. [Detailed contract](BLOCK_BEHAVIOR_SPEC.md).

## G0.6B.4 — real visual Enter after styled content, terminal typing recovery

Code `c0c8cc` adds parser-verified rich B/I/S one-line split on Enter; code `91fa27d` fixes terminal blank caret position so typing after paragraph/heading Enter stays visually editable instead of merging into an AST multiline read-only paragraph. **269/269 Node, sanity + Windows/Linux Electron smoke passed**. Mixed nesting collisions, nonterminal blank paragraphs and full multi-block/IME edit flows still require work. [Block details](BLOCK_BEHAVIOR_SPEC.md).

## G0.6B.5 — verified source-safe plain paragraph joining (22.10.2026)

Commit `6482537` adds **Backspace at beginning of next paragraph** and **Delete at end of previous paragraph** over exactly one Markdown blank separator; parser verification enforces a single editable paragraph after joining. Source corruption, opaque EFSS, extra blanks and mixed-rich markers fail closed. **275/275 Node**, source sanity and real Windows/Linux Electron smoke passed. Next: multiline/Shift+Enter, selection across paragraphs, physical IME. [Block contract](BLOCK_BEHAVIOR_SPEC.md).


## G0.6B.6 — verified editable plain multiline Flow (23.10.2026)

Code `af31760`: an EFSS plain Markdown paragraph may span multiple source lines and remain one editable visual block. Source-preserving Shift+Enter is accepted **inside text**, with guarded multiline typing/backspace/Undo/Redo and parser revalidation. Normal Enter beside a soft break avoids a third EOL. **280/280 Node**, sanity and native Windows/Linux Electron smoke green. Still open: trailing empty soft line, marked multiline, cross-block selections/paste, physical IME. [Contract](BLOCK_BEHAVIOR_SPEC.md).


## 25.10.2026 — product-visible contextual Inspector (verified)

`fbb0ab` adds a real right-hand Inspector for an active visual block. H1–H6 heading level, unordered list `-/+/*` marker and info/tip/warning/success/error callout variant are set by one source-owned, parser-verified `TextEditorSession` transaction. Default callout title/icon follow the type; user-customized title/icon are preserved. Undo/Redo and original opaque EFSS content are preserved. **285/285 Node + Windows/Linux native Electron smoke green.** This is a deliberately early G0.9 vertical slice, not the full Inspector or artboard.

Scope now prioritizes **visible end-to-end capabilities**: real tables/checklist, then first local LLM GUI/IPC, alongside limited G0.6C reliability, followed by artboard/layout. [Product direction](PRODUCT_DIRECTION.md).


## G0.7A — native editable pipe tables, saved and reopened (25.10.2026)

`7ff3c39` — **291/291 Node**, privacy/sanity, real Windows/Linux Electron and real local vault save/reopen smoke passed. Menu → Table inserts **3 columns × 3 visible rows** including the header. Each simple cell is a live editable text surface: insertion/deletion, Tab / Shift+Tab navigation, row append after last Tab, and row append in Inspector. Changes are source-reparsed and transactional in the existing journal. Unknown EFSS and unrelated prose retain exact bytes. Static desktop protocol adds only two checked-in table modules, never a general file server. Full GFM escape/markup syntax, complex cells, arbitrary paste-grid, row deletion and column operations remain open.

[Core](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40234791607) · [Desktop](https://github.com/saygiylasunar/efss.bellekpad/actions/runs/40234791537).


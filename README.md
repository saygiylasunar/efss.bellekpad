# EFSS BellekPad

> **PROPRIETARY / ALL RIGHTS RESERVED.** Original source code and original design materials are **not open source** and are not granted for third-party use, adaptation, execution, redistribution or commercial deployment without prior written permission, except rights under applicable law and GitHub's Terms of Service. See [LICENSE](LICENSE) and [rights & distribution](docs/RIGHTS_AND_DISTRIBUTION.md). Public visibility is **not** public software licensing.


> **🧭 GELİŞTİRME DEVRİ / AKTİF ROADMAP:** [docs/DEV_HANDOFF.md](docs/DEV_HANDOFF.md) — güncel durum, tamamlanan dilimler, G0.6'dan itibaren öncelikler, dosya haritası, test kapıları ve yeni sohbet başlangıç talimatı. **Yeni çalışmaya bu dosyadan başla.**

Local-first experimental EFSS Markdown and contextual-memory kernel. Own Markdown parser, AST, source-linked references and offline document vault. **A stored value is not automatically a fact or the current state of a real-world object.**

## Symbol contract (P1.4 cleanup)

There are **two** kinds of typed symbols: `variable` and `constant`. They use the same six allowed value types (`text`, `number`, `boolean`, `date`, `enum`, `reference`). A variable holds **one** inline value candidate by default; a list is allowed only when `cardinality: "many"` was explicitly declared. A constant must have exactly one fixed value in its definition and cannot be reassigned through a Paper binding or rewritten under the same document identity.

`&Miktar{26}` is a typed candidate **only when Miktar is declared**; it is not a time-series observation, automatic state update or inference. `&Miktar{26,48}` is rejected for a default one-value variable. `&Pi` references an immutable constant defined in a variable-schema document.

See [symbol rules and migration](docs/SYMBOL_CONTRACT.md) and [syntax](docs/EFSS_BINDINGS.md).

## Local persistence

Canonical EFSS Markdown lives in the Git-ignored `.efss/vault/`, protected by revision checks. Explicit, reviewed **relations** can live in `.efss/knowledge/relations.jsonl`. The speculative duplicate observation journals have been **retired from the active product API**; existing local journal files are not deleted, and previous implementation remains in Git history. Graph snapshots do not auto-promote arbitrary typed values into a second memory.

```powershell
npm run vault -- status
npm run vault -- import .efss/imports/document.md
npm run vault -- search ritim
```

See [data-storage boundaries](docs/DATA_STORAGE.md) and [knowledge graph](docs/KNOWLEDGE_GRAPH.md).

## Local model connections (optional)

This experimental project also offers a local OpenAI-compatible LLM provider, ComfyUI workflow adapter and directory-scoped model inventory. Nothing is automatically trained or downloaded. Model search only visits user-declared directories; it excludes LoRA and ancillary assets from the primary model list.

```powershell
# Copy config/model-paths.example.json to config/model-paths.local.json first.
npm run comfy:paths -- --config config/model-paths.local.json
npm run runtime -- scan config/model-paths.local.json
npm run runtime -- scan config/model-paths.local.json --components
```

Refer to [runtime](docs/MODEL_RUNTIME.md) and [ComfyUI path mapping](docs/COMFY_MODEL_PATHS.md).

## Development checks

```sh
npm run sanity
npm run check
npm test
```

The public-source sanity check and GitHub Actions help catch private paths or credential patterns, but they cannot guarantee that all private information is absent. Local personal data, trained models, private notes, logs, and keys must stay off the public repository. See [privacy policy](docs/PRIVACY.md).

**Editor status:** An early, desktop Electron visual Flow editor (G0.5) exists; it is **not a complete production-ready note editor**. Full rich multi-block editing, tables, artboards, installer, crash recovery, browser IndexedDB and complete import/export remain future work. See the [current development handoff](docs/DEV_HANDOFF.md).

## Genuine self-developed editor — next priority

**No editor framework, external rich-text engine or application runtime UI library will be adopted.** Earlier exploratory Tiptap/ProseMirror/CodeMirror/Vite/Vue suggestions are withdrawn. The planned visual editor, native text input adapter, model transactions, page/artboard layout, text frames and contextual Illustrator-like inspector will be developed using our own ES modules and standard browser APIs.

The editor must be practical for writing before advanced export features. It will support slash commands, click-to-insert callouts/tables, emoji/icons, source/visual views, multi-artboard presets, flow + precise spatial layout, non-overlap by default and explicit control over sizing, placement and typography.

**Not yet implemented.** References: [Editor Blueprint](docs/EDITOR_BLUEPRINT.md), [Engine Architecture](docs/EDITOR_ENGINE.md), [Artboard/Layout](docs/ARTBOARD_LAYOUT_SPEC.md).

Export planning includes PDF, scalable objects, user-controlled raster dimensions/DPI and compression, **after** the actual writing and layout engine works.

## Independent editor engineering research (2026-10-21)

Before implementing the self-developed editor, the team reviewed transaction/selection models, Unicode/IME input, browser-native contenteditable/EditContext limitations, non-overlapping artboard constraints, typographic shaping, Markdown fidelity, security and storage. Findings, rejected options, objective browser experiments and success gates: [Editor Engineering Research](docs/EDITOR_RESEARCH_2026-10-21.md). Research only: not a functioning visual editor.

## Desktop-first, host-independent architecture

BellekPad is not restricted to a public website or browser tab. A future installable desktop executable can host the custom editor through Electron (candidate) or another suitably isolated native shell. The document, Markdown, layout and transaction systems will remain shell-independent; native operations use narrow adapters. Electron would be a packaging/runtime host, **not** an imported rich-text editor dependency. No desktop binary is implemented yet. See [Platform Architecture](docs/PLATFORM_ARCHITECTURE.md).

## G0.1 — Desktop integration prototype (Electron)

The first working **desktop document bridge and text input spike** is in `desktop/`: a local Electron window, strict preload IPC, an EFSS document list/new/open/save workflow with revision checks, a plain text input surface, and AST-based read-only preview. This is **not yet** the intended visual rich-text/layout editor.

```powershell
npm install
npm run desktop
```

The project pins Electron 44.9.3 as the **only approved host package**; no external editor/UI runtime is imported. Node CI verifies the document contract and security allowlists, **not** Electron launch or Windows IME. Data is stored in the operating system user-data vault; existing `.efss/vault` CLI notes are not auto-imported. Read [Desktop Integration and manual test plan](docs/DESKTOP_SPIKE.md).

## G0.2 — Custom text transaction core

The Electron writing surface now routes inserts, deletion, Enter, paste and undo/redo through BellekPad-owned `TextEditorSession` and a native browser input bridge. Grapheme-safe selections, inverse delta history, typing groups and revision-aware saving are covered by Node tests. The source remains EFSS Markdown; this is **still a plain text frame**, not the planned WYSIWYG/page-layout editor. See [G0.2 engineering notes](docs/EDITOR_G0_2.md). Desktop Windows GUI/IME testing remains pending.

## G0.3 — Stable block projection and hidden Electron developer chrome

`src/editor-block-model.js` now projects source EFSS Markdown to stable **editing-session** block identities with exact raw-source/CRLF/unknown-extension preservation. Electron exposes a collapsible block outline navigable by click; true multi-block visual editing, artboards and callouts remain pending. The default Electron menu, in-window DevTools, debugger/reload shortcuts and Inspect context entries are disabled; editable fields retain a basic safe cut/copy/paste context menu. These application controls are not an absolute anti-debugging/DRM mechanism. [G0.3 engineering notes](docs/EDITOR_G0_3.md).

## G0.4 — İlk görsel Flow düzenleyicisi

BellekPad artık tek bir `TextEditorSession` üzerinde **Görsel / Kaynak / Önizleme** modlarını kullanıyor. Basit başlık, paragraf, liste ve alıntı metinleri görsel olarak düzenlenebiliyor; `/callout`, `/uyarı`, `/ipucu` komutları ve açılır blok menüsü gerçek EFSS callout oluşturuyor. Kayıpsız desteklenmeyen kod, bilinmeyen EFSS uzantısı, inline Markdown biçimleri ve karmaşık içerikler **Kaynak** moduna yönlendiren korumalı kart olarak gösteriliyor. Henüz tam WYSIWYG, tablo ve artboard değil. [G0.4 ayrıntıları](docs/EDITOR_G0_4.md). Gerçek Windows/Electron GUI testi bekliyor.

## Desktop renderer smoke — Windows and Linux

The `desktop-smoke` GitHub Action now launches the **actual pinned Electron binary**, exercising the sandboxed window, preload/IPCs, visual `/callout`, native local vault save/open, block insertion, undo/redo, and three view modes on **Windows and Linux**. Both jobs passed on commit `a16a15e`. This verifies a focused set of real UI pathways, **not** comprehensive Windows user input, IME, accessibility or installer behavior. [Desktop smoke workflow](.github/workflows/desktop-smoke.yml).

## G0.5 — Inline biçimlendirme

Görsel Flow metninde B/I/S ile seçili bölüme kalın, italik ve üzeri çizili Markdown işaretleri eklenir; görünür işaretler arayüzden gizlenirken EFSS kaynak ve tek Undo/Redo geçmişi korunur. Desteklenmeyen karmaşık kaynak segmentleri salt okunur biçimde Kaynak'a yönlendirilir. [G0.5 teknik notları](docs/EDITOR_G0_5.md).

### G0.5 test confirmation

The real Electron desktop smoke test now covers selecting and styling heading text, typing inside the formatted run, Undo/Redo, save/open and both editing modes on **Windows and Ubuntu**. Both targets passed on commit `be3bfa0`; 211/211 Node tests passed. Keyboard/IME and complex cross-style selections are still explicit limitations.

## G0.6A.1 — Güvenli rich-text seçim ve kaynak sınırları

Biçimli metin içindeki native caret, görünür karakter offset'i yerine ilgili **inline DOM run → kaynak aralığı** üzerinden eşlenir. Biçimsiz + biçimli run seçiminin gizli Markdown işaretlerini bozacağı düzenleme fail-closed reddedilir; native cut güvenli metin payload'ına ve aynı transaction'a bağlanır. `A **kalın** B` ters karma seçim, `**İçerik**` baş/son Unicode, Undo/Redo ve EFSS unknown extension regresyonları eklendi. **219/219** Node test ve **Windows/Linux Electron GUI smoke** başarılı (commit `dfac015`). Tam karma stil dönüştürme **G0.6A.2**, çok satırlı akış **G0.6B**. [G0.6A teknik kayıt](docs/EDITOR_G0_6A.md).


## UI Tipografi ve Özgün SVG İkonları (v0.2.7)

Arayüz için merkezi, **offline** font stack'leri eklendi: All Round Gothic (UI), Noka (görüntüleme/başlık), Exo (teknik/metin), Türkçe harfler için sistem fallback'leri. Lisanslı font dosyası repoda yoktur; ailelerin makinede bulunması gerekir, web kit içeriği ayrıca doğrulanmalıdır. Electron UI'de yerel SVG ikon sözlüğü (src/ui-icons.js) ile araç çubuğu, belge gezgini ve callout başlıkları değiştirildi. Adobe Fonts web-project URL `https://use.typekit.net/aww8lcp.css` yalnız **web-only** örneğinde yer alır; CSP ve `connect-src 'none'` ile desktop'ta harici ağ fontu yüklenmez. `src/editor-text-engine.js` ve not verisi değiştirilmedi. [Ayrıntılı tipografi/lisans/ikon notları](docs/TYPOGRAPHY_ICONOGRAPHY.md).

## G0.6A.2 — Karma rich seçimler

Tam seçilen Markdown stilleriyle düz metin aynı işlemde değiştirilebilir/silinebilir. Doğrulanmış karma strike, kaynak bütünlüğü ve Undo/Redo korunur. Kısmi mark kesişimleri hâlâ fail-closed; bu iş devam edecek. [G0.6A.2 teknik kayıt](docs/EDITOR_G0_6A_2.md).

**G0.6A.2 güncellemesi:** Basit biçimli bölgenin ortasından düz metne veya düz metinden biçimli bölgeye uzanan seçimi de kayıpsız düzenleyen tek seviyeli close/reopen eklendi. İç içe biçimlerdeki kısmi kesimler henüz fail-closed. 232/232 Node + Windows/Linux desktop smoke yeşil.

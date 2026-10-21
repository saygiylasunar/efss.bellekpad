# BellekPad — Own Editor Engine / Architecture Decision 001

Status: **Design contract, not implementation.** Approval baseline: genuine visual text editor; no third-party editor engines or runtime UI frameworks, no hidden dependence on a Markdown library. Use standard browser and Node APIs; review any new third-party dependencies explicitly **before** adopting them.

## Product invariant

Users write/edit styled text and structured objects using visible controls, shortcuts, `/callout`, `/table`, icons, and contextual panels. They **do not need to type Markdown syntax**. EFSS Markdown is the stable portable *storage and interchange language*, not the primary interaction surface. Users may switch to a full source view voluntarily. Source and visual modes must converge without silently losing any text or metadata.

## Distinct layers, explicit connections

```text
Input Events (pointer, keyboard, IME, clipboard)
      │
      ▼
Editor Controller / Command Dispatcher
      │ edits with selected IDs, ranges and intent
      ▼
Document Model / Undo Transaction Log ─────► Selection & Caret Mapping
      │                                            │
      ├────► EFSS AST Adapter ◄────► EFSS Markdown / local vault
      │
      ├────► Constraint Layout Solver ────► Page / Frame / Artboard geometry
      │
      ├────► Typography Shaping Policy ──► Browser DOM text shaping
      │
      └────► Renderer (semantic DOM + CSS/SVG) ───► Inspector and accessibility
                                                     │
                                                     ▼
                                           Optional export pipeline
```

The document model contains semantic content and style properties; layout nodes hold geometry/constraints. The renderer draws **derived state**, never acts as the primary document database. Auto-save writes through a revision-checked storage adapter. Knowledge graph and AI features consume approved document state; they never own editing/caret coordinates.

## Responsibilities and contracts

| Layer | Responsibility | Forbidden |
|---|---|---|
| EFSS parser and serializer | Own grammar, source ranges, roundtrips and unknown extension preservation | Reformat unrecognized source blocks or invent memory claims |
| Document model | Stable node IDs; pages, frames, blocks, text runs, table cells, icon references; ordered children | DOM element IDs as persistent identity; mutable global singletons |
| Transaction controller | Atomic insert/delete/split/merge/format/move/resize and undo/redo with selection state | Direct HTML mutations without model transaction |
| Selection/caret | Unicode grapheme-safe offsets, cross-block selection, IME composition, clipboard | Splitting surrogate pairs; input interception while composition is in progress |
| Layout solver | Flow, row, column, grid, artboard constraints, overflow diagnostics, deterministic placement | Hidden overlap, clipping, autoshrinking or moving content without user intent |
| Typography | Font/style/run metrics, paragraph shaping via platform text engine, optional OpenType features | Rasterizing editable text into a permanently destructive image |
| DOM renderer | Semantic accessible HTML; CSS for text/layout and SVG for scalable visual geometry | External framework/editor dependencies; raw unsanitized HTML execution |
| Storage | Local IndexedDB adapter, crash/revision handling, explicit import/export | Silent cloud writes; source/data and layout versions diverging unnoticed |

The first implementation should be **plain JavaScript ECMAScript modules** plus browser platform APIs. Native `beforeinput`, composition events, Selection/Range, ResizeObserver, Canvas text measurement and CSS/SVG are *platform services*, not third-party libraries. The custom text editor still owns its document model, transaction logic, selection policy and serialization. A separate narrow DOM input adapter is allowed; a naked `contenteditable` div alone is **not** the editor engine.

## Objects and content

- **Document**: stable identity, source revision, style library, ordered pages and optional local assets.
- **Artboard/Page**: a design surface with explicit size, unit, margin, bleed (print), background, orientation, zoom/view state separate from source geometry.
- **Layout frame**: container with `flow`, `row`, `column`, `grid` or explicit `free` strategy, spacing, insets, alignment, constraints and stable child order.
- **Text frame**: a positioned box with *editable* text runs, paragraph styles, fit behavior and geometry. This is vector-scalable frame geometry; the glyphs remain editable text.
- **Content block**: paragraph, heading, ordered/unordered/checklist, callout, table, divider, code block, image or icon. Block editing is contextual.
- **Inline run**: text, emphasis, underline, color, highlight, link, emoji, variable/reference, or supported icon asset reference.

**Glyph outlines:** Illustrator-style `convert text to paths` is **non-destructive and opt-in**: a distinct derived object with a link to the editable source text, when technically and legally possible. Font outline extraction is an advanced separate capability, not assumed to be available from CSS or the browser.

## Editor behavior without tool clutter

- One compact primary toolbar (document name, undo/redo, insert, view mode, inspector).
- A selection toolbar for common inline formatting.
- A contextual property inspector for selected text runs, frames, icons, callouts, tables and artboards. Hide advanced controls until applicable.
- A `/` command palette and `+` insertion affordance. Both create the **same transaction** as an inspector click or keyboard shortcut.
- `/callout` inserts an editable callout block; `/table` creates a real cell grid; ordinary literal slash remains possible. Neither exposes raw Markdown source unless requested.
- Design-side properties allow manual exact x/y/width/height, gap, padding, anchor, alignment, glyph tracking/kerning/line height, baseline shift and supported font features. Unsupported platform-dependent controls must be identified, not faked.
- Resize handles act on selected frames; selecting multiple frames enables align/distribute operations. Every operation supports undo/redo.

## Text-engine correctness gates

Test Turkish combining marks and dotted/dotless I, emoji ZWJ sequences, surrogate pairs, multi-line selection, keyboard navigation, input method composition, paste safety, basic right-to-left runs, screenreader behavior, mobile virtual keyboards, browser zoom and font-loading reflow. Grapheme-safe editing must not assume one JavaScript UTF-16 unit equals one visible character.

Never treat CSS pixels as print DPI. Fonts may render differently across platforms; the artboard model stores explicit geometry/typographic values, and the renderer reports font substitution when exact typography is unavailable.

## Persistence and serialization

- EFSS Markdown source remains authoritative for linear text and explicit EFSS nodes.
- Tables that fit pipe Markdown can use it; merged cells, rich typography, artboards and complex layout require versioned EFSS extension representation to avoid loss.
- A storage adapter uses immutable document IDs, revision compare-and-swap, a revisioned EFSS layout manifest/extension and content IDs. Precise final extension grammar is **subject to a parser roundtrip spike**, not silently stabilized by this design document.
- Unknown EFSS blocks must be preserved raw and shown as locked-but-visible placeholders instead of being discarded on edit.
- Separately stored image/icon assets have manifest references and checksums; no absolute local machine paths embedded in exports.

## Delivery gates

**G0 — Engine skeleton:** Stable document/block ID model, transaction reducer, native input adapter and text selection mapping; no framework.
**G1 — Writing:** Caret, paragraphs, headings, marks, lists, keyboard shortcuts, undo/redo and Markdown roundtrip.
**G2 — Layout:** Multiple artboards, presets, frame tree, row/column/grid placement, collision and overflow tests, inspector-driven geometry.
**G3 — Distinctive blocks:** Real tables, callouts, icons/emoji, `/` commands, selection/inspector and accessibility.
**G4 — Local persistence:** IndexedDB, autosave, reload, export/import without loss of content/layout.
**G5 — Advanced typography/assets:** OpenType controls, glyph alternates where supported, custom asset intake and extra layout modes.
**G6 — Deferred outputs:** PDF, raster export, compression and advanced vector conversion.

A gate does not pass merely because test code compiles. A user must be able to perform the described interaction in a running editor.

Reference details: [ARTBOARD_LAYOUT_SPEC.md](ARTBOARD_LAYOUT_SPEC.md).

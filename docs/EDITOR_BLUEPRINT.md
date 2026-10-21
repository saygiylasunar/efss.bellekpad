# BellekPad — Editor & Content Specification (Working Blueprint)

Status: design scope only. Nothing below is an implemented editor. This document is the acceptance baseline for the first real web application.

## Product boundary

BellekPad must be a usable **visual document editor**, not merely a textarea with a Markdown preview. The canonical portable content format remains EFSS Markdown; editor selections, rendering and rich controls may use a temporary in-memory tree. No silent loss of existing EFSS text, unknown extension nodes or user metadata is acceptable.

Research influences: Notion (composable blocks, slash commands, callouts, page icons); Microsoft Word (precise typography, table tools, find/replace, document-oriented review); Adobe Illustrator (contextual property panels, reusable styles/symbols, aligned/grouped objects for an optional visual canvas). We borrow interaction patterns, not proprietary artwork or an unrestricted vector graphics application.

## Feature inventory / release criteria

| Group | First usable editor (E0) | Following release (E1) | Optional specialist mode (E2) |
|---|---|---|---|
| Editing | Text insertion, selection, undo/redo, keyboard shortcuts, copy/paste, native IME/Turkish text, auto focus, block navigation | Multi-block selection and drag/reorder, document outline, find/replace, history | Review suggestions, comments/annotations |
| Inline marks | Bold, italic, underline, strike, code, links, text color, highlight | Sub/superscript, alignment/line spacing, reusable text styles | Full print typography and advanced typesetting |
| Blocks | Paragraph, H1–H6, unordered/ordered/nested lists, checklist, quote, divider, code fence | Toggle/disclosure, collapsible sections, columns, table of contents | Layout sections and printable page controls |
| Callouts | Info / tip / warning / success / error; title, selectable icon/emoji, background accent; text and nested lists | Nested tables/images/blocks, templates, custom appearance presets | Reusable callout design systems |
| Tables | GFM-style table, editable cells, header, row/column add/remove, keyboard cell movement | Column resizing, alignment, cell background, drag range selection, merge/split cells, captions | Formulas, sortable/filterable data view (distinct from plain tables) |
| Emoji and icons | Inline Unicode emoji picker, emoji search, page icon, basic packaged SVG icon palette | Custom uploaded icons, block icons, saved icon presets, page covers | Asset/library syncing and vector symbol editor |
| Media | Link insertion, safe clipboard paste; media placeholder/display where available | Local image attach/drop/paste, resize, alt-text, captions; file/PDF previews, audio/video embeds via explicit consent | Crop/position/rotate and advanced visual blocks |
| Navigation | Page list, new/rename/archive, breadcrumb, selected document properties, focus mode | Folders/tags, link backlinks, cross-document search, split view | Views of documents as cards/board/calendar |
| Authoring | Toolbar + selection bubble menu + slash insert menu + visible add-block control | Drag handles, block duplication/conversion, reusable templates | Free-positioned diagram/board/whiteboard |
| Export | Source Markdown download and copy; safe HTML preview | Portable EFSS bundle (document + local assets), PDF export | DOCX and print layout |

These are **editor capabilities**, not new variable kinds or memory classes. Icons are display assets and emoji text, not automatisch EFSS facts.

## Do not conflate these objects

- **Markdown table**: fixed document content and presentation. Not a spreadsheet, relational database, inventory or autonomous status ledger.
- **Callout**: a styled container with optional inner blocks. Not an instruction to the AI model.
- **Page icon / block icon**: presentation metadata or explicit inline icon node, not an entity by default.
- **Emoji**: Unicode content (and an optional UI picker); no network icon fetching by default.
- **Illustrator-like object operations**: apply first to image/card/diagram blocks, not normal prose text; free canvas is a separate future editor mode.
- **EFSS variable/reference**: an explicit authored construct, never auto-generated from ordinary numbers or arbitrary notes.

## Markdown-first serialization policy

1. The original UTF-8 EFSS Markdown source remains authoritative on disk; the visual tree is a working representation and should not overwrite unknown/unsupported blocks.
2. Simple tables use familiar GFM pipe-table syntax. Pipe tables cannot represent merged cells or arbitrary nested blocks. E1 rich tables must use a versioned EFSS extension block instead of lossy fake pipe Markdown.
3. Proposed callout form (design only; not yet parsed or rendered):

   :::efss.callout type=warning icon="⚠️" title="Önemli"
   İçeriği ve **Markdown** biçimlendirmesini koru.
   :::

4. EFSS callout content must be tokenized as nested editable child blocks, **not skipped as opaque code**. The current scanner treats efss extension blocks as opaque and will need a scoped, tested grammar addition.
5. On any visual → source → visual round-trip, compare semantic AST and preserve unknown constructs verbatim. If some layout cannot be represented, preserve the raw extension or expose a conversion warning; never silently discard it.
6. Inline emoji is UTF-8 text. Page icon needs stable, safe metadata (emoji literal, bundled icon ID, or local asset reference). Never store base64 assets inside arbitrary Markdown spans by default.
7. Every pasted HTML/media source is untrusted. Sanitize HTML/URLs, block scripts/event handlers, avoid unsafe SVG execution, and keep personal media local unless explicitly exported.

## UI interaction concept

- Global header: page title, breadcrumb, search/command palette, saved status and view switcher (Visual / Source / Preview).
- Left rail: workspace navigation, notes, projects, pinned/recent, create page.
- Center: spacious page editing surface; hover `+` to insert blocks, `/` commands, selection bubble toolbar, keyboard-first typing.
- Right inspector (collapsible): contextual controls for the selected table, callout, image or block; document properties when nothing is selected.
- Top-of-page: page emoji/icon, optional cover, title, optional description. Responsive layout collapses inspectors into drawers.
- An optional *canvas view* may later support moving and aligning object blocks; it does **not** replace linear document editing.

## Proposed implementation (to validate in a spike)

- Vite + Vue 3 for the web shell; Tiptap/ProseMirror for visual block/inline editing, CodeMirror 6 for source mode.
- Existing EFSS Markdown parser/AST remains the canonical language contract. Add a tested AST ↔ visual node adapter; do **not** replace the EFSS grammar with Tiptap's Markdown parser by fiat.
- Tiptap table editing offers row/column operations and merge/split, but its Markdown extension is currently marked **beta**; its own docs note limitations with multiple child nodes in table cells. Test interoperability before adopting that extension for persistence.
- E0 may use one visual editor session and explicit source/preview modes. Never run two concurrent uncoordinated document stores.
- Storage work is driven by the editor: browser IndexedDB plus asset references, autosave after a debounced edit, safe export and crash/reload validation.

## Minimum acceptance scenarios (E0)

1. Open app → create page → choose emoji/icon → type Turkish heading and paragraph → format bold/underline/highlight → close/reopen; no text, Unicode or metadata lost.
2. Slash menu → insert a warning callout with icon → nested bullet list; visual/source roundtrip preserves structure and icon.
3. Insert 3×3 table → type with Tab → add/remove row and column → roundtrip to Markdown → reopen and edit the same cells.
4. Insert checkbox list, blockquote, divider and code block; source mode retains whitespace, code fences and escaped EFSS references.
5. Paste untrusted HTML/URL → scripts and active content do not execute; plain text/allowed formatting survive.
6. Place a reference `[[paper:example]]` or `&Name` and see safe syntax decoration; unregistered names never create automatic memory facts.
7. Switch between Visual / Source / Preview without silently rewriting unknown legacy EFSS blocks.
8. Test narrow/mobile viewport, keyboard-only interaction, search, autosave collision and reload after abrupt tab closure.

## Implementation slices

- **E0a Shell:** Vite application, responsive layout, note list, empty editor and visible state; no more standalone memory abstractions.
- **E0b Editing:** visual paragraphs/headings/marks/lists, toolbar, undo, slash menu, keyboard paths.
- **E0c Distinctive blocks:** first-class callout + editable table + emoji/icon picker (not deferred to a hypothetical final release).
- **E0d Persistence:** IndexedDB autosave, markdown/source fidelity tests, export/import, local privacy checks.
- **E0e Integration:** documented EFSS references, graph-aware navigation, safe preview, optional local models with explicit actions.
- **E1/E2:** richer media, complex tables, print/docx, page layout, collaborative review, free canvas.

## Reference material

- Notion: https://www.notion.com/help/writing-and-editing-basics
- Notion callouts: https://www.notion.com/en-gb/help/customize-and-style-your-content
- Word tables: https://support.microsoft.com/en-us/word/training/insert-a-table
- Word review: https://support.microsoft.com/en-us/word/give-and-receive-feedback-in-word
- Illustrator properties: https://helpx.adobe.com/illustrator/desktop/get-started/learn-the-basics/properties-panel-overview.html
- Illustrator layers: https://helpx.adobe.com/illustrator/desktop/manage-layers/create-and-organize-layers/layers-overview.html
- Tiptap table: https://tiptap.dev/docs/editor/extensions/nodes/table
- Tiptap Markdown caveats: https://tiptap.dev/docs/editor/markdown

# BellekPad — Editor Blueprint (scope, not yet implemented)

## Core intent

Build a genuine **self-developed text/document editor**. Users edit objects and text visually: click a style, choose an icon, type `/callout` or `/table`, or choose a block from the insert menu. **No one must author verbose EFSS Markdown syntax to obtain basic formatting.** EFSS Markdown remains the portable source/storage grammar, with planned versioned extensions for artboards and advanced styles.

## Non-negotiable engineering choice

**No third-party editor framework or application UI runtime library.** Previous suggestions to use Tiptap, ProseMirror, CodeMirror, Vite and Vue are explicitly **withdrawn**. The text editor/document model, selection/caret handling, layout constraints and renderer are maintained by BellekPad itself. We may use standard browser platform APIs, CSS, HTML, SVG, Canvas and native JavaScript modules, plus Node built-ins for tests. Any new external library requires a separate discussion and user's express permission.

[Architecture decisions and engine boundaries](EDITOR_ENGINE.md)  
[Artboard and layout behaviors](ARTBOARD_LAYOUT_SPEC.md)

## Minimal interaction surfaces (not Microsoft Word toolbar sprawl)

- Document header: page navigation, undo/redo, save state, view toggle.
- Insert surface: `+` menu and contextual slash commands with predictable results.
- Selection toolbar: frequently used text formatting.
- Contextual inspector: collapsible Illustrator-inspired numeric and typographic controls for currently selected text/frame/table/icon/artboard.
- Page navigator and preset/template picker. Multiple artboards, different sizes, grouped frames, readable order.
- User-visible **Flow** and **Layout** editing behaviors share one document model. Flow keeps prose readable; Layout adds artboards, row/column/grid frames, precision handles and optional free-position overlay.

## Must-have blocks and affordances

Text paragraphs, heading levels, bold/italic/underline/strike, code spans and blocks, blockquote, list/checklist, divider, safe link and reference, table with editable cells, callout with type/icon/title and nested content, emoji/inline icons and page icons. All should be insertable by mouse/menu and relevant slash commands.

Selected text exposes font family, sizing, weights, line spacing, tracking, available OpenType features and paragraph alignment through the inspector. Selected frames expose sizing, x/y, alignment, padding, constraints, and layout behavior. Toolbar/inspector settings map to the **same transaction** as keyboard commands.

## Content vs. styling

- Simple prose and tables remain readable Markdown. Lossy transformations are forbidden.
- Rich layout, text-frame geometry and advanced styles need **versioned EFSS extension data**; the exact syntax will be determined by a source roundtrip prototype.
- Unknown extensions are preserved raw, not discarded.
- Emoji is Unicode; icons are bundled/authorized SVGs or local asset references; embedded or uploaded HTML/SVG is untrusted.
- Artboards have reusable **presets** (dimensions) and **templates** (layout + styles + optional content), which are distinct constructs.

## Development order

1. **Editor engine contract/tests**: immutable transactions, stable block IDs, selection, browser-native input and own renderer.
2. **Write first**: visible text area, robust caret/IME/undo, inline formatting and source roundtrip. This must feel like an editor, not a raw textarea.
3. **Artboard/layout**: multi-page sizes, row/column/grid, frames, collision/overflow diagnostics and contextual inspector.
4. **Structured blocks**: tables, callouts, icon picker, slash-insertion and toolbar actions.
5. **Browser persistence**: IndexedDB autosave, crash/reload and portable EFSS export/import.
6. **Advanced typography** and authorized asset libraries.
7. **Later**: PDF/raster export, DPI and compression options, text outlines, richer media and advanced color management.

No rushed all-at-once UI, silent migration or new independent memory architecture.

## Acceptance checks

- Create a page with a Web/Desktop/Mobile/Social/Document preset; insert text and an icon, save/reopen and preserve size/unit/geometry.
- Arrange two editable text boxes side by side and above/below; alter gap/constraints without collisions or silent clipping.
- Type multilingual text/emoji, apply styles with selection toolbar and inspector, undo/redo, paste safely and use an IME.
- Type `/callout`, choose a variant and icon, insert an editable table from `/table` or `+`.
- Switch to source Markdown voluntarily; save and return to visual mode with content and unknown extensions intact.
- Adjust exact frame placement and typography; zoom without changing actual page dimensions; change artboard preset only with an explicit resize/reflow intention.
- Inspect keyboard and screenreader reading order independently from display order.

## Inspiration (interaction concepts only)

Notion: block insert/structure and callouts.
Microsoft Word: typography, tables, text editing fidelity.
Adobe Illustrator: artboards, selection, alignment, properties, spacing and precise object transforms.
Canva: page size presets and page templates.

No proprietary assets, embedded fonts or third-party code are included solely because these products inspired the behaviors.

## Installation strategy

BellekPad may first ship as an installable **desktop editor** with a platform-neutral edit engine and a web-technology presentation surface. Electron is a possible desktop **host only**, not a rich-text editor framework or source format dependency. An optional web build and later mobile shell can reuse the document model without enforcing the same window/menu controls. See [PLATFORM_ARCHITECTURE.md](PLATFORM_ARCHITECTURE.md).

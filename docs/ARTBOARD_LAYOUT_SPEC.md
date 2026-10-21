# BellekPad — Artboards, Layout and Flow (working contract)

Status: **Architecture first. Not implemented.** The editor must support document writing *and* artboard-based placement without conflating the two.

## Artboard and layout hierarchy

```text
Workspace
 └── Document
      ├── Page / Artboard (ID, preset, size, unit, background, margins)
      │    ├── LayoutFrame: Flow
      │    │    ├── Heading / paragraph / callout / table
      │    │    └── Nested LayoutFrame: Row / Column / Grid
      │    │         ├── TextFrame
      │    │         ├── Icon
      │    │         └── ImageFrame
      │    └── Optional ArtboardOverlay: explicit free placement
      └── Page / Artboard ...
```

Every object has a stable ID and a parent frame. **Content order**, **visual arrangement**, and **z-order** are separately stored fields. The reading order remains understandable to assistive technology and exporters.

## Coordinate and sizing contract

- Screen presets specify **logical CSS pixels**; print presets specify **physical mm** (or a user-selected print unit). The canonical artboard stores its unit explicitly. Conversions use physical definitions only at defined output boundaries.
- Child placement is **relative to its parent frame**, not an unbounded global canvas. The page origin is the top-left content surface.
- Frames support min/max width/height, explicit dimensions or intrinsic content-fit, margins/padding/gaps, alignment, anchor and optional aspect-ratio lock.
- Zoom changes **viewport rendering**, not actual page size, saved coordinates or typography.
- A resize operation must expose three different intents: **resize only page**, **scale content proportionally with page**, or **reflow within new page constraints**. Never silently choose one.
- A font-loading failure or different browser shaping result must not silently override user-entered text geometry. The editor recalculates fit and warns on overflow.

## Layout strategies

1. **Flow**: sequential editable prose and blocks. Intrinsic height; later content moves as preceding content grows.
2. **Row/Column**: adjacent frames arranged with explicit gap, padding, alignment, wrap policy and min/max sizes. For two text boxes side-by-side this is the default, not manual x/y alignment.
3. **Grid**: named rows/columns with deterministic spans and cell gaps. Objects cannot accidentally occupy an already-filled exclusive cell.
4. **Free**: optional absolute placement of an object relative to its parent artboard/frame. Dragging, snapping, numeric coordinates, object alignment and explicit z-order are available. Its collision policy defaults to **no unexpected overlap**; deliberate overlap can be enabled only for the selected layers/objects.

## Collision, overflow and persistence guarantees

- **No accidental overlap**: in Flow/Row/Column/Grid modes, siblings receive non-overlapping content rectangles (excluding deliberate decorations/bleed/shadows). Test boundary precision, paddings and gaps. When constraints cannot be satisfied, return a diagnostic rather than force shapes into the same space.
- **Text is never silently cropped**: each text frame reports intrinsic content size and overflow status. Default action is to grow its frame or reflow. For a fixed-size print artboard, offer next-page continuation, manual change or a visible overflow warning.
- **No silent autoshrink** of font size, no destructive text-to-path conversion and no automatic page content resizing on preset switch.
- **Hierarchy is canonical**: moving a grouped frame preserves all child positions relative to their parent. Ungrouping requires deterministic transforms.
- **Single user action = one undoable transaction**: changes to geometry, selected IDs, reading order and styles happen together; no half-moved children.
- **Responsive is not scale-by-ratio**: changing a desktop artboard into a mobile preset can request a reflow layout; it does not merely shrink the desktop design.
- **Explicit overlay mode**: z-order and intentional overlap are allowed in a named overlay/free layer. The renderer never invents stacking order from DOM order.
- **Overflow markers persist as diagnostics**, not secret edits. Exports must either show a clear warning or follow an explicitly selected overflow strategy.

## Page preset registry (initial, editable; examples, not guarantees about devices)

| Group | Example | Logical target size | Unit / intent |
|---|---|---|---|
| Web | Website canvas | 1440 × 900 | CSS px / fixed design canvas |
| Desktop | Widescreen presentation | 1920 × 1080 | CSS px / artboard |
| Mobile | Phone screen | 390 × 844 | CSS px / portrait |
| Social media | Story / vertical video cover | 1080 × 1920 | px / 9:16 |
| Social media | Portrait post | 1080 × 1350 | px / 4:5 |
| Social media | Square post | 1080 × 1080 | px / 1:1 |
| Documents | A4 portrait | 210 × 297 | mm / print |
| Documents | A4 landscape | 297 × 210 | mm / print |
| Documents | US Letter | 8.5 × 11 | inches / print |
| Custom | User-defined | validated positive dimensions | px / mm / in |

Preset values are defaults rather than platform specifications. IDs are versioned, and users may create/save reusable page layouts. A preset is not the same as a template: **preset = dimensions / unit / orientation; template = frame hierarchy + styles + sample content**.

## User interaction scenarios / tests before code

- Add two text frames and an icon into a row; align left/center/right, change gap, resize one frame; no text escapes the page or overlaps.
- Move entire group from first page to second; child offsets and reading order remain valid.
- Set exact position/size in the inspector, snap to grid, undo; coordinates restore precisely.
- Change a web layout to mobile with a requested **reflow**, preserve typed content, prevent clipping and show a layout diff.
- Create multiple artboards of different sizes within one document; zoom independently without altering geometry.
- Set a fixed-height text box then type too much; show overflow and offer continuation, never delete glyphs or shrink text without consent.
- Select an icon → resize, swap and align. Select text → inspect font metrics and paragraph alignment, without exposing irrelevant icon controls.
- Serialize to EFSS Markdown + versioned layout representation → reload; compare identities, hierarchy, typography, layout and raw unknown extension bytes.
- Free-mode deliberately layer an icon over a colored shape: allowed only after explicit overlap/layer intent, with clear selected outline and z-order.

## Text frames and glyphs

TextFrames remain editable Unicode text runs. Their **bounding boxes are vector geometry**, scalable without destructive rasterization. Character controls include font family/weight/style, size, tracking, kerning mode, line-height, baseline offset, OpenType feature flags (supported fonts only) and per-run attributes. Text-to-outlines is a **future derived export operation**, not how the editor stores editable text.

## Export planning — intentionally deferred behind editor correctness

- **PDF**: prioritize vector text/shape geometry and physical page size; PDF objects themselves do not have a single meaningful DPI. Embedded raster images have effective resolution.
- **Raster (PNG/WebP etc.)**: the user chooses output dimensions or target DPI for physical-size artboards; the converter computes pixel output dimensions from physical page dimensions.
- **Compression**: offer lossless/lossy quality, image downsampling, optional font embedding and asset optimization, with a preview and estimated file size when available.
- **PDF conversion commands**: explicit action per selected pages/artboards, never auto-export; early version can expose the browser's native Print-to-PDF functionality if it preserves tested layout/typography. A custom exporter is a separate engineering milestone.
- **No third-party export libraries** are silently introduced. Any limitation of browser-native APIs is documented instead of hidden behind an unreviewed dependency.

Print bleed, crop marks, output color management and professionally validated DPI/ICC handling are advanced goals, not guaranteed by the current code.

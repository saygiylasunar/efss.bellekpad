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

# R0 — Four critical boundaries, resolved as contracts

## 1. Supervisor / worker

Backend owns process lifecycle, state and error codes. Browser cannot provide executable, shell arguments or remote host. Python paths and Comfy main.py are configured by the operator at startup. Engines are separate Python/CPP workers; a virtual environment is dependency isolation, not inference. State: unconfigured, stopped, starting, ready, stopping, failed. Health is an actual Comfy system_stats response, not presence of a button. Stop works during starting. No implicit GPU/VRAM veto. Failure never means success. Worker dependency installation is intentionally NOT automatic in R0.

Limitations to close before runtime GA: monitor old listener / port identity, Windows process-tree kill, stdout log capture/redaction, fault injection, version pinning and crash recovery; measure against real Comfy.

## 2. EFSS ↔ Tiptap

Canonical source remains EFSS text + version/hash. The editor sees an AST projection; unknown EFSS regions are opaque, immutable placeholders. Only supported content may be changed, via source revision and block-hash compare-and-swap. Never serialize the entire document from Tiptap Markdown, because unknown extensions/formatting could vanish. First executable proof supports simple single-line paragraphs and headings, preserving CRLF and opaque text. Full Tiptap node/mark schema, tables, symbol bindings and multi-line rich edits are separate R5 milestones and MUST pass source roundtrip before UI enables them.

## 3. React Flow ↔ ComfyUI

UI graph: node {id,type,inputs}, edge {source, sourceHandle: output index, target, targetHandle: input name}. Backend compiles against live /object_info, checking all required ports, enums, literal types, connection types, duplicate inputs and DAG cycles. Output is Comfy API /prompt graph; execution uses isolated loopback HTTP, never Comfy web UI. Use job IDs for history and targeted cancellation; no global /interrupt. Offline workflow **draft** persistence now exists as a versioned schema: graph nodes, coordinates, inputs and edges, stored in SQLite with revision compare-and-swap. Draft validity is structural; **execution validity is only checked against current live Comfy /object_info when compiling/submitting**. Immutable submitted-prompt job snapshots, local job state history, Comfy output proxy and opt-in hash-verified image archive are now implemented. **Still open:** per-run overrides, WebSocket events, engine timeout reconciliation, real Windows/Comfy acceptance and coordinated archive/DB snapshots. See GENERATION_LIFECYCLE.md. No user-specified remote URL/renderer-computed permission.

## 4. Data, security and distribution

Workspace root MUST be supplied explicitly through BELLEKPAD_DATA_ROOT; never silently use Roaming/Temp. SQLite WAL with version-checked notes and consistent sqlite3 online backup. Future workflow/asset backups require a coordinated manifest/snapshot: SQLite-only backup does not back up external files. The API binds 127.0.0.1; host/origin filtering is supplemental only. Future packaging must include session authentication and CSRF protection before remotely accessible modes; do not enable LAN access. User model paths remain external.

ComfyUI GPL-3.0 is not vendored into this proprietary repository. Distribution of a Comfy runtime or mixed derivative requires an actual license review. Third-party Python/JS versions must be locked for release and the shipped runtime verified with real weights.

## Product invariants

Web-first, local-first, AI-first. Core → API → UI. Parallel / Roundtable / Orchestrated conversation policies are product commitments, not claims of implementation. React + Tiptap and React Flow remain product technology decisions. No hidden forced content moderation layer. Model size is user responsibility; lifecycle errors are software responsibility. Artboard deferred.

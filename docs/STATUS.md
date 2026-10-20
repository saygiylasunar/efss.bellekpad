# P1.0 — Local shared-model paths

Added: versioned JSON model-root manifest and independent YAML generator for ComfyUI `extra_model_paths.yaml`. Multiple model roots and multiple paths per category, including configurable custom-node categories. No duplication of large models.

Added: local-only path inventory preflight, no-clobber YAML export and opt-in overwrite-with-backup. The generator does not modify ComfyUI config or launch model processes automatically. A runtime config is local/private; public repository contains placeholders only.

The user may defer all local experiments. CI verifies mapping and overwrite safety with temporary directories.

Known limits: custom ComfyUI model classes require supporting nodes; a directory does not establish runtime model compatibility; no automatic merging with existing YAML; no live hardware tests.

## P1.1 decision: scan scope

Only user-configured model categories and paths may be scanned via the runtime CLI. Discovery defaults to primary model categories; LoRA and auxiliary assets are separated behind opt-in `--components`. No whole-PC scan. File type/classification is indicative only, not runtime compatibility proof. No local user GPU scanning or live model test was performed.

## P1.2 — First durable document station

Added Node-only LocalDocumentVault for EFSS documents, saving original UTF-8 source to ignored local .efss/vault; atomic replace with exclusive per-document lock and SHA-256 revision compare; safe identity validation; list/read; deterministic memory-index rebuild, restricted sources omitted by default.

A minimal opt-in local CLI can import canonical EFSS Markdown, inspect index counts and search source IDs without exposing excerpts. No SQLite, external services, model downloads or runtime GPU tests.

Not complete: browser IndexedDB storage, full backup/export + attachments, migration versioning, crash-safe lock recovery, durable semantic and graph metadata, reversible rich-text UI, automatic content conflict merge.

## P1.3 — Positional EFSS variable binding syntax

The EFSS Markdown scanner recognizes `&Variable{value0, value1, ...}` as one source-ranged variable token. Quoted string values may contain commas and escaped quotes. Invalid/oversized bindings fail closed with diagnostics rather than silently becoming references. Typed inspectors validate each value against explicitly registered schemas and create inert, provenance-linked candidates; parsing never changes stored observations, activates commands, or performs type inference. All existing reference syntax remains supported.

Not yet implemented: committing selected binding candidates into persistent ledger records, variable scope/rename, named properties or syntax migrations. These require explicit product contracts.

## P1.4 — Durable, evidence-scoped relational memory

Added `LocalKnowledgeGraph`: rebuildable Markdown-derived links plus a private append-only ledger of proposed, explicitly approved, and retired relations. Every approved relation has source document revision + body range + text fingerprint. After document changes, prior approvals are labeled stale and withheld from graph edges. Proposals can never elevate themselves. Restricted documents are excluded by default.

Added typed variable-binding candidate extraction with source revisions, **without** treating candidates as committed facts. Document-source nodes and variable definitions share EntityRegistry semantics; no network, model or GPU is invoked. Private journal files live beneath ignored `.efss/knowledge/`.

Next: durable variable schema documents and approved observation ledger; browser IndexedDB adapter; UI; graph traversal ranking/embedding; safe schema migrations.

## P1.4a — Reopenable variable definitions

Added an inert versioned `:::efss.schema` JSON block for `kind: variable` EFSS documents, rebuilding `VariableTypeRegistry` from the local vault. Malformed schema, duplicate definitions and invalid type fields fail closed. Restricted schemas cannot become public graph entities. The graph can now reconstruct typed value candidates from disk without requiring an application-hardcoded schema.

No automatic acceptance of variable values; persistence of approved typed observations still pending.

## P1.4b — Typed Observation Ledger

Added LocalObservationLedger: review-gated, source-revision-bound typed observations persisted in a local append-only JSONL journal. Approved values survive restart. Edited sources or schemas invalidate previous approvals; retired and stale records remain in history. Default views hide restricted sources. Conversation sources are ineligible. LocalKnowledgeGraph exposes observations separately from edges. Browser persistence, model inference and review UI remain pending.

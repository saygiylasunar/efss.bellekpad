# EFSS Document Storage — P1.2

## Storage principle

The original EFSS Markdown source is the **authoritative record**. Parse trees, token indexes, embeddings, retrieval graphs and previews are rebuildable derivatives.

A local Node file-backed adapter (`src/local-document-vault.js`) keeps private files beneath `.efss/vault/{kind}/{id}.md`. The `.efss/` directory is ignored by Git and must never be included in public commits. File names are validated as safe document identities. Unreadable, oversized and mismatched documents fail closed rather than silently disappearing.

The first import accepts existing canonical EFSS Markdown envelopes with version, kind and id. The parser currently normalizes CRLF **for semantic processing**, but storage preserves the raw source exactly as supplied, including original CRLF bytes.

## Revision discipline

- First write has no previous revision; accidental replacement fails.
- A read returns a SHA-256 revision of the persisted UTF-8 bytes.
- Replacing a file requires passing that exact previous revision; stale revisions fail.
- Writes use an exclusive per-document lock, temporary file, fsync and atomic rename. Crash or power failure can leave an orphaned `.lock` file; the store fails closed with `DOCUMENT_BUSY`. Recovering locks safely will be implemented later.
- The current adapter does not delete documents or automatically merge conflicting edits.
- The rename-based replacement is designed for a local filesystem. Full directory-fsync durability and multi-device/cloud-file synchronization are **not** guaranteed.

## Context and data privacy

`rebuildIndex()` constructs fresh MemoryStations from saved documents on demand. Documents marked `visibility: "restricted"` are excluded from this default indexing step. No external embedding models or cloud providers are invoked by storage or index rebuild. In-memory derived indexes are **not** silently persisted or shared with third parties.

Private documents can be placed in `.efss/vault` and tested later using:

```powershell
npm run vault -- status
npm run vault -- import .efss/imports/sample.md
npm run vault -- search music
```

The CLI shows source identifiers, counts and match scores, not plaintext excerpts or prompts. CLI arguments are visible to the local process environment; do not put secrets in search arguments.

## Next adapters

- A browser IndexedDB implementation using the same source/revision API.
- Attachments and content-addressed media alongside Markdown, separately governed.
- Signed portable exports, explicit restore and migrations; user-approved sync.
- Conflict and recovery UI for stale revisions and orphaned locks.
- Durable graph/variable/provenance records with atomic multi-record transactions.

A browser application cannot directly access arbitrary local files; desktop/local Node and browser storage adapters are deliberately kept separate.

## Knowledge graph layer (P1.4)

`LocalKnowledgeGraph` stores a private review ledger at `.efss/knowledge/relations.jsonl`. Every event is append-only, validated on replay, protected by an exclusive mutation lock, and fsynced. It does not rewrite EFSS Markdown files. Derivative syntax graph links are rebuilt from the source vault each time a snapshot is requested.

Inferred relationships need explicit approval before entering the graph, and approved links must still match the **source revision and exact excerpt fingerprint**. Stale, retired and proposed relationships are never treated as approved facts. The default snapshot excludes restricted documents and their links.

The ledger is an **early local prototype**, not a cross-device replicated database or transactional backup format. There is no automatic stale-lock recovery, full crash recovery, browser storage, conflict reconciliation or backup/restore UI yet.

## Observation journal

The opt-in LocalObservationLedger records typed candidate values under `.efss/knowledge/observations.jsonl`. This location is excluded from Git. Every event is an immutable proposal, approval or retirement. The journal includes typed values, so its contents and backups must stay private. Source revision, selected text fingerprint and variable schema digest are rechecked before treating an observation as current. The journal uses exclusive mutation locks and fsync but is not a distributed database or a complete crash-recovery solution.

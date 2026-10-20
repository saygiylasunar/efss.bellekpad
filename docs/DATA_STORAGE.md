# EFSS storage boundaries

## Authoritative data

`LocalDocumentVault` stores the exact source bytes of EFSS Markdown under the Git-ignored `.efss/vault/{kind}/{id}.md`. First writes fail if the identity already exists; later writes require the previous SHA-256 document revision. Writes use a temporary file and exclusive per-document lock. The browser IndexedDB adapter is not implemented yet.

A persisted constant uses a version-2 `:::efss.schema` block in a `kind: variable` document and has a fixed typed value. The local vault refuses changes to an existing constant definition (`CONSTANT_DEFINITION_IMMUTABLE`); choose a different identity to create a genuinely different constant. There is no silent variable-to-constant migration.

## Derived data

Source references and indexes are rebuildable from canonical Markdown. The explicit, reviewed relation journal in `.efss/knowledge/relations.jsonl` remains an optional local layer; source revisions and fingerprints determine whether its relations are still current.

The previous experimental observation journal (`.efss/knowledge/observations.jsonl`) is **not used by the current core**. No local files are deleted by this cleanup; preserve existing files for a future explicit migration/recovery step. Do not commit them or backups to a public repository.

## Security and limits

All `.efss/` records remain local and Git-ignored. This is not an encrypted vault or a distributed transactional store. User approval is required before sharing, importing external memory or executing model-generated actions. No whole-PC model scans are performed. Crash-safe stale-lock recovery, browser storage, backups, conflict merging and stable format migrations remain future work.

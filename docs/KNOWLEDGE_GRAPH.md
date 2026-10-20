# EFSS P1.4 — Source-backed Knowledge Graph

## Principle

The original EFSS Markdown text is authoritative. Two kinds of relationships coexist:

1. **Source-derived references**: `[[paper:example]]`, `&Variable` or explicit `::use` (from the existing Markdown grammar). Regenerated from the latest saved document each time.
2. **Reviewed inferred relations**: e.g. a local model suggests a link. It starts `proposed`; only an explicit user-authorized `approveRelation(id)` turns it into an approved graph edge. The approval survives application restart in a private append-only journal.

There is no automatic elevation of model output to instructions, permissions or confirmed facts.

## Persistence and integrity

- `LocalDocumentVault` owns the original documents at `.efss/vault/{kind}/{id}.md`.
- `LocalKnowledgeGraph` owns an **append-only** local journal at `.efss/knowledge/relations.jsonl` (schema version 1).
- Proposed, approved and retired transitions cannot be silently overwritten. Each transition appends a separate record.
- Relationship evidence includes `sourceId`, its SHA-256 **document revision**, original Markdown **body** offsets and a SHA-256 **fingerprint** of the selected text, not the text itself.
- Each snapshot checks the current document revision and fingerprint. If evidence changed, previously approved links are withheld and the relation is marked `stale`.
- Truncated JSONL, invalid state transitions and symlinked storage roots fail closed.
- Restricted documents and their relationships are excluded from default snapshots. Explicit `allowRestricted: true` permits a local privileged view.
- Evidence and graph offsets currently use JavaScript UTF-16 indices on parsed Markdown bodies. Source byte revisions are independently computed by the vault.

## API sketch

```js
import { LocalDocumentVault, LocalKnowledgeGraph } from "./src/local-runtime.js";
import { VariableTypeRegistry } from "./src/typed-variables.js";

const vault = new LocalDocumentVault();
const types = new VariableTypeRegistry();
types.register({ id: "subject", label: "Subject", value: { type: "text" } });
const graph = new LocalKnowledgeGraph({ vault, types });

const document = await vault.read("paper", "example");
if (document) {
  const offset = document.body.indexOf("Subject");
  if (offset >= 0) {
    await graph.proposeRelation({
      id: "relation_example", from: "paper:example", to: "variable:subject",
      predicate: "illustrates", method: "inference", confidence: 0.5,
      evidence: { sourceId: "paper:example", revision: document.revision,
        start: offset, end: offset + "Subject".length }
    });
    // Review the actual evidence before explicitly approving:
    // await graph.approveRelation("relation_example");
  }
}
const snapshot = await graph.snapshot();
```

The API does not automatically approve; a future user-facing review interface will surface source excerpts safely. Restrict yourself to known documents and typed variables with stable IDs.

## Candidate variable observations

`&Count{26, 48}` produces *typed value candidates* when `Count` has a registered schema. Snapshot candidates carry source ranges and the current source revision, with `status: candidate` and `effect: none`. They do not enter the permanent relation ledger or overwrite existing variables. A separate approved observation process and persisted variable-definition schema are pending.

## Deliberately not included

No model inference, no background scanning, no auto-acceptance of relationships, no public sync, no embedding database, no browser IndexedDB adapter and no UI in this increment.

## Durable variable definitions (P1.4 extension)

A variable definition can be a canonical EFSS Markdown document (kind `variable`, stable id `count`) whose body is a single inert extension:

```text
:::efss.schema
{
  "schemaVersion": 1,
  "label": "Count",
  "aliases": ["Quantity"],
  "value": { "type": "number", "min": 0 },
  "properties": {}
}
:::
```

When this is stored as `.efss/vault/variable/count.md`, the default knowledge graph loads the type definition at each snapshot. Consequently, a Paper containing `&Count{26, 48}` yields schema-validated candidate values after a restart. The extension is parsed as JSON **data only**, never as JavaScript, instruction text or model output.

Supported value types are limited to the existing built-ins. Malformed documents, unknown types, duplicate aliases and conflicts with explicitly supplied type registries fail closed. Restricted variable documents are excluded from default public views.

Observation candidates are **not** committed facts; the approved, source-revision-aware observation ledger remains a separate milestone.

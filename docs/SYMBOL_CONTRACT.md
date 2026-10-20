# EFSS — Minimal Symbol Contract (P1.4 cleanup)

## Separate independent concepts

- **Variable** (`symbolKind: "variable"`): a named, explicitly declared symbol whose value may differ between contexts/documents. The parser **never** decides which mention is a global latest value.
- **Constant** (`symbolKind: "constant"`): a named symbol with exactly one `fixedValue` stored in its definition. A Paper may reference the constant but cannot provide a replacement value. The original constant definition is immutable under its existing document ID. To intentionally introduce a different constant, use a different ID.
- **Value type**: one of `text`, `number`, `boolean`, `date`, `enum`, `reference`. An enum is an explicitly restricted string, not a separate entity in the knowledge graph.
- **Cardinality**: `one` by default; `many` only when explicitly authorized for a variable. Constants always have `one`.
- **Document kind**: Paper, Project, Conversation, Variable, etc. in the existing EFSS envelope. A constant's schema is currently stored in an EFSS `kind: variable` document — document kind and symbol mutability are distinct.

No extra user-created value types, silently invented symbols, automatic casts from prose, or implicit global value history.

## Canonical schema version 2

This is the **body** of a canonical EFSS `kind: variable` document, using a stable ID such as `quantity`:

```text
:::efss.schema
{
  "schemaVersion": 2,
  "label": "Miktar",
  "symbolKind": "variable",
  "cardinality": "one",
  "value": { "type": "number", "min": 0 }
}
:::
```

A list must be explicitly declared with `cardinality: "many"`. Even then `&Miktar{26,48}` denotes an **explicit list in that Paper**, not a chronology, current value or confirmed observation.

For a constant definition, use a separate stable ID and:

```text
:::efss.schema
{
  "schemaVersion": 2,
  "label": "Pi",
  "symbolKind": "constant",
  "cardinality": "one",
  "value": { "type": "number" },
  "fixedValue": 3.14159
}
:::
```

`&Pi` is a reference. `&Pi{4}` produces a diagnostic and is never an assignment. Once saved as a constant, the canonical variable document cannot be edited to change its definition; it must be re-identified intentionally.

## Source and graph behavior

EFSS Markdown is authoritative. Plain text stays plain text. An undeclared `&Label` may remain an unresolved reference but is **never a new variable definition**. Typed binding inspection is explicit and yields *inert candidates* only, with source ranges. The knowledge graph stores source-derived links and separately approved relations, not automatic value observations.

Use real semantic identities in the Paper when necessary: a generic `Miktar` name does **not** identify a particular object, unit or time. The parser does not claim otherwise.

## Compatibility and retired mechanisms

- Existing version 1 variable-schema documents with **empty or absent** `properties` stay readable, preserving their former multi-value interpretation (`cardinality: "many"`). They are not silently rewritten.
- Version 1 documents with **non-empty** legacy property bags raise `LEGACY_PROPERTIES_REQUIRE_MIGRATION`. No property data are discarded. Migration is a future explicit operation.
- Version 2 requires both `symbolKind` and `cardinality` and rejects unknown schema fields.
- Two overlapping observation recording layers (`VariableLedger`, `LocalObservationLedger`) have been removed from the current API rather than allowed to redefine the semantics of ordinary notes. **No private local data are deleted**: existing `.efss/knowledge/observations.jsonl` files remain intact for an opt-in migration/recovery tool in a later phase, and the code remains in Git history.
- Relations journaling is unaffected; there is no migration or deletion of `relations.jsonl`.

## Deferred by design

There is no automatic last-value calculation, hidden scalar-to-list upgrade, time-series inference, auto-approval, schema migration, or implicit selection among contradictory notes. Before additional persistence abstractions are added, they must demonstrate a meaningful user need.

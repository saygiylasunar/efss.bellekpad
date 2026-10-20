# EFSS Knowledge Graph — current contract

The original private EFSS Markdown documents are authoritative. The graph has two narrowly defined link sources:

1. **Syntax references**, reconstructed from the source documents (`[[paper:id]]`, `&DeclaredSymbol`, `::use`). These are references, not factual truth.
2. **Explicitly reviewed inferred relations**, stored as propose/approve/retire events in `.efss/knowledge/relations.jsonl`. An approval is tied to a source revision, UTF-16 text range and text fingerprint. If the source changes, that approval becomes stale.

No graph operation assumes that `&Miktar{26,48}` describes a chronological series or determines the real-world state of an object. The graph does **not** create persistent observation records from arbitrary numerical mentions. Call the typed binding inspector deliberately when an editor needs to validate explicit variable literals.

The graph loads versioned `:::efss.schema` definitions stored in EFSS `kind: variable` documents, including the distinction between mutable variables and immutable constants. Restricted source and schema documents are excluded from default views.

Local relation records remain append-only, with exclusive mutation locks. A malformed or truncated relation journal fails closed. This is still an early single-device implementation without browser IndexedDB, cross-device synchronization or a graphical review UI.

The earlier duplicate observation journal implementation (P1.4b) is **retired**. Existing local `observations.jsonl` data are left untouched; see [SYMBOL_CONTRACT.md](SYMBOL_CONTRACT.md). It is not correct to treat that earlier journal as authoritative in the new minimal symbol contract.

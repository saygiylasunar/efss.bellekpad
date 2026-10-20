# P0.4

Core: own EFSS Markdown grammar, source-retaining AST, semantic commands and context plans.

Added: typed variable schemas (text, number, boolean, date, enum, reference), property validation, source-traced observation ledger, non-activating typed mention lookup.

No inline assignment syntax is finalized. Schemas and observations live in memory only. Variable references never inject stored values into model context automatically.

Next: syntax contract, schema migrations, canonical persistence, relation attributes, editor projection.

Node native tests; zero runtime dependencies.

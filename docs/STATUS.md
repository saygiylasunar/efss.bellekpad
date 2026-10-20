# P0.3

Core: custom EFSS source parser and reversible block/inline AST.

Added: isolated inline rule registry, range-based text patching, source locations, deterministic diagnostic boundaries. Content serialization retains original body line endings; envelope serialization remains canonical LF.

Unified: variable reference extraction delegates to semantic scanner. Document kinds follow central contract. Inert extension blocks do not activate commands or references.

Checks: Node built-in test runner. No runtime dependencies.

Open: nested CommonMark constructs, complete editorial attributes, typed values, stable AST node IDs, incremental reparse, custom rule persistence, formal grammar migration, UI adapter, durable storage and AI providers.

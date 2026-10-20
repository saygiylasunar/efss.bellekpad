# EFSS binding syntax — minimal rules

The parser owns the literal `&Name` and `&Name{...}` grammar. No external Markdown engine or language model interprets these tokens.

`&Name` is a reference. `&Name{26}` contains one typed *candidate value* when `Name` is an explicitly registered variable. No value is automatically committed, promoted to a fact, or taken to describe the current state of anything.

`&Name{26, 48}` is a candidate list **only** when the definition explicitly sets `cardinality: "many"`. Otherwise the typed inspector emits `VARIABLE_CARDINALITY_MISMATCH`. An immutable constant has a `fixedValue` in its schema and is referenced as `&Pi`; writing `&Pi{4}` produces `CONSTANT_INLINE_VALUE_FORBIDDEN`.

The language-level token parser still preserves old literal lists and exact source spans so existing Markdown can be read and edited without losing bytes. Text including commas should use JSON-style quoting inside bindings: `&Etiket{"bir, iki", üç}`. Empty, nested, unclosed or overlong bindings generate diagnostics; code fences, inline code, URL destinations and EFSS extension blocks are inert.

Known types: text, number, boolean, date, enum, reference. Type, cardinality and mutability are separate. The scanner never infers units, time periods, owners or relationships merely because several numbers are present.

For complete definitions, constant examples and legacy format handling, see [SYMBOL_CONTRACT.md](SYMBOL_CONTRACT.md).

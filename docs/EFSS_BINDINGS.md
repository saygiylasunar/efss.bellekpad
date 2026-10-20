# EFSS Markdown — Multi-value bindings, draft RFC P1.3

The original EFSS Markdown language owns the variable grammar; no external Markdown library or AI model is involved in parsing it.

## Forms

- `&Tarih` — a reference to a named variable.
- `&Tarih{2026-10-26, 2026-11-01}` — two positional values (no implicit storage or update).
- `&Not{"ilk, ikinci", örnek}` — a quoted comma-bearing string and a plain string.
- `&Miktar{26, 48.5}` — candidate numeric values, **only** if an explicitly registered variable definition has the number type.

The grammar parses a same-line brace-delimited list immediately following a variable name. 1–64 values; maximal binding length 8192 UTF-16 code units. Items are comma-separated outside double-quoted JSON strings. Quotes, braces or backslashes inside an item require JSON quoting. Empty, nested, unclosed and otherwise malformed lists yield `BAD_VARIABLE_BINDING` diagnostics. Decimal notation is dot-separated. A comma is always the value separator, not a decimal symbol.

Metadata remains document-version `0.1.0`; the evolving *grammar* version moves to `0.3.0-draft`.

## Interpretation and safety

`scanSemantics` emits one variable token with source offsets and an optional `binding` structure; the original raw Markdown is never reformatted by the scanner. Code fences, inline code, escaped references, URLs and EFSS extension payloads remain inert.

`inspectVariableBindings(body, registry, {sourceId})` performs strict schema checks and returns **inert candidates**. Known types: text, number, boolean, date, enum and reference. Text is never guessed to be a date or a number merely from nearby words. Wrong types, invalid dates and unknown variables produce diagnostics, not entries.

Parsing text never writes to `VariableLedger`, changes a previous observation, executes a directive, sends data to a model or authorizes any operation. In particular, `&Ad{...}` is **not** an assignment with overwrite semantics yet. A future reviewable commit step will connect accepted candidates to immutable source-backed observations.

## Deliberately deferred

Named property notation (such as `&Ölçüm{değer:26, birim:"mm"}`), entity scope resolution, variable rename, automatic approval, source revision-aware ledger invalidation, rich text editing, migration from evolving grammar syntax and contextual type inference are separate design tasks, not silently introduced here.

Tests exercise Unicode, CRLF offsets, escaping, quoted comma handling, no-injection contexts, strict types and diagnostics.

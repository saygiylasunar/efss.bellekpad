# EFSS BellekPad

Experimental, dependency-free EFSS Markdown and context kernel. Own parser and AST: no external Markdown/editor framework.

## Verify

```sh
npm run check
npm test
```

## Core components

- `parseDocument`, `serializeDocument`: canonical EFSS envelope.
- `parseMarkdownAst`, `serializeMarkdownAst`, `editMarkdownAst`: source-retaining AST and text edits.
- `InlineRules`: configurable inline syntax.
- `VariableTypeRegistry`, `VariableLedger`: typed definitions and source-backed values.
- `buildGraph`, `buildContext`: explicit references, scoped context import and inert mentions.
- `MemoryStations`: source-preserving paragraph/block index, lexical recall, optional model-specific embeddings, recurring-term candidates, evidence-backed relation hypotheses, model-neutral context tray.

No language model, persistence layer, network calls, or UI ships with this core. A repeated word is not a verified concept; model-generated relationships require review. Original text remains authoritative; vectors are derivative search indexes.

Public code and docs contain no personal data or credentials.

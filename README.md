# EFSS BellekPad

Dependency-free text and context kernel. Own EFSS Markdown parser and AST; no external Markdown or editor package.

## Verify

    npm run check
    npm test

## Core API

- `parseDocument`, `serializeDocument`: EFSS envelope.
- `parseMarkdownAst`, `serializeMarkdownAst`, `editMarkdownAst`: source-retaining AST.
- `InlineRules`: custom inline delimiters.
- `scanSemantics`, `EntityRegistry`, `buildGraph`, `buildContext`: semantic links and explicit context plans.
- `VariableTypeRegistry`: independent definitions and field constraints.
- `VariableLedger`: source-traced, typed observations.
- `inspectTypedMentions`: resolves variable references without importing values.

A variable mention remains inert by default. This is an in-memory core; no web UI, AI calls or durable storage. The public repository contains no user records or credentials.

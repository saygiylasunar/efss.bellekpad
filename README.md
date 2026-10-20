# EFSS BellekPad

Dependency-free experimental text and context kernel. EFSS Markdown parsing, syntax rules, source locations and semantic context processing are implemented in this repository; no external Markdown parser or editor framework is used.

## Verify

```sh
npm run check
npm test
```

## Core surface

- `parseDocument` and `serializeDocument`: canonical EFSS envelope (`efss_version: "0.1.0"`).
- `parseMarkdownAst` and `serializeMarkdownAst`: reversible body AST, preserving original line endings.
- `editMarkdownAst`: source-range edits with AST reparse.
- `InlineRules`: deterministic inline delimiters, local to an instance.
- `scanSemantics`, `EntityRegistry`, `buildGraph`, `buildContext`: typed references, explicit context inclusion and inert mentions.
- `parseConversationBody`: role-attributed turns.

## Status

The AST is a deliberate subset, not a complete CommonMark or word-processing implementation. Custom markers are structure only, not HTML/CSS and never executable input. No UI, model execution, network or persistent storage exists in this package.

The public repository contains no user data, secrets or private working profiles.

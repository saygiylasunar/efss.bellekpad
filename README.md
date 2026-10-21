# EFSS BellekPad

Local-first experimental EFSS Markdown and contextual-memory kernel. Own Markdown parser, AST, source-linked references and offline document vault. **A stored value is not automatically a fact or the current state of a real-world object.**

## Symbol contract (P1.4 cleanup)

There are **two** kinds of typed symbols: `variable` and `constant`. They use the same six allowed value types (`text`, `number`, `boolean`, `date`, `enum`, `reference`). A variable holds **one** inline value candidate by default; a list is allowed only when `cardinality: "many"` was explicitly declared. A constant must have exactly one fixed value in its definition and cannot be reassigned through a Paper binding or rewritten under the same document identity.

`&Miktar{26}` is a typed candidate **only when Miktar is declared**; it is not a time-series observation, automatic state update or inference. `&Miktar{26,48}` is rejected for a default one-value variable. `&Pi` references an immutable constant defined in a variable-schema document.

See [symbol rules and migration](docs/SYMBOL_CONTRACT.md) and [syntax](docs/EFSS_BINDINGS.md).

## Local persistence

Canonical EFSS Markdown lives in the Git-ignored `.efss/vault/`, protected by revision checks. Explicit, reviewed **relations** can live in `.efss/knowledge/relations.jsonl`. The speculative duplicate observation journals have been **retired from the active product API**; existing local journal files are not deleted, and previous implementation remains in Git history. Graph snapshots do not auto-promote arbitrary typed values into a second memory.

```powershell
npm run vault -- status
npm run vault -- import .efss/imports/document.md
npm run vault -- search ritim
```

See [data-storage boundaries](docs/DATA_STORAGE.md) and [knowledge graph](docs/KNOWLEDGE_GRAPH.md).

## Local model connections (optional)

This experimental project also offers a local OpenAI-compatible LLM provider, ComfyUI workflow adapter and directory-scoped model inventory. Nothing is automatically trained or downloaded. Model search only visits user-declared directories; it excludes LoRA and ancillary assets from the primary model list.

```powershell
# Copy config/model-paths.example.json to config/model-paths.local.json first.
npm run comfy:paths -- --config config/model-paths.local.json
npm run runtime -- scan config/model-paths.local.json
npm run runtime -- scan config/model-paths.local.json --components
```

Refer to [runtime](docs/MODEL_RUNTIME.md) and [ComfyUI path mapping](docs/COMFY_MODEL_PATHS.md).

## Development checks

```sh
npm run sanity
npm run check
npm test
```

The public-source sanity check and GitHub Actions help catch private paths or credential patterns, but they cannot guarantee that all private information is absent. Local personal data, trained models, private notes, logs, and keys must stay off the public repository. See [privacy policy](docs/PRIVACY.md).

**Not yet a user-facing note editor.** Browser IndexedDB, UI, migration/import tooling and live model testing remain future work.

## Editor product blueprint

The actual visual editor/web application is **not yet implemented**. The first editor release must include callouts, editable Markdown tables, emoji/page icons, formatting tools and keyboard-first block insertion, with source round-trip tests. Design scope, priority and competitive reference audit: [Editor Blueprint](docs/EDITOR_BLUEPRINT.md).

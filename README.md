# EFSS BellekPad

Dependency-free experimental text and context kernel. Web UI and AI provider integration are separate layers.

## Check

```sh
npm run check
npm test
```

## Grammar sketch

- `&Label`: variable reference, passive until resolved.
- `[[paper:doc_id]]`: typed reference, passive.
- `::use [[paper:doc_id]]`: explicit context import.
- `::scope [[project:project_id]]`: restrict document scope.
- `::mode "Profile Label"`: activate a registered user-defined mode in the context plan.
- `::goal "Task description"`: declare a task objective.
- `@Person:User`, `@AI:LocalModel`: conversation speaker boundaries.

Documents use the existing `efss_version: "0.1.0"` envelope. Semantic features are defined by `EFSS_CONTRACT.grammarVersion`. Resolve and compile to a **data-only context packet**, not executable code or a model instruction with privileged authority. Passive references never import content automatically. Retrieval modes: off, suggest, include. Current retrieval is lexical only.

The repository stores implementation assets only; no personal profiles, content archives, API keys or runtime data.

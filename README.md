# EFSS BellekPad

Experimental, dependency-free EFSS Markdown and memory kernel. Own parser, AST, typed variables and source-traced context; no external Markdown or editor framework.

## Verify

```sh
npm run check
npm test
```

## Shared local AI model folders (without duplicate files)

BellekPad uses a private JSON manifest and generates ComfyUI's native `extra_model_paths.yaml` file. Nothing is moved or copied. See [shared model path instructions](docs/COMFY_MODEL_PATHS.md).

```powershell
# Copy config/model-paths.example.json to config/model-paths.local.json first.
npm run comfy:paths -- --config config/model-paths.local.json
```

## Local AI runtime and diagnostics

```powershell
npm run runtime -- help
npm run runtime -- scan config/model-paths.local.json
npm run runtime -- gpu
npm run runtime -- running
npm run runtime -- estimate publisher/model 4096
```

Node-only runtime supervisor, append-only private JSONL logs, local model inventory and experimental model lab: `docs/MODEL_RUNTIME.md`. Model weights, personal data and runtime logs are excluded from Git. No model is automatically loaded or trained.

Vision-language input is an explicit `createImageMessage` with a verified local compatible chat runtime. Image generation uses `ComfyWorkflowProvider` with trusted local ComfyUI workflows. GGUF and Safetensors weights are not interchangeable.

`npm run test:trace` appends test progress and failures to local `.efss/logs/`.

Model and adapter evaluations:

```powershell
npm run eval -- examples/eval-suite.example.json <loaded-model-id>
```

## Explicit model discovery

Only categories and folders declared in the private model-paths JSON are searched.
Primary model discovery excludes `loras`, `vae`, `text_encoders` and other auxiliary assets.
To inspect ancillary assets **separately**, explicitly run:

```powershell
npm run runtime -- scan config/model-paths.local.json --components
```

Whole-disk scanning is not a supported CLI action. All findings are unverified until loaded and tested in a compatible runtime.

## Public-source sanity check

Before pushing, run `npm run sanity` (working tree) or `npm run sanity:staged` (Git index). The CI also checks for accidentally tracked local configuration, credential-like strings and identifiable paths. Optional private term lists belong in `.efss/private-terms.json`, never in the repository. To enable an optional local pre-commit gate, run `git config core.hooksPath .githooks` **once per local clone**. See `docs/PRIVACY.md`.

## Durable EFSS documents (Node local-first, P1.2)

A private file-backed vault stores **original EFSS Markdown source**, with SHA-256 optimistic revision checks and atomic file replacement. The searchable memory index can be rebuilt from saved documents. No private document is checked into Git. This is a local Node adapter; a future browser IndexedDB adapter will share the document contract.

```powershell
npm run vault -- status
npm run vault -- import .efss/imports/document.md
npm run vault -- search ritim
```

See [storage boundaries and recovery instructions](docs/DATA_STORAGE.md).

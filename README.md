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

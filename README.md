# EFSS BellekPad

Experimental, dependency-free EFSS Markdown and memory kernel. Own parser, AST, typed variables and source-traced context; no external Markdown or editor framework.

## Verify

```sh
npm run check
npm test
```

## Local model diagnostics

```powershell
npm run runtime -- help
npm run runtime -- scan "D:\AI\models"
npm run runtime -- gpu
npm run runtime -- running
npm run runtime -- estimate publisher/model 4096
```

Node-only runtime supervisor, append-only JSONL logs, local model inventory and future model lab: see `docs/MODEL_RUNTIME.md`. Model weights, personal data and runtime logs are excluded from Git. No model is automatically loaded or trained.

## Vision and debug

Vision-language input is an explicit `createImageMessage` with a verified local compatible chat runtime. Image generation uses `ComfyWorkflowProvider` with trusted local ComfyUI workflows; GGUF and Safetensors weights are not interchangeable.

`npm run test:trace` appends test progress and failures to local `.efss/logs/`. See `docs/MODEL_RUNTIME.md`.

# EFSS local runtime, diagnostics and model lab (P0.7)

## Technical boundaries

The EFSS Markdown parser, source graph, typed variables and context assembler are independent of any model host. Model files are never committed, and inference engines are not bundled. There are three distinct routes:

1. GGUF chat / vision-language weights: import compatible GGUF into LM Studio or another llama.cpp-compatible host. Vision models may also need a separate projector and compatible preprocessing.
2. Full Hugging Face / Safetensors language or VL checkpoints: use a runtime that supports that *specific architecture*, together with its config, tokenizer and processor. A lone .safetensors file is not automatically runnable.
3. Diffusion, text encoders, VAEs and related image assets: these are workflow components; use a compatible image-generation runtime (for example ComfyUI). A vision-language model reads images; a diffusion model generates them.

`classifyModelFile` intentionally only makes filename-based *unverified* guesses. Always inspect the full model directory and required companion files before loading.

## Local GPU constraints

Default planning capacity: 12 GiB VRAM, reserving 2.5 GiB for cache, context, OS display and runtime allocations. 32 GiB RAM is not an extension of full-speed VRAM. CPU offloading can permit larger weights but may substantially slow generation. Weight size is not a measured VRAM budget. A larger parameter count is not a substitute for measuring actual model quality and correctness.

Prefer quality-first, task-appropriate profiles, not unconditional fallback to tiny models:
- Reasoning: 14B GGUF Q4 class first where memory budget allows; measure 4K-context loading, speed and error rate.
- Image interpretation: use a compatible 7B-VL FP8 / 4B-VL BF16 model with tokenizer, processor and image encoder; verify available GPU memory.
- Image generation: workflow-capable image runtime; keep model weights and text encoder / VAE scheduling separate.
- Embedding: embedding model is a dedicated *indexing role*, not the main reasoning engine. Its parameters can be smaller without lowering the reasoning model's capacity.
- Reranking: separate retrieval ranking step only when needed.

No model is installed, imported or automatically loaded by this repository.

## Commands and local logs

Requires Node 20+ and LM Studio CLI `lms` on PATH for model commands; `nvidia-smi` on PATH for GPU status. Scan does not read model weights.

```powershell
npm run runtime -- scan "D:\AI\models"
npm run runtime -- models
npm run runtime -- running
npm run runtime -- gpu
npm run runtime -- status
npm run runtime -- estimate publisher/model-id 4096
npm run runtime -- load publisher/model-id 4096
npm run runtime -- unload publisher/model-id
```

Use `lms import <file.gguf>` manually for compatible external files, then `lms ls` to obtain the correct model identifier. A file listing from Explorer is not the same as a server-ready model.

Commands are allowlisted, spawned with `shell:false`, and write JSON Lines with ISO timestamps to `.efss/logs/runtime-YYYY-MM-DD.jsonl`. Multiple sessions append to the same file. Fields include session, action, stage, state, process exit code and bounded redacted output. Model text/prompts are not automatically logged. Keep `.efss/` private: logs are a local diagnostic asset. Console output may contain local paths.

Control+C stops the active supervised CLI command. It does **not** terminate arbitrary externally running model daemons, a training job, or every process started by a model runtime. To free VRAM use `unload` for each loaded model, and inspect `running` and `gpu`.

## Future own-model programme

`ModelLab` supports in-memory, versionable experiment manifests: base model, layers, data references, evaluations, measurable results and stage gates. It does not train model weights yet.

Planned lanes, kept separate:
- Prompt / policy layer: user-approved prompts, stable versioned rules.
- RAG / context layer: EFSS sources, graph links, traceable retrieval.
- Adapter layer: LoRA / fine-tuned weights identified by base model and version.
- Evaluation layer: fixed repeatable tests, regression checks and acceptance gates.
- Full pretraining: long-term research track; 12 GB VRAM is not a practical target for training large foundation models from scratch.

Training data must be opt-in, source-attributed and locally redacted before any training/export step.

## Pending runtime milestones

- Actual model format probes using GGUF metadata and Safetensors headers, not filenames alone.
- Cross-process runtime daemon and stateful global kill switch, plus accurate GPU telemetry.
- Safe browser-to-local companion bridge with explicit consent.
- Vision message multipart API, image generation workflow connector, model checkpoint validation.
- Rebuildable vector indices, persistent experiment results and dataset governance.

## Vision / image generation API routes

The API adapter accepts **explicit** `image/png`, `image/jpeg` or `image/webp` image data URIs as user-message content parts. Construct a local image message with `createImageMessage({prompt, images:[{mimeType,base64}]})`, then pass it to `OpenAICompatibleProvider.chat()` after loading a *verified* vision-language model. No remote image URLs are fetched by this adapter. The runtime must actually expose image-capable `/v1/chat/completions`; a text-only model cannot interpret image parts.

ComfyUI image-generation workflows are separate from VL image reading. `ComfyWorkflowProvider` queues an explicit trusted API-format workflow at a loopback ComfyUI server (`/prompt`) and requests its `/history/<id>`. The client does not auto-download models, load checkpoints, install custom nodes or expose arbitrary shell execution. Imported workflows can invoke custom node code; only run locally trusted workflows. Job queuing does not prove image generation succeeded.

Provider telemetry supports `onEvent(event)`; emitted events contain route, model ID, status, elapsed milliseconds and normalized error code, never image bytes or prompt contents.

## Traced tests and error taxonomy

Run `npm run test:trace` to execute Node's built-in tests using the supervised runtime. It appends all command progress to the same local JSONL debug log. Diagnoses include `EXECUTABLE_NOT_FOUND`, `MODEL_NOT_FOUND`, `CUDA_OUT_OF_MEMORY`, `DEVICE_UNAVAILABLE`, `FORMAT_UNSUPPORTED`, `PORT_IN_USE`, `PERMISSION_DENIED`, `COMMAND_EXIT_NONZERO` and `CANCELLED`. These are pattern-based categories: full stderr must still be inspected for ambiguous cases.

Logs are local private files, and their contents should be reviewed before any bug report is shared.

## Versioned evaluation baseline

`ModelLab` registers intended base/adapter/retrieval layers. `runModelEvaluation` executes the same explicit local test suite against each model and produces per-case pass/fail, required-token hit-rate, latency and token counts when available. This lexical match benchmark is a **smoke/regression test**, NOT a measurement of broad reasoning quality.

```powershell
npm run eval -- examples/eval-suite.example.json <loaded-model-id>
```

Private test suites belong outside Git, for example under `.efss/evals/`. Runtime logs include case IDs, statuses, error classifications and timing, not prompts, image bytes or model outputs. Regression acceptance should additionally examine human-rated answers and cited evidence.

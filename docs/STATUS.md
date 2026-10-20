# P0.7

Added: model file catalog (GGUF and Safetensors) using conservative filename-only heuristics; 12 GiB planning estimate is not a compatibility guarantee. Separate local runtime module for Node, keeping core browser-compatible.

Added: append-only private JSONL runtime events with timestamps, stages, errors and redacted bounded output; strictly allowlisted LM Studio and GPU status commands, supervised process state, per-command kill switch and CLI.

Added: ModelLab experiment/adapter manifest with evaluation stage gates. This is a research scaffold, not a model trainer or a new foundation model.

No weights, training data, provider credentials, personal model files, API tokens or logs in GitHub. No model was run on user GPU remotely. GGUF loading goes through LM Studio; Safetensors components require the corresponding HF/ComfyUI runtime. Vision and image generation routes planned, not yet implemented.

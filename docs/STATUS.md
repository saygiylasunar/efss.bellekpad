# P0.8

Own EFSS Markdown parser, AST and typed graph are separate from local runtime adapters.

Added: audited filename-only model catalog for GGUF/Safetensors; append-only local JSONL runtime logging; allowlisted CLI command supervisor; model lab experiment manifests; mapped runtime errors. Unit tests and traced-test command.

Added: OpenAI-compatible multimodal user image messages for compatible VL servers and a localhost-only ComfyUI workflow queue/history adapter for image generation. Neither is automatically activated. No checkpoints loaded, no provider credentials stored.

Pending: live Windows/RTX 3060 testing, accurate memory telemetry, trusted full model manifests, Hugging Face Safetensors model host support, persisted eval records, cancel running ComfyUI jobs, cross-process kill switch, UI.

# Local model bridge

The EFSS core owns the grammar, source ranges, graph and context assembly. A local inference runtime owns model weights and CUDA execution. No model is bundled.

## Stages

| Stage | Model capability | Initial choice | Swap candidate |
| --- | --- | --- | --- |
| Markdown, AST, variable grammar | None | Deterministic EFSS parser | — |
| Semantic index | Multilingual embedding | Qwen3-Embedding-0.6B | BGE-M3 or Qwen3-Embedding-4B |
| Candidate concept discovery | Instruction LLM | Qwen3-14B Q4 GGUF | Locally available capable reasoning model |
| Evidence-backed relation proposals | Instruction / reasoning LLM | Qwen3-14B Q4 GGUF | Vision-aware VL model if image evidence |
| Reranking | Reranker | Qwen3-Reranker-0.6B | Not wired yet |
| Context-grounded chat | Chat / reasoning LLM | Qwen3-14B Q4 GGUF | Verified 7B–9B+ vision-language variant for visual requests |
| Image reading and interpretation | Vision-language model | Qwen2.5-VL-7B FP8 complete checkpoint | Qwen3-VL-4B BF16 complete checkpoint |
| Image creation / editing | Diffusion workflow | Compatible Z-Image / FLUX workflow | Requires ComfyUI runtime and matching components |
| Speech input | Speech-to-text | Whisper large-v3-turbo | Not wired yet |

For 12GB VRAM reference: Qwen3.5-4B Q4 checkpoints are roughly 3.3–4.0GB and 9B around 6.6–7.6GB *on disk*; GPU residency also needs KV cache, runtime memory, and display reserve. Qwen3-Embedding-0.6B is approximately 639MB in common quantized distributions. Prefer staged loading rather than running every model simultaneously.

Model families are examples, not pinned provider model IDs. Discover actual IDs with GET /v1/models. Weights, KV cache, display overhead and concurrent model loads all contribute to memory requirements. Start at 4096 tokens for 14B Q4 on a 12 GiB-class GPU; confirm measured memory before increasing. Large context support on a model card does not mean it fits in VRAM.

## Runtime

LM Studio can expose /v1/models, /v1/embeddings and /v1/chat/completions. A compatible runtime can replace it. Use `OpenAICompatibleProvider` with explicit model IDs; remote HTTPS endpoints require explicit opt-in and a key.

All HTTP requests are opt-in and disabled by default until a method is called. Local requests default to loopback. Keep the provider in a local process, not in an exposed static web client. Browser integration requires a separately authenticated local companion gateway; do not embed provider secrets in frontend assets.

`indexEmbeddings` processes memory segments sequentially for bounded resource use, and `queryWithMemory` bundles source text with provenance in a model-neutral context packet. It does not automatically alter EFSS documents or accept model-proposed relationships as verified facts.

For a manual run: start the local inference server, load a chat model and optionally an embeddings model, then run `node examples/local-memory.mjs` with `EFSS_CHAT_MODEL` and optionally `EFSS_EMBED_MODEL` set to identifiers returned by the server.

## Separation of concerns

- **Grammar:** deterministic, no model requirement.
- **Retrieval:** lexical and/or vector; vectors are rebuildable derivatives of source.
- **Reasoning:** model generates candidate relationships, each retaining evidence and status.
- **Context:** selected snippets, source identifiers, limits and access decisions.
- **AI execution:** independent adapter, no implicit tool execution.

The adapter is tested with mocked HTTP responses; hardware performance and native LM Studio connection remain to be tested on a user machine.

## Runtime control, formats, diagnostics

See `docs/MODEL_RUNTIME.md` for local inventory, GGUF/SAFETENSORS compatibility, Windows commands, append-only error logging, 14B-first reasoning profiles, explicit VL input and trusted image-generation workflows. Personal model file paths are never hardcoded in the public repository.

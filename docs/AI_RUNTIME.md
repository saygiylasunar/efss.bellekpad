# Local model bridge

The EFSS core owns the grammar, source ranges, graph and context assembly. A local inference runtime owns model weights and CUDA execution. No model is bundled.

## Stages

| Stage | Model capability | Initial choice | Swap candidate |
| --- | --- | --- | --- |
| Markdown, AST, variable grammar | None | Deterministic EFSS parser | — |
| Semantic index | Multilingual embedding | Qwen3-Embedding-0.6B | BGE-M3 or Qwen3-Embedding-4B |
| Candidate concept discovery | Instruction LLM | Qwen3-4B-Instruct | Qwen3-8B |
| Evidence-backed relation proposals | Instruction / reasoning LLM | Qwen3-8B Q4 | Qwen3-4B-Instruct |
| Reranking | Reranker | Qwen3-Reranker-0.6B | Not wired yet |
| Context-grounded chat | Chat / reasoning LLM | Qwen3-8B Q4 | Qwen3-4B |
| Images / diagrams | Vision-language model | Qwen3-VL-4B-Instruct | Not wired yet |
| Speech input | Speech-to-text | Whisper large-v3-turbo | Not wired yet |

Model families are examples, not pinned provider model IDs. Discover actual IDs with GET /v1/models. Weights, KV cache, display overhead and concurrent model loads all contribute to memory requirements. Start at 4096–8192 tokens for 8B Q4 on a 12GB class GPU; confirm measured memory before increasing. Large context support on a model card does not mean it fits in VRAM.

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

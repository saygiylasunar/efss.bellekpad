# BellekPad — Locked product contract (R0 rebuild)

## Scope and ownership
- Web-first, AI-first, local-first. React + TypeScript client, Python backend, user-chosen workspace data root.
- Main repository: saygiylasunar/efss.bellekpad. Rebuild branch: rebuild/web-ai-core. No cross-project integrations or destructive main rewrite.
- Source and package ownership remains EFSS proprietary; third-party licenses must be respected.
- No arbitrary model size/quantization veto. Errors reflect real runner outcomes. No mandatory moral/NSFW response rewriting layer.
- User supplies model directories across disks. Only configured directories may be indexed. Never copy model files without intent.
- Artboard/Word/Illustrator layout editing is deferred; keep semantic text model independent of the presentation surface.

## UI reference and tools
- ChatGPT/LM Studio: broad conversation surface, left history/projects rail, context-sensitive right inspector.
- Forge-like Generate panel; ComfyUI-like graph workspace. The UI belongs to BellekPad, NOT Comfy's frontend.
- React Flow powers node layout/edges; Comfy core is a managed engine process, not a required second app.
- Tiptap on ProseMirror powers user writing; EFSS source is the canonical persisted contract, never an implicit Tiptap Markdown export.
- Large, established libraries are welcome; a feature does not justify adding several overlapping editors/state tools.

## Conversations (future R3)
- Parallel: independent replies to one user turn.
- Roundtable: bounded turns with model-to-model context.
- Orchestrated: controller chooses roles/turns with explicit stop conditions; controller need not be an LLM.
- Conversation persistence, message forks, turn budget, prompt roles, streaming and cancellation must be designed together.
- Multiple participants do not require loading all weights at once.

## Images (R4)
- One primary model per generation job; independently chosen model-family-compatible text encoders/CLIP/VAE and LoRA stack with per-component weights.
- Workflow preset is separate from runtime input overrides and immutable job snapshot.
- Model-specific optional sampler, scheduler, CFG, steps, denoise, conditioning, reference image, seed, size.
- Backend validates capabilities using the active engine node registry. Unsupported configuration fails visibly, not silently.
- Chat-driven image generation produces a validated structured job; it must never inject arbitrary Python code or paths.

## Engineering acceptance
- Business behavior belongs to backend core. UI may not invent engine states or features.
- Core → API → persistent state → UI → integration/failure-path test is one feature.
- A green compile or mocked request is not proof of real Comfy/GGUF inference.
- Only actual saved/roundtripped EFSS constructs may be editable. Unknown syntax is preserved as opaque.

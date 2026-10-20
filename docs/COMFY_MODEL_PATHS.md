# External models without copying them

BellekPad uses a private JSON model-root manifest. ComfyUI itself reads **YAML**, not this JSON. The `comfy:paths` command validates JSON and generates `extra_model_paths.yaml` for ComfyUI.

## Prepare later, when convenient

1. Copy `config/model-paths.example.json` to `config/model-paths.local.json`. The local filename is ignored by Git.
2. In that local JSON replace example `basePath` values with actual **absolute disk paths**. A base path should point to the parent directory of folders such as `checkpoints`, `diffusion_models`, `LLM`, etc. Use forward slashes for Windows: `D:/AI/SharedModels`.
3. Every `categories` key is the ComfyUI folder category. Values are subfolders relative to `basePath`. Multiple paths per category are supported. Separate roots can refer to separate disks. No files are copied or symlinked.
4. Generate a private YAML preview:

```powershell
npm run comfy:paths -- --config config/model-paths.local.json
```

5. Optionally validate real folders on your computer:

```powershell
npm run comfy:paths -- --config config/model-paths.local.json --check
```

6. When ready, inspect `.efss/generated-extra_model_paths.yaml`. Add its sections to the **existing** `extra_model_paths.yaml` in the correct ComfyUI configuration location, preserving any current paths. On portable/manual ComfyUI this usually means the ComfyUI root. Desktop installations may have their own managed config location. Restart ComfyUI to reload the path list.

A direct `--output` target is also supported. It refuses to overwrite existing files by default. `--force` creates a backup before replacing a file, but **does not merge** an existing ComfyUI configuration. Merging the generated sections manually is safer.

## Mapping examples

```json
{
  "schemaVersion": 1,
  "roots": [{
    "id": "main_models",
    "basePath": "D:/AI/SharedModels",
    "categories": {
      "checkpoints": ["checkpoints"],
      "diffusion_models": ["diffusion_models", "unet"],
      "text_encoders": ["text_encoders", "clip"],
      "loras": ["loras"],
      "vae": ["vae"],
      "LLM": ["LLM"],
      "ipadapter": ["ipadapter"]
    }
  }]
}
```

This generates the following kind of native ComfyUI YAML:

```yaml
efss_main_models:
  base_path: "D:/AI/SharedModels"
  checkpoints: |
    checkpoints
  diffusion_models: |
    diffusion_models
    unet
  text_encoders: |
    text_encoders
    clip
  loras: |
    loras
  vae: |
    vae
  LLM: |
    LLM
  ipadapter: |
    ipadapter
```

These folder names were suggested by the screenshot; **the image does not reveal a disk letter or absolute path**. We have not guessed your actual paths.

## Scope and limitations

ComfyUI itself knows common categories including `checkpoints`, `diffusion_models`, `text_encoders`, `clip_vision`, `vae`, `loras`, `controlnet`, `embeddings`, `upscale_models`, and many others. Custom categories such as `LLM`, `ipadapter`, `animatediff_models`, and `grounding-dino` are valid configuration keys but **only have practical effect when installed custom nodes use or register those categories**. Those nodes sometimes use additional paths and extension rules of their own. Naming a category does not automatically make a Safetensors or GGUF model executable by ComfyUI.

Paths are only search directories. A ComfyUI workflow still needs compatible loader nodes and the proper file structure. BellekPad's existing ComfyUI API client can request explicitly chosen trusted workflows; it does not itself load model weights. Neither this generator nor the path scanner copies or moves weights, and nothing runs on your GPU until you choose to test it.

Private JSON configs, generated YAML under `.efss/`, model files and runtime logs must never be committed. The checked-in example is placeholder-only.

## Explicit discovery vs. ComfyUI availability

The JSON contains both primary and ancillary model folders so ComfyUI can find all of its required workflow parts. **The BellekPad model-search command does not treat every Safetensors file as an independent model.**

```powershell
npm run runtime -- scan config/model-paths.local.json
```

This searches only the configured `LLM`, `checkpoints`, `diffusion_models` and `unet` categories for primary models. `loras`, `vae`, `text_encoders`, etc. are skipped in the primary view. Append `--components` to list these in a **separate ancillary section**. The scanner never sweeps the whole PC. Custom categories used by ComfyUI are still included in YAML export, but aren't automatically included in model discovery.

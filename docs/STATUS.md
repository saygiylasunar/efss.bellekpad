# P1.0 — Local shared-model paths

Added: versioned JSON model-root manifest and independent YAML generator for ComfyUI `extra_model_paths.yaml`. Multiple model roots and multiple paths per category, including configurable custom-node categories. No duplication of large models.

Added: local-only path inventory preflight, no-clobber YAML export and opt-in overwrite-with-backup. The generator does not modify ComfyUI config or launch model processes automatically. A runtime config is local/private; public repository contains placeholders only.

The user may defer all local experiments. CI verifies mapping and overwrite safety with temporary directories.

Known limits: custom ComfyUI model classes require supporting nodes; a directory does not establish runtime model compatibility; no automatic merging with existing YAML; no live hardware tests.

## P1.1 decision: scan scope

Only user-configured model categories and paths may be scanned via the runtime CLI. Discovery defaults to primary model categories; LoRA and auxiliary assets are separated behind opt-in `--components`. No whole-PC scan. File type/classification is indicative only, not runtime compatibility proof. No local user GPU scanning or live model test was performed.

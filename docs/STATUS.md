# P1.0 — Local shared-model paths

Added: versioned JSON model-root manifest and independent YAML generator for ComfyUI `extra_model_paths.yaml`. Multiple model roots and multiple paths per category, including configurable custom-node categories. No duplication of large models.

Added: local-only path inventory preflight, no-clobber YAML export and opt-in overwrite-with-backup. The generator does not modify ComfyUI config or launch model processes automatically. A runtime config is local/private; public repository contains placeholders only.

The user may defer all local experiments. CI verifies mapping and overwrite safety with temporary directories.

Known limits: custom ComfyUI model classes require supporting nodes; a directory does not establish runtime model compatibility; no automatic merging with existing YAML; no live hardware tests.

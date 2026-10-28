# R2.6 — Model Descriptor / runtime selection boundary

**Actual source:** backend/bellekpad/model_descriptor.py

This is a header-inspection feature, **not model inference**. It never
loads weights into Torch, ComfyUI, llama.cpp or system VRAM. It is triggered
when the user selects a file in the Models view; it does not scan arbitrary
directories or inspect all models at startup.

## Core → API → UI

1. Browser selects an indexed **model UUID**, not a file path.
2. SQLite joins model UUID → saved root → saved relative path.
3. The backend rejects traversal, symlinks, missing paths and any regular
   file whose size / nanosecond mtime changed since the last manual index.
   Changed files are marked **stale** and should be reindexed by the user.
4. Only a bounded header is inspected. The file is not unpickled, loaded by
   an ML library, copied, hashed in full, or memory-mapped for inference.
5. GET /api/models/{model_id}/descriptor returns header-based evidence
   and an explicit *requires_runtime_validation* contract. React displays
   architecture, tensor count and dtype only if actually present.
6. Header inspection never marks the model as loaded / runnable. Real engine
   adapters are still responsible for compatibility, accessories,
   quantization, tokenizer and actual loading.

## Supported headers

### GGUF

Reads GGUF file signature, version, tensor count and metadata key/value
header. Supports little-endian **v2/v3** scalar and array metadata values
within a strict 32 MiB inspection window (large tokenizer arrays may
cause a bounded partial result). Extracts general.architecture and
general.name when available. A GGUF architecture string is **model-file
metadata**, not proof that the local gguf worker supports it.

Specification: https://github.com/ggml-org/llama.cpp/blob/master/ggml/include/gguf.h

### Safetensors

Reads 8-byte little-endian header length and bounded UTF-8 JSON metadata,
validating tensor entry dtype/shape/offset structure, repeated keys and
available file length. Reports tensor count, dtype list and limited
non-sensitive header metadata. Does **not** infer a model family from a
filename or arbitrary tensor naming patterns.

Specification: https://github.com/huggingface/safetensors/blob/main/README.md

### Other formats

PT/PTH/CKPT/ONNX/BIN still appear in the model index, but return
uninspected because no safe, authoritative header inspector is implemented.
In particular, the system never unpickles a PT/CKPT to discover metadata.

## Runtime candidates and honest states

- Inspected GGUF → potential **gguf-worker**. Not active: requires verified
  runner executable, supported architecture/quantization, tokenizer/model
  companion files and actual load acceptance.
- Inspected safetensors → potential **pytorch-transformers** or **comfyui**;
  which one is valid depends on the *real model architecture* and specific
  runtime components and must be checked separately.
- Stale, invalid, uninspected or inspection-limited → no validated runtime
  candidate. No "Run" button is enabled by this descriptor alone.

No arbitrary RAM/VRAM/model-size cutoff is imposed. The 32 MiB limit
applies only to **metadata/header parsing** so untrusted files cannot
cause unlimited memory use; the actual model weights are not inspected.

## Remaining integration

The **next flight** needs actual adapter capability negotiation, executable
worker lifecycle and model-activation contract; afterwards connect model
selection to Chat and Image Studio. Preserve deliberate user choice of
model paths, and keep Comfy integration separate from the application's
React UI.

**Acceptance:** Linux and native Windows Python tests construct small,
format-accurate headers and verify safe parsing, corrupt files,
malformed metadata, stale modifications, symlink escapes, bounded header
reading and UUID-only HTTP access. Tests do not claim true inference.

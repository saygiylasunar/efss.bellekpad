# R2.5 — Model Registry (explicit-directory indexing)

**Status:** Core → SQLite v4 → HTTP API → React Models view → Linux/Windows tests.
**Not a model runner.** A successful file scan is not a promise that the
runtime supports that checkpoint, tokenizer or quantization.

## Contract

1. User adds an **absolute local model directory** in BellekPad → Modeller.
   Backend canonicalizes and saves only directories that actually exist.
2. No filesystem scan starts at app launch or when a root is added. Scanning
   occurs **only on the user's Tara action** on the chosen root.
3. The scanner recursively inspects only that approved directory. It does
   not follow directory/file symlinks or copy/open large model payloads.
   Disconnected roots fail explicitly.
4. Files currently recognized for indexing: .gguf, .safetensors, .ckpt, .pt,
   .pth, .onnx and .bin. Catalog contains relative path, name, extension,
   source file size and modification timestamp. Heuristic *component hints*
   may come from folder names such as loras, vae and text_encoders.
5. **No inferred model family is authoritative.** Extension/folder name
   cannot guarantee a valid diffusion model, LLM, VAE or LoRA.
6. Scan builds a full snapshot first; DB index replacement uses **one
   transaction**. Disk errors leave the previous snapshot intact. Stable
   UUIDs derive from saved root + relative path.
7. Removing a root deletes only metadata rows. **Never unlink, move, rename
   or alter** an external model file.
8. Index metadata is backed up with SQLite; model weight bytes are *not*.
9. Scans run in a backend worker thread. Duplicate scans of the same root
   return a conflict.
10. Client only displays/filters backend catalog; React cannot claim a model
    is compatible or loaded.

## HTTP surface

- GET /api/models/roots — approved roots and last scan metadata.
- POST /api/models/roots — add exact absolute directory; no scan.
- DELETE /api/models/roots/{root_id} — remove reference only.
- POST /api/models/roots/{root_id}/scan — only persisted root ID.
- GET /api/models?root_id=&query=&format=&limit=&offset= — paginated search.

Routes inherit loopback Host / write-Origin protection. There is no model
copy/exec endpoint and the scan route never accepts an arbitrary path.

## Verified and not yet verified

Core/API tests cover opt-in, no automatic scan, stable IDs, symlink escape
rejection (where supported), failed scan retaining previous snapshot,
parameterized filtering, metadata-only deletion, HTTP constraints, pagination
and workspace backup/restore. Linux + native Windows 3.13 CI and frontend
build are required for release of this slice.

**Next:** verified ModelDescriptor/engine capabilities, GGUF and PyTorch
worker selection and Comfy directory mapping. Execution must revalidate the
path and compatible backend; an index does not grant model-execution rights.
Background scan progress/cancellation, Windows network mounts and real
model metadata parsing are not yet complete. No arbitrary model-size limit.

import { basename, extname, join } from "node:path";
import { readdir, stat } from "node:fs/promises";

export function classifyModelFile({ name, sizeBytes = null } = {}) {
  if (typeof name !== "string" || !name.trim()) throw new TypeError("Missing filename");
  if (sizeBytes !== null && (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0))
    throw new TypeError("Invalid size");
  const normalized = basename(name).toLowerCase();
  const format = normalized.endsWith(".gguf") ? "gguf" :
    normalized.endsWith(".safetensors") ? "safetensors" : "unknown";
  const stem = normalized.replace(/\.(gguf|safetensors)$/, "");
  const role = /vae/.test(stem) ? "vae" :
    /text.?encoder|umt5|t5[-_]|clip[_-]/.test(stem) ? "text_encoder" :
    /(?:vision.?encoder|long.?vit|mmproj)/.test(stem) ? "vision_encoder" :
    /flux|z.?image|intorealism|cyberrealistic|stable.?diffusion/.test(stem) ? "image_generation" :
    /qwen.*(?:vl|vision)|qwen3vl/.test(stem) ? "vision_language" :
    /qwen|llama|mistral|gemma|phi[-_]/.test(stem) ? "language" : "unknown";
  const route = ["vae", "text_encoder", "vision_encoder", "image_generation"].includes(role)
    ? "workflow-runtime" : format === "gguf" ? "gguf-runtime" :
      format === "safetensors" ? "safetensors-runtime" : "undetermined";
  const sizeGiB = sizeBytes === null ? null : Number((sizeBytes / (1024 ** 3)).toFixed(2));
  return { name: basename(name), format, role, route, sizeBytes, sizeGiB,
    evidence: "filename-only", verified: false,
    readiness: format === "gguf" && ["language", "vision_language"].includes(role)
      ? "import-then-verify" : "needs-complete-model-or-workflow",
    warning: "A weight file alone does not prove model architecture or loadability." };
}

export function estimateFit(model, { gpuGiB = 12, reserveGiB = 2.5 } = {}) {
  if (typeof gpuGiB !== "number" || typeof reserveGiB !== "number" ||
      !Number.isFinite(gpuGiB) || !Number.isFinite(reserveGiB) ||
      gpuGiB <= reserveGiB || reserveGiB < 0) throw new TypeError("Invalid GPU budget");
  const availableGiB = gpuGiB - reserveGiB;
  return { availableGiB, status: model.sizeGiB === null ? "unknown" :
    model.sizeGiB > availableGiB ? "likely-needs-offload" : "weights-might-fit",
    caveat: "Weights do not include KV cache, vision tensors, runtime overhead or paired encoders." };
}

export async function scanModelDirectory(root, { maxDepth = 5, maxEntries = 3000 } = {}) {
  if (typeof root !== "string" || !root.trim() ||
      !Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 12 ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 50000)
    throw new TypeError("Invalid scan settings");
  const found = [], queue = [{ path: root, depth: 0 }];
  let traversed = 0;
  while (queue.length) {
    const current = queue.pop();
    for (const item of await readdir(current.path, { withFileTypes: true })) {
      if (++traversed > maxEntries) throw new Error("SCAN_LIMIT_REACHED");
      if (item.isSymbolicLink()) continue;
      const path = join(current.path, item.name);
      if (item.isDirectory() && current.depth < maxDepth) {
        queue.push({ path, depth: current.depth + 1 });
      } else if (item.isFile() && [".gguf", ".safetensors"].includes(extname(item.name.toLowerCase()))) {
        const info = await stat(path);
        found.push({ ...classifyModelFile({ name: item.name, sizeBytes: info.size }), path });
      }
    }
  }
  return found.sort((a, b) => a.role.localeCompare(b.role) ||
    (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || a.name.localeCompare(b.name));
}

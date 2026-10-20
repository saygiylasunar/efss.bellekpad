import { lstat } from "node:fs/promises";
import { extname } from "node:path";
import { listComfyModelPaths } from "./comfy-paths.js";
import { scanModelDirectory } from "./model-catalog.js";

const PRIMARY = new Map([
  ["LLM", "language"],
  ["llm", "language"],
  ["checkpoints", "image_generation"],
  ["diffusion_models", "image_generation"],
  ["unet", "image_generation"]
]);
const COMPONENT = new Set([
  "loras", "lora", "vae", "vae_approx", "text_encoders",
  "clip", "clip_vision", "vision_encoders", "audio_encoders",
  "controlnet", "embeddings", "ipadapter", "ipadapter-flux",
  "animatediff_motion_lora", "animatediff_models", "upscale_models",
  "latent_upscale_models", "hypernetworks", "style_models"
]);
const ADAPTER_PATTERN = /(?:^|[-_. ])(?:lora|locon|lycoris|dora|adapter)(?:[-_. ]|$)/i;
const MODEL_SUFFIX = new Set([".gguf", ".safetensors"]);

export function modelCategoryPolicy(category) {
  if (typeof category !== "string") throw new TypeError("Invalid model category");
  if (PRIMARY.has(category)) return { kind: "primary", roleHint: PRIMARY.get(category) };
  if (COMPONENT.has(category)) return { kind: "component", roleHint: null };
  return { kind: "unclassified", roleHint: null };
}

/**
 * Discovers only locations listed in the user's model-paths JSON.
 * Unspecified folders, full disks, and symlinked roots are never traversed.
 * A discovered file is never declared compatible until checked by its runtime.
 */
export async function discoverConfiguredModels(manifest, {
  includeComponents = false, maxDepth = 2, maxEntries = 3000
} = {}) {
  if (typeof includeComponents !== "boolean" || !Number.isSafeInteger(maxDepth) ||
      maxDepth < 0 || maxDepth > 5 || !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1 || maxEntries > 50000) throw new TypeError("Invalid discovery options");
  const configured = listComfyModelPaths(manifest);
  const models = [], components = [], diagnostics = [];
  const pathsSeen = new Set();
  for (const entry of configured) {
    const policy = modelCategoryPolicy(entry.category);
    if (policy.kind === "unclassified") continue;
    if (policy.kind === "component" && !includeComponents) continue;
    if (pathsSeen.has(entry.path)) continue;
    pathsSeen.add(entry.path);
    try {
      const root = await lstat(entry.path);
      if (!root.isDirectory() || root.isSymbolicLink()) {
        diagnostics.push({ rootId: entry.rootId, category: entry.category,
          code: "NOT_A_DIRECTORY" });
        continue;
      }
      const found = await scanModelDirectory(entry.path, { maxDepth, maxEntries });
      for (const file of found) {
        if (!MODEL_SUFFIX.has(extname(file.name.toLowerCase()))) continue;
        const looksLikeAdapter = ADAPTER_PATTERN.test(file.name);
        const kind = policy.kind === "component" || looksLikeAdapter ? "component" : "primary";
        if (kind === "component" && !includeComponents) continue;
        const inferredRole = policy.roleHint === "language" && file.role === "vision_language"
          ? "vision_language" : policy.roleHint ?? file.role;
        const result = {
          ...file, kind, sourceCategory: entry.category, rootId: entry.rootId,
          role: kind === "component" && looksLikeAdapter ? "adapter" : inferredRole,
          verified: false, confidence: "path-category-and-filename-only"
        };
        (kind === "primary" ? models : components).push(result);
      }
    } catch (error) {
      diagnostics.push({ rootId: entry.rootId, category: entry.category,
        code: error?.code === "ENOENT" ? "DIRECTORY_MISSING" :
          error?.code === "EACCES" || error?.code === "EPERM" ? "DIRECTORY_DENIED" :
          error?.message === "SCAN_LIMIT_REACHED" ? "SCAN_LIMIT_REACHED" : "DISCOVERY_FAILED" });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    models: models.sort(byName), components: components.sort(byName),
    diagnostics, inspectedCategories: pathsSeen.size,
    note: "Filename and category hints only. LoRA and ancillary assets are never treated as standalone models."
  };
}

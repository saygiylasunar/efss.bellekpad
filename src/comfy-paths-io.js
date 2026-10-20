import { readFile, writeFile, mkdir, stat, copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generateComfyExtraPathsYaml, listComfyModelPaths,
  validateComfyPathManifest } from "./comfy-paths.js";

export async function readComfyPathManifest(file) {
  if (typeof file !== "string" || !file.trim()) throw new TypeError("INVALID_CONFIG_PATH");
  let raw;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("INVALID_MODEL_JSON");
    throw error;
  }
  return validateComfyPathManifest(raw);
}

export async function inspectComfyFolders(manifest, { inspect = stat } = {}) {
  if (typeof inspect !== "function") throw new TypeError("Invalid inspector");
  const entries = listComfyModelPaths(manifest);
  const result = [];
  for (const entry of entries) {
    try {
      const info = await inspect(entry.path);
      result.push({ ...entry, status: info.isDirectory() ? "present" : "not-directory" });
    } catch (error) {
      if (error?.code === "ENOENT") result.push({ ...entry, status: "missing" });
      else if (error?.code === "EACCES" || error?.code === "EPERM") {
        result.push({ ...entry, status: "permission-denied" });
      } else {
        result.push({ ...entry, status: "error", code: String(error?.code ?? "UNKNOWN") });
      }
    }
  }
  return result;
}

export async function writeComfyExtraPaths(manifest, file, { force = false } = {}) {
  if (typeof file !== "string" || !file.trim()) throw new TypeError("INVALID_OUTPUT_PATH");
  const yaml = generateComfyExtraPathsYaml(manifest);
  await mkdir(dirname(file), { recursive: true });
  let backup = null;
  if (force) {
    try {
      await stat(file);
      backup = file + ".backup-" + new Date().toISOString().replace(/[:.]/g, "-") +
        "-" + process.pid;
      await copyFile(file, backup, 1);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  await writeFile(file, yaml, { encoding: "utf8", flag: force ? "w" : "wx" });
  return { file, backup, bytes: Buffer.byteLength(yaml) };
}

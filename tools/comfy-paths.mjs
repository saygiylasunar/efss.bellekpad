#!/usr/bin/env node
import { readComfyPathManifest, inspectComfyFolders,
  writeComfyExtraPaths } from "../src/comfy-paths-io.js";
import { RuntimeLog } from "../src/runtime-log.js";

const usage = [
  "EFSS BellekPad — ComfyUI shared model directory configuration",
  "",
  "npm run comfy:paths -- --config config/model-paths.local.json",
  "npm run comfy:paths -- --config config/model-paths.local.json --check",
  "npm run comfy:paths -- --config config/model-paths.local.json --output path/to/ComfyUI/extra_model_paths.yaml",
  "",
  "Options: --config FILE, --output FILE, --check, --force",
  "--force creates a backup before overwriting an existing output.",
  "By default output is private: .efss/generated-extra_model_paths.yaml",
  "No model weights are copied, loaded or downloaded."
].join("\n");

if (process.argv.length <= 2 || process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage);
  process.exit(0);
}
const args = process.argv.slice(2);
let config = "config/model-paths.local.json";
let output = ".efss/generated-extra_model_paths.yaml";
let check = false;
let force = false;
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (flag === "--check") check = true;
  else if (flag === "--force") force = true;
  else if (flag === "--config" || flag === "--output") {
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("MISSING_CLI_VALUE: " + flag);
    if (flag === "--config") config = value;
    else output = value;
  } else throw new Error("UNKNOWN_CLI_ARGUMENT: " + flag);
}
const log = new RuntimeLog();
try {
  await log.write({ event: "comfy-paths-start", stage: "config", action: "comfy-paths",
    state: "running" });
  const manifest = await readComfyPathManifest(config);
  console.log("Roots:", manifest.roots.length);
  if (check) {
    const folders = await inspectComfyFolders(manifest);
    // Print full paths only on the local console; do not copy them into logs.
    console.table(folders.map(item => ({
      root: item.rootId, category: item.category, location: item.path, state: item.status
    })));
    const issues = folders.filter(item => item.status !== "present");
    await log.write({ event: "comfy-paths-checked", stage: "config",
      action: "comfy-paths", state: issues.length ? "warning" : "completed",
      bytes: folders.length, code: issues.length ? "MODEL_FOLDERS_UNAVAILABLE" : null });
    if (issues.length) {
      console.error("Some configured folders are unavailable. YAML not installed.");
      process.exitCode = 2;
    }
  } else {
    const saved = await writeComfyExtraPaths(manifest, output, { force });
    await log.write({ event: "comfy-paths-generated", stage: "config",
      action: "comfy-paths", state: "completed", bytes: saved.bytes });
    console.log("Generated:", saved.file);
    if (saved.backup) console.log("Existing configuration backed up to:", saved.backup);
    console.log("Copy into your ComfyUI config location and restart ComfyUI.");
  }
} catch (error) {
  await log.error({ stage: "comfy-config", action: "comfy-paths", error }).catch(() => {});
  console.error("Comfy model paths:", error?.code ?? error.message);
  console.error("Private log:", log.path);
  process.exitCode = 1;
}

#!/usr/bin/env node
import { estimateFit } from "../src/model-catalog.js";
import { readComfyPathManifest } from "../src/comfy-paths-io.js";
import { discoverConfiguredModels } from "../src/model-discovery.js";
import { RuntimeLog } from "../src/runtime-log.js";
import { RuntimeSupervisor } from "../src/runtime-supervisor.js";

const HELP = [
  "EFSS BellekPad local runtime CLI",
  "",
  "node tools/efss-runtime.mjs scan [config/model-paths.local.json] [--components]",
  "node tools/efss-runtime.mjs models",
  "node tools/efss-runtime.mjs test",
  "node tools/efss-runtime.mjs running",
  "node tools/efss-runtime.mjs gpu",
  "node tools/efss-runtime.mjs status",
  "node tools/efss-runtime.mjs estimate <lms-model-key> [contextTokens]",
  "node tools/efss-runtime.mjs load <lms-model-key> [contextTokens]",
  "node tools/efss-runtime.mjs unload <lms-model-key>",
  "node tools/efss-runtime.mjs server-start",
  "node tools/efss-runtime.mjs server-stop",
  "",
  "Only declared JSON model folders are scanned; no unrestricted disk scan.",
  "LoRAs and other ancillary files are excluded from main model discovery.",
  "Use --components to list those separately.",
  "Logs append locally to .efss/logs/runtime-YYYY-MM-DD.jsonl.",
  "Commands are allowlisted and run without a shell.",
  "Control+C cancels the supervised CLI command, not all LM Studio loaded models.",
  "To release model VRAM, use unload <model-key>."
].join("\n");

const [action, parameter, context] = process.argv.slice(2);
if (!action || ["--help", "-h", "help"].includes(action)) {
  console.log(HELP);
  process.exit(0);
}

const log = new RuntimeLog();
console.log("EFSS runtime log:", log.path);
const supervisor = new RuntimeSupervisor({ logger: log, onStatus: event => {
  const prefix = "[" + new Date().toISOString() + "]";
  if (event.stage === "stdout" || event.stage === "stderr") {
    (event.stage === "stderr" ? process.stderr : process.stdout).write(event.output);
  } else console.log(prefix, event.action, event.state,
    event.errorCode || event.exitCode || "");
}});
let interrupted = false;
process.on("SIGINT", () => {
  interrupted = true;
  void supervisor.stopActive().then(stopped => {
    if (!stopped) process.exitCode = 130;
  });
});

try {
  if (action === "scan") {
    const config = parameter && parameter !== "--components"
      ? parameter : "config/model-paths.local.json";
    const withComponents = parameter === "--components" || context === "--components";
    if (context && context !== "--components") throw new Error("INVALID_SCAN_OPTION");
    const manifest = await readComfyPathManifest(config);
    await log.write({ event: "scan-start", stage: "inventory",
      action: "scan", state: "running" });
    const result = await discoverConfiguredModels(manifest, { includeComponents: withComponents });
    console.table(result.models.map(item => ({
      model: item.name, category: item.sourceCategory, root: item.rootId,
      GiB: item.sizeGiB, role: item.role, budget: estimateFit(item).status
    })));
    if (withComponents) {
      console.log("Ancillary components (NOT standalone models):");
      console.table(result.components.map(item => ({
        component: item.name, category: item.sourceCategory, root: item.rootId,
        GiB: item.sizeGiB
      })));
    }
    if (result.diagnostics.length) {
      console.warn("Directory warnings:", result.diagnostics);
      process.exitCode = 2;
    }
    console.log("Primary models:", result.models.length,
      "components:", result.components.length,
      "configured categories scanned:", result.inspectedCategories);
    await log.write({ event: "scan-complete", stage: "inventory",
      action: "scan", state: result.diagnostics.length ? "warning" : "completed",
      bytes: result.models.length, code: result.diagnostics.length ?
        "MODEL_DIRECTORIES_INACCESSIBLE" : null });
  } else if (action === "status") {
    const loaded = await supervisor.execute("running");
    const gpu = await supervisor.execute("gpu");
    if (!loaded.ok || !gpu.ok) process.exitCode = 1;
  } else {
    const options = { model: parameter,
      contextLength: context ? Number(context) : 4096 };
    const result = await supervisor.execute(action, options);
    if (!result.ok) {
      console.error("Runtime error:", result.errorCode,
        "exit:", result.exitCode, "\nInspect:", log.path);
      process.exitCode = interrupted ? 130 : 1;
    }
  }
} catch (error) {
  await log.error({ stage: "cli", action, error }).catch(() => {});
  console.error("EFSS runtime:", error.code || error.message, "\nLog:", log.path);
  process.exitCode = interrupted ? 130 : 1;
}

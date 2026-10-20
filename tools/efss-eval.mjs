#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { OpenAICompatibleProvider } from "../src/model-provider.js";
import { RuntimeLog } from "../src/runtime-log.js";
import { runModelEvaluation } from "../src/model-evaluator.js";

const [file, model] = process.argv.slice(2);
if (!file || !model) {
  console.log("Usage: node tools/efss-eval.mjs <suite.json> <loaded-model-id>");
  console.log("Uses local LM Studio compatible /v1 chat server. No prompts or answers are logged.");
  process.exit(0);
}
const logger = new RuntimeLog();
const cancel = new AbortController();
process.on("SIGINT", () => cancel.abort());
try {
  const suite = JSON.parse(await readFile(file, "utf8"));
  const provider = new OpenAICompatibleProvider({
    onEvent: event => {
      void logger.write({ level: event.state === "failed" ? "error" : "debug",
        event: event.event, stage: event.stage, state: event.state,
        action: event.route, model: event.model,
        elapsedMs: event.elapsedMs, code: event.code
      }).catch(() => {});
    }
  });
  const result = await runModelEvaluation({
    suite, model, provider, logger, signal: cancel.signal,
    onProgress: step => console.log("[" + step.completed + "/" + step.total +
      "]", step.caseId, step.passed ? "PASS" : "FAIL")
  });
  console.log("Result:", result.passed + "/" + result.total,
    "pass rate:", result.passRate, "elapsed ms:", result.elapsedMs);
  console.log("Local debug log:", logger.path);
  if (result.failed) process.exitCode = 2;
} catch (error) {
  await logger.error({ stage: "evaluation", action: "suite", error }).catch(() => {});
  console.error("Evaluation failed:", error.code || error.message);
  console.error("Local debug log:", logger.path);
  process.exitCode = 1;
}

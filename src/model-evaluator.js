import { OpenAICompatibleProvider } from "./model-provider.js";

const CASE = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

export function validateEvaluationSuite(suite) {
  if (!suite || typeof suite !== "object" || Array.isArray(suite) ||
      typeof suite.name !== "string" || !suite.name.trim() || suite.name.length > 120 ||
      !Array.isArray(suite.cases) || !suite.cases.length || suite.cases.length > 200) {
    throw new TypeError("Invalid evaluation suite");
  }
  const ids = new Set();
  for (const item of suite.cases) {
    if (!item || typeof item !== "object" || !CASE.test(item.id ?? "") ||
        ids.has(item.id) || typeof item.prompt !== "string" || !item.prompt.trim() ||
        item.prompt.length > 12000 || !Array.isArray(item.mustContain) ||
        !item.mustContain.length || item.mustContain.length > 20 ||
        item.mustContain.some(term => typeof term !== "string" ||
          !term.trim() || term.length > 250)) throw new TypeError("Invalid evaluation case");
    ids.add(item.id);
  }
  return suite;
}

export async function runModelEvaluation({ suite, model, provider,
  logger = null, onProgress = null, temperature = 0, maxTokens = 800,
  signal } = {}) {
  validateEvaluationSuite(suite);
  if (!(provider instanceof OpenAICompatibleProvider) ||
      typeof model !== "string" || !model.trim() ||
      (logger !== null && typeof logger.write !== "function") ||
      (onProgress !== null && typeof onProgress !== "function")) {
    throw new TypeError("Invalid evaluation configuration");
  }
  const results = [];
  const begun = Date.now();
  await logger?.write({ event: "eval-start", stage: "evaluation", action: "benchmark",
    state: "running", model });
  for (const [index, item] of suite.cases.entries()) {
    if (signal?.aborted) {
      await logger?.write({ level: "warn", event: "eval-stopped", stage: "evaluation",
        action: "benchmark", state: "cancelled", model });
      throw new Error("EVALUATION_CANCELLED");
    }
    await logger?.write({ event: "eval-case-start", stage: "evaluation",
      action: item.id, state: "running", model });
    const started = Date.now();
    try {
      const output = await provider.chat({ model, messages: [
        { role: "user", content: item.prompt }
      ], temperature, maxTokens, signal });
      const response = output.content.toLocaleLowerCase("tr-TR");
      const matches = item.mustContain.map(term =>
        response.includes(term.toLocaleLowerCase("tr-TR")));
      const passed = matches.every(Boolean);
      const evaluation = { id: item.id, passed, score: matches.filter(Boolean).length / matches.length,
        elapsedMs: Date.now() - started, totalTokens: output.usage?.total_tokens ?? null };
      results.push(evaluation);
      await logger?.write({ level: passed ? "info" : "warn",
        event: "eval-case-finished", stage: "evaluation", action: item.id,
        state: passed ? "passed" : "failed",
        code: passed ? null : "EVAL_EXPECTATION_MISMATCH",
        elapsedMs: evaluation.elapsedMs });
      onProgress?.({ completed: index + 1, total: suite.cases.length,
        caseId: item.id, passed });
    } catch (error) {
      await logger?.write({ level: "error", event: "eval-case-failed",
        stage: "evaluation", action: item.id, state: "error",
        code: error?.code || "EVAL_PROVIDER_ERROR", kind: error?.name ?? "Error" });
      throw error;
    }
  }
  const passed = results.filter(item => item.passed).length;
  const summary = { suite: suite.name, model, total: results.length,
    passed, failed: results.length - passed,
    passRate: Number((passed / results.length).toFixed(4)),
    elapsedMs: Date.now() - begun, results };
  await logger?.write({ event: "eval-complete", stage: "evaluation",
    action: "benchmark", state: summary.failed ? "failed" : "completed",
    model, elapsedMs: summary.elapsedMs, code: summary.failed ? "EVAL_FAILED" : null });
  return summary;
}

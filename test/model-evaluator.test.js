import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenAICompatibleProvider } from "../src/model-provider.js";
import { RuntimeLog } from "../src/runtime-log.js";
import { validateEvaluationSuite, runModelEvaluation } from "../src/model-evaluator.js";

const suite = { name: "baseline", cases: [
  { id: "caseA", prompt: "What is one plus one?", mustContain: ["2"] },
  { id: "caseB", prompt: "Name a color.", mustContain: ["blue"] }
] };

test("evaluation suites require distinct cases and measurable expectations", () => {
  assert.equal(validateEvaluationSuite(suite).cases.length, 2);
  assert.throws(() => validateEvaluationSuite({ ...suite, cases: [
    suite.cases[0], suite.cases[0]
  ] }));
  assert.throws(() => validateEvaluationSuite({ ...suite,
    cases: [{ id: "caseA", prompt: "", mustContain: ["2"] }] }));
});

test("real provider interface is used with fake inference and no prompt logging", async () => {
  const dir = await mkdtemp(join(tmpdir(), "efss-eval-"));
  try {
    const logger = new RuntimeLog({ file: join(dir, "results.jsonl") });
    const requests = [];
    const provider = new OpenAICompatibleProvider({
      fetchImpl: async (_url, options) => {
        const payload = JSON.parse(options.body);
        requests.push(payload);
        const text = payload.messages[0].content;
        return Response.json({ choices: [{ message: {
          content: text.includes("plus") ? "The answer is 2." : "Green is one color."
        } }], usage: { total_tokens: 20 } });
      }
    });
    const progress = [];
    const result = await runModelEvaluation({
      suite, model: "strong-local", provider, logger,
      onProgress: x => progress.push(x)
    });
    assert.equal(result.total, 2);
    assert.equal(result.passed, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.passRate, 0.5);
    assert.equal(progress.length, 2);
    assert.equal(requests.length, 2);
    const log = await readFile(logger.path, "utf8");
    assert.match(log, /EVAL_EXPECTATION_MISMATCH/);
    assert.ok(!log.includes("What is one plus one?"));
    assert.ok(!log.includes("The answer is 2."));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("pre-cancelled evaluation does not call any model", async () => {
  let called = false;
  const provider = new OpenAICompatibleProvider({
    fetchImpl: async () => { called = true; return Response.json({}); }
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runModelEvaluation({
    suite, model: "strong-local", provider, signal: controller.signal
  }), /EVALUATION_CANCELLED/);
  assert.equal(called, false);
});

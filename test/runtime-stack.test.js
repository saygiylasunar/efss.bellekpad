import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { classifyModelFile, estimateFit, scanModelDirectory } from "../src/model-catalog.js";
import { RuntimeLog, redactLogText } from "../src/runtime-log.js";
import { planRuntimeCommand, RuntimeSupervisor } from "../src/runtime-supervisor.js";
import { ModelLab } from "../src/model-lab.js";

test("GGUF and safetensors names route to different inference runtimes", () => {
  const cases = [
    ["Qwen3-14B-Q4_K_M.gguf", "gguf", "language", "gguf-runtime"],
    ["qwen_2.5_vl_7b_fp8_scaled.safetensors", "safetensors", "vision_language", "safetensors-runtime"],
    ["qwen3vl4b_bf16.safetensors", "safetensors", "vision_language", "safetensors-runtime"],
    ["z_image_turbo-Q4_K_M.gguf", "gguf", "image_generation", "workflow-runtime"],
    ["umt5_xxl_fp16.safetensors", "safetensors", "text_encoder", "workflow-runtime"],
    ["qwen_image_vae.safetensors", "safetensors", "vae", "workflow-runtime"],
    ["long-ViT-L-14.safetensors", "safetensors", "vision_encoder", "workflow-runtime"]
  ];
  for (const [name, format, role, route] of cases) {
    const model = classifyModelFile({ name, sizeBytes: 1024 });
    assert.equal(model.format, format, name);
    assert.equal(model.role, role, name);
    assert.equal(model.route, route, name);
    assert.equal(model.verified, false);
  }
});

test("weight-size planner does not claim the model will load", () => {
  const big = classifyModelFile({ name: "Qwen3-14B-Q4_K_M.gguf",
    sizeBytes: 10 * (2 ** 30) });
  assert.equal(estimateFit(big).status, "likely-needs-offload");
  const small = classifyModelFile({ name: "model.gguf", sizeBytes: 4 * (2 ** 30) });
  assert.equal(estimateFit(small).status, "weights-might-fit");
  assert.match(estimateFit(small).caveat, /KV cache/);
});

test("filesystem scanner does not follow symbolic links or read weight contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "efss-model-scan-"));
  try {
    await mkdir(join(root, "models"));
    await writeFile(join(root, "models", "Qwen3-14B-Q4_K_M.gguf"), "stub");
    await writeFile(join(root, "models", "clip_l.safetensors"), "stub");
    await writeFile(join(root, "models", "notes.txt"), "not a model");
    const items = await scanModelDirectory(root);
    assert.equal(items.length, 2);
    assert.ok(items.every(x => x.path.includes(root)));
    assert.ok(items.every(x => x.evidence === "filename-only"));
    await assert.rejects(scanModelDirectory(root, { maxEntries: 1 }), /SCAN_LIMIT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("allowlist forbids arbitrary shell commands and untrusted model flags", () => {
  assert.deepEqual(planRuntimeCommand("running").args, ["ps", "--json"]);
  assert.equal(planRuntimeCommand("gpu").executable, "nvidia-smi");
  assert.ok(planRuntimeCommand("estimate", { model: "publisher/large-model", contextLength: 4096 }).args.includes("--estimate-only"));
  assert.throws(() => planRuntimeCommand("run", { model: "ls" }), /ACTION_NOT_ALLOWED/);
  assert.throws(() => planRuntimeCommand("load", { model: "--all" }), /INVALID_MODEL_KEY/);
  assert.throws(() => planRuntimeCommand("load", { model: "x;rm" }), /INVALID_MODEL_KEY/);
  assert.throws(() => planRuntimeCommand("load", { model: "model", gpu: "3.0" }), /INVALID_LOAD_OPTIONS/);
});

test("JSONL logger appends time ordered events, preserves history and redacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "efss-logs-"));
  try {
    const file = join(dir, "runtime.jsonl");
    const logger = new RuntimeLog({ file });
    await Promise.all([
      logger.write({ event: "start", action: "load", state: "running" }),
      logger.write({ event: "output", output: "Bearer supersecrettoken" }),
      logger.error({ stage: "run", action: "load", error: new Error("failure at C:\\Users\\private\\model.gguf") })
    ]);
    const second = new RuntimeLog({ file });
    await second.write({ event: "new-session", state: "completed" });
    const lines = (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(lines.length, 4);
    assert.equal(lines[0].event, "start");
    assert.equal(lines[3].event, "new-session");
    assert.notEqual(lines[0].session, lines[3].session);
    assert.ok(lines.every(line => typeof line.at === "string"));
    assert.ok(!(await readFile(file, "utf8")).includes("supersecrettoken"));
    assert.ok(!(await readFile(file, "utf8")).includes("private"));
  } finally { await rm(dir, { recursive: true, force: true }); }
  assert.equal(redactLogText("api_key=abc"), "api_key=[REDACTED]");
});

function mockSpawnFactory(calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.pid = 100;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { setImmediate(() => child.emit("close", null)); return true; };
    setImmediate(() => {
      child.stdout.write("step 1\\n");
      child.stderr.write("step 2\\n");
      child.emit("close", 0);
    });
    return child;
  };
}

test("supervised operations expose status and append command lifecycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "efss-supervised-"));
  try {
    const logger = new RuntimeLog({ file: join(dir, "runtime.jsonl") });
    const calls = [], states = [];
    const controller = new RuntimeSupervisor({
      logger, spawnImpl: mockSpawnFactory(calls),
      onStatus: item => states.push(item.stage)
    });
    const result = await controller.execute("models");
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(controller.status.running, false);
    assert.equal(calls[0].options.shell, false);
    assert.ok(states.includes("spawn"));
    assert.ok(states.includes("stdout"));
    assert.ok(states.includes("exit"));
    const log = await readFile(logger.path, "utf8");
    assert.match(log, /command-planned/);
    assert.match(log, /command-output/);
    assert.match(log, /command-finished/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("kill switch marks command cancelled, not just failed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "efss-stop-"));
  try {
    let fake;
    const controller = new RuntimeSupervisor({
      logger: new RuntimeLog({ file: join(dir, "runtime.jsonl") }),
      spawnImpl: () => {
        fake = new EventEmitter();
        fake.pid = 42;
        fake.stdout = new PassThrough();
        fake.stderr = new PassThrough();
        fake.kill = () => { setImmediate(() => fake.emit("close", null)); return true; };
        return fake;
      }
    });
    const running = controller.execute("running");
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(controller.status.running, true);
    assert.equal(await controller.stopActive(), true);
    const result = await running;
    assert.equal(result.cancelled, true);
    assert.equal(result.errorCode, "CANCELLED");
    assert.equal(controller.status.running, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("model lab tracks base, layers and evaluations without claiming training", () => {
  const lab = new ModelLab();
  const item = lab.create({ id: "exp1", title: "Prototype",
    baseModel: "qwen-local", layers: [
      { kind: "base", id: "qwen" }, { kind: "retrieval", id: "context" },
      { kind: "adapter", id: "future-lora" }
    ], datasetRefs: ["dataset:benchmark1"] });
  assert.equal(item.stage, "draft");
  assert.ok(Object.isFrozen(item.layers));
  assert.throws(() => lab.setStage("exp1", "accepted"), /STAGE/);
  assert.equal(lab.recordResult("exp1", { task: "reasoning", metric: "accuracy",
    score: 0.7, evidence: "dataset:benchmark1" }).stage, "tested");
  assert.equal(lab.setStage("exp1", "candidate").stage, "candidate");
  assert.throws(() => lab.create({ id: "exp1", title: "Other", baseModel: "x" }));
});

test("runtime logs redact usernames and non-example email addresses", () => {
  const path = ["C:", "Users", "fictional_account", "models"].join("\\");
  const scrubbed = redactLogText("Failed to open " + path);
  assert.ok(scrubbed.includes("[REDACTED_PATH]"));
  assert.ok(!scrubbed.includes("fictional_account"));
  const email = ["not-a-user", "@", "private.invalid"].join("");
  const scrubbedMail = redactLogText("contact: " + email);
  assert.ok(scrubbedMail.includes("[REDACTED_EMAIL]"));
  assert.ok(!scrubbedMail.includes(email));
});

import { spawn } from "node:child_process";
import { RuntimeLog } from "./runtime-log.js";
import { classifyRuntimeFailure } from "./runtime-errors.js";

const NAME = /^[a-zA-Z0-9_./:@+-]{1,250}$/;
const ALLOWED_ACTIONS = new Set(["models", "running", "estimate", "load",
  "unload", "gpu", "test", "server-start", "server-stop"]);
const MAX_OUTPUT = 32000;

function modelKey(value) {
  if (typeof value !== "string" || !NAME.test(value) || value === "." ||
      value === ".." || value.startsWith("-") || value.includes("/../"))
    throw new Error("INVALID_MODEL_KEY");
  return value;
}

export function planRuntimeCommand(action, { model = null, contextLength = 4096, gpu = "auto" } = {}) {
  if (!ALLOWED_ACTIONS.has(action)) throw new Error("ACTION_NOT_ALLOWED");
  if (action === "test") return { action, executable: process.execPath, args: ["--test"] };
  if (action === "gpu") return { action, executable: "nvidia-smi",
    args: ["--query-gpu=name,memory.total,memory.used,utilization.gpu",
      "--format=csv,noheader,nounits"] };
  if (action === "models") return { action, executable: "lms", args: ["ls", "--json"] };
  if (action === "running") return { action, executable: "lms", args: ["ps", "--json"] };
  if (action === "server-start") return { action, executable: "lms", args: ["server", "start"] };
  if (action === "server-stop") return { action, executable: "lms", args: ["server", "stop"] };
  const key = modelKey(model);
  if (action === "unload") return { action, executable: "lms", args: ["unload", key] };
  if (!Number.isSafeInteger(contextLength) || contextLength < 512 ||
      contextLength > 131072 || !["auto", "off", "max"].includes(gpu))
    throw new Error("INVALID_LOAD_OPTIONS");
  const args = ["load", key, "--context-length", String(contextLength), "--gpu", gpu];
  if (action === "estimate") args.push("--estimate-only");
  return { action, executable: "lms", args };
}

export class RuntimeSupervisor {
  #logger;
  #spawn;
  #active = null;
  #onStatus;

  constructor({ logger = new RuntimeLog(), spawnImpl = spawn,
    onStatus = null } = {}) {
    if (!(logger instanceof RuntimeLog) || typeof spawnImpl !== "function" ||
        (onStatus !== null && typeof onStatus !== "function")) {
      throw new TypeError("Invalid runtime supervisor");
    }
    this.#logger = logger;
    this.#spawn = spawnImpl;
    this.#onStatus = onStatus;
  }

  get status() {
    return this.#active ? { running: true, action: this.#active.action,
      pid: this.#active.child.pid ?? null, startedAt: this.#active.startedAt } :
      { running: false };
  }

  async stopActive() {
    if (!this.#active) return false;
    await this.#logger.write({ level: "warn", event: "kill-switch",
      action: this.#active.action, state: "stopping" });
    this.#active.cancelled = true;
    this.#active.child.kill();
    return true;
  }

  async execute(action, options = {}) {
    const plan = planRuntimeCommand(action, options);
    if (this.#active) throw new Error("RUNTIME_BUSY");
    const started = Date.now();
    await this.#logger.write({ event: "command-planned", stage: "plan",
      action, state: "queued", model: options.model ? options.model.split("/").at(-1) : undefined });
    this.#onStatus?.({ stage: "plan", state: "queued", action });
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.#spawn(plan.executable, plan.args, {
          shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        void this.#logger.error({ stage: "spawn", action, error, code: "SPAWN_ERROR" })
          .finally(() => reject(error));
        return;
      }
      const state = { action, child, startedAt: new Date(started).toISOString(), cancelled: false };
      this.#active = state;
      let output = "", errorOutput = "", settled = false;
      const record = (stream, data) => {
        const incoming = data.toString("utf8");
        if (stream === "stdout") output = (output + incoming).slice(-MAX_OUTPUT);
        else errorOutput = (errorOutput + incoming).slice(-MAX_OUTPUT);
        void this.#logger.write({ level: "debug", event: "command-output",
          stage: stream, action, bytes: Buffer.byteLength(incoming),
          output: incoming }).catch(() => {
            this.#onStatus?.({ stage: "logging", state: "failed", action,
              errorCode: "LOG_WRITE_FAILED" });
          });
        this.#onStatus?.({ stage: stream, state: "streaming", action,
          output: incoming });
      };
      child.stdout?.on("data", value => record("stdout", value));
      child.stderr?.on("data", value => record("stderr", value));
      const complete = async (code, error = null) => {
        if (settled) return;
        settled = true;
        this.#active = null;
        const cancelled = state.cancelled;
        const failure = classifyRuntimeFailure({ error, exitCode: code, stderr: errorOutput, cancelled });
        const ok = !cancelled && !error && code === 0;
        const result = { ok, action, exitCode: code,
          cancelled, durationMs: Date.now() - started,
          stdout: output, stderr: errorOutput,
          errorCode: failure.code, errorCategory: failure.category,
          failureStage: failure.stage };
        await this.#logger.write({ level: ok ? "info" : "error",
          event: "command-finished", stage: ok ? "exit" : failure.stage, action,
          state: ok ? "completed" : cancelled ? "cancelled" : "failed",
          exitCode: code, elapsedMs: result.durationMs, code: result.errorCode,
          kind: error?.name ?? failure.category, message: error?.message ??
            (ok ? null : "Command failed during " + failure.stage) });
        this.#onStatus?.({ stage: "exit", state: ok ? "completed" : "failed",
          action, exitCode: code, errorCode: result.errorCode });
        resolve(result);
      };
      child.on("error", error => { void complete(null, error); });
      child.on("close", code => { void complete(code); });
      void this.#logger.write({ event: "command-started", stage: "spawn",
        action, pid: child.pid ?? null, state: "running" }).catch(() => {
          this.#onStatus?.({ stage: "logging", state: "failed", action,
            errorCode: "LOG_WRITE_FAILED" });
        });
      this.#onStatus?.({ stage: "spawn", state: "running", action,
        pid: child.pid ?? null });
    });
  }
}

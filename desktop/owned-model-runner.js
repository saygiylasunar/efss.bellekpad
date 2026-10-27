// Owned GGUF runner. Only the Electron main process creates this service.
// The renderer cannot provide paths, commands, args, ports or environment.
// User explicitly selects a llama-server executable and one GGUF via native dialogs.
import { lstat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

export const OWNED_MODEL_PORT = 12883;
export const OWNED_MODEL_URL = "http://127.0.0.1:" + OWNED_MODEL_PORT + "/v1";
const ALIAS = "bellekpad-local";
const READY_TIMEOUT_MS = 90000;
const CHECK_MS = 250;

function safeName(name) {
  return typeof name === "string" && name.length > 0 && name.length < 300 &&
    !/[\r\n\0]/.test(name);
}

export function createOwnedModelRunner({
  spawnImpl = spawn, fetchImpl = globalThis.fetch,
  platform = process.platform, now = () => Date.now(),
  delay = ms => new Promise(done => setTimeout(done, ms)),
  tokenImpl = () => randomBytes(24).toString("hex")
} = {}) {
  let executable = null, model = null, child = null, secret = null;
  let phase = "idle", exitSeen = false, generation = 0, lastFailure = null;
  const result = () => Object.freeze({
    phase,
    engine: executable ? basename(executable) : null,
    model: model ? basename(model) : null,
    ready: phase === "ready",
    failure: lastFailure
  });
  async function choose(kind, path) {
    if (phase === "starting" || phase === "ready" || phase === "stopping")
      throw new Error("MODEL_RUNNER_BUSY");
    if (!["engine","model"].includes(kind) || !safeName(path))
      throw new Error("MODEL_RUNNER_INVALID_PATH");
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink())
      throw new Error("MODEL_RUNNER_INVALID_FILE");
    if (kind === "engine" &&
        basename(path).toLowerCase() !== (platform === "win32" ?
          "llama-server.exe" : "llama-server"))
      throw new Error("MODEL_RUNNER_BAD_ENGINE");
    if (kind === "model" && extname(path).toLowerCase() !== ".gguf")
      throw new Error("MODEL_RUNNER_BAD_MODEL");
    if (kind === "engine") executable = path;
    else model = path;
    phase = "idle";
    lastFailure = null;
    return result();
  }
  async function probe(auth) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      timer.unref?.();
      try {
        const response = await fetchImpl(OWNED_MODEL_URL + "/models", {
          method:"GET", redirect:"error",
          headers:{Authorization:"Bearer " + auth},
          signal:controller.signal
        });
        if (!response?.ok) return false;
        const data = await response.json();
        return Array.isArray(data?.data) && data.data.some(entry=>entry?.id===ALIAS);
      } finally { clearTimeout(timer); }
    } catch { return false; }
  }
  async function start() {
    if (!executable || !model) throw new Error("MODEL_RUNNER_NOT_CONFIGURED");
    if (phase !== "idle" && phase !== "error")
      throw new Error("MODEL_RUNNER_BUSY");
    // Validate again: the selected files may have been replaced since selection.
    const [e,m] = await Promise.all([lstat(executable),lstat(model)])
      .catch(() => { throw new Error("MODEL_RUNNER_INVALID_FILE"); });
    if (!e.isFile() || e.isSymbolicLink() || !m.isFile() || m.isSymbolicLink())
      throw new Error("MODEL_RUNNER_INVALID_FILE");
    const key = tokenImpl();
    if (!/^[0-9a-f]{48}$/.test(key)) throw new Error("MODEL_RUNNER_INTERNAL");
    const invocation = [
      "--model",model,"--host","127.0.0.1",
      "--port",String(OWNED_MODEL_PORT),"--ctx-size","4096",
      "--n-gpu-layers","auto","--alias",ALIAS,
      "--api-key",key,"--no-webui"
    ];
    let proc;
    try {
      proc = spawnImpl(executable, invocation, {
        shell:false,windowsHide:true,stdio:"ignore"
      });
    } catch {
      phase="error";lastFailure="MODEL_RUNNER_START_FAILED";
      throw new Error(lastFailure);
    }
    if (!proc || typeof proc.on !== "function" || typeof proc.kill !== "function") {
      phase="error";lastFailure="MODEL_RUNNER_START_FAILED";
      throw new Error(lastFailure);
    }
    child = proc; secret = key; phase = "starting"; exitSeen = false;
    lastFailure = null;
    const current = ++generation;
    proc.on("error", () => {
      if (generation === current) {
        exitSeen = true;
        if(phase!=="stopping"){phase="error";lastFailure="MODEL_RUNNER_START_FAILED";}
      }
    });
    proc.on("exit", () => {
      if (generation === current) {
        exitSeen = true;
        if(phase!=="stopping"){phase="error";lastFailure="MODEL_RUNNER_EXITED";}
        child=null;secret=null;
      }
    });
    const deadline=now()+READY_TIMEOUT_MS;
    while (now()<deadline && phase==="starting" && !exitSeen) {
      if (await probe(key) && phase==="starting" && generation===current) {
        phase="ready";
        return Object.freeze({ ...result(),endpoint:OWNED_MODEL_URL,apiKey:key });
      }
      await delay(CHECK_MS);
    }
    if (generation !== current || phase==="stopping")
      throw new Error("MODEL_RUNNER_CANCELLED");
    if (child) child.kill();
    child=null;secret=null;
    const code = exitSeen ? lastFailure ?? "MODEL_RUNNER_EXITED" : "MODEL_RUNNER_TIMEOUT";
    phase="error";lastFailure=code;
    throw new Error(code);
  }
  function stop() {
    ++generation;
    const previous=child;
    phase="idle";exitSeen=true;secret=null;child=null;lastFailure=null;
    if(previous && previous.exitCode===null) {
      try{previous.kill();}catch{/* Already exited. */}
    }
    return result();
  }
  return Object.freeze({choose,start,stop,status:result});
}

const RULES = Object.freeze([
  ["CUDA_OUT_OF_MEMORY", /(?:cuda|gpu|device)[^\n]{0,100}out of memory|out of memory[^\n]{0,100}(?:cuda|gpu|vram)/i],
  ["MODEL_NOT_FOUND", /model[^\n]{0,80}(?:not found|does not exist|not installed)/i],
  ["PORT_IN_USE", /eaddrinuse|address already in use|port[^\n]{0,20}in use/i],
  ["DEVICE_UNAVAILABLE", /cuda.*not available|no cuda device|no compatible gpu|cuda driver version/i],
  ["FORMAT_UNSUPPORTED", /unsupported[^\n]{0,45}(?:architecture|model|format|tensor)|unknown model architecture/i],
  ["PERMISSION_DENIED", /eacces|permission denied|access is denied/i]
]);

export function classifyRuntimeFailure({ error = null, exitCode = null,
  stderr = "", cancelled = false } = {}) {
  if (cancelled) return { code: "CANCELLED", category: "control", stage: "termination" };
  if (error?.code === "ENOENT") return {
    code: "EXECUTABLE_NOT_FOUND", category: "environment", stage: "spawn"
  };
  if (error?.code === "ETIMEDOUT" || error?.name === "AbortError") return {
    code: "TIMEOUT", category: "environment", stage: "execution"
  };
  const text = String(stderr).slice(-16000);
  for (const [code, pattern] of RULES) {
    if (pattern.test(text) || pattern.test(String(error?.message ?? ""))) {
      return { code, category: ["CUDA_OUT_OF_MEMORY", "DEVICE_UNAVAILABLE"].includes(code) ?
        "hardware" : "runtime", stage: "execution" };
    }
  }
  if (error) return { code: "PROCESS_ERROR", category: "runtime", stage: "spawn" };
  if (exitCode !== null && exitCode !== 0) return {
    code: "COMMAND_EXIT_NONZERO", category: "runtime", stage: "execution"
  };
  return { code: null, category: "none", stage: "completed" };
}

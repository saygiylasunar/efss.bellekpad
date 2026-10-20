const UUID = /^[a-zA-Z0-9_-]{6,100}$/;

function validWorkflow(workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return false;
  const nodes = Object.values(workflow);
  return nodes.length > 0 && nodes.length <= 256 && nodes.every(node =>
    node && typeof node === "object" && typeof node.class_type === "string" &&
    node.class_type.length <= 160 && node.inputs &&
    typeof node.inputs === "object" && !Array.isArray(node.inputs));
}

export class ComfyWorkflowProvider {
  #base;
  #fetch;
  #timeoutMs;

  constructor({ baseURL = "http://127.0.0.1:8188", fetchImpl = globalThis.fetch,
    timeoutMs = 120000 } = {}) {
    let url;
    try { url = new URL(baseURL); } catch { throw new TypeError("Invalid ComfyUI URL"); }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        !["http:", "https:"].includes(url.protocol) || url.username ||
        url.password || url.search || url.hash || !["/", ""].includes(url.pathname) ||
        typeof fetchImpl !== "function" ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 100) {
      throw new TypeError("ComfyUI must be local");
    }
    this.#base = url.toString();
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async #send(path, { body, signal } = {}) {
    if (signal?.aborted) throw new Error("CANCELLED");
    const abortController = new AbortController();
    const cancel = () => abortController.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, this.#timeoutMs);
    timer.unref?.();
    try {
      const response = await this.#fetch(new URL(path, this.#base), {
        method: body ? "POST" : "GET", redirect: "error",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: abortController.signal
      });
      if (!response.ok) {
        const error = new Error("COMFY_HTTP_ERROR");
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  async queueWorkflow({ workflow, signal } = {}) {
    if (!validWorkflow(workflow)) throw new TypeError("Invalid ComfyUI workflow");
    const encoded = JSON.stringify(workflow);
    if (encoded.length > 4 * 1024 * 1024) throw new Error("WORKFLOW_TOO_LARGE");
    const result = await this.#send("prompt", { body: { prompt: workflow }, signal });
    if (typeof result?.prompt_id !== "string" || !UUID.test(result.prompt_id))
      throw new Error("BAD_COMFY_RESPONSE");
    return { jobId: result.prompt_id, position: result.number ?? null, state: "queued" };
  }

  async history({ jobId, signal } = {}) {
    if (typeof jobId !== "string" || !UUID.test(jobId)) throw new TypeError("Invalid ComfyUI job ID");
    const data = await this.#send("history/" + encodeURIComponent(jobId), { signal });
    return { jobId, found: Object.hasOwn(data, jobId), result: data[jobId] ?? null };
  }
}

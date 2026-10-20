const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_TEXT = 200000;
const MAX_RESPONSE = 12 * 1024 * 1024;

export class ProviderError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

function endpoint(baseURL, allowRemote, apiKey) {
  let parsed;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new ProviderError("BAD_URL");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash ||
      !["http:", "https:"].includes(parsed.protocol) ||
      !["", "/", "/v1", "/v1/"].includes(parsed.pathname)) {
    throw new ProviderError("BAD_URL");
  }
  const local = LOOPBACK_HOSTS.has(parsed.hostname);
  if (!local && (parsed.protocol !== "https:" || allowRemote !== true || !apiKey)) {
    throw new ProviderError("REMOTE_DISABLED");
  }
  if (!local && (parsed.hostname.endsWith(".local") || parsed.hostname.endsWith(".localhost"))) {
    throw new ProviderError("REMOTE_DISABLED");
  }
  parsed.pathname = "/v1/";
  return parsed.toString();
}

function validModel(model) {
  if (typeof model !== "string" || !model.trim() || model.length > 250 ||
      /[\r\n\x00-\x1f]/.test(model)) throw new ProviderError("BAD_MODEL");
  return model;
}

function validInput(text) {
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) {
    throw new ProviderError("BAD_INPUT");
  }
  return text;
}

function checkVectors(result, count) {
  if (!result || !Array.isArray(result.data) || result.data.length !== count) {
    throw new ProviderError("BAD_EMBEDDING_RESPONSE");
  }
  const indexed = result.data.map((item, position) => ({
    index: item.index ?? position,
    vector: item.embedding
  })).sort((a, b) => a.index - b.index);
  if (indexed.some((item, index) => item.index !== index ||
      !Array.isArray(item.vector) || item.vector.length === 0 ||
      item.vector.length > 16384 ||
      item.vector.some(n => typeof n !== "number" || !Number.isFinite(n)))) {
    throw new ProviderError("BAD_EMBEDDING_RESPONSE");
  }
  const dimension = indexed[0].vector.length;
  if (indexed.some(item => item.vector.length !== dimension)) {
    throw new ProviderError("BAD_EMBEDDING_RESPONSE");
  }
  return indexed.map(x => x.vector);
}

export class OpenAICompatibleProvider {
  #base;
  #apiKey;
  #fetch;
  #timeout;

  constructor({ baseURL = "http://127.0.0.1:1234/v1", apiKey = null,
    allowRemote = false, fetchImpl = globalThis.fetch, timeoutMs = 90000 } = {}) {
    if (typeof fetchImpl !== "function" || !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 100 || timeoutMs > 600000) throw new ProviderError("BAD_CONFIGURATION");
    if (apiKey !== null && (typeof apiKey !== "string" || !apiKey.trim())) {
      throw new ProviderError("BAD_CONFIGURATION");
    }
    this.#base = endpoint(baseURL, allowRemote, apiKey);
    this.#apiKey = apiKey;
    this.#fetch = fetchImpl;
    this.#timeout = timeoutMs;
  }

  get kind() { return "openai-compatible"; }
  get scope() { return LOOPBACK_HOSTS.has(new URL(this.#base).hostname) ? "loopback" : "remote"; }

  async #request(method, path, payload = null, signal = undefined) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw new ProviderError("CANCELLED");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.#timeout);
    timer.unref?.();
    try {
      const headers = { Accept: "application/json" };
      if (payload !== null) headers["Content-Type"] = "application/json";
      if (this.#apiKey) headers.Authorization = "Bearer " + this.#apiKey;
      const response = await this.#fetch(new URL(path, this.#base).toString(), {
        method, headers, body: payload === null ? undefined : JSON.stringify(payload),
        signal: controller.signal, redirect: "error"
      });
      if (!response || typeof response.ok !== "boolean" || typeof response.json !== "function") {
        throw new ProviderError("BAD_RESPONSE");
      }
      if (!response.ok) throw new ProviderError("PROVIDER_HTTP_ERROR", response.status ?? null);
      const size = Number(response.headers?.get?.("content-length") ?? 0);
      if (Number.isFinite(size) && size > MAX_RESPONSE) throw new ProviderError("RESPONSE_TOO_LARGE");
      const data = await response.json();
      if (!data || typeof data !== "object") throw new ProviderError("BAD_RESPONSE");
      return data;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (controller.signal.aborted) {
        throw new ProviderError(signal?.aborted ? "CANCELLED" : "TIMEOUT");
      }
      throw new ProviderError("TRANSPORT_ERROR");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async listModels({ signal } = {}) {
    const data = await this.#request("GET", "models", null, signal);
    if (!Array.isArray(data.data)) throw new ProviderError("BAD_MODEL_LIST");
    return data.data.map(item => ({ id: validModel(item.id), ownedBy: String(item.owned_by ?? "") }));
  }

  async embed({ model, input, signal } = {}) {
    validModel(model);
    const items = typeof input === "string" ? [input] : input;
    if (!Array.isArray(items) || items.length < 1 || items.length > 64) {
      throw new ProviderError("BAD_INPUT");
    }
    items.forEach(validInput);
    const result = await this.#request("POST", "embeddings",
      { model, input: items }, signal);
    return { model: result.model || model, vectors: checkVectors(result, items.length) };
  }

  async chat({ model, messages, temperature = 0.2, maxTokens = 1024, signal } = {}) {
    validModel(model);
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 64 ||
        messages.some(message => !message ||
          !["system", "user", "assistant"].includes(message.role) ||
          typeof message.content !== "string" || message.content.length > MAX_TEXT) ||
        typeof temperature !== "number" || !Number.isFinite(temperature) ||
        temperature < 0 || temperature > 2 ||
        !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) {
      throw new ProviderError("BAD_INPUT");
    }
    const result = await this.#request("POST", "chat/completions",
      { model, messages, temperature, max_tokens: maxTokens, stream: false }, signal);
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new ProviderError("BAD_CHAT_RESPONSE");
    return { model: result.model || model, content, usage: result.usage ?? null };
  }
}

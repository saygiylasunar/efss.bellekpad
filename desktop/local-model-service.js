// First desktop AI vertical: explicit discovery of a separately running local server.
// Never enumerate disks, model paths, documents or external URLs. No inference yet.
import { OpenAICompatibleProvider } from "../src/model-provider.js";
import { OWNED_MODEL_URL } from "./owned-model-runner.js";

export const LOCAL_MODEL_ENDPOINT = "http://127.0.0.1:1234/v1";
const MAX_VISIBLE_MODELS = 128;
const MAX_OWNER_LENGTH = 80;
const MAX_PROMPT_LENGTH = 8192;
const MAX_COMPLETION_LENGTH = 16000;
const REQUEST_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function createDesktopModelService({
  fetchImpl = globalThis.fetch, timeoutMs = 4500, chatTimeoutMs = 120000
} = {}) {
  // The provider supplies strict loopback URL validation, redirect rejection,
  // request cancellation and response-shape checking. The main process alone
  // owns the network operation; the sandboxed renderer retains connect-src none.
  let targetURL = LOCAL_MODEL_ENDPOINT, apiKey = null;
  const providerFor = timeout => new OpenAICompatibleProvider({
    baseURL: targetURL, apiKey, fetchImpl, timeoutMs: timeout
  });
  const discovered = new Set();
  const inFlight = new Map();
  return Object.freeze({
    async list() {
      if (inFlight.size) throw new Error("MODEL_BUSY");
      const models = await providerFor(timeoutMs).listModels();
      if (models.length > MAX_VISIBLE_MODELS) throw new Error("MODEL_LIST_TOO_LARGE");
      const seen = new Set();
      const filtered = [];
      for (const item of models) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        filtered.push({
          id: item.id,
          ownedBy: item.ownedBy.slice(0, MAX_OWNER_LENGTH)
        });
      }
      discovered.clear();
      for (const item of filtered) discovered.add(item.id);
      return Object.freeze({
        endpoint: targetURL,
        models: filtered,
        checked: true
      });
    },
    async chat({ requestId, model, prompt } = {}) {
      if (!REQUEST_ID.test(requestId ?? "") ||
          typeof model !== "string" || !discovered.has(model) ||
          typeof prompt !== "string" || !prompt.trim() ||
          prompt.length > MAX_PROMPT_LENGTH || /\0/.test(prompt))
        throw new Error("INVALID_CHAT_REQUEST");
      if (inFlight.size || inFlight.has(requestId))
        throw new Error("MODEL_BUSY");
      const controller = new AbortController();
      inFlight.set(requestId, controller);
      try {
        // Nothing is attached from open documents, clipboard or a hidden
        // system prompt. Only text the user explicitly submits is sent.
        const chatProvider = providerFor(chatTimeoutMs);
        const result = await chatProvider.chat({
          model, messages: [{ role: "user", content: prompt }],
          temperature: 0.7, maxTokens: 1024, signal: controller.signal
        });
        if (controller.signal.aborted) throw new Error("CANCELLED");
        if (typeof result.content !== "string" ||
            result.content.length > MAX_COMPLETION_LENGTH)
          throw new Error("BAD_CHAT_RESPONSE");
        return Object.freeze({ model, content: result.content });
      } finally {
        inFlight.delete(requestId);
      }
    },
    cancel({ requestId } = {}) {
      if (!REQUEST_ID.test(requestId ?? "")) throw new Error("INVALID_CHAT_REQUEST");
      const controller = inFlight.get(requestId);
      if (!controller) return Object.freeze({ cancelled: false });
      controller.abort();
      return Object.freeze({ cancelled: true });
    },
    useOwned({ endpoint, token } = {}) {
      if (endpoint !== OWNED_MODEL_URL || typeof token !== "string" ||
          !/^[0-9a-f]{48}$/.test(token))
        throw new Error("INVALID_CHAT_REQUEST");
      for (const controller of inFlight.values()) controller.abort();
      targetURL = OWNED_MODEL_URL;
      apiKey = token;
      discovered.clear();
    },
    useExternal() {
      for (const controller of inFlight.values()) controller.abort();
      targetURL = LOCAL_MODEL_ENDPOINT;
      apiKey = null;
      discovered.clear();
    },
    dispose() {
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
    }
  });
}

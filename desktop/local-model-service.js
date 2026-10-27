// First desktop AI vertical: explicit discovery of a separately running local server.
// Never enumerate disks, model paths, documents or external URLs. No inference yet.
import { OpenAICompatibleProvider } from "../src/model-provider.js";

export const LOCAL_MODEL_ENDPOINT = "http://127.0.0.1:1234/v1";
const MAX_VISIBLE_MODELS = 128;
const MAX_OWNER_LENGTH = 80;

export function createDesktopModelService({
  fetchImpl = globalThis.fetch, timeoutMs = 4500
} = {}) {
  // The provider supplies strict loopback URL validation, redirect rejection,
  // request cancellation and response-shape checking. The main process alone
  // owns the network operation; the sandboxed renderer retains connect-src none.
  const provider = new OpenAICompatibleProvider({
    baseURL: LOCAL_MODEL_ENDPOINT, fetchImpl, timeoutMs
  });
  return Object.freeze({
    async list() {
      const models = await provider.listModels();
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
      return Object.freeze({
        endpoint: LOCAL_MODEL_ENDPOINT,
        models: filtered,
        checked: true
      });
    }
  });
}

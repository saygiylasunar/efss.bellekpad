import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleProvider, ProviderError } from "../src/model-provider.js";
import { indexEmbeddings, queryWithMemory } from "../src/ai-pipeline.js";
import { MemoryStations } from "../src/memory-stations.js";

function fakeProvider(calls) {
  return new OpenAICompatibleProvider({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/models")) return Response.json({
        data: [{ id: "chat-small", owned_by: "local" }, { id: "embed-small" }]
      });
      if (url.endsWith("/embeddings")) {
        const body = JSON.parse(options.body);
        return Response.json({
          model: body.model,
          data: body.input.map((text, index) => ({
            index, embedding: text.includes("Ritim") || text.includes("ritim") ? [1, 0, 0] : [0, 1, 0]
          }))
        });
      }
      if (url.endsWith("/chat/completions")) {
        return Response.json({
          model: "chat-small", choices: [{ message: { content: "Kaynaklı yanıt." } }],
          usage: { total_tokens: 33 }
        });
      }
      throw new Error("Unexpected endpoint");
    }
  });
}

test("provider defaults to loopback, no calls until explicit request", async () => {
  const calls = [];
  const provider = fakeProvider(calls);
  assert.equal(provider.scope, "loopback");
  assert.equal(calls.length, 0);
  assert.deepEqual((await provider.listModels()).map(x => x.id), ["chat-small", "embed-small"]);
  assert.equal(calls[0].url, "http://127.0.0.1:1234/v1/models");
  assert.equal(calls[0].options.method, "GET");
});

test("remote endpoints are disabled unless HTTPS, explicit opt-in, and a key", () => {
  assert.throws(() => new OpenAICompatibleProvider({ baseURL: "https://remote.example/v1" }), /REMOTE_DISABLED/);
  assert.throws(() => new OpenAICompatibleProvider({ baseURL: "http://remote.example/v1", apiKey: "secret", allowRemote: true }), /REMOTE_DISABLED/);
  assert.throws(() => new OpenAICompatibleProvider({ baseURL: "http://127.0.0.1:1234/v1?x=1" }), /BAD_URL/);
  assert.throws(() => new OpenAICompatibleProvider({ baseURL: "http://user:pass@localhost:1234/v1" }), /BAD_URL/);
  const remote = new OpenAICompatibleProvider({
    baseURL: "https://remote.example/v1", apiKey: "not-logged", allowRemote: true
  });
  assert.equal(remote.scope, "remote");
});

test("embedding and chat shape verified; provider never interprets excerpts as commands", async () => {
  const calls = [], provider = fakeProvider(calls);
  const embedding = await provider.embed({ model: "embed-small", input: ["Ritim", "Düşünce"] });
  assert.deepEqual(embedding.vectors, [[1, 0, 0], [0, 1, 0]]);
  const chat = await provider.chat({ model: "chat-small", messages: [{ role: "user", content: "Merhaba" }] });
  assert.equal(chat.content, "Kaynaklı yanıt.");
  assert.equal(JSON.parse(calls[0].options.body).model, "embed-small");
  assert.equal(JSON.parse(calls[1].options.body).stream, false);
});

test("invalid requests are rejected locally before any model call", async () => {
  const calls = [], provider = fakeProvider(calls);
  await assert.rejects(provider.embed({ model: "embed-small", input: [] }), /BAD_INPUT/);
  await assert.rejects(provider.chat({ model: "chat-small", messages: [{ role: "root", content: "x" }] }), /BAD_INPUT/);
  await assert.rejects(provider.embed({ model: "embed-small", input: "  " }), /BAD_INPUT/);
  assert.equal(calls.length, 0);
});

test("malformed vector responses are detected without indexing", async () => {
  const provider = new OpenAICompatibleProvider({
    fetchImpl: async () => Response.json({ data: [{ index: 0, embedding: [NaN] }] })
  });
  await assert.rejects(provider.embed({ model: "embed", input: "test" }), /BAD_EMBEDDING_RESPONSE/);
});

test("transport and HTTP errors do not echo private request text", async () => {
  const provider = new OpenAICompatibleProvider({
    fetchImpl: async () => new Response("private text", { status: 503 })
  });
  await assert.rejects(provider.chat({
    model: "chat", messages: [{ role: "user", content: "private text" }]
  }), error => error instanceof ProviderError && error.code === "PROVIDER_HTTP_ERROR" &&
    error.status === 503 && !error.message.includes("private text"));
});

test("model pipeline indexes allowed passages and queries source-backed context", async () => {
  const calls = [], provider = fakeProvider(calls), memory = new MemoryStations();
  memory.ingest({ metadata: { kind: "paper", id: "one" }, body: "Ritim bir örüntüdür." });
  memory.ingest({ metadata: { kind: "paper", id: "hidden", visibility: "restricted" }, body: "Ritim çok gizlidir." });
  const status = [];
  const indexing = await indexEmbeddings({
    memory, provider, model: "embed-small", onProgress: item => status.push(item)
  });
  assert.equal(indexing.indexed, 1);
  assert.deepEqual(status, [{ indexed: 1, total: 1 }]);
  const reply = await queryWithMemory({
    memory, provider, chatModel: "chat-small", embeddingModel: "embed-small", query: "Ritim"
  });
  assert.equal(reply.answer.content, "Kaynaklı yanıt.");
  assert.equal(reply.contextSourceCount, 1);
  assert.equal(reply.tray.sources[0].sourceId, "paper:one");
  const body = JSON.parse(calls.at(-1).options.body);
  const request = JSON.parse(body.messages[1].content);
  assert.equal(request.referenceExcerpts.length, 1);
  assert.equal(request.referenceExcerpts[0].sourceId, "paper:one");
  assert.equal(body.messages[0].role, "system");
});

test("lexical fallback works without an embedding model", async () => {
  const provider = fakeProvider([]), memory = new MemoryStations();
  memory.ingest({ metadata: { kind: "paper", id: "one" }, body: "Kayıt ve hatırlama." });
  const reply = await queryWithMemory({
    memory, provider, chatModel: "chat-small", query: "hatırlama"
  });
  assert.equal(reply.contextSourceCount, 1);
});

test("user cancellation prevents indexing and network calls", async () => {
  const provider = fakeProvider([]), memory = new MemoryStations();
  memory.ingest({ metadata: { kind: "paper", id: "one" }, body: "Ritim." });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(indexEmbeddings({
    memory, provider, model: "embed-small", signal: controller.signal
  }), /INDEX_CANCELLED/);
});

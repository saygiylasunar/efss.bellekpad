import test from "node:test";
import assert from "node:assert/strict";
import { createImageMessage } from "../src/multimodal.js";
import { OpenAICompatibleProvider } from "../src/model-provider.js";
import { ComfyWorkflowProvider } from "../src/comfy-provider.js";

test("vision message uses a bounded local image data URI, not a URL fetch", () => {
  const message = createImageMessage({ prompt: "Describe this image", images: [
    { mimeType: "image/png", base64: "aGVsbG8=" }
  ] });
  assert.equal(message.role, "user");
  assert.equal(message.content[1].image_url.url, "data:image/png;base64,aGVsbG8=");
  assert.throws(() => createImageMessage({ prompt: "Hi", images: [
    { mimeType: "image/png", base64: "https://somewhere" }
  ] }));
  assert.throws(() => createImageMessage({ prompt: "Hi", images: [
    { mimeType: "image/svg+xml", base64: "aGVsbG8=" }
  ] }));
});

test("local compatible runtime receives explicit image message", async () => {
  const requests = [], events = [];
  const provider = new OpenAICompatibleProvider({
    onEvent: e => events.push(e),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return Response.json({ choices: [{ message: { content: "Image described." } }] });
    }
  });
  const response = await provider.chat({ model: "vl-local", messages: [
    createImageMessage({ prompt: "Describe", images: [
      { mimeType: "image/jpeg", base64: "aGVsbG8=" }
    ] })
  ] });
  assert.equal(response.content, "Image described.");
  assert.equal(JSON.parse(requests[0].options.body).messages[0].content[1].type, "image_url");
  assert.deepEqual(events.map(e => e.state), ["running", "completed"]);
  assert.ok(!JSON.stringify(events).includes("aGVsbG8="));
});

test("reject external image URLs and invalid multimodal roles", async () => {
  let called = false;
  const provider = new OpenAICompatibleProvider({
    fetchImpl: async () => { called = true; return Response.json({}); }
  });
  const message = { role: "user", content: [
    { type: "text", text: "x" },
    { type: "image_url", image_url: { url: "https://somewhere.test/photo.png" } }
  ] };
  await assert.rejects(provider.chat({ model: "vl", messages: [message] }), /BAD_INPUT/);
  await assert.rejects(provider.chat({ model: "vl", messages: [
    { role: "system", content: createImageMessage({
      prompt: "x", images: [{ mimeType: "image/png", base64: "eA==" }]
    }).content }
  ] }), /BAD_INPUT/);
  assert.equal(called, false);
});

test("ComfyUI adapter sends only explicit local workflows", async () => {
  const calls = [];
  const client = new ComfyWorkflowProvider({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/prompt")) {
        return Response.json({ prompt_id: "abc123", number: 3 });
      }
      return Response.json({ abc123: { outputs: { "1": { images: [] } } } });
    }
  });
  const workflow = { "1": { class_type: "KSampler", inputs: { seed: 1 } } };
  const task = await client.queueWorkflow({ workflow });
  assert.deepEqual(task, { jobId: "abc123", position: 3, state: "queued" });
  assert.equal(JSON.parse(calls[0].options.body).prompt["1"].class_type, "KSampler");
  assert.equal(calls[0].options.method, "POST");
  const history = await client.history({ jobId: "abc123" });
  assert.equal(history.found, true);
  assert.equal(calls[1].options.method, "GET");
});

test("ComfyUI refuses remote hosts and malformed jobs", async () => {
  assert.throws(() => new ComfyWorkflowProvider({ baseURL: "https://remote.test" }));
  const client = new ComfyWorkflowProvider({
    fetchImpl: async () => Response.json({ prompt_id: "abc123" })
  });
  await assert.rejects(client.queueWorkflow({ workflow: { "1": { class_type: "Unsafe" } } }));
  await assert.rejects(client.history({ jobId: "../history" }));
  await assert.rejects(client.queueWorkflow({ workflow: {} }));
});

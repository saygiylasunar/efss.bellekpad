import { MemoryStations, OpenAICompatibleProvider, indexEmbeddings,
  queryWithMemory } from "../src/index.js";

const client = new OpenAICompatibleProvider();
const models = await client.listModels();
console.log("Available model IDs:", models.map(item => item.id).join(", ") || "(none)");

const chatModel = process.env.EFSS_CHAT_MODEL;
const embeddingModel = process.env.EFSS_EMBED_MODEL || null;
if (!chatModel) {
  console.log("Set EFSS_CHAT_MODEL to a loaded chat model ID to run this opt-in demo.");
  process.exit(0);
}
const memory = new MemoryStations();
memory.ingest({
  metadata: { kind: "paper", id: "sample1", title: "Notes" },
  body: "# Basic terms\n\nRhythm and melody are connected in music.\n"
});
memory.ingest({
  metadata: { kind: "paper", id: "sample2", title: "More notes" },
  body: "# Intervals\n\nAn interval is the difference between two pitches.\n"
});
if (embeddingModel) {
  const result = await indexEmbeddings({ memory, provider: client, model: embeddingModel });
  console.log("Embedded segments:", result.indexed);
}
const result = await queryWithMemory({
  memory, provider: client, chatModel, embeddingModel, query: "What is an interval?",
  maxSources: 4, maxChars: 4000
});
console.log("Context excerpts:", result.contextSourceCount);
console.log("Model response:", result.answer.content);

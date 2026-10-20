#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { LocalDocumentVault } from "../src/local-document-vault.js";

const [command, parameter] = process.argv.slice(2);
const help = [
  "EFSS BellekPad — local, file-backed vault",
  "",
  "npm run vault -- status",
  "npm run vault -- import <EFSS Markdown file>",
  "npm run vault -- search <word-or-phrase>",
  "",
  "Storage: .efss/vault/ (private, ignored by Git).",
  "An imported document is never overwritten without an explicit revision.",
  "Search shows record IDs and scores, not source excerpts.",
  "Nothing is uploaded or sent to an AI provider."
].join("\n");

if (!command || ["help", "--help", "-h"].includes(command)) {
  console.log(help);
  process.exit(0);
}

const vault = new LocalDocumentVault();
try {
  if (command === "status") {
    const { documents, excluded, segments } = await vault.rebuildIndex();
    console.log("Local EFSS documents:", documents);
    console.log("Restricted records excluded from index:", excluded);
    console.log("Indexed text segments:", segments);
  } else if (command === "import") {
    if (!parameter) throw new Error("SOURCE_FILE_REQUIRED");
    const bytes = await readFile(parameter);
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const saved = await vault.save(source);
    console.log("Locally imported:", saved.kind + ":" + saved.id);
    console.log("Revision:", saved.revision);
    console.log("Bytes:", saved.bytes);
  } else if (command === "search") {
    if (!parameter?.trim()) throw new Error("SEARCH_QUERY_REQUIRED");
    const { memory, documents } = await vault.rebuildIndex();
    const results = memory.search({ query: parameter, limit: 12 });
    console.log("Indexed documents:", documents, "Matches:", results.length);
    console.table(results.map(r => ({
      source: r.sourceId, block: r.blockType,
      position: r.start, score: r.score
    })));
  } else {
    throw new Error("UNSUPPORTED_VAULT_COMMAND");
  }
} catch (error) {
  // Never print a source payload, file contents or query text on failure.
  console.error("EFSS Vault:", error?.code ?? error?.message ?? "UNKNOWN_ERROR");
  process.exitCode = 1;
}

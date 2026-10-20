import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDocumentVault } from "../src/local-document-vault.js";
import { LocalKnowledgeGraph } from "../src/local-knowledge-graph.js";
import { FORMAT_VERSION, serializeDocument } from "../src/efss-markdown.js";
import { VariableTypeRegistry } from "../src/typed-variables.js";
import { loadVariableSchemas, parseVariableSchemaDocument } from "../src/variable-schema-documents.js";

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "efss-variable-schema-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const vault = new LocalDocumentVault({ root: join(dir, "vault") });
  return { dir, vault, graph: new LocalKnowledgeGraph({ vault, root: join(dir, "graph") }) };
}
function source(kind, id, body, additional = {}) {
  return serializeDocument({ metadata: {
    efss_version: FORMAT_VERSION, kind, id, ...additional
  }, body });
}
function schemaBody({ label = "Count", type = "number", schemaVersion = 1,
  aliases = [], properties = {} } = {}) {
  return ":::efss.schema\n" + JSON.stringify({
    schemaVersion, label, aliases, value: { type }, properties
  }, null, 2) + "\n:::";
}

test("persisted variable schema survives restart and validates Paper value candidates", async t => {
  const { vault, graph, dir } = await setup(t);
  await vault.save(source("variable", "count", schemaBody()));
  await vault.save(source("paper", "first", "&Count{26, 48} with an ordinary note."));
  const first = await graph.snapshot();
  assert.equal(first.valueCandidates.length, 1);
  assert.deepEqual(first.valueCandidates[0].values, [26, 48]);
  assert.equal(first.valueCandidates[0].status, "candidate");
  assert.ok(first.edges.some(e => e.from === "paper:first" &&
    e.to === "variable:count" && e.origin === "markdown"));
  const afterRestart = new LocalKnowledgeGraph({ vault, root: join(dir, "graph") });
  assert.deepEqual((await afterRestart.snapshot()).valueCandidates[0].values, [26, 48]);
  assert.equal((await loadVariableSchemas(vault)).resolve("&Count").id, "count");
});

test("unsupported schema type and schema versions fail closed", async t => {
  const { vault, graph } = await setup(t);
  await vault.save(source("variable", "count", schemaBody({ type: "executable" })));
  await assert.rejects(graph.snapshot(), /INVALID_VARIABLE_SCHEMA/);
  const record = await vault.read("variable", "count");
  await vault.save(source("variable", "count", schemaBody({ schemaVersion: 2 })), {
    expectedRevision: record.revision
  });
  await assert.rejects(graph.snapshot(), /INVALID_VARIABLE_SCHEMA/);
});

test("duplicate code-registered and persisted definitions require explicit reconciliation", async t => {
  const { vault, dir } = await setup(t);
  await vault.save(source("variable", "count", schemaBody()));
  const types = new VariableTypeRegistry();
  types.register({ id: "count", label: "Different", value: { type: "text" } });
  await assert.rejects(loadVariableSchemas(vault, { baseTypes: types }), /VARIABLE_SCHEMA_CONFLICT/);
  const graph = new LocalKnowledgeGraph({ vault, types, root: join(dir, "graph") });
  await assert.rejects(graph.snapshot(), /VARIABLE_SCHEMA_CONFLICT/);
});

test("restricted schema does not authorize public variable references", async t => {
  const { vault, graph } = await setup(t);
  await vault.save(source("variable", "count", schemaBody(), {
    visibility: "restricted"
  }));
  await vault.save(source("paper", "first", "&Count{5}"));
  const publicView = await graph.snapshot();
  assert.equal(publicView.valueCandidates.length, 0);
  assert.ok(publicView.diagnostics.some(d => d.code === "UNKNOWN_VARIABLE_BINDING"));
  assert.equal(publicView.nodes.includes("variable:count"), false);
  const privilegedView = await graph.snapshot({ allowRestricted: true });
  assert.equal(privilegedView.valueCandidates.length, 1);
  assert.deepEqual(privilegedView.valueCandidates[0].values, [5]);
});

test("ordinary variable Markdown is not treated as a schema", async t => {
  const { vault } = await setup(t);
  await vault.save(source("variable", "notes", "A paragraph about notes."));
  const doc = await vault.read("variable", "notes");
  assert.equal(parseVariableSchemaDocument(doc), null);
  assert.equal((await loadVariableSchemas(vault)).list().length, 0);
});

test("malformed extensions and arbitrary keys are rejected, never executed", async t => {
  const { vault, graph } = await setup(t);
  await vault.save(source("variable", "count", ':::efss.schema\n{"schemaVersion":1,"label":"X","value":{"type":"text"},"script":"execute"}\n:::'));
  await assert.rejects(graph.snapshot(), /INVALID_VARIABLE_SCHEMA/);
  const old = await vault.read("variable", "count");
  await vault.save(source("variable", "count", ':::efss.schema\ninvalid-json\n:::'), {
    expectedRevision: old.revision
  });
  await assert.rejects(graph.snapshot(), /INVALID_VARIABLE_SCHEMA_JSON/);
});

test("private model schema documents cannot inject executable directives", async t => {
  const { vault, graph } = await setup(t);
  await vault.save(source("variable", "count", schemaBody({ label: "Count" })));
  await vault.save(source("paper", "one", "&Count{5}"));
  const snapshot = await graph.snapshot();
  assert.equal(snapshot.valueCandidates[0].effect, "none");
  assert.equal(snapshot.edges.some(edge => edge.relation === "imports"), false);
});

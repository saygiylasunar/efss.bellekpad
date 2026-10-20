import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDocumentVault } from "../src/local-document-vault.js";
import { LocalKnowledgeGraph } from "../src/local-knowledge-graph.js";
import { FORMAT_VERSION, serializeDocument } from "../src/efss-markdown.js";
import { VariableTypeRegistry } from "../src/typed-variables.js";
import { inspectVariableBindings } from "../src/binding-resolver.js";
import { loadVariableSchemas, parseVariableSchemaDocument } from "../src/variable-schema-documents.js";

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "efss-symbol-schema-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const vault = new LocalDocumentVault({ root: join(dir, "vault") });
  return { dir, vault, graph: new LocalKnowledgeGraph({ vault, root: join(dir, "graph") }) };
}
function source(kind, id, body, additional = {}) {
  return serializeDocument({ metadata: {
    efss_version: FORMAT_VERSION, kind, id, ...additional
  }, body });
}
function schemaBody({ label = "Count", type = "number", schemaVersion = 2,
  aliases = [], symbolKind = "variable", cardinality = "one",
  fixedValue, properties } = {}) {
  const schema = { schemaVersion, label, aliases, value: { type } };
  if (schemaVersion === 2) {
    schema.symbolKind = symbolKind;
    schema.cardinality = cardinality;
    if (fixedValue !== undefined) schema.fixedValue = fixedValue;
  } else if (properties !== undefined) schema.properties = properties;
  return ":::efss.schema\n" + JSON.stringify(schema, null, 2) + "\n:::";
}

test("persisted definitions reload, but values are not automatically remembered", async t => {
  const { vault, graph } = await setup(t);
  await vault.save(source("variable", "count", schemaBody()));
  await vault.save(source("paper", "first", "&Count{26} remains a value in a note."));
  const loaded = await loadVariableSchemas(vault);
  assert.equal(loaded.resolve("&Count").symbolKind, "variable");
  assert.equal(loaded.resolve("&Count").cardinality, "one");
  const candidates = inspectVariableBindings("&Count{26}", loaded, { sourceId: "paper:first" });
  assert.deepEqual(candidates.candidates.map(x => x.values), [[26]]);
  const snapshot = await graph.snapshot();
  assert.ok(snapshot.edges.some(e => e.from === "paper:first" &&
    e.to === "variable:count" && e.origin === "markdown"));
  assert.equal(Object.hasOwn(snapshot, "valueCandidates"), false);
  assert.equal(Object.hasOwn(snapshot, "observations"), false);
});

test("constant definitions have one fixed value and cannot be rewritten in the vault", async t => {
  const { vault, graph } = await setup(t);
  const body = schemaBody({ label: "Pi", type: "number",
    symbolKind: "constant", fixedValue: 3.14 });
  const old = await vault.save(source("variable", "pi", body));
  assert.equal((await loadVariableSchemas(vault)).resolve("&Pi").fixedValue, 3.14);
  await assert.rejects(
    vault.save(source("variable", "pi", schemaBody({
      label: "Pi", type: "number", symbolKind: "constant", fixedValue: 4
    })), { expectedRevision: old.revision }),
    /CONSTANT_DEFINITION_IMMUTABLE/
  );
  await vault.save(source("paper", "one", "&Pi"));
  assert.ok((await graph.snapshot()).edges.some(e => e.to === "variable:pi"));
  assert.equal((await loadVariableSchemas(vault)).resolve("&Pi").fixedValue, 3.14);
});

test("schema version 2 requires an explicit class and cardinality", async t => {
  const { vault } = await setup(t);
  await vault.save(source("variable", "count",
    ':::efss.schema\n{"schemaVersion":2,"label":"X","value":{"type":"text"}}\n:::'));
  await assert.rejects(loadVariableSchemas(vault), /INVALID_VARIABLE_SCHEMA/);
});

test("older version 1 definitions remain readable but retain their legacy many behavior", async t => {
  const { vault } = await setup(t);
  await vault.save(source("variable", "count",
    schemaBody({ schemaVersion: 1, properties: {} })));
  const def = (await loadVariableSchemas(vault)).resolve("&Count");
  assert.equal(def.cardinality, "many");
  assert.equal(def.symbolKind, "variable");
  assert.equal(inspectVariableBindings("&Count{1,2}", await loadVariableSchemas(vault)).candidates.length, 1);
});

test("legacy extension property bags are rejected instead of silently ignored", async t => {
  const { vault } = await setup(t);
  await vault.save(source("variable", "count",
    schemaBody({ schemaVersion: 1, properties: { accuracy: { type: "number" } } })));
  await assert.rejects(loadVariableSchemas(vault), /LEGACY_PROPERTIES_REQUIRE_MIGRATION/);
});

test("duplicate ids, labels and unknown fields cannot silently replace a symbol", async t => {
  const { vault, dir } = await setup(t);
  await vault.save(source("variable", "count", schemaBody()));
  const types = new VariableTypeRegistry();
  types.register({ id: "count", label: "Different", value: { type: "text" } });
  await assert.rejects(loadVariableSchemas(vault, { baseTypes: types }), /VARIABLE_SCHEMA_CONFLICT/);
  const graph = new LocalKnowledgeGraph({ vault, types, root: join(dir, "graph") });
  await assert.rejects(graph.snapshot(), /VARIABLE_SCHEMA_CONFLICT/);
});

test("restricted definitions do not authorize public bindings", async t => {
  const { vault, graph } = await setup(t);
  await vault.save(source("variable", "count", schemaBody(), {
    visibility: "restricted"
  }));
  await vault.save(source("paper", "first", "&Count{5}"));
  const normal = await loadVariableSchemas(vault);
  assert.equal(normal.get("count"), null);
  assert.equal(inspectVariableBindings("&Count{5}", normal).candidates.length, 0);
  assert.equal((await graph.snapshot()).nodes.includes("variable:count"), false);
  assert.equal((await graph.snapshot({ allowRestricted: true })).nodes.includes("variable:count"), true);
});

test("unstructured variable notes never create inferred symbols", async t => {
  const { vault } = await setup(t);
  await vault.save(source("variable", "notes", "A paragraph about notes."));
  assert.equal(parseVariableSchemaDocument(await vault.read("variable", "notes")), null);
  assert.equal((await loadVariableSchemas(vault)).list().length, 0);
});

test("invalid or executable-looking schema content fails closed", async t => {
  const { vault } = await setup(t);
  await vault.save(source("variable", "count",
    ':::efss.schema\n{"schemaVersion":2,"label":"X","symbolKind":"variable","cardinality":"one","value":{"type":"text"},"script":"execute"}\n:::'));
  await assert.rejects(loadVariableSchemas(vault), /INVALID_VARIABLE_SCHEMA/);
  const previous = await vault.read("variable", "count");
  await vault.save(source("variable", "count", ":::efss.schema\ninvalid-json\n:::"),
    { expectedRevision: previous.revision });
  await assert.rejects(loadVariableSchemas(vault), /INVALID_VARIABLE_SCHEMA_JSON/);
});

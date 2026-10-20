import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConfiguredModels, modelCategoryPolicy } from "../src/model-discovery.js";

test("categorized scan only touches explicitly configured directories and hides LoRAs", async () => {
  const root = await mkdtemp(join(tmpdir(), "efss-allowed-"));
  const elsewhere = await mkdtemp(join(tmpdir(), "efss-unlisted-"));
  try {
    for (const dir of ["LLM", "checkpoints", "loras", "vae", "text_encoders"]) {
      await mkdir(join(root, dir));
    }
    await writeFile(join(root, "LLM", "Qwen3-14B-Q4_K_M.gguf"), "stub");
    await writeFile(join(root, "checkpoints", "full-model.safetensors"), "stub");
    await writeFile(join(root, "checkpoints", "portrait_lora.safetensors"), "stub");
    await writeFile(join(root, "loras", "portrait.safetensors"), "stub");
    await writeFile(join(root, "vae", "decoder.safetensors"), "stub");
    await writeFile(join(root, "text_encoders", "clip.safetensors"), "stub");
    await writeFile(join(elsewhere, "secret-llm.gguf"), "not allowed");
    const manifest = { schemaVersion: 1, roots: [{
      id: "explicit", basePath: root, categories: {
        LLM: ["LLM"], checkpoints: ["checkpoints"],
        loras: ["loras"], vae: ["vae"], text_encoders: ["text_encoders"]
      }
    }] };
    const defaults = await discoverConfiguredModels(manifest);
    assert.deepEqual(defaults.models.map(m => m.name).sort(), [
      "Qwen3-14B-Q4_K_M.gguf", "full-model.safetensors"
    ]);
    assert.equal(defaults.components.length, 0);
    assert.ok(defaults.models.every(m => m.kind === "primary" && !m.verified));
    assert.ok(!defaults.models.some(m => m.name.includes("secret")));
    assert.equal(defaults.inspectedCategories, 2);
    const extended = await discoverConfiguredModels(manifest, { includeComponents: true });
    assert.equal(extended.models.length, 2);
    assert.deepEqual(extended.components.map(m => m.name).sort(), [
      "clip.safetensors", "decoder.safetensors",
      "portrait.safetensors", "portrait_lora.safetensors"
    ]);
    assert.ok(extended.components.every(m => m.kind === "component"));
    assert.equal(extended.inspectedCategories, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("unrecognized model categories are excluded from discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "efss-unknown-"));
  try {
    await mkdir(join(root, "some_custom_folder"));
    await writeFile(join(root, "some_custom_folder", "mystery.safetensors"), "stub");
    const result = await discoverConfiguredModels({ schemaVersion: 1,
      roots: [{ id: "my_models", basePath: root,
        categories: { some_custom_folder: ["some_custom_folder"] } }]
    }, { includeComponents: true });
    assert.equal(result.models.length, 0);
    assert.equal(result.components.length, 0);
    assert.equal(result.inspectedCategories, 0);
    assert.equal(modelCategoryPolicy("loras").kind, "component");
    assert.equal(modelCategoryPolicy("LLM").kind, "primary");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("declared symlink folder is not followed into another directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "efss-root-"));
  const outside = await mkdtemp(join(tmpdir(), "efss-elsewhere-"));
  try {
    await writeFile(join(outside, "model.gguf"), "stub");
    await symlink(outside, join(root, "LLM"));
    const result = await discoverConfiguredModels({ schemaVersion: 1, roots: [{
      id: "safe", basePath: root, categories: { LLM: ["LLM"] }
    }] });
    assert.equal(result.models.length, 0);
    assert.equal(result.diagnostics[0].code, "NOT_A_DIRECTORY");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("declared nonexistent directory emits a diagnostic without searching elsewhere", async () => {
  const root = await mkdtemp(join(tmpdir(), "efss-missing-"));
  try {
    const result = await discoverConfiguredModels({ schemaVersion: 1, roots: [{
      id: "root", basePath: root, categories: { LLM: ["does-not-exist"] }
    }] });
    assert.deepEqual(result.models, []);
    assert.equal(result.diagnostics[0].code, "DIRECTORY_MISSING");
    await assert.rejects(discoverConfiguredModels({ schemaVersion: 1, roots: [{
      id: "root", basePath: root, categories: { LLM: ["does-not-exist"] }
    }] }, { maxDepth: 100 }), /Invalid discovery options/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

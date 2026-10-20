import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateComfyPathManifest, generateComfyExtraPathsYaml, listComfyModelPaths
} from "../src/comfy-paths.js";
import {
  readComfyPathManifest, inspectComfyFolders, writeComfyExtraPaths
} from "../src/comfy-paths-io.js";

function sample(root = "D:/AI/SharedModels") {
  return { schemaVersion: 1, roots: [
    { id: "shared", basePath: root, categories: {
      checkpoints: ["checkpoints"],
      text_encoders: ["text_encoders", "clip"],
      LLM: ["LLM"]
    }},
    { id: "second", basePath: "E:/Extra", categories: { loras: ["loras"] } }
  ] };
}

test("JSON manifest generates native ComfyUI extra_model_paths.yaml without copying files", () => {
  const manifest = validateComfyPathManifest(sample());
  const yaml = generateComfyExtraPathsYaml(manifest);
  assert.match(yaml, /efss_shared:\n  base_path: "D:\/AI\/SharedModels"/);
  assert.match(yaml, /  text_encoders: \|\n    text_encoders\n    clip/);
  assert.match(yaml, /efss_second:\n  base_path: "E:\/Extra"/);
  assert.equal(listComfyModelPaths(manifest).length, 5);
  assert.ok(listComfyModelPaths(manifest).some(item =>
    item.category === "LLM" && item.path === "D:/AI/SharedModels/LLM"));
  assert.ok(!yaml.includes("safetensors"));
});

test("absolute Windows backslashes normalize to ComfyUI-friendly forward slashes", () => {
  const raw = sample("D:\\My Models\\Assets");
  const result = generateComfyExtraPathsYaml(raw);
  assert.match(result, /base_path: "D:\/My Models\/Assets"/);
  assert.ok(listComfyModelPaths(raw).some(x =>
    x.path === "D:/My Models/Assets/checkpoints"));
});


test("UNC shared-folder paths keep the double leading separator", () => {
  const original = sample("\\\\server\\models");
  const paths = listComfyModelPaths(original);
  assert.ok(paths.some(entry => entry.path === "//server/models/checkpoints"));
  assert.ok(generateComfyExtraPathsYaml(original).includes('base_path: "//server/models"'));
});

test("relative folders and arbitrary ComfyUI extension category names are supported", () => {
  const entry = sample("/media/models");
  entry.roots[0].categories.animatediff_models = ["animatediff_models"];
  entry.roots[0].categories.ipadapter = ["ipadapter"];
  const yaml = generateComfyExtraPathsYaml(entry);
  assert.match(yaml, /animatediff_models: \|\n    animatediff_models/);
  assert.match(yaml, /ipadapter: \|\n    ipadapter/);
});

test("reject invalid schema, duplicate roots, traversal and dangerous YAML category keys", () => {
  const s = sample();
  assert.throws(() => validateComfyPathManifest({ ...s, schemaVersion: 9 }));
  assert.throws(() => validateComfyPathManifest({ ...s, roots: [s.roots[0], s.roots[0]] }));
  assert.throws(() => validateComfyPathManifest(sample("relative/folder")), /ABSOLUTE/);
  const evil = sample();
  evil.roots[0].categories["bad:\nevil"] = ["models"];
  assert.throws(() => validateComfyPathManifest(evil), /CATEGORY/);
  const traversal = sample();
  traversal.roots[0].categories.checkpoints = ["../other"];
  assert.throws(() => validateComfyPathManifest(traversal), /RELATIVE/);
  const duplicate = sample();
  duplicate.roots[0].categories.text_encoders = ["clip", "clip"];
  assert.throws(() => validateComfyPathManifest(duplicate), /DUPLICATE/);
  const reserved = sample();
  reserved.roots[0].categories.base_path = ["foo"];
  assert.throws(() => validateComfyPathManifest(reserved), /CATEGORY/);
});

test("folder check does not mutate model contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "efss-comfy-folders-"));
  try {
    await mkdir(join(root, "checkpoints"));
    await mkdir(join(root, "text_encoders"));
    const manifest = { schemaVersion: 1, roots: [
      { id: "storage", basePath: root, categories: {
        checkpoints: ["checkpoints"], text_encoders: ["text_encoders", "clip"]
      }}
    ] };
    const status = await inspectComfyFolders(manifest);
    assert.deepEqual(status.map(x => x.status), ["present", "present", "missing"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output refuses to overwrite by default; forced update keeps historical backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "efss-comfy-yaml-"));
  try {
    const configPath = join(root, "models.json");
    const output = join(root, "extra_model_paths.yaml");
    await writeFile(configPath, JSON.stringify(sample()));
    const input = await readComfyPathManifest(configPath);
    await writeFile(output, "existing_user_config:\n  base_path: other\n");
    await assert.rejects(writeComfyExtraPaths(input, output), { code: "EEXIST" });
    assert.equal(await readFile(output, "utf8"), "existing_user_config:\n  base_path: other\n");
    const result = await writeComfyExtraPaths(input, output, { force: true });
    assert.ok(result.backup);
    assert.equal(await readFile(result.backup, "utf8"), "existing_user_config:\n  base_path: other\n");
    assert.match(await readFile(output, "utf8"), /efss_shared:/);
    assert.ok((await stat(result.backup)).isFile());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("example config in repository remains valid", async () => {
  const example = await readComfyPathManifest("config/model-paths.example.json");
  assert.ok(example.roots.length >= 1);
  const yaml = generateComfyExtraPathsYaml(example);
  assert.ok(yaml.includes("efss_shared_models:"));
});

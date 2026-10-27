import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { planBetaFiles, assembleBetaPortable } from "../scripts/package-beta.mjs";
import { verifyBetaPortable } from "../scripts/verify-beta.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");

test("beta portable manifest ships only explicitly approved desktop runtime dependencies",async()=>{
  const paths=await planBetaFiles(root);
  for(const key of ["desktop/main.js","desktop/preload.cjs",
    "desktop/ui/index.html","desktop/ui/app.js","desktop/security.js",
    "src/editor-flow-adapter.js","src/local-document-vault.js",
    "src/model-provider.js","desktop/local-model-service.js"])
    assert.ok(paths.includes(key),"missing "+key);
  assert.equal(new Set(paths).size,paths.length);
  assert.equal(paths.some(p=>p.startsWith("test/")||p.startsWith(".git/")||
    p.startsWith(".efss/")||p.includes("node_modules")||
    p.endsWith(".gguf")||p.endsWith(".env")),false);
});

test("beta portable assembles and independently verifies an offline Windows payload",async t=>{
  const work=await mkdtemp(join(tmpdir(),"efss-beta-fixture-"));
  t.after(()=>rm(work,{recursive:true,force:true}));
  const electronDist=join(work,"electron-dist");
  await mkdir(join(electronDist,"resources"),{recursive:true});
  await writeFile(join(electronDist,"electron.exe"),"fake-ci-executable");
  await writeFile(join(electronDist,"resources","default_app.asar"),"stock-app");
  const outputRoot=join(work,"out");
  const build=await assembleBetaPortable({root,platform:"win32",
    architecture:"x64",electronDist,outputRoot});
  assert.ok(build.folder.includes("beta."));
  const verified=await verifyBetaPortable({projectRoot:root,platform:"win32",
    architecture:"x64",outputRoot});
  assert.equal(verified.verified,true);
  assert.equal(verified.files,build.files.length);
  assert.equal(await readFile(build.executable,"utf8"),"fake-ci-executable");
  assert.match(await readFile(join(build.target,"BETA_README.txt"),"utf8"),/PORTABLE LIMITED BETA/);
  const pkg=JSON.parse(await readFile(join(build.target,
    "resources","app","package.json"),"utf8"));
  assert.equal(pkg.main,"desktop/main.js");
  assert.equal(Object.hasOwn(pkg,"dependencies"),false);
  const source=join(build.target,"resources","app","desktop","ui","app.js");
  await writeFile(source,"tampered");
  await assert.rejects(verifyBetaPortable({projectRoot:root,platform:"win32",
    architecture:"x64",outputRoot}),/BETA_HASH_MISMATCH/);
});

test("beta packaging refuses unsupported targets without touching output",async()=>{
  await assert.rejects(assembleBetaPortable({
    root,platform:"darwin",architecture:"x64"
  }),/BETA_UNSUPPORTED_PLATFORM/);
  await assert.rejects(assembleBetaPortable({
    root,platform:"win32",architecture:"arm64"
  }),/BETA_UNSUPPORTED_PLATFORM/);
});

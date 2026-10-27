// Read-only portable-beta package acceptance check. Does not open the GUI.
import { createHash } from "node:crypto";
import { readFile, lstat, readdir } from "node:fs/promises";
import { resolve, join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { planBetaFiles } from "./package-beta.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = { win32:"BellekPad.exe",linux:"bellekpad" };

async function collect(path, prefix = "") {
  const found = [];
  for (const item of await readdir(path, {withFileTypes:true})) {
    if(item.isSymbolicLink())throw new Error("BETA_SYMLINK_IN_APPLICATION");
    const rel=prefix?prefix+"/"+item.name:item.name;
    if(item.isDirectory())found.push(...await collect(join(path,item.name),rel));
    else if(item.isFile())found.push(rel);
    else throw new Error("BETA_UNEXPECTED_APPLICATION_FILE");
  }
  return found.sort();
}

export async function verifyBetaPortable({
  projectRoot = root,
  platform = process.platform,
  architecture = process.arch,
  outputRoot = join(projectRoot,"dist")
} = {}) {
  if(!(platform in executable)||architecture!=="x64")
    throw new Error("BETA_UNSUPPORTED_PLATFORM");
  const pkg=JSON.parse(await readFile(join(projectRoot,"package.json"),"utf8"));
  const folder="BellekPad-"+pkg.version+"-"+platform+"-"+architecture;
  const target=join(outputRoot,folder);
  const runtimePath=join(target,executable[platform]);
  if(!(await lstat(runtimePath)).isFile())throw new Error("BETA_EXECUTABLE_MISSING");
  const app=join(target,"resources","app");
  const actual=await collect(app);
  const planned=await planBetaFiles(projectRoot);
  const expected=[...planned,"package.json"].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))
    throw new Error("BETA_APPLICATION_MANIFEST_MISMATCH");
  const packed=JSON.parse(await readFile(join(app,"package.json"),"utf8"));
  if(packed.version!==pkg.version||packed.main!=="desktop/main.js"||
    packed.type!=="module" || Object.hasOwn(packed,"dependencies"))
    throw new Error("BETA_PACKAGED_ENTRY_INVALID");
  const manifest=JSON.parse(await readFile(join(target,"BETA_MANIFEST.json"),"utf8"));
  if(manifest.version!==pkg.version||manifest.platform!==platform||
    manifest.architecture!==architecture ||
    JSON.stringify(Object.keys(manifest.files).sort())!==JSON.stringify(planned))
    throw new Error("BETA_HASH_MANIFEST_MISMATCH");
  for(const file of planned) {
    const hash=createHash("sha256").update(await readFile(join(app,file))).digest("hex");
    if(hash!==manifest.files[file])throw new Error("BETA_HASH_MISMATCH");
  }
  if(!(await readFile(join(target,"BETA_README.txt"),"utf8"))
    .includes("Do not use irreplaceable notes"))
    throw new Error("BETA_README_MISSING");
  return Object.freeze({folder,files:planned.length,verified:true});
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try {console.log("BETA_PORTABLE_VERIFIED",JSON.stringify(await verifyBetaPortable()));}
  catch(error){console.error("BETA_VERIFY_FAILED:",error?.message??"UNKNOWN");process.exitCode=1;}
}

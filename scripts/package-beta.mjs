// BellekPad limited beta: portable, offline Electron bundle without third-party packagers.
// The application is copied from a CLOSED list of bundled assets and local-import
// dependencies. No vault, .env, model, user data, Git metadata, or source test files.
import { cp, mkdir, readFile, lstat, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, join, relative, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BUNDLED_PATHS } from "../desktop/security.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedFiles = Object.freeze([
  "desktop/main.js", "desktop/preload.cjs",
  "desktop/ui/index.html", "desktop/ui/app.js", "desktop/ui/styles.css"
]);
const runtimeName = Object.freeze({win32:"electron.exe",linux:"electron"});
const appName = Object.freeze({win32:"BellekPad.exe",linux:"bellekpad"});
const sourceImport = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g;

function child(root, path) {
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(".." + "/") ||
      rel.startsWith(".." + "\\") || rel.startsWith("/") ||
      rel.includes("\\..\\") || /^[A-Za-z]:/.test(rel)) {
    throw new Error("BETA_UNSAFE_SOURCE_PATH");
  }
  return abs;
}

function bundledPaths() {
  const mapped = BUNDLED_PATHS.map(path => path.startsWith("/src/") ?
    path.slice(1) : "desktop/ui" + path);
  return [...new Set([...seedFiles, ...mapped])];
}

export async function planBetaFiles(root = repoRoot) {
  const visited = new Set();
  const queue = bundledPaths();
  while (queue.length) {
    const path = queue.pop();
    if (visited.has(path)) continue;
    const abs = child(root,path);
    const info = await lstat(abs);
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error("BETA_UNSAFE_SOURCE_FILE");
    if (!/^(src|desktop)\//.test(path) ||
        ![".js",".cjs",".css",".html"].includes(extname(path)))
      throw new Error("BETA_UNEXPECTED_ASSET");
    visited.add(path);
    if (!/\.(?:m?js|cjs)$/.test(path)) continue;
    const source = await readFile(abs,"utf8");
    sourceImport.lastIndex = 0;
    for (const match of source.matchAll(sourceImport)) {
      const ref = match[1];
      const next = relative(root,resolve(dirname(abs),ref)).replaceAll("\\","/");
      if (!next.endsWith(".js") && !next.endsWith(".cjs") &&
          !next.endsWith(".mjs"))
        throw new Error("BETA_UNSUPPORTED_RELATIVE_IMPORT");
      child(root,next);
      queue.push(next);
    }
  }
  const out = [...visited].sort();
  if (!out.includes("desktop/main.js") ||
      !out.includes("desktop/preload.cjs") ||
      !out.includes("desktop/ui/index.html") ||
      out.some(path => path.startsWith("test/") ||
        path.startsWith(".efss/") || path.includes("node_modules")))
    throw new Error("BETA_UNSAFE_MANIFEST");
  return out;
}

export async function assembleBetaPortable({
  root = repoRoot,
  platform = process.platform,
  architecture = process.arch,
  electronDist = join(root,"node_modules","electron","dist"),
  outputRoot = join(root,"dist")
} = {}) {
  if (!(platform in runtimeName) || architecture !== "x64")
    throw new Error("BETA_UNSUPPORTED_PLATFORM");
  const pkg = JSON.parse(await readFile(join(root,"package.json"),"utf8"));
  if (typeof pkg.version !== "string" ||
      !/^0\.3\.0-beta\.[0-9]+$/.test(pkg.version) ||
      pkg.main !== "desktop/main.js")
    throw new Error("BETA_VERSION_OR_ENTRY_MISMATCH");
  const sources = await planBetaFiles(root);
  const stat = await lstat(electronDist);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("BETA_INVALID_ELECTRON_DIST");
  const executable = join(electronDist,runtimeName[platform]);
  if (!(await lstat(executable)).isFile())
    throw new Error("BETA_ELECTRON_BINARY_MISSING");
  const folder = "BellekPad-" + pkg.version + "-" + platform + "-" + architecture;
  const target = join(outputRoot,folder);
  await mkdir(outputRoot,{recursive:true});
  await rm(target,{force:true,recursive:true});
  await cp(electronDist,target,{recursive:true,force:true,verbatimSymlinks:false});
  const appRoot = join(target,"resources","app");
  await mkdir(appRoot,{recursive:true});
  for (const path of sources) {
    const to = join(appRoot,path);
    await mkdir(dirname(to),{recursive:true});
    await cp(child(root,path),to,{force:false,errorOnExist:true});
  }
  // An Electron executable runs the embedded app when resources/app/package.json
  // exists. Its app payload requires only these fields, not npm node_modules.
  await writeFile(join(appRoot,"package.json"),JSON.stringify({
    name:"efss-bellekpad",private:true,type:"module",
    version:pkg.version,main:"desktop/main.js"
  },null,2)+"\n","utf8");
  await rename(join(target,runtimeName[platform]),
    join(target,appName[platform]));
  // Electron's sample application is neither useful nor our product.
  await rm(join(target,"resources","default_app.asar"),{force:true});
  const note = [
    "BellekPad "+pkg.version+" — PORTABLE LIMITED BETA",
    "",
    platform==="win32" ? "Open BellekPad.exe in this directory." :
      "Open ./bellekpad. Linux may require a working Chromium sandbox helper.",
    "The whole folder must be extracted before running; do not execute inside an archive.",
    "There is no installer, signature, auto-update, automatic migration or crash recovery guarantee.",
    "Do not use irreplaceable notes; keep an independent backup.",
    "Notes are saved separately under the operating system's application data folder.",
    "Removing this portable folder does NOT remove your existing notes.",
    "LM Studio runs separately. Local AI is optional and only triggered explicitly.",
    ""
  ].join("\n");
  await writeFile(join(target,"BETA_README.txt"),note,"utf8");
  const manifest = {};
  for (const file of sources) {
    const bytes = await readFile(join(appRoot,file));
    manifest[file] = createHash("sha256").update(bytes).digest("hex");
  }
  await writeFile(join(target,"BETA_MANIFEST.json"),
    JSON.stringify({version:pkg.version,platform,architecture,files:manifest},null,2)+"\n");
  return Object.freeze({target,folder,version:pkg.version,platform,
    executable:join(target,appName[platform]),files:sources});
}

if (process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await assembleBetaPortable();
    console.log("BETA_PORTABLE_READY",JSON.stringify({
      folder:result.folder,platform:result.platform,
      appFiles:result.files.length
    }));
  } catch(error) {
    console.error("BETA_PORTABLE_FAILED:",error?.message || "UNEXPECTED");
    process.exitCode = 1;
  }
}

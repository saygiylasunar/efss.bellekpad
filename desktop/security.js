import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ORIGIN = "bellekpad://app";
export const APP_HOME = APP_ORIGIN + "/index.html";

// Nothing outside this explicit, checked-in list can be served via the
// privileged application scheme. User Markdown, secrets and local vault files
// are NOT addressable as URLs.
export const BUNDLED_PATHS = Object.freeze([
  "/index.html", "/app.js", "/styles.css",
  "/src/ast.js", "/src/editor-draft.js",
  "/src/editor-text-engine.js", "/src/editor-input-adapter.js",
  "/src/editor-block-model.js",
  "/src/editor-flow-model.js", "/src/editor-flow-adapter.js",
  "/src/editor-inline-format.js", "/src/inline-rules.js", "/src/semantics.js",
  "/src/binding-syntax.js", "/src/contract.js"
]);
const ALLOWED = new Set(BUNDLED_PATHS);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function resolveBundledAsset(requestURL, method = "GET") {
  if (method !== "GET") return null;
  let url;
  try { url = new URL(requestURL); }
  catch { return null; }
  if (url.protocol !== "bellekpad:" || url.host !== "app" ||
      url.username || url.password || url.port || url.search || url.hash ||
      !ALLOWED.has(url.pathname)) return null;
  const relative = url.pathname.startsWith("/src/") ?
    url.pathname.slice(1) : "desktop/ui" + url.pathname;
  return resolve(PROJECT_ROOT, relative);
}

export function isTrustedEditorFrame({ senderURL, isMainFrame } = {}) {
  return isMainFrame === true && senderURL === APP_HOME;
}

export const DESKTOP_CHANNELS = Object.freeze({
  list: "bellekpad:documents:list",
  open: "bellekpad:documents:open",
  create: "bellekpad:documents:create",
  save: "bellekpad:documents:save"
});

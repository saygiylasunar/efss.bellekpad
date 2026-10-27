import { app, BrowserWindow, ipcMain, Menu, protocol, session, dialog } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopDocumentService } from "../src/desktop-document-service.js";
import { LocalDocumentVault } from "../src/local-document-vault.js";
import { createDesktopModelService } from "./local-model-service.js";
import { createOwnedModelRunner } from "./owned-model-runner.js";
import {
  APP_HOME, DESKTOP_CHANNELS, isTrustedEditorFrame, resolveBundledAsset
} from "./security.js";
import { shouldBlockWindowShortcut } from "./window-controls.js";

protocol.registerSchemesAsPrivileged([
  { scheme: "bellekpad",
    privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

app.setName("BellekPad");
// Do not expose Electron’s default File/Edit/View/Developer application menu.
Menu.setApplicationMenu(null);

let window = null;
const knownErrors = new Set([
  "INVALID_DOCUMENT_REQUEST", "INVALID_DOCUMENT_TITLE",
  "INVALID_DOCUMENT_BODY", "INVALID_DOCUMENT_REVISION",
  "DOCUMENT_REVISION_REQUIRED", "DOCUMENT_NOT_FOUND",
  "DOCUMENT_VERSION_CONFLICT", "DOCUMENT_ALREADY_EXISTS",
  "DOCUMENT_TOO_LARGE", "DOCUMENT_BUSY", "UNSAFE_DOCUMENT_FILE",
  "UNSAFE_VAULT_DIRECTORY", "INVALID_DOCUMENT_IDENTITY",
  "CONSTANT_DEFINITION_IMMUTABLE",
  "BAD_MODEL_LIST", "BAD_MODEL", "PROVIDER_HTTP_ERROR",
  "TRANSPORT_ERROR", "TIMEOUT", "BAD_RESPONSE",
  "RESPONSE_TOO_LARGE", "MODEL_LIST_TOO_LARGE",
  "INVALID_CHAT_REQUEST", "MODEL_BUSY", "CANCELLED", "BAD_CHAT_RESPONSE", "BAD_INPUT",
  "MODEL_RUNNER_BUSY", "MODEL_RUNNER_INVALID_FILE", "MODEL_RUNNER_BAD_ENGINE",
  "MODEL_RUNNER_BAD_MODEL", "MODEL_RUNNER_START_FAILED", "MODEL_RUNNER_EXITED",
  "MODEL_RUNNER_TIMEOUT", "MODEL_RUNNER_NOT_CONFIGURED", "MODEL_RUNNER_CANCELLED",
  "MODEL_RUNNER_INVALID_PATH", "MODEL_RUNNER_INTERNAL"
]);

function trustedRequest(event) {
  return !!window && !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    isTrustedEditorFrame({
      senderURL: event.senderFrame?.url,
      isMainFrame: event.senderFrame === window.webContents.mainFrame
    });
}

function bindDesktopAPI(service, models, runner) {
  const operations = {
    [DESKTOP_CHANNELS.list]: () => service.list(),
    [DESKTOP_CHANNELS.open]: payload => service.open(payload),
    [DESKTOP_CHANNELS.create]: payload => service.create(payload),
    [DESKTOP_CHANNELS.save]: payload => service.saveDraft(payload),
    [DESKTOP_CHANNELS.models]: () => models.list(),
    [DESKTOP_CHANNELS.chat]: payload => models.chat(payload),
    [DESKTOP_CHANNELS.chatCancel]: payload => models.cancel(payload),
    [DESKTOP_CHANNELS.runnerStatus]: () => runner.status(),
    [DESKTOP_CHANNELS.runnerChoose]: async payload => {
      if (payload !== "engine" && payload !== "model")
        throw new Error("MODEL_RUNNER_INVALID_PATH");
      const selected = await dialog.showOpenDialog(window, {
        title: payload === "engine" ? "llama-server çalıştırıcısını seç" :
          "Yerel GGUF modelini seç",
        properties: ["openFile"],
        filters: payload === "model" ?
          [{name:"GGUF",extensions:["gguf"]}] :
          process.platform === "win32" ?
            [{name:"llama-server",extensions:["exe"]}] :
            [{name:"Bütün dosyalar",extensions:["*"]}]
      });
      if (selected.canceled || selected.filePaths.length !== 1) return runner.status();
      return runner.choose(payload, selected.filePaths[0]);
    },
    [DESKTOP_CHANNELS.runnerStart]: async () => {
      const started = await runner.start();
      models.useOwned({endpoint:started.endpoint,token:started.apiKey});
      return runner.status();
    },
    [DESKTOP_CHANNELS.runnerStop]: () => {
      models.useExternal();
      return runner.stop();
    }
  };
  for (const [channel, run] of Object.entries(operations)) {
    ipcMain.handle(channel, async (event, payload) => {
      if (!trustedRequest(event)) return { ok: false, error: "UNTRUSTED_FRAME" };
      try {
        const data = await run(payload);
        return { ok: true, data };
      } catch (error) {
        // Never echo OS paths, original source, private notes or stack traces.
        return { ok: false,
          error: knownErrors.has(error?.message) ? error.message : "INTERNAL_ERROR" };
      }
    });
  }
}

function createEditorWindow() {
  window = new BrowserWindow({
    title: "BellekPad",
    width: 1300, height: 850,
    minWidth: 760, minHeight: 540,
    backgroundColor: "#11161c",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(fileURLToPath(new URL(".", import.meta.url)), "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: false
    }
  });
  // Native title-bar close/minimize/maximize remain usable; Electron chrome
  // menus and DevTools are not part of BellekPad's end-user UI.
  window.setMenu(null);
  window.setMenuBarVisibility(false);
  window.webContents.on("before-input-event", (event, input) => {
    if (shouldBlockWindowShortcut(input)) event.preventDefault();
  });
  window.webContents.on("devtools-opened", () => {
    window?.webContents.closeDevTools();
  });
  window.webContents.on("context-menu", (_event, params) => {
    // Preserve familiar editing commands without Chromium's Inspect menu.
    if (!params.isEditable) return;
    const actions = ["cut", "copy", "paste", "selectAll"];
    Menu.buildFromTemplate(actions.map(role => ({ role }))).popup({ window });
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, destination) => {
    if (destination !== APP_HOME) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", event => event.preventDefault());
  window.on("closed", () => { window = null; });
  window.loadURL(APP_HOME).catch(() => {
    // No remote fallback, no user documents included in error reporting.
    if (window && !window.isDestroyed()) window.close();
  });
}

app.whenReady().then(() => {
  protocol.handle("bellekpad", async request => {
    const filename = resolveBundledAsset(request.url, request.method);
    if (!filename) return new Response("Not found", { status: 404 });
    const mime = filename.endsWith(".js") ? "text/javascript; charset=utf-8" :
      filename.endsWith(".css") ? "text/css; charset=utf-8" :
        "text/html; charset=utf-8";
    try {
      const bytes = await readFile(filename);
      return new Response(bytes, {
        headers: { "Content-Type": mime, "X-Content-Type-Options": "nosniff" }
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, answer) => {
    answer(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  const vault = new LocalDocumentVault({ root: join(app.getPath("userData"), "vault") });
  const models = createDesktopModelService();
  const runner = createOwnedModelRunner();
  bindDesktopAPI(createDesktopDocumentService({ vault }), models, runner);
  app.on("before-quit", () => {models.dispose(); runner.stop();});
  createEditorWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createEditorWindow();
  });
}).catch(() => app.quit());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

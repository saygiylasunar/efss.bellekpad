"use strict";

// Electron's sandboxed preload permits the Electron bridge, not arbitrary
// Node imports. Never export ipcRenderer or a caller-supplied channel.
const { contextBridge, ipcRenderer } = require("electron");

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("bellekpadDesktop", Object.freeze({
    listDocuments: () => ipcRenderer.invoke("bellekpad:documents:list"),
    listLocalModels: () => ipcRenderer.invoke("bellekpad:models:list"),
    chatLocalModel: (requestId, model, prompt) =>
      ipcRenderer.invoke("bellekpad:models:chat", { requestId, model, prompt }),
    cancelLocalChat: (requestId) =>
      ipcRenderer.invoke("bellekpad:models:chat:cancel", { requestId }),
    runnerStatus: () => ipcRenderer.invoke("bellekpad:runner:status"),
    runnerChoose: (kind) => ipcRenderer.invoke("bellekpad:runner:choose", kind),
    runnerStart: () => ipcRenderer.invoke("bellekpad:runner:start"),
    runnerStop: () => ipcRenderer.invoke("bellekpad:runner:stop"),
    openDocument: (kind, id) =>
      ipcRenderer.invoke("bellekpad:documents:open", { kind, id }),
    createDocument: (kind, title) =>
      ipcRenderer.invoke("bellekpad:documents:create", { kind, title }),
    saveDraft: (draft) =>
      ipcRenderer.invoke("bellekpad:documents:save", {
        kind: draft.kind, id: draft.id, title: draft.title,
        body: draft.body, expectedRevision: draft.expectedRevision
      })
  }));
}

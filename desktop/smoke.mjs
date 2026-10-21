// CI-only Electron GUI smoke runner. No external editor/UI test packages.
// Importing the real main entry exercises the same sandbox and IPC.
import "./main.js";
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function retry(label, predicate) {
  const end = Date.now() + 20000;
  let last;
  while (Date.now() < end) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) { last = error; }
    await sleep(80);
  }
  throw new Error(label + " timeout" + (last ? ": " + last.message : ""));
}
async function run() {
  await app.whenReady();
  const win = await retry("window", () => BrowserWindow.getAllWindows()[0]);
  await retry("trusted page", () => !win.webContents.isLoading() &&
    win.webContents.getURL() === "bellekpad://app/index.html");
  const page = code => win.webContents.executeJavaScript(code, true);
  assert.equal(win.webContents.isDevToolsOpened(), false);
  assert.equal(await page("typeof window.bellekpadDesktop"), "object");
  assert.equal(await page("!!document.querySelector('#show-flow')"), true);
  await page("document.querySelector('#new-document').click()");
  await retry("new document", () =>
    page("!document.querySelector('#editor-screen').hidden"));
  assert.equal(await page("!!document.querySelector('.flow-editable')"), true);

  await page('(() => { for (const ch of "/callout") {' +
    ' const el = document.querySelector(".flow-editable"); el.focus();' +
    ' const selection = document.getSelection(); const child = el.firstChild || el;' +
    ' const n = child.nodeType === 3 ? child.length : 0;' +
    ' selection.setBaseAndExtent(child,n,child,n);' +
    ' el.dispatchEvent(new InputEvent("beforeinput",{' +
    ' bubbles:true,cancelable:true,inputType:"insertText",data:ch})); } })()');
  await retry("visual callout", () =>
    page("!!document.querySelector('.flow-callout .flow-editable')"));
  await page('(() => { const el=document.querySelector(".flow-callout .flow-editable");' +
    'el.focus();el.dispatchEvent(new InputEvent("beforeinput",{' +
    'bubbles:true,cancelable:true,inputType:"insertText",data:"Deneme 😀"}));})()');
  await retry("callout text", () =>
    page("document.querySelector('.flow-callout .flow-editable')?.textContent === 'Deneme 😀'"));
  await page("document.querySelector('#save').click()");
  await retry("vault saved", () =>
    page("document.querySelector('#save-state').textContent === 'Kaydedildi'"));
  const records = await page("window.bellekpadDesktop.listDocuments()");
  assert.equal(records.ok, true);
  assert.ok(records.data.length > 0);
  const note = records.data.at(-1);
  const expression = "window.bellekpadDesktop.openDocument(" +
    JSON.stringify(note.kind) + "," + JSON.stringify(note.id) + ")";
  const opened = await page(expression);
  assert.equal(opened.ok, true);
  assert.match(opened.data.body, /:::efss.callout/);
  assert.match(opened.data.body, /Deneme 😀/);
  await page("document.querySelector('#show-write').click()");
  assert.equal(await page("!document.querySelector('#write-pane').hidden"), true);
  assert.equal(await page("document.querySelector('#editor').textContent.includes(':::efss.callout')"), true);
  await page("document.querySelector('#show-flow').click()");
  assert.equal(await page("!!document.querySelector('.flow-callout')"), true);
  await page("document.querySelector('#show-preview').click()");
  assert.equal(await page("!document.querySelector('#preview-pane').hidden"), true);
  console.log("DESKTOP GUI SMOKE PASSED — shell, slash callout, save/open, views.");
  win.close(); app.quit();
}
run().catch(error => {
  console.error("DESKTOP GUI SMOKE FAILED:", error.message);
  app.exit(1);
});

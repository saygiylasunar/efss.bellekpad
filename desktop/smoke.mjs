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
    ' const selection = document.getSelection(); const walk=document.createTreeWalker(el,4);' +
    ' let leaf=null,part; while((part=walk.nextNode())) leaf=part;' +
    ' const child=leaf||el; const n=leaf?leaf.length:0;' +
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
  await page('document.querySelector("#insert-kind").value="heading";' +
    'document.querySelector("#insert-block").click()');
  await retry("visual heading inserted", () =>
    page("!!document.querySelector('.flow-heading .flow-editable')"));
  await page('(() => { const el=document.querySelector(".flow-heading .flow-editable");' +
    'el.focus(); el.dispatchEvent(new InputEvent("beforeinput",{' +
    'bubbles:true,cancelable:true,inputType:"insertText",data:"Başlık"}));})()');
  await retry("heading typed", () =>
    page("document.querySelector('.flow-heading .flow-editable')?.textContent === 'Başlık'"));
  await page("document.querySelector('#undo').click()");
  await retry("undo heading text", () =>
    page("document.querySelector('.flow-heading .flow-editable')?.textContent === ''"));
  await page("document.querySelector('#redo').click()");
  await retry("redo heading text", () =>
    page("document.querySelector('.flow-heading .flow-editable')?.textContent === 'Başlık'"));
  // Format a selection in the *visual* heading without exposing Markdown
  // markers to its text surface, then verify that the same source persists.
  await page('(() => { const el=document.querySelector(".flow-heading .flow-editable");' +
    'el.focus(); const t=el.querySelector(".flow-run").firstChild;' +
    'document.getSelection().setBaseAndExtent(t,0,t,t.length);' +
    'document.querySelector("#format-bold").click(); })()');
  await retry("heading visually bold", () =>
    page("document.querySelector('.flow-heading .flow-editable strong')?.textContent === 'Başlık'"));
  await page('(() => { const t=document.querySelector(".flow-heading .flow-editable strong").firstChild;' +
    'const el=t.parentElement.parentElement; el.focus();' +
    'document.getSelection().setBaseAndExtent(t,t.length,t,t.length);' +
    'el.dispatchEvent(new InputEvent("beforeinput",{' +
    'bubbles:true,cancelable:true,inputType:"insertText",data:"!"}));})()');
  await retry("type within bold run", () =>
    page("document.querySelector('.flow-heading .flow-editable strong')?.textContent === 'Başlık!'"));
  await page("document.querySelector('#undo').click()");
  await retry("undo bold content edit", () =>
    page("document.querySelector('.flow-heading .flow-editable strong')?.textContent === 'Başlık'"));
  await page("document.querySelector('#redo').click()");
  await retry("redo bold content edit", () =>
    page("document.querySelector('.flow-heading .flow-editable strong')?.textContent === 'Başlık!'"));
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
  assert.match(opened.data.body, /# \*\*Başlık!\*\*/);
  await page("document.querySelector('#show-write').click()");
  assert.equal(await page("!document.querySelector('#write-pane').hidden"), true);
  assert.equal(await page("document.querySelector('#editor').textContent.includes(':::efss.callout')"), true);
  await page("document.querySelector('#show-flow').click()");
  assert.equal(await page("!!document.querySelector('.flow-callout')"), true);
  await page("document.querySelector('#show-preview').click()");
  assert.equal(await page("!document.querySelector('#preview-pane').hidden"), true);

  // G0.6A: exercise actual Electron DOM selection over plain + bold + plain.
  // Source mode inserts two *visible* text fragments; the Flow mode then
  // applies strike to the entire mixed selection with a reversed mouse range.
  await page("document.querySelector('#show-write').click()");
  await page(`(() => {
    const el = document.querySelector("#editor");
    const at = el.textContent.indexOf("**Başlık!**");
    if (at < 0) throw new Error("missing source marker");
    el.focus();
    document.getSelection().setBaseAndExtent(el.firstChild, at, el.firstChild, at);
    el.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType: "insertText", data: "Önce "
    }));
  })()`);
  await page(`(() => {
    const el = document.querySelector("#editor");
    const at = el.textContent.indexOf("**Başlık!**") + "**Başlık!**".length;
    if (at < 0) throw new Error("missing source marker");
    el.focus();
    document.getSelection().setBaseAndExtent(el.firstChild, at, el.firstChild, at);
    el.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType: "insertText", data: " son"
    }));
  })()`);
  await retry("mixed source created", () => page(
    'document.querySelector("#editor").textContent.includes("# Önce **Başlık!** son")'
  ));
  await page("document.querySelector('#show-flow').click()");
  await page(`(() => {
    const el = document.querySelector(".flow-heading .flow-editable");
    const runs = [...el.querySelectorAll(".flow-run")];
    if (runs.length < 3) throw new Error("mixed run projection missing");
    const first = runs[0].firstChild;
    const last = runs.at(-1).firstChild;
    if (first.nodeType !== 3 || last.nodeType !== 3)
      throw new Error("unexpected visual text layout");
    el.focus();
    document.getSelection().setBaseAndExtent(last, last.length, first, 0);
    document.querySelector("#format-strike").click();
  })()`);
  await retry("mixed run strike preserved strong", () => page(`(() => {
    const el = document.querySelector(".flow-heading .flow-editable");
    return el?.textContent === "Önce Başlık! son" &&
      el.querySelector("s strong")?.textContent === "Başlık!";
  })()`));
  await page("document.querySelector('#undo').click()");
  await retry("undo mixed mark", () => page(
    "!document.querySelector('.flow-heading .flow-editable s') && " +
    "document.querySelector('.flow-heading .flow-editable strong')?.textContent === 'Başlık!'"
  ));
  assert.equal(await page("document.getSelection()?.toString()"),
    "Önce Başlık! son"); // Undo restored the backward native selection.
  await page("document.querySelector('#redo').click()");
  await retry("redo mixed mark", () => page(
    "document.querySelector('.flow-heading .flow-editable s strong')?.textContent === 'Başlık!'"
  ));
  await page("document.querySelector('#save').click()");
  await retry("mixed mark saved", () =>
    page("document.querySelector('#save-state').textContent === 'Kaydedildi'"));
  const richOpened = await page(expression);
  assert.equal(richOpened.ok, true);
  assert.ok(richOpened.data.body.includes("# ~~Önce **Başlık!** son~~"));
  assert.match(richOpened.data.body, /:::efss.callout/);
  console.log("DESKTOP GUI SMOKE PASSED — G0.6A reverse mixed-run selection/undo/redo/vault.");
  win.close(); app.quit();
}
run().catch(error => {
  console.error("DESKTOP GUI SMOKE FAILED:", error.message);
  app.exit(1);
});

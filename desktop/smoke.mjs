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
  // UI theme and packaged, original vector icons must work completely offline.
  assert.equal(await page("document.querySelector('#undo svg[data-icon=undo]') !== null"), true);
  assert.equal(await page("document.querySelector('#save svg[data-icon=save]') !== null"), true);
  assert.equal(await page("getComputedStyle(document.documentElement)" +
    ".getPropertyValue('--font-ui').includes('All Round Gothic')"), true);
  assert.equal(await page("document.styleSheets.length === 1"), true);
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
  assert.equal(await page("!!document.querySelector('.flow-callout-header svg[data-icon=info]')"), true);
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
  // G0.6A regression: reversed selection across styled and plain runs must
  // NEVER consume hidden Markdown delimiters or create an undo entry.
  const existingIds = new Set((await page("window.bellekpadDesktop.listDocuments()"))
    .data.map(item => item.id));
  const priorId = await page("document.querySelector('#document-id').textContent");
  await page("document.querySelector('#new-document').click()");
  await retry("new regression note", () =>
    page("!document.querySelector('#editor-screen').hidden && " +
      "document.querySelector('#document-id').textContent !== " + JSON.stringify(priorId)));
  await page("document.querySelector('#show-write').click()");
  const rawRegressionNote = "A **kalın** B\n\n:::efss.unknown\nsecret: x\n:::\n";
  await page('(() => { const e=document.querySelector("#editor"); e.focus();' +
    'e.textContent=' + JSON.stringify(rawRegressionNote) + ';' +
    'e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText"})); })()');
  await retry("source ready", () =>
    page("document.querySelector('#editor').textContent.includes('**kalın**')"));
  await page("document.querySelector('#show-flow').click()");
  await retry("rich paragraph", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'kalın'"));
  await page('(() => { const el=document.querySelector(".flow-paragraph .flow-editable");' +
    'const bold=el.querySelector("strong").firstChild;' +
    'const spans=el.querySelectorAll("[data-inline-run]");' +
    'const last=spans[spans.length-1].firstChild;' +
    'el.focus();document.getSelection().setBaseAndExtent(last,last.length,bold,0);' +
    'el.dispatchEvent(new InputEvent("beforeinput",{' +
    'bubbles:true,cancelable:true,inputType:"deleteContentBackward"}));})()');
  assert.equal(await page("document.querySelector('.flow-paragraph .flow-editable')?.textContent"),
    "A kalın B");
  // Focus at the *start of the strong DOM leaf*: source offset must be after
  // the opening **, not at the previous plain run's end.
  await page('(() => {const el=document.querySelector(".flow-paragraph .flow-editable");' +
    'const t=el.querySelector("strong").firstChild;el.focus();' +
    'document.getSelection().setBaseAndExtent(t,0,t,0);' +
    'el.dispatchEvent(new InputEvent("beforeinput",{' +
    'bubbles:true,cancelable:true,inputType:"insertText",data:"ğ"}));})()');
  await retry("strong-run prefix insertion", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'ğkalın'"));
  await page('(() => {const el=document.querySelector(".flow-paragraph .flow-editable");' +
    'const t=el.querySelector("strong").firstChild;el.focus();' +
    'document.getSelection().setBaseAndExtent(t,t.length,t,t.length);' +
    'el.dispatchEvent(new InputEvent("beforeinput",{' +
    'bubbles:true,cancelable:true,inputType:"insertText",data:"👩‍👧"}));})()');
  await retry("strong-run emoji suffix", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'ğkalın👩‍👧'"));
  await page("document.querySelector('#undo').click()");
  await retry("emoji undo", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'ğkalın'"));
  await page("document.querySelector('#redo').click()");
  await retry("emoji redo", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'ğkalın👩‍👧'"));
  await page("document.querySelector('#save').click()");
  await retry("rich note saved", () =>
    page("document.querySelector('#save-state').textContent === 'Kaydedildi'"));
  const richNotes = await page("window.bellekpadDesktop.listDocuments()");
  assert.equal(richNotes.ok, true);
  const lastNote = richNotes.data.find(item => !existingIds.has(item.id));
  assert.ok(lastNote, "new regression document must be selected by identity, not sort order");
  const readRich = await page("window.bellekpadDesktop.openDocument(" +
    JSON.stringify(lastNote.kind) + "," + JSON.stringify(lastNote.id) + ")");
  assert.equal(readRich.ok, true);
  assert.match(readRich.data.body, /A \*\*ğkalın👩‍👧\*\* B/);
  assert.match(readRich.data.body, /:::efss.unknown/);
  console.log("DESKTOP GUI SMOKE PASSED — Flow inline formatting, undo/redo, local vault, views.");
  win.close(); app.quit();
}
run().catch(error => {
  console.error("DESKTOP GUI SMOKE FAILED:", error.message);
  app.exit(1);
});

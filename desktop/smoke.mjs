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
  // G0.6A.2: complete marked runs may be atomically replaced; partial
  // selections still refuse to consume invisible delimiters.
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
  await retry("fully selected bold-plus-plain deletion", () =>
    page("document.querySelector('.flow-paragraph .flow-editable')?.textContent === 'A '"));
  await page("document.querySelector('#undo').click()");
  await retry("mixed deletion undo preserves strong", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'kalın'"));
  // Partial rich selection can now split a mark while retaining its prefix.
  await page('(() => { const el=document.querySelector(".flow-paragraph .flow-editable");' +
    'const bold=el.querySelector("strong").firstChild;' +
    'const spans=el.querySelectorAll("[data-inline-run]");' +
    'const last=spans[spans.length-1].firstChild;' +
    'el.focus();document.getSelection().setBaseAndExtent(last,last.length,bold,2);' +
    'el.dispatchEvent(new InputEvent("beforeinput",{' +
    'bubbles:true,cancelable:true,inputType:"deleteContentBackward"}));})()');
  await retry("partial deletion preserves remaining bold prefix", () =>
    page("document.querySelector('.flow-paragraph .flow-editable')?.textContent === 'A ka'"));
  await page("document.querySelector('#undo').click()");
  await retry("partial deletion undo restores full marked run", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'kalın'"));
  // The entire mixed selection can be struck through, preserving bold.
  await page('(() => { const el=document.querySelector(".flow-paragraph .flow-editable");' +
    'const bold=el.querySelector("strong").firstChild;' +
    'const spans=el.querySelectorAll("[data-inline-run]");' +
    'const last=spans[spans.length-1].firstChild;' +
    'el.focus();document.getSelection().setBaseAndExtent(bold,0,last,last.length);' +
    'document.querySelector("#format-strike").click();})()');
  await retry("mixed strike keeps bold", () =>
    page("document.querySelector('.flow-paragraph s strong')?.textContent === 'kalın'"));
  await page("document.querySelector('#undo').click()");
  await retry("mixed strike undo", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'kalın' && " +
    "document.querySelector('.flow-paragraph s') === null"));
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

  // Reverse DOM selection across two nested wrappers in the real Electron
  // renderer. Editing, undo/redo, and vault persistence share one source.
  await page("document.querySelector('#show-write').click()");
  const nestedSource = "A ~~sil **kalın** metin~~ Z\n\n:::efss.unknown\nsecret: y\n:::\n";
  await page('(() => {const e=document.querySelector("#editor");e.focus();' +
    'e.textContent=' + JSON.stringify(nestedSource) + ';' +
    'e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText"}));})()');
  await retry("nested source loaded", () =>
    page("document.querySelector('#editor').textContent.includes('~~sil **kalın** metin~~')"));
  await page("document.querySelector('#show-flow').click()");
  await retry("nested run projection", () =>
    page("document.querySelector('.flow-paragraph s strong')?.textContent === 'kalın'"));
  await page('(() => {const el=document.querySelector(".flow-paragraph .flow-editable");' +
    'const bold=el.querySelector("s strong").firstChild;' +
    'const spans=el.querySelectorAll("[data-inline-run]");' +
    'const tail=spans[spans.length-1].firstChild;el.focus();' +
    'document.getSelection().setBaseAndExtent(tail,tail.length,bold,2);' +
    'el.dispatchEvent(new InputEvent("beforeinput",{' +
    'bubbles:true,cancelable:true,inputType:"insertText",data:"yenisi"}));})()');
  await retry("nested balanced mixed edit", () =>
    page("document.querySelector('.flow-paragraph .flow-editable')?.textContent === 'A sil kayenisi'"));
  await page("document.querySelector('#undo').click()");
  await retry("nested edit undo", () =>
    page("document.querySelector('.flow-paragraph s strong')?.textContent === 'kalın'"));
  await page("document.querySelector('#redo').click()");
  await retry("nested edit redo", () =>
    page("document.querySelector('.flow-paragraph .flow-editable')?.textContent === 'A sil kayenisi'"));
  await page("document.querySelector('#save').click()");
  await retry("nested note saved", () =>
    page("document.querySelector('#save-state').textContent === 'Kaydedildi'"));
  const savedNested = await page("window.bellekpadDesktop.openDocument(" +
    JSON.stringify(lastNote.kind) + "," + JSON.stringify(lastNote.id) + ")");
  assert.equal(savedNested.ok, true);
  assert.match(savedNested.data.body, /A ~~sil [*][*]ka[*][*]~~yenisi/);
  assert.match(savedNested.data.body, /:::efss.unknown\nsecret: y\n:::/);

  // G0.6A.2: reverse selection across a partial bold run + plain text.
  // Formatting must preserve both the source markers and DOM selection
  // direction, including undo/redo and exact local-vault persistence.
  await page("document.querySelector('#show-write').click()");
  const mixedFormatSource = "A **kalın** B\n\n:::efss.unknown\nsecret: format\n:::\n";
  await page('(() => {const e=document.querySelector("#editor");e.focus();' +
    'e.textContent=' + JSON.stringify(mixedFormatSource) + ';' +
    'e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText"}));})()');
  await retry("mixed source loaded", () =>
    page("document.querySelector('#editor').textContent.includes('**kalın** B')"));
  await page("document.querySelector('#show-flow').click()");
  await retry("rich formatting paragraph", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'kalın'"));
  await page('(() => {const el=document.querySelector(".flow-paragraph .flow-editable");' +
    'const bold=el.querySelector("strong").firstChild;' +
    'const runs=el.querySelectorAll("[data-inline-run]");' +
    'const tail=runs[runs.length-1].firstChild;el.focus();' +
    'document.getSelection().setBaseAndExtent(tail,tail.length,bold,2);' +
    'document.querySelector("#format-strike").click();})()');
  await retry("reverse mixed strike", () =>
    page("document.querySelector('.flow-paragraph s strong')?.textContent === 'lın' && " +
      "document.querySelector('.flow-paragraph .flow-editable')?.textContent === 'A kalın B'"));
  assert.equal(await page('(() => {const s=document.getSelection();' +
    'return s.anchorNode?.textContent === " B" && s.focusNode?.textContent === "lın";})()'), true);
  await page("document.querySelector('#undo').click()");
  await retry("partial mixed mark undo", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'kalın' && " +
      "document.querySelector('.flow-paragraph s') === null"));
  assert.equal(await page('(() => {const s=document.getSelection();' +
    'return s.anchorNode?.textContent === " B" && s.focusNode?.textContent === "kalın";})()'), true);
  await page("document.querySelector('#redo').click()");
  await retry("partial mixed mark redo", () =>
    page("document.querySelector('.flow-paragraph s strong')?.textContent === 'lın'"));
  // Redo must reproduce the formatted reverse selection as well as its text.
  assert.equal(await page('(() => {const s=document.getSelection();' +
    'return s.anchorNode?.textContent === " B" && s.focusNode?.textContent === "lın";})()'), true);
  await page("document.querySelector('#save').click()");
  await retry("partial mixed note saved", () =>
    page("document.querySelector('#save-state').textContent === 'Kaydedildi'"));
  const storedPartial = await page("window.bellekpadDesktop.openDocument(" +
    JSON.stringify(lastNote.kind) + "," + JSON.stringify(lastNote.id) + ")");
  assert.equal(storedPartial.ok, true);
  assert.match(storedPartial.data.body, /A [*][*]ka[*][*]~~[*][*]lın[*][*] B~~/);
  assert.match(storedPartial.data.body, /:::efss.unknown\nsecret: format\n:::/);

  // Regression: plain-run formatting must not reinterpret adjacent * and **.
  await page("document.querySelector('#show-write').click()");
  const markerGuard = "A *x*y\n\n:::efss.unknown\nsecret: guard\n:::\n";
  await page('(() => {const e=document.querySelector("#editor");e.focus();' +
    'e.textContent=' + JSON.stringify(markerGuard) + ';' +
    'e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText"}));})()');
  await retry("marker guard source loaded", () =>
    page("document.querySelector('#editor').textContent.includes('*x*y')"));
  await page("document.querySelector('#show-flow').click()");
  await retry("marker guard visible", () =>
    page("document.querySelector('.flow-paragraph .flow-editable')?.textContent === 'A xy'"));
  await page('(() => {const el=document.querySelector(".flow-paragraph .flow-editable");' +
    'const leaf=el.querySelectorAll("[data-inline-run]");' +
    'const last=leaf[leaf.length-1].firstChild;el.focus();' +
    'document.getSelection().setBaseAndExtent(last,0,last,last.length);' +
    'document.querySelector("#format-bold").click();})()');
  assert.equal(await page("document.querySelector('.flow-paragraph .flow-editable')?.textContent"), "A xy");
  await page("document.querySelector('#show-write').click()");
  assert.equal(await page("document.querySelector('#editor').textContent.includes('A *x*y')"), true);

  // Toggling B inside an existing B run removes B only from the selection,
  // rather than writing an ineffective nested ** wrapper. Undo restores it.
  await page("document.querySelector('#show-write').click()");
  const toggleSource = "A **kalın** B\n\n:::efss.unknown\nsecret: toggle\n:::\n";
  await page('(() => {const e=document.querySelector("#editor");e.focus();' +
    'e.textContent=' + JSON.stringify(toggleSource) + ';' +
    'e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText"}));})()');
  await retry("partial toggle source loaded", () =>
    page("document.querySelector('#editor').textContent.includes('**kalın** B')"));
  await page("document.querySelector('#show-flow').click()");
  await retry("partial toggle bold available", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'kalın'"));
  await page('(() => {const el=document.querySelector(".flow-paragraph .flow-editable");' +
    'const bold=el.querySelector("strong").firstChild;el.focus();' +
    'document.getSelection().setBaseAndExtent(bold,3,bold,1);' +
    'document.querySelector("#format-bold").click();})()');
  await retry("partial bold toggle preserves left and right strong", () =>
    page("Array.from(document.querySelectorAll('.flow-paragraph strong'))" +
      ".map(el=>el.textContent).join(',') === 'k,ın'"));
  await page("document.querySelector('#undo').click()");
  await retry("partial bold toggle undo", () =>
    page("document.querySelector('.flow-paragraph strong')?.textContent === 'kalın'"));
  await page("document.querySelector('#redo').click()");
  await retry("partial bold toggle redo", () =>
    page("Array.from(document.querySelectorAll('.flow-paragraph strong'))" +
      ".map(el=>el.textContent).join(',') === 'k,ın'"));

  // G0.6B.1: Enter continues a bullet item, focuses the new list item,
  // exits on the next empty-item Enter, and respects Undo/Redo.
  await page("document.querySelector('#show-write').click()");
  const bulletEnterSource = "- Birinci\n\n:::efss.unknown\nopaque: stay\n:::\n";
  await page('(() => {const e=document.querySelector("#editor");e.focus();' +
    'e.textContent=' + JSON.stringify(bulletEnterSource) + ';' +
    'e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText"}));})()');
  await retry("bullet source set", () =>
    page("document.querySelector('#editor').textContent.includes('- Birinci')"));
  await page("document.querySelector('#show-flow').click()");
  await retry("bullet visible", () =>
    page("document.querySelector('.flow-list_item .flow-editable')?.textContent === 'Birinci'"));
  await page('(() => {const el=document.querySelector(".flow-list_item .flow-editable");' +
    'const t=el.querySelector("[data-inline-run]").firstChild;el.focus();' +
    'document.getSelection().setBaseAndExtent(t,t.length,t,t.length);' +
    'el.dispatchEvent(new InputEvent("beforeinput",{' +
    'bubbles:true,cancelable:true,inputType:"insertParagraph"}));})()');
  await retry("bullet Enter continues", () =>
    page("document.querySelectorAll('.flow-list_item').length === 2"));
  assert.equal(await page('document.activeElement?.closest(".flow-list_item")' +
    '?.querySelector(".flow-editable")?.textContent === ""'), true);
  await page('(() => {const el=document.activeElement;' +
    'el.dispatchEvent(new InputEvent("beforeinput",{' +
    'bubbles:true,cancelable:true,inputType:"insertParagraph"}));})()');
  await retry("empty bullet Enter exits list", () =>
    page("document.querySelectorAll('.flow-list_item').length === 1"));
  await page("document.querySelector('#undo').click()");
  await retry("bullet exit undo", () =>
    page("document.querySelectorAll('.flow-list_item').length === 2"));
  await page("document.querySelector('#redo').click()");
  await retry("bullet exit redo", () =>
    page("document.querySelectorAll('.flow-list_item').length === 1"));
  await page("document.querySelector('#show-write').click()");
  assert.equal(await page('document.querySelector("#editor").textContent.includes("opaque: stay")'), true);
  console.log("DESKTOP GUI SMOKE PASSED — Flow inline formatting, undo/redo, local vault, views.");
  win.close(); app.quit();
}
run().catch(error => {
  console.error("DESKTOP GUI SMOKE FAILED:", error.message);
  app.exit(1);
});

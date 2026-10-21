import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldBlockWindowShortcut } from "../desktop/window-controls.js";

const root = new URL("../", import.meta.url);
const load = path => readFileSync(new URL(path, root), "utf8");

const down = (key, extras = {}) => ({
  type: "keyDown", key, control: false, meta: false, shift: false, alt: false,
  ...extras
});

test("Electron window has no DevTools, default menu or inspector UI", () => {
  const main = load("desktop/main.js");
  assert.match(main, /devTools:\s*false/);
  assert.doesNotMatch(main, /devTools:\s*true/);
  assert.match(main, /Menu\.setApplicationMenu\(null\)/);
  assert.match(main, /window\.setMenu\(null\)/);
  assert.match(main, /window\.setMenuBarVisibility\(false\)/);
  assert.match(main, /on\("before-input-event"/);
  assert.match(main, /on\("devtools-opened"/);
  assert.match(main, /closeDevTools\(\)/);
  assert.match(main, /on\("context-menu"/);
  assert.doesNotMatch(main, /openDevTools\(/);
  assert.doesNotMatch(main, /inspectElement\(/);
});

test("block DevTools and reload shortcuts while preserving text editing shortcuts", () => {
  for (const input of [
    down("F12"), down("F5"),
    down("I", { control: true, shift: true }),
    down("J", { control: true, shift: true }),
    down("C", { control: true, shift: true }),
    down("R", { control: true }),
    down("R", { control: true, shift: true }),
    down("I", { meta: true, shift: true }),
    down("R", { meta: true })
  ]) assert.equal(shouldBlockWindowShortcut(input), true, input.key);
  for (const input of [
    down("S", { control: true }), down("Z", { control: true }),
    down("V", { control: true }), down("C", { control: true }),
    down("A", { control: true }), down("B", { control: true }),
    down("F12", { type: "keyUp" }), down("i"),
    down("ArrowLeft"), down("Escape")
  ]) assert.equal(shouldBlockWindowShortcut(input), false, input.key);
});

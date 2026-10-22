import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ICON_NAMES, makeIcon, decorateUI } from "../src/ui-icons.js";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");

class MockElement {
  constructor(tag) {
    this.tagName = tag;
    this.attributes = Object.create(null);
    this.dataset = {};
    this.children = [];
    this.classList = { add: value => this.classNames.add(value) };
    this.classNames = new Set();
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  hasAttribute(key) { return Object.hasOwn(this.attributes, key); }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = [...children]; }
}
const document = { createElementNS: (_namespace, tag) => new MockElement(tag) };

test("all defined icons are self-contained, accessible decorative SVGs", () => {
  assert.ok(ICON_NAMES.length >= 16);
  assert.deepEqual(new Set(ICON_NAMES).size, ICON_NAMES.length);
  for (const name of ICON_NAMES) {
    const icon = makeIcon(document, name);
    assert.equal(icon.tagName, "svg");
    assert.equal(icon.attributes.viewBox, "0 0 24 24");
    assert.equal(icon.attributes["aria-hidden"], "true");
    assert.equal(icon.attributes.focusable, "false");
    assert.equal(icon.dataset.icon, name);
    assert.ok(icon.children.length >= 1);
    assert.ok(icon.children.every(child => ["path", "circle", "rect"].includes(child.tagName)));
    assert.ok(icon.children.every(child => Object.keys(child.attributes).every(key =>
      ["d", "x", "y", "width", "height", "rx", "cx", "cy", "r"].includes(key))));
  }
});
test("icons reject unknown names and unsafe sizes", () => {
  assert.throws(() => makeIcon(document, "<img src=x onerror=1>"), /UNKNOWN_UI_ICON/);
  assert.throws(() => makeIcon(document, "__proto__"), /UNKNOWN_UI_ICON/);
  assert.throws(() => makeIcon(document, "save", { size: 0 }), /INVALID_UI_ICON_SIZE/);
  assert.throws(() => makeIcon(document, "save", { size: 999 }), /INVALID_UI_ICON_SIZE/);
});
test("icon-only buttons require an accessible label", () => {
  const button = new MockElement("button");
  button.dataset.uiIcon = "undo";
  button.dataset.iconOnly = "true";
  const owner = Object.assign(Object.create(document), { querySelectorAll: () => [button] });
  assert.throws(() => decorateUI(owner), /UNLABELLED_ICON_CONTROL/);
  button.setAttribute("aria-label", "Geri al");
  decorateUI(owner);
  assert.equal(button.children[0].dataset.icon, "undo");
});
test("icons, fonts and packaging do not weaken offline desktop CSP", () => {
  const html = read("desktop/ui/index.html");
  const css = read("desktop/ui/styles.css");
  const app = read("desktop/ui/app.js");
  const flow = read("src/editor-flow-adapter.js");
  const security = read("desktop/security.js");
  const webExample = read("examples/adobe-fonts-web.html");
  assert.match(html, /style-src 'self'/);
  assert.match(html, /font-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<link[^>]+use\.typekit\.net/);
  assert.match(webExample, /<link rel="stylesheet" href="https:\/\/use\.typekit\.net\/aww8lcp\.css">/);
  for (const token of ["--font-ui", "--font-display", "--font-technical", "--font-document"])
    assert.ok(css.includes(token), token);
  for (const family of ["All Round Gothic", "Noka", "Exo"])
    assert.ok(css.includes(family), family);
  assert.match(security, /"\/src\/ui-icons\.js"/);
  assert.match(app, /decorateUI\(document\)/);
  assert.match(app, /makeIcon\(document/);
  assert.match(flow, /makeIcon\(doc, block\.variant/);
  assert.doesNotMatch(app, /innerHTML/);
  assert.doesNotMatch(flow, /innerHTML/);
});

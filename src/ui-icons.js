// BellekPad UI icon vocabulary: originally authored, package-free SVGs.
// Whitelisted symbols, no downloaded/icon-font assets, DOM-only render.
// Icons are decorative unless the containing control has an accessible label.
const NS = "http://www.w3.org/2000/svg";
const shapes = Object.freeze({
  new: [["path","M12 5v14M5 12h14"]],
  save: [["path","M5 3h12l4 4v14H3V3h2Zm2 0v7h10V3M7 21v-8h10v8"]],
  undo: [["path","M9 14 4 9l5-5M4 9h10a6 6 0 1 1 0 12"]],
  redo: [["path","m15 14 5-5-5-5m5 5H10a6 6 0 1 0 0 12"]],
  flow: [["rect","4 4 16 4 1"],["path","M4 13h16M4 18h12"]],
  source: [["path","m9 7-5 5 5 5m6-10 5 5-5 5M14 4l-4 16"]],
  preview: [["path","M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"],["circle","12 12 3"]],
  document: [["path","M6 2h8l5 5v15H6V2Zm8 0v6h5M9 12h7M9 16h7"]],
  layers: [["path","m12 3 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5"]],
  list: [["path","M9 6h12M9 12h12M9 18h12"],["circle","4 6 1"],["circle","4 12 1"],["circle","4 18 1"]],
  quote: [["path","M5 11h6v9H3v-9a7 7 0 0 1 7-7M16 11h5v9h-8v-9a7 7 0 0 1 7-7"]],
  info: [["circle","12 12 9"],["path","M12 11v6M12 7h.01"]],
  warning: [["path","m12 3 10 18H2L12 3Zm0 6v5m0 4h.01"]],
  tip: [["path","M9 18h6M10 21h4M9 15c-2-1.3-3-3.1-3-5a6 6 0 0 1 12 0c0 1.9-1 3.7-3 5v2H9v-2Z"]],
  success: [["circle","12 12 9"],["path","m7.5 12 3 3 6-6"]],
  error: [["circle","12 12 9"],["path","M9 9l6 6m0-6-6 6"]],
  code: [["path","m8 7-5 5 5 5m8-10 5 5-5 5"]],
  edit: [["path","M4 20h5L20 9a3 3 0 0 0-5-5L4 15v5Zm9-13 5 5"]],
  text: [["path","M4 5h16M12 5v15M8 20h8M4 5v4m16-4v4"]],
  more: [["circle","12 5 1"],["circle","12 12 1"],["circle","12 19 1"]]
});
export const ICON_NAMES = Object.freeze(Object.keys(shapes));
export function makeIcon(document, name, { size = 18 } = {}) {
  if (!Object.hasOwn(shapes, name)) throw new TypeError("UNKNOWN_UI_ICON");
  if (!Number.isInteger(size) || size < 12 || size > 32)
    throw new TypeError("INVALID_UI_ICON_SIZE");
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ui-icon");
  svg.dataset.icon = name;
  for (const [kind, instruction] of shapes[name]) {
    const element = document.createElementNS(NS, kind);
    const args = instruction.split(" ");
    if (kind === "circle") {
      element.setAttribute("cx", args[0]);
      element.setAttribute("cy", args[1]);
      element.setAttribute("r", args[2]);
    } else if (kind === "rect") {
      element.setAttribute("x", args[0]);
      element.setAttribute("y", args[1]);
      element.setAttribute("width", args[2]);
      element.setAttribute("height", args[3]);
      element.setAttribute("rx", args[4] ?? "0");
    } else element.setAttribute("d", instruction);
    svg.append(element);
  }
  return svg;
}
// Replace a purely decorative pre-existing glyph; keep button title/label.
export function decorateUI(root) {
  for (const node of root.querySelectorAll("[data-ui-icon]")) {
    const icon = makeIcon(root.ownerDocument ?? root, node.dataset.uiIcon);
    if (node.dataset.iconOnly === "true") {
      if (!node.hasAttribute("aria-label") && !node.hasAttribute("title"))
        throw new TypeError("UNLABELLED_ICON_CONTROL");
      node.replaceChildren(icon);
    } else node.prepend(icon);
  }
}

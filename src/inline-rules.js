const NAME = /^[a-z][a-z0-9_-]*$/;
const MARKER = /^[*!~%^+=_]{1,6}$/;

const BUILT_INS = Object.freeze([
  Object.freeze({ name: "strong", marker: "**" }),
  Object.freeze({ name: "emphasis", marker: "*" }),
  Object.freeze({ name: "strike", marker: "~~" })
]);

export class InlineRules {
  #entries = new Map();

  constructor(definitions = BUILT_INS) {
    if (!Array.isArray(definitions)) throw new TypeError("Rules must be an array");
    for (const definition of definitions) this.add(definition);
  }

  add({ name, marker } = {}) {
    if (typeof name !== "string" || !NAME.test(name) ||
        typeof marker !== "string" || !MARKER.test(marker)) {
      throw new Error("Invalid inline rule");
    }
    if (this.#entries.has(name) || [...this.#entries.values()].some(rule => rule.marker === marker)) {
      throw new Error("Duplicate inline rule");
    }
    this.#entries.set(name, Object.freeze({ name, marker }));
    return this;
  }

  list() {
    return [...this.#entries.values()].sort((a, b) =>
      b.marker.length - a.marker.length || a.name.localeCompare(b.name));
  }
}

export function createInlineRules() {
  return new InlineRules();
}

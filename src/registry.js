import { normalizeAlias } from "./semantics.js";
import { EFSS_CONTRACT } from "./contract.js";

const KINDS = new Set(EFSS_CONTRACT.kinds);
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

export class EntityRegistry {
  #entities = new Map();
  #aliases = new Map();

  register(entity) {
    if (!entity || !KINDS.has(entity.kind) || !ID.test(entity.id ?? "")) {
      throw new Error("Invalid entity identity");
    }
    if (typeof entity.label !== "string" || !entity.label.trim()) {
      throw new Error("An entity needs a label");
    }
    if (entity.body != null && typeof entity.body !== "string") throw new TypeError("Invalid body");
    if (entity.projectIds != null && (!Array.isArray(entity.projectIds) ||
        entity.projectIds.some((id) => !ID.test(id)))) throw new Error("Invalid project membership");
    if (entity.aliases != null && (!Array.isArray(entity.aliases) ||
        entity.aliases.some((a) => typeof a !== "string" || !a.trim()))) throw new Error("Invalid aliases");

    const key = `${entity.kind}:${entity.id}`;
    if (this.#entities.has(key)) throw new Error(`Duplicate entity: ${key}`);
    const names = [...new Set([entity.label, ...(entity.aliases ?? [])].map(normalizeAlias))];
    for (const name of names) {
      const byKind = this.#aliases.get(`${entity.kind}|${name}`);
      if (byKind) throw new Error(`Alias collision: ${entity.kind}`);
    }
    const copy = Object.freeze({ ...entity, aliases: Object.freeze([...(entity.aliases ?? [])]),
      projectIds: Object.freeze([...(entity.projectIds ?? [])]) });
    this.#entities.set(key, copy);
    for (const name of names) this.#aliases.set(`${entity.kind}|${name}`, key);
    return copy;
  }

  get(kind, id) { return this.#entities.get(`${kind}:${id}`) ?? null; }
  all() { return [...this.#entities.values()]; }

  resolve(target, expectedKind = null) {
    if (!target || typeof target !== "object") throw new TypeError("Invalid target");
    if (target.type === "id") {
      if (expectedKind && target.kind !== expectedKind) return { entity: null, error: "KIND_MISMATCH" };
      const entity = this.get(target.kind, target.id);
      return entity ? { entity, error: null } : { entity: null, error: "NOT_FOUND" };
    }
    if (!(["alias", "variable"].includes(target.type))) {
      return { entity: null, error: "BAD_TARGET" };
    }
    const kind = target.type === "variable" ? "variable" : expectedKind;
    if (target.type === "variable" && expectedKind && expectedKind !== "variable") {
      return { entity: null, error: "KIND_MISMATCH" };
    }
    const normalized = normalizeAlias(target.value);
    const ids = kind ? [this.#aliases.get(`${kind}|${normalized}`)].filter(Boolean) :
      [...this.#entities.values()].filter((e) => [e.label, ...e.aliases].some((s) => normalizeAlias(s) === normalized))
        .map((e) => `${e.kind}:${e.id}`);
    if (!ids.length) return { entity: null, error: "NOT_FOUND" };
    if (ids.length > 1) return { entity: null, error: "AMBIGUOUS_ALIAS" };
    return { entity: this.#entities.get(ids[0]), error: null };
  }
}

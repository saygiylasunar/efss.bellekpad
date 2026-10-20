const ID = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/;
const KINDS = new Set(["base", "prompt", "retrieval", "adapter", "routing", "evaluation"]);
const STAGES = new Set(["draft", "tested", "candidate", "accepted", "retired"]);

function identifier(value) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error("INVALID_EXPERIMENT_ID");
  return value;
}

export class ModelLab {
  #experiments = new Map();

  create({ id, title, baseModel, layers = [], datasetRefs = [], note = "" } = {}) {
    identifier(id);
    if (this.#experiments.has(id) || typeof title !== "string" || !title.trim() ||
        typeof baseModel !== "string" || !baseModel.trim() || baseModel.length > 240 ||
        !Array.isArray(layers) || !Array.isArray(datasetRefs) ||
        datasetRefs.some(ref => typeof ref !== "string" ||
          !/^(paper|conversation|dataset):[a-zA-Z0-9_-]+$/.test(ref)) ||
        typeof note !== "string" || note.length > 1000) throw new Error("INVALID_EXPERIMENT");
    const normalized = layers.map(layer => {
      if (!layer || !KINDS.has(layer.kind) || !identifier(layer.id))
        throw new Error("INVALID_EXPERIMENT_LAYER");
      return Object.freeze({ kind: layer.kind, id: layer.id });
    });
    const experiment = Object.freeze({ id, title, baseModel,
      layers: Object.freeze(normalized), datasetRefs: Object.freeze([...datasetRefs]),
      note, stage: "draft", results: Object.freeze([]) });
    this.#experiments.set(id, experiment);
    return experiment;
  }

  recordResult(id, { task, score, metric, evidence = null, details = "" } = {}) {
    const item = this.#experiments.get(id);
    if (!item || typeof task !== "string" || !task.trim() ||
        typeof metric !== "string" || !metric.trim() || metric.length > 100 ||
        typeof score !== "number" || !Number.isFinite(score) ||
        evidence !== null && (typeof evidence !== "string" || evidence.length > 200) ||
        typeof details !== "string" || details.length > 600)
      throw new Error("INVALID_EXPERIMENT_RESULT");
    const result = Object.freeze({ task, score, metric, evidence, details });
    const updated = Object.freeze({ ...item,
      results: Object.freeze([...item.results, result]), stage: "tested" });
    this.#experiments.set(id, updated);
    return updated;
  }

  setStage(id, stage) {
    const item = this.#experiments.get(id);
    if (!item || !STAGES.has(stage) ||
        (["candidate", "accepted"].includes(stage) && !item.results.length))
      throw new Error("INVALID_EXPERIMENT_STAGE");
    const updated = Object.freeze({ ...item, stage });
    this.#experiments.set(id, updated);
    return updated;
  }

  get(id) { return this.#experiments.get(id) ?? null; }
  all() { return [...this.#experiments.values()]; }
}

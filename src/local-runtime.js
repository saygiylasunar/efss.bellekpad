// Node-only integration; the browser-friendly EFSS core is exported from index.js.
export { classifyModelFile, scanModelDirectory, estimateFit } from "./model-catalog.js";
export { RuntimeLog, redactLogText } from "./runtime-log.js";
export { RuntimeSupervisor, planRuntimeCommand } from "./runtime-supervisor.js";
export { ModelLab } from "./model-lab.js";
export { classifyRuntimeFailure } from "./runtime-errors.js";
export { discoverConfiguredModels, modelCategoryPolicy } from "./model-discovery.js";
export { LocalDocumentVault } from "./local-document-vault.js";
export { LocalKnowledgeGraph } from "./local-knowledge-graph.js";

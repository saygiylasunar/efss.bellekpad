export const EFSS_CONTRACT = Object.freeze({
  documentVersion: "0.1.0",
  grammarVersion: "0.3.0-draft",
  kinds: Object.freeze(["paper", "project", "conversation", "variable", "mode", "person"]),
  actions: Object.freeze(["use", "scope", "mode", "goal"]),
  speakers: Object.freeze(["Person", "AI"]),
  syntax: Object.freeze({ variable: "&", bindingOpen: "{", bindingClose: "}", referenceOpen: "[[", referenceClose: "]]", command: "::" }),
  retrievalModes: Object.freeze(["off", "suggest", "include"])
});

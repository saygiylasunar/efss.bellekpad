import { normalizeAlias, scanSemantics } from "./semantics.js";
import { parseConversationBody } from "./conversation.js";
import { EFSS_CONTRACT } from "./contract.js";

const ACCESS = (entity) => entity.visibility !== "restricted";
const KEY = (entity) => `${entity.kind}:${entity.id}`;
const MATCHES = /[\p{L}\p{N}_]+/gu;

function words(value) {
  return new Set((normalizeAlias(value).match(MATCHES) ?? []).filter((word) => word.length > 1));
}

function scoreEntity(entity, query) {
  const requested = words(query);
  if (!requested.size) return 0;
  const labels = words([entity.label, ...entity.aliases].join(" "));
  const content = words(entity.body ?? "");
  let score = 0;
  for (const word of requested) {
    if (labels.has(word)) score += 5;
    if (content.has(word)) score += 1;
  }
  return score;
}

export function buildContext({ document, registry, query = "", retrieval = "suggest",
  maxChars = 12_000, maxSources = 12, canRead = ACCESS,
  activeTurn = null, actingSpeaker = "User" } = {}) {
  if (!document || typeof document.body !== "string" || !registry) {
    throw new TypeError("Document and registry are required");
  }
  if (!EFSS_CONTRACT.retrievalModes.includes(retrieval) ||
      !Number.isSafeInteger(maxChars) || maxChars < 0 ||
      !Number.isSafeInteger(maxSources) || maxSources < 0 ||
      typeof canRead !== "function") throw new Error("Invalid context options");

  let tokens;
  let errors;
  if (document.metadata?.kind === "conversation") {
    const turns = parseConversationBody(document.body);
    tokens = turns.flatMap((turn) => turn.tokens
      .filter((token) => token.type !== "directive" ||
        (turn.index === activeTurn && turn.speakerType === "Person" && turn.speaker === actingSpeaker))
      .map((token) => ({ ...token, start: token.start + turn.bodyStart,
        end: token.end + turn.bodyStart, turnIndex: turn.index })));
    errors = [];
  } else {
    ({ tokens, diagnostics: errors } = scanSemantics(document.body));
  }
  const diagnostics = [...errors];
  const scopes = tokens.filter((t) => t.type === "directive" && t.action === "scope");
  const scopeTargets = scopes.map((token) => ({ token, ...registry.resolve(token.target, "project") }));
  const validScopes = scopeTargets.filter((item) => item.entity && canRead(item.entity));
  for (const entry of scopeTargets) {
    if (!entry.entity) diagnostics.push({ code: entry.error, action: "scope", start: entry.token.start });
    else if (!canRead(entry.entity)) diagnostics.push({ code: "ACCESS_DENIED", action: "scope", start: entry.token.start });
  }
  if (new Set(validScopes.map(({ entity }) => KEY(entity))).size > 1) {
    diagnostics.push({ code: "CONFLICTING_SCOPES" });
  }
  const scopeInvalid = scopeTargets.length !== validScopes.length ||
    new Set(validScopes.map(({ entity }) => KEY(entity))).size > 1;
  const scopeId = validScopes.length ? validScopes[validScopes.length - 1].entity.id : null;
  const inScope = (entity) => !scopeId || entity.kind === "mode" ||
    (entity.kind === "project" && entity.id === scopeId) || entity.projectIds.includes(scopeId);
  const canUse = (entity) => !scopeInvalid && canRead(entity) && inScope(entity);

  const imports = [];
  const profiles = [];
  const mentions = [];
  const goals = [];
  const suggestions = [];
  const excluded = [];
  const seen = new Set();
  let used = 0;

  function add(entity, destination, reason, at) {
    const key = KEY(entity);
    if (seen.has(key)) return;
    if (seen.size >= maxSources || used + (entity.body ?? "").length > maxChars) {
      excluded.push({ id: key, reason: "BUDGET", start: at });
      return;
    }
    used += (entity.body ?? "").length;
    seen.add(key);
    destination.push({ id: key, label: entity.label, kind: entity.kind,
      body: entity.body ?? "", reason, provenance: { id: key, start: at ?? null } });
  }

  for (const token of tokens) {
    if (token.type === "directive" && token.action === "goal") {
      goals.push(token.target.value);
      continue;
    }
    if (token.type === "directive" && token.action === "scope") continue;
    const action = token.type === "directive" ? token.action : "mention";
    const expected = action === "mode" ? "mode" : token.type === "variable" ? "variable" : null;
    const { entity, error } = registry.resolve(token.target, expected);
    if (error || !entity) {
      diagnostics.push({ code: error, action, start: token.start });
      continue;
    }
    if (!canUse(entity)) {
      diagnostics.push({ code: scopeInvalid ? "INVALID_SCOPE" : !canRead(entity) ? "ACCESS_DENIED" : "OUT_OF_SCOPE", action, start: token.start });
      continue;
    }
    if (action === "mode" && entity.kind !== "mode") {
      diagnostics.push({ code: "KIND_MISMATCH", action, start: token.start });
      continue;
    }
    const reference = { id: KEY(entity), kind: entity.kind, start: token.start, action };
    mentions.push(reference);
    if (action === "use") add(entity, imports, "explicit-import", token.start);
    else if (action === "mode") add(entity, profiles, "explicit-profile", token.start);
  }

  if (retrieval !== "off" && !scopeInvalid) {
    const keyphrase = [query, ...goals].join(" ");
    const candidates = registry.all().filter((entity) => canUse(entity) && !seen.has(KEY(entity)))
      .map((entity) => ({ entity, score: scoreEntity(entity, keyphrase) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || KEY(a.entity).localeCompare(KEY(b.entity)));
    for (const candidate of candidates.slice(0, maxSources)) {
      if (retrieval === "include") add(candidate.entity, suggestions, "lexical-retrieval", null);
      else suggestions.push({ id: KEY(candidate.entity), label: candidate.entity.label,
        kind: candidate.entity.kind, score: candidate.score, reason: "lexical-retrieval" });
    }
  }
  return {
    grammar: EFSS_CONTRACT.grammarVersion,
    documentId: document.metadata ? `${document.metadata.kind}:${document.metadata.id}` : null,
    scope: scopeId ? `project:${scopeId}` : null,
    goals,
    mentions,
    imports,
    profiles,
    suggestions,
    excluded,
    diagnostics,
    usage: { contentChars: used, maxChars, maxSources },
    execution: {
      ready: !diagnostics.some(({ code, action }) =>
        ["BAD_DIRECTIVE", "CONFLICTING_SCOPES", "INVALID_SCOPE"].includes(code) ||
        (["scope", "use", "mode"].includes(action) && code !== null)) &&
        !excluded.some(({ reason }) => reason === "BUDGET"),
      operation: "assemble-context",
      effects: "none",
      reviewRequired: true
    },
    trust: { importedContent: "reference-data", profiles: "user-defined", executable: false }
  };
}

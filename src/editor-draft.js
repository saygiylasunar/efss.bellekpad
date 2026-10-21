const SHA = /^[a-f0-9]{64}$/;
const EDITABLE_KINDS = new Set(["paper", "project"]);

function assertRecord(record) {
  if (!record || !EDITABLE_KINDS.has(record.kind) ||
      typeof record.id !== "string" || !record.id ||
      typeof record.title !== "string" || typeof record.body !== "string" ||
      !SHA.test(record.revision ?? "")) throw new Error("INVALID_DRAFT_RECORD");
}
export function createDraft(record) {
  assertRecord(record);
  return Object.freeze({
    kind: record.kind, id: record.id, title: record.title, body: record.body,
    expectedRevision: record.revision, version: 0, dirty: false
  });
}
export function editDraft(draft, field, value) {
  if (!draft || !["title", "body"].includes(field) || typeof value !== "string")
    throw new Error("INVALID_DRAFT_EDIT");
  if (draft[field] === value) return draft;
  return Object.freeze({
    ...draft, [field]: value, version: draft.version + 1, dirty: true
  });
}
export function snapshotDraft(draft) {
  if (!draft) throw new Error("DRAFT_REQUIRED");
  return Object.freeze({
    kind: draft.kind, id: draft.id, title: draft.title,
    body: draft.body, expectedRevision: draft.expectedRevision,
    version: draft.version
  });
}
export function confirmDraftSave(draft, sent, result) {
  if (!draft || !sent || !result ||
      draft.kind !== sent.kind || draft.id !== sent.id ||
      result.kind !== sent.kind || result.id !== sent.id ||
      draft.expectedRevision !== sent.expectedRevision ||
      !SHA.test(result.revision ?? "")) throw new Error("STALE_SAVE_ACK");
  // Edits made while an IPC call was in flight stay dirty.
  return Object.freeze({
    ...draft, expectedRevision: result.revision,
    dirty: draft.version !== sent.version
  });
}

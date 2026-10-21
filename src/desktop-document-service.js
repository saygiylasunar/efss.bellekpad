import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { EFSS_CONTRACT } from "./contract.js";
import { LocalDocumentVault } from "./local-document-vault.js";
import { serializeDocument } from "./efss-markdown.js";

const IDENT = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const REVISION = /^[a-f0-9]{64}$/;
const EDITABLE_KINDS = Object.freeze(["paper", "project"]);
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TITLE_CHARS = 160;

function fail(code) { throw new Error(code); }
function shape(value, allowed) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k));
}
function kindAndId(value) {
  if (!shape(value, ["kind", "id"]) ||
      !EDITABLE_KINDS.includes(value.kind) || !IDENT.test(value.id ?? "")) {
    fail("INVALID_DOCUMENT_REQUEST");
  }
  return [value.kind, value.id];
}
function title(value) {
  if (typeof value !== "string" || value.length > MAX_TITLE_CHARS ||
      value.includes("\0") || /[\r\n]/.test(value)) fail("INVALID_DOCUMENT_TITLE");
  return value.trim();
}
function body(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_BODY_BYTES ||
      value.includes("\0")) fail("INVALID_DOCUMENT_BODY");
  return value;
}
function revision(value) {
  if (value !== null && (typeof value !== "string" || !REVISION.test(value)))
    fail("INVALID_DOCUMENT_REVISION");
  return value;
}
function safeRecord(doc) {
  return {
    kind: doc.kind, id: doc.id,
    title: doc.metadata.title ?? "", body: doc.body,
    revision: doc.revision, visibility: doc.metadata.visibility ?? "normal"
  };
}

/**
 * Application-specific, deliberately small desktop document API.
 * Electron is merely a transport. This service can be tested with Node only.
 * There is no arbitrary filesystem read, path argument, command execution or
 * model process invocation in this contract.
 */
export function createDesktopDocumentService({ vault } = {}) {
  if (!(vault instanceof LocalDocumentVault)) throw new TypeError("INVALID_DOCUMENT_SERVICE");
  return Object.freeze({
    async list() {
      const items = await vault.list();
      return items.filter(item => EDITABLE_KINDS.includes(item.kind))
        .map(item => ({
          kind: item.kind, id: item.id,
          title: item.metadata.title ?? "", revision: item.revision,
          visibility: item.metadata.visibility ?? "normal"
        }));
    },

    async open(request) {
      const [kind, id] = kindAndId(request);
      const record = await vault.read(kind, id);
      return record ? safeRecord(record) : null;
    },

    async create(request) {
      if (!shape(request, ["kind", "title"]) ||
          !EDITABLE_KINDS.includes(request.kind)) fail("INVALID_DOCUMENT_REQUEST");
      const label = title(request.title ?? "");
      const id = "note_" + randomUUID().replace(/-/g, "");
      const metadata = { efss_version: EFSS_CONTRACT.documentVersion,
        kind: request.kind, id, title: label };
      await vault.save(serializeDocument({ metadata, body: "" }));
      const created = await vault.read(request.kind, id);
      return safeRecord(created);
    },

    async saveDraft(request) {
      if (!shape(request, ["kind", "id", "title", "body", "expectedRevision"]))
        fail("INVALID_DOCUMENT_REQUEST");
      const [kind, id] = kindAndId({ kind: request.kind, id: request.id });
      const label = title(request.title);
      const content = body(request.body);
      const expected = revision(request.expectedRevision);
      if (expected === null) fail("DOCUMENT_REVISION_REQUIRED");
      const current = await vault.read(kind, id);
      if (!current) fail("DOCUMENT_NOT_FOUND");
      if (current.revision !== expected) fail("DOCUMENT_VERSION_CONFLICT");
      const metadata = { ...current.metadata, title: label };
      const source = serializeDocument({ metadata, body: content });
      const saved = await vault.save(source, { expectedRevision: expected });
      return { kind, id, revision: saved.revision, title: label };
    }
  });
}

export const DESKTOP_DOCUMENT_LIMITS = Object.freeze({
  maxBodyBytes: MAX_BODY_BYTES, maxTitleChars: MAX_TITLE_CHARS,
  editableKinds: EDITABLE_KINDS
});

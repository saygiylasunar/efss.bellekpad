import { createHash, randomUUID } from "node:crypto";
import { open, mkdir, lstat, readdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { EFSS_CONTRACT } from "./contract.js";
import { parseDocument } from "./efss-markdown.js";
import { MemoryStations } from "./memory-stations.js";

const VALID_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const VALID_KINDS = new Set(EFSS_CONTRACT.kinds);
const REVISION = /^[a-f0-9]{64}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

function identity(kind, id) {
  if (!VALID_KINDS.has(kind) || !VALID_ID.test(id ?? "")) {
    throw new Error("INVALID_DOCUMENT_IDENTITY");
  }
}
function revision(source) {
  return createHash("sha256").update(source).digest("hex");
}
function validateSource(source) {
  if (typeof source !== "string") throw new TypeError("DOCUMENT_SOURCE_REQUIRED");
  const size = Buffer.byteLength(source, "utf8");
  if (size > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
  const decoded = parseDocument(source);
  return { decoded, size };
}
function missing(error) { return error?.code === "ENOENT"; }
async function regularFile(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("UNSAFE_DOCUMENT_FILE");
    if (info.size > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
    return info;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
async function safeFolder(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("UNSAFE_VAULT_DIRECTORY");
  } catch (error) {
    if (!missing(error)) throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("UNSAFE_VAULT_DIRECTORY");
  }
}

export class LocalDocumentVault {
  #root;

  constructor({ root = ".efss/vault" } = {}) {
    if (typeof root !== "string" || !root.trim() || root.includes("\0")) {
      throw new TypeError("INVALID_VAULT_ROOT");
    }
    this.#root = resolve(root);
  }

  get root() { return this.#root; }

  #path(kind, id) {
    identity(kind, id);
    return join(this.#root, kind, id + ".md");
  }

  async #ensureDirectory(kind) {
    await safeFolder(this.#root);
    await safeFolder(join(this.#root, kind));
  }

  async read(kind, id) {
    const path = this.#path(kind, id);
    await this.#ensureDirectory(kind);
    const info = await regularFile(path);
    if (!info) return null;
    const sourceBytes = await readFile(path);
    if (sourceBytes.length > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
    const source = decoder.decode(sourceBytes);
    const parsed = parseDocument(source);
    if (parsed.metadata.kind !== kind || parsed.metadata.id !== id) {
      throw new Error("DOCUMENT_IDENTITY_MISMATCH");
    }
    return { kind, id, source, metadata: { ...parsed.metadata }, body: parsed.body,
      revision: revision(sourceBytes), bytes: sourceBytes.length };
  }

  /**
   * Saves the original EFSS source byte-for-byte, including CRLF.
   * On first save expectedRevision must be null. Every replacement needs a
   * revision read from this store, preventing accidental stale overwrites.
   */
  async save(source, { expectedRevision = null } = {}) {
    if (expectedRevision !== null && (typeof expectedRevision !== "string" ||
        !REVISION.test(expectedRevision))) throw new TypeError("INVALID_REVISION");
    const { decoded, size } = validateSource(source);
    const { kind, id } = decoded.metadata;
    const path = this.#path(kind, id);
    await this.#ensureDirectory(kind);
    const lockPath = path + ".lock";
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("DOCUMENT_BUSY");
      throw error;
    }
    let temp = null;
    try {
      const existing = await this.read(kind, id);
      if (existing && expectedRevision === null) throw new Error("DOCUMENT_ALREADY_EXISTS");
      if (expectedRevision !== null && (!existing ||
          existing.revision !== expectedRevision)) throw new Error("DOCUMENT_VERSION_CONFLICT");
      temp = path + "." + randomUUID() + ".tmp";
      const writer = await open(temp, "wx", 0o600);
      try {
        await writer.writeFile(source, "utf8");
        await writer.sync();
      } finally {
        await writer.close();
      }
      await rename(temp, path);
      temp = null;
      return { kind, id, bytes: size, revision: revision(Buffer.from(source, "utf8")),
        replaced: !!existing };
    } finally {
      if (temp) await unlink(temp).catch(() => {});
      await lock.close();
      await unlink(lockPath);
    }
  }

  async list() {
    await safeFolder(this.#root);
    const records = [];
    for (const kind of EFSS_CONTRACT.kinds) {
      const dir = join(this.#root, kind);
      try {
        const folder = await lstat(dir);
        if (!folder.isDirectory() || folder.isSymbolicLink()) throw new Error("UNSAFE_VAULT_DIRECTORY");
      } catch (error) {
        if (missing(error)) continue;
        throw error;
      }
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.name.endsWith(".md")) continue;
        const id = entry.name.slice(0, -3);
        identity(kind, id);
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("UNSAFE_DOCUMENT_FILE");
        const document = await this.read(kind, id);
        records.push({ kind, id, revision: document.revision, bytes: document.bytes,
          metadata: document.metadata });
      }
    }
    return records.sort((a, b) => (a.kind + ":" + a.id).localeCompare(b.kind + ":" + b.id));
  }

  async rebuildIndex({ allowRestricted = false } = {}) {
    if (typeof allowRestricted !== "boolean") throw new TypeError("INVALID_INDEX_OPTIONS");
    const memory = new MemoryStations();
    const records = await this.list();
    let indexed = 0;
    for (const record of records) {
      const document = await this.read(record.kind, record.id);
      if (!allowRestricted && document.metadata.visibility === "restricted") continue;
      memory.ingest({ metadata: document.metadata, body: document.body });
      indexed++;
    }
    return { memory, documents: indexed, excluded: records.length - indexed,
      segments: memory.segments().length };
  }
}

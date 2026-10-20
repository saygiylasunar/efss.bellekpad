import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const KEYS = new Set(["level", "event", "stage", "state", "action", "kind", "code",
  "message", "exitCode", "elapsedMs", "pid", "output", "bytes", "model"]);
const LEVELS = new Set(["debug", "info", "warn", "error"]);
const PRIVATE = /(bearer\s+)[a-z0-9._-]+|(sk-[a-z0-9_-]{8,})|((?:[a-z]:[\\/](?:users|documents and settings)[\\/]|\/home\/|\/users\/)[^\s"']+)/gi;

export function redactLogText(value) {
  return String(value ?? "").replace(PRIVATE, (_match, bearer, key) =>
    bearer ? bearer + "[REDACTED]" : key ? "[REDACTED_KEY]" : "[REDACTED_PATH]")
    .replace(/(api[_-]?key|password|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, 1800);
}

export class RuntimeLog {
  #file;
  #queue = Promise.resolve();
  #session = randomUUID();

  constructor({ root = ".efss/logs", file = null } = {}) {
    if (typeof root !== "string" || !root.trim() ||
        (file !== null && (typeof file !== "string" || !file.endsWith(".jsonl"))))
      throw new TypeError("Invalid log location");
    this.#file = file ?? join(root, "runtime-" + new Date().toISOString().slice(0, 10) + ".jsonl");
  }

  get path() { return this.#file; }
  get session() { return this.#session; }

  async write(event) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        !LEVELS.has(event.level ?? "info")) throw new TypeError("Invalid event");
    const data = { at: new Date().toISOString(), session: this.#session,
      level: event.level ?? "info" };
    for (const [key, value] of Object.entries(event)) {
      if (!KEYS.has(key) || value === undefined || key === "level") continue;
      if (typeof value === "string") data[key] = redactLogText(value);
      else if (value === null || typeof value === "number" ||
          typeof value === "boolean") data[key] = value;
    }
    const line = JSON.stringify(data) + "\n";
    const write = this.#queue.then(async () => {
      await mkdir(dirname(this.#file), { recursive: true });
      await appendFile(this.#file, line, "utf8");
    });
    this.#queue = write.catch(() => {});
    await write;
    return data;
  }

  async error({ stage, action, error, code = "UNEXPECTED_ERROR" } = {}) {
    return this.write({ level: "error", event: "failure", stage, action,
      kind: error?.name ?? "Error", code: error?.code ?? code,
      message: error?.message ?? "Unknown error" });
  }
}

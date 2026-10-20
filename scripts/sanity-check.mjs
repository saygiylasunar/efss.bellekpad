import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DENYLIST = ".efss/private-terms.json";
const EXEMPT_EMAIL_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "test.invalid", "localhost"
]);
const PRIVATE_PATH = /(?:[A-Z]:[\/\\](?:Users|Documents and Settings)[\/\\][a-z0-9._-]+|\/(?:home|Users)\/[a-z0-9._-]+)/gi;
const EMAIL = /[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/gi;
const SECRET = [
  /sk-(?:proj-|live-)?[a-z0-9_-]{20,}/gi,
  /gh(?:p|o|u|s|r)_[a-z0-9_]{20,}/gi,
  /github_pat_[a-z0-9_]{20,}/gi,
  /hf_[a-z0-9]{20,}/gi,
  /AKIA[0-9A-Z]{16}/g,
  /xox[baprs]-[a-z0-9-]{20,}/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /https?:\/\/[^/\s:@]+:[^/\s@]+@/gi
];
const CREDENTIAL_ASSIGNMENT = /\b(?:api[_-]?key|access[_-]?token|password|secret[_-]?key)\s*[:=]\s*["']([^"'\n]{8,})["']/gi;
const SAFE_VALUES = /^(?:your[-_ ]|example|placeholder|dummy|test|not-logged|<|process\.env|env\.|os\.environ)/i;
const DENIED_PATH = /(^|\/)(?:\.efss|\.venv|node_modules|local-models|training-data|checkpoints|user-data|private-data|wandb)(\/|$)|(?:^|\/)\.env(?:\..+)?$|(?:^|\/)extra_model_paths\.yaml$|(?:^|\/)[^/]+\.local\.json$|\.(?:gguf|safetensors|ckpt|pt|pth|onnx|jsonl|sqlite3?|db|pem|p12|pfx|key)$/i;

function lineOf(text, offset) {
  return text.slice(0, offset).split("\n").length;
}
function recordRegex(text, regex, category, findings, predicate = () => true) {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (predicate(match)) findings.push({ category, line: lineOf(text, match.index) });
    if (match.index === regex.lastIndex) regex.lastIndex++;
  }
}
export function auditText(text, { privateTerms = [] } = {}) {
  if (typeof text !== "string") throw new TypeError("Expected file text");
  const findings = [];
  for (const regex of SECRET) recordRegex(text, regex, "SECRET_PATTERN", findings);
  recordRegex(text, PRIVATE_PATH, "PERSONAL_ABSOLUTE_PATH", findings);
  recordRegex(text, EMAIL, "PERSONAL_EMAIL", findings, match =>
    !EXEMPT_EMAIL_DOMAINS.has(match[0].split("@").at(-1).toLowerCase()));
  recordRegex(text, CREDENTIAL_ASSIGNMENT, "HARDCODED_CREDENTIAL", findings,
    match => !SAFE_VALUES.test(match[1].trim()));
  for (const term of privateTerms) {
    if (typeof term !== "string" || term.length < 3 || term.length > 180)
      throw new TypeError("Invalid private term");
    let pos = 0;
    while ((pos = text.toLocaleLowerCase("tr-TR").indexOf(
      term.toLocaleLowerCase("tr-TR"), pos)) >= 0) {
      findings.push({ category: "PRIVATE_TERM", line: lineOf(text, pos) });
      pos += term.length;
    }
  }
  return findings;
}
export function auditPath(file) {
  if (typeof file !== "string") throw new TypeError("Invalid path");
  const name = file.replace(/\\/g, "/");
  return DENIED_PATH.test(name) ? [{ category: "FORBIDDEN_TRACKED_PATH", line: null }] : [];
}
export function readPrivateTerms(file = DENYLIST) {
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(data) || data.length > 250) throw new Error("INVALID_PRIVATE_DENYLIST");
  if (data.some(term => typeof term !== "string" || term.trim().length < 3 ||
      term.length > 180)) throw new Error("INVALID_PRIVATE_DENYLIST");
  return data.map(x => x.trim());
}
export function auditTrackedFiles({ root = process.cwd(), staged = false,
  privateTerms = readPrivateTerms(resolve(root, DENYLIST)) } = {}) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024
  });
  const files = output.split("\0").filter(Boolean);
  const findings = [];
  for (const file of files) {
    for (const issue of auditPath(file)) findings.push({ file, ...issue });
    const absolute = resolve(root, file);
    const bytes = staged ? execFileSync("git", ["show", ":" + file], {
      cwd: root, maxBuffer: 3 * 1024 * 1024
    }) : readFileSync(absolute);
    const size = bytes.length;
    if (size > 2 * 1024 * 1024) {
      findings.push({ file, category: "OVERSIZED_TRACKED_FILE", line: null });
      continue;
    }
    // Missing/corrupt UTF-8 files are not treated as safe.
    const text = bytes.toString("utf8");
    if (text.includes("\uFFFD") || text.includes("\0")) {
      findings.push({ file, category: "NON_TEXT_TRACKED_FILE", line: null });
      continue;
    }
    for (const issue of auditText(text, { privateTerms })) {
      findings.push({ file, ...issue });
    }
  }
  return { files: files.length, findings };
}
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) ===
  fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const report = auditTrackedFiles({ staged: process.argv.includes("--staged") });
    if (report.findings.length) {
      console.error("EFSS public-source sanity gate FAILED:");
      for (const issue of report.findings) {
        // Never print matched secret/personal strings.
        console.error(issue.category + " in tracked file #" +
          (issue.file ? "[name hidden]" : "unknown") +
          (issue.line === null ? "" : " at line " + issue.line));
      }
      console.error("Total findings:", report.findings.length);
      process.exitCode = 1;
    } else {
      console.log("EFSS public-source sanity gate PASSED:",
        report.files, "tracked files; zero detected private-data patterns.");
      console.log("This heuristic scan does not certify complete absence of sensitive data.");
    }
  } catch (error) {
    console.error("EFSS sanity gate error:", error?.code ?? error?.name ?? "unknown");
    process.exitCode = 1;
  }
}

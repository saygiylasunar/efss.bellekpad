import test from "node:test";
import assert from "node:assert/strict";
import { auditPath, auditText, readPrivateTerms } from "../scripts/sanity-check.mjs";

test("sensitive tracked paths are rejected before a public push", () => {
  for (const file of [
    ".env", ".env.production", ".efss/private-terms.json",
    "config/model-paths.local.json", "my-weights.gguf",
    "weights.safetensors", "output.jsonl", "secret.pem",
    "training-data/papers/one.md", "data/session.sqlite3"
  ]) {
    assert.ok(auditPath(file).length, file);
  }
  for (const file of [
    "README.md", ".env.example", "src/efss-markdown.js",
    "config/model-paths.example.json", "test/private-fixtures.test.js"
  ]) {
    assert.deepEqual(auditPath(file), [], file);
  }
});

test("an API token is found but its value is never included in a finding", () => {
  const synthetic = ["ghp_", "A".repeat(40)].join("");
  const result = auditText("header=" + synthetic);
  assert.ok(result.some(item => item.category === "SECRET_PATTERN"));
  assert.ok(!JSON.stringify(result).includes(synthetic));
});

test("personal names can be privately denied without publishing them in code", () => {
  const placeholder = ["private", "fictional", "term"].join("-");
  const result = auditText("A paragraph containing " + placeholder + ".", {
    privateTerms: [placeholder]
  });
  assert.equal(result[0].category, "PRIVATE_TERM");
  assert.ok(!JSON.stringify(result).includes(placeholder));
});

test("personal absolute paths and non-example emails are detected", () => {
  const path = ["C:", "Users", "fictional_account", "models"].join("/");
  assert.equal(auditText(path)[0].category, "PERSONAL_ABSOLUTE_PATH");
  const email = ["imaginary.user", "@", "private", ".", "invalid"].join("");
  assert.equal(auditText(email)[0].category, "PERSONAL_EMAIL");
  assert.deepEqual(auditText(["test", "@", "example.com"].join("")), []);
});

test("example paths and explanatory markup are allowed", () => {
  const example = "D:/AI/SharedModels and .efss/logs and config/model-paths.local.json";
  assert.deepEqual(auditText(example), []);
  assert.deepEqual(auditText("https://example.com/v1 and http://127.0.0.1:1234"), []);
});

test("local private denylist stays optional and is not published as code", () => {
  assert.deepEqual(readPrivateTerms(".efss/does-not-exist-example-file.json"), []);
});

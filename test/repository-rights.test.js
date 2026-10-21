import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8");

test("repository declares copyright reserved with no public software license", () => {
  const notice = read("LICENSE");
  assert.match(notice, /ALL RIGHTS RESERVED/);
  assert.match(notice, /NO PUBLIC SOFTWARE LICENSE/);
  assert.match(notice, /2026 saygiylasunar/);
  assert.match(notice, /GitHub Terms of Service/);
  assert.match(read("README.md"), /PROPRIETARY \/ ALL RIGHTS RESERVED/);
});

test("npm distribution is disabled and source is explicitly UNLICENSED", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, "UNLICENSED");
});

test("no external runtime or editor dependency is declared without approval", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  assert.equal(Object.keys(pkg.devDependencies ?? {}).length, 0);
  assert.equal(Object.keys(pkg.optionalDependencies ?? {}).length, 0);
});

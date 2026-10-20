import test from "node:test";
import assert from "node:assert/strict";
import { FORMAT_VERSION, parseDocument, scanReferences, serializeDocument } from "../src/efss-markdown.js";

const metadata = { efss_version: FORMAT_VERSION, kind: "paper", id: "paper_1", title: "Müzik" };
const tick = String.fromCharCode(96);

test("canonical document survives the round trip", () => {
  const body = "\n# Müzik\n\n&Müzik ile &Tarih ilişkili.\n";
  const serialized = serializeDocument({ metadata, body });
  const decoded = parseDocument(serialized);
  assert.deepEqual({ ...decoded.metadata }, metadata);
  assert.equal(decoded.body, body);
  assert.equal(serializeDocument(decoded), serialized);
  assert.deepEqual(decoded.references.map((hit) => hit.key), ["Müzik", "Tarih"]);
});

test("scanner tracks exact source offsets", () => {
  const body = "A &Müzik\nB &İstanbul";
  const hits = scanReferences(body);
  assert.deepEqual(hits.map((hit) => body.slice(hit.start, hit.end)), ["&Müzik", "&İstanbul"]);
});

test("escaped and code references are not indexed", () => {
  const body = [
    "\\&Kaçış",
    tick + "&Kod" + tick,
    tick.repeat(3) + "ts",
    "&Blok",
    tick.repeat(3),
    "    &Girintili",
    "&Gerçek"
  ].join("\n");
  assert.deepEqual(scanReferences(body).map((hit) => hit.key), ["Gerçek"]);
});

test("inline code delimiter lengths are respected", () => {
  const body = tick.repeat(2) + "&Kod " + tick + " " + tick.repeat(2) + " &Metin";
  assert.deepEqual(scanReferences(body).map((hit) => hit.key), ["Metin"]);
});

test("tilde fences and directive attributes are excluded", () => {
  const body = [
    "~~~",
    "&Gizli",
    "~~~",
    ':::efss.format {"sample":"&Attribute"}',
    "&Gövde",
    ":::"
  ].join("\n");
  assert.deepEqual(scanReferences(body).map((hit) => hit.key), ["Gövde"]);
});

test("link destinations, HTML tags, URLs and HTML entities are excluded", () => {
  const body = "[&Görünen](https://example.org/?q=&Gizli) <a title=\"&Özellik\">&Açık</a> &amp; https://host.test/?q=&URL";
  assert.deepEqual(scanReferences(body).map((hit) => hit.key), ["Görünen", "Açık"]);
});

test("Unicode variable names preserve their surface ranges", () => {
  const body = "&ışık &İstanbul &Cafe\u0301 &Proje_2";
  assert.deepEqual(scanReferences(body).map((hit) => hit.key), ["ışık", "İstanbul", "Café", "Proje_2"]);
});

test("invalid document kinds, ids, versions and value types fail", () => {
  assert.throws(() => serializeDocument({ metadata: { ...metadata, kind: "unknown" }, body: "" }));
  assert.throws(() => serializeDocument({ metadata: { ...metadata, id: "../unsafe" }, body: "" }));
  assert.throws(() => serializeDocument({ metadata: { ...metadata, efss_version: "9.0" }, body: "" }));
  assert.throws(() => serializeDocument({ metadata: { ...metadata, title: 42 }, body: "" }));
});

test("duplicate and malformed envelope fields fail", () => {
  const valid = serializeDocument({ metadata, body: "" });
  assert.throws(() => parseDocument(valid.replace('id: "paper_1"', 'id: "paper_1"\nid: "paper_2"')));
  assert.throws(() => parseDocument(valid.replace('title: "Müzik"', 'title: [1,2]')));
  assert.throws(() => parseDocument("missing"));
});

test("CRLF input becomes canonical LF", () => {
  const source = serializeDocument({ metadata, body: "\n&Anı\n" }).replace(/\n/g, "\r\n");
  const parsed = parseDocument(source);
  assert.equal(parsed.body, "\n&Anı\n");
});

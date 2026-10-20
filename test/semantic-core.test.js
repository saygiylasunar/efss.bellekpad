import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSemantics, parseTarget } from '../src/semantics.js';
import { EntityRegistry } from '../src/registry.js';
import { buildContext } from '../src/context-engine.js';
import { buildGraph, neighbors } from '../src/graph.js';

function registry() {
  const r = new EntityRegistry();
  r.register({ kind: 'project', id: 'p1', label: 'First Project' });
  r.register({ kind: 'project', id: 'p2', label: 'Other Project' });
  r.register({ kind: 'variable', id: 'music', label: 'Müzik', aliases: ['Audio'], body: 'music variable' });
  r.register({ kind: 'paper', id: 'a', label: 'Music Notes', body: 'Scale patterns and melody.', projectIds: ['p1'] });
  r.register({ kind: 'paper', id: 'b', label: 'Audio Guide', body: 'Audio methods.', projectIds: ['p2'] });
  r.register({ kind: 'mode', id: 'm1', label: 'Focus Mode', aliases: ['Focus'], body: 'Use concise answers.' });
  r.register({ kind: 'paper', id: 'locked', label: 'Locked Music', body: 'Restricted.', visibility: 'restricted', projectIds: ['p1'] });
  return r;
}
const doc = (body, id = 'current') => ({ metadata: { kind: 'paper', id }, body });

test('explicit commands, mentions and links retain locations', () => {
  const body = '::scope [[project:p1]]\n::mode "Focus Mode"\n::use [[paper:a]]\n::goal "Draft music review"\n&Müzik and [[paper:a]]';
  const { tokens, diagnostics } = scanSemantics(body);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(tokens.map(t => t.type === 'directive' ? t.action : t.type), ['scope', 'mode', 'use', 'goal', 'variable', 'link']);
  for (const t of tokens) assert.ok(t.start >= 0 && t.end > t.start);
});

test('code fences and inline code never trigger semantic actions', () => {
  const t = '`';
  const body = [t.repeat(3), '::use [[paper:a]] &Müzik', t.repeat(3),
    t + '[[paper:a]] &Müzik' + t, '\\&Music', '    ::mode "Focus Mode"',
    '::use [[paper:a]]'].join('\n');
  assert.deepEqual(scanSemantics(body).tokens.map(t => t.type), ['directive']);
});

test('escapes, links, raw URLs and HTML attributes are excluded', () => {
  const body = '[&Müzik](https://some.host/path?x=[[paper:b]]) <img alt="[[paper:a]] &Audio"> &amp; https://a.host/?q=&Audio [[paper:a]]';
  const scan = scanSemantics(body);
  assert.deepEqual(scan.tokens.map(t => t.type), ['variable', 'link']);
});

test('malformed directives and links report diagnostics instead of activation', () => {
  const scan = scanSemantics('::execute rm -rf\n::use [[paper:bad id]]\n[[other:foo]]\n::goal hello');
  assert.deepEqual(scan.tokens, []);
  assert.deepEqual(scan.diagnostics.map(d => d.code), ['BAD_DIRECTIVE', 'BAD_DIRECTIVE', 'BAD_LINK', 'BAD_DIRECTIVE']);
});

test('Unicode aliases normalize predictably, requiring an explicit command', () => {
  const r = registry();
  assert.equal(r.resolve(parseTarget('"Focus"'), 'mode').entity.id, 'm1');
  assert.equal(r.resolve(parseTarget('&Müzik')).entity.id, 'music');
  assert.equal(r.resolve(parseTarget('"müzik"')).entity.id, 'music');
  const packet = buildContext({ registry: r, document: doc('Focus Mode is named here.') });
  assert.equal(packet.profiles.length, 0);
});

test('conflicting entity aliases within a kind are forbidden', () => {
  const r = registry();
  assert.throws(() => r.register({ kind: 'mode', id: 'm2', label: 'FOCUS' }), /collision/);
  assert.throws(() => r.register({ kind: 'mode', id: 'm1', label: 'Anything' }), /Duplicate/);
});

test('an ambiguous alias across kinds is not silently resolved', () => {
  const r = registry();
  r.register({ kind: 'mode', id: 'm3', label: 'Audio' });
  assert.equal(r.resolve(parseTarget('"Audio"')).error, 'AMBIGUOUS_ALIAS');
  assert.equal(r.resolve(parseTarget('"Audio"'), 'mode').entity.id, 'm3');
});

test('explicit imports and modes are separated from passive mentions', () => {
  const packet = buildContext({ registry: registry(), document: doc('::use [[paper:a]]\n::mode "Focus"\n&Müzik\n[[paper:b]]') });
  assert.deepEqual(packet.imports.map(x => x.id), ['paper:a']);
  assert.deepEqual(packet.profiles.map(x => x.id), ['mode:m1']);
  assert.equal(packet.mentions.length, 4);
  assert.equal(packet.suggestions.length, 0);
  assert.equal(packet.trust.executable, false);
});

test('scope prevents cross-project imports and retrieval', () => {
  const packet = buildContext({ registry: registry(), document: doc('::scope [[project:p1]]\n::use [[paper:a]]\n::use [[paper:b]]\n::goal "Audio"'), retrieval: 'include' });
  assert.equal(packet.scope, 'project:p1');
  assert.deepEqual(packet.imports.map(x => x.id), ['paper:a']);
  assert.equal(packet.suggestions.some(x => x.id === 'paper:b'), false);
  assert.ok(packet.diagnostics.some(d => d.code === 'OUT_OF_SCOPE'));
});

test('restricted entities cannot be imported or retrieved by default', () => {
  const packet = buildContext({ registry: registry(), document: doc('::use [[paper:locked]]\n::goal "Locked Music"'), retrieval: 'include' });
  assert.equal(packet.imports.length, 0);
  assert.equal(packet.suggestions.some(x => x.id === 'paper:locked'), false);
  assert.ok(packet.diagnostics.some(x => x.code === 'ACCESS_DENIED'));
});

test('invalid scope stops retrieval and is diagnostic', () => {
  const packet = buildContext({ registry: registry(), document: doc('::scope [[project:unknown]]\n::goal "music"'), retrieval: 'include' });
  assert.equal(packet.suggestions.length, 0);
  assert.ok(packet.diagnostics.some(d => d.code === 'NOT_FOUND'));
});

test('context suggestions remain previews unless retrieval is included', () => {
  const r = registry();
  const source = doc('::goal "Audio melody"');
  const preview = buildContext({ registry: r, document: source, retrieval: 'suggest' });
  assert.ok(preview.suggestions.some(s => s.id === 'paper:b'));
  assert.ok(preview.suggestions.every(s => !Object.hasOwn(s, 'body')));
  assert.ok(buildContext({ registry: r, document: source, retrieval: 'include' }).suggestions.some(s => s.body));
});

test('text imports obey size budgets without truncating their sources', () => {
  const packet = buildContext({ registry: registry(), document: doc('::use [[paper:a]]'), maxChars: 3 });
  assert.equal(packet.imports.length, 0);
  assert.deepEqual(packet.excluded.map(x => x.id), ['paper:a']);
});

test('graph distinguishes mention from import and mode activation', () => {
  const r = registry();
  const graph = buildGraph([doc('[[paper:a]] &Müzik\n::use [[paper:a]]\n::mode "Focus"')], r);
  assert.deepEqual(new Set(graph.edges.map(e => e.relation)), new Set(['mentions', 'imports', 'activates']));
  assert.equal(neighbors(graph, 'paper:a').length, 2);
  assert.equal(graph.unresolved.length, 0);
});

test('graph records unresolved references without hallucinating nodes', () => {
  const graph = buildGraph([doc('[[paper:absent]]')], registry());
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.unresolved[0].code, 'NOT_FOUND');
});

test('failed scope blocks explicit imports rather than reverting to all projects', () => {
  const packet = buildContext({ registry: registry(), document: doc('::scope [[project:missing]]\n::use [[paper:a]]') });
  assert.equal(packet.imports.length, 0);
  assert.equal(packet.execution.ready, false);
  assert.ok(packet.diagnostics.some(d => d.code === 'INVALID_SCOPE'));
});

test('a global source limit caps imports and modes collectively', () => {
  const packet = buildContext({ registry: registry(), document: doc('::mode "Focus"\n::use [[paper:a]]'), maxSources: 1 });
  assert.equal(packet.imports.length + packet.profiles.length, 1);
  assert.equal(packet.execution.ready, false);
});

test('archived AI response cannot activate a mode or import another paper', () => {
  const d = { metadata: { kind: 'conversation', id: 'c1' }, body: '@Person:User\nDiscuss &Müzik\n@AI:LocalModel\n::mode "Focus"\n::use [[paper:a]]' };
  const packet = buildContext({ document: d, registry: registry() });
  assert.equal(packet.imports.length, 0);
  assert.equal(packet.profiles.length, 0);
  assert.equal(buildGraph([d], registry()).edges.filter(e => e.relation === 'imports').length, 0);
});

test('only the explicitly active human turn can issue commands', () => {
  const d = { metadata: { kind: 'conversation', id: 'c1' }, body: '@Person:User\n::use [[paper:b]]\n@AI:Model\n::mode "Focus"\n@Person:User\n::use [[paper:a]]' };
  const noActive = buildContext({ document: d, registry: registry() });
  const active = buildContext({ document: d, registry: registry(), activeTurn: 2 });
  assert.equal(noActive.imports.length, 0);
  assert.deepEqual(active.imports.map(s => s.id), ['paper:a']);
  assert.equal(active.profiles.length, 0);
});

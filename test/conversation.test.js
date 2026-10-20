import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConversationBody, serializeConversationBody } from '../src/conversation.js';

test('conversation records preserve roles, model identifiers and references', () => {
  const turns = [
    { speakerType: 'Person', speaker: 'User', text: 'How about &Music?' },
    { speakerType: 'AI', speaker: 'Local-v3.safetensors', text: 'See [[paper:a]].' }
  ];
  const source = serializeConversationBody(turns);
  const parsed = parseConversationBody(source);
  assert.deepEqual(parsed.map(({ speakerType, speaker, text }) => ({ speakerType, speaker, text })), turns);
  assert.deepEqual(parsed[0].tokens.map(t => t.type), ['variable']);
  assert.deepEqual(parsed[1].tokens.map(t => t.type), ['link']);
});

test('speaker-shaped text inside fenced code stays in a turn', () => {
  const source = '@Person:User\n```text\n@AI:Fake\n```\ntext\n@AI:Actual\nreply';
  const parsed = parseConversationBody(source);
  assert.equal(parsed.length, 2);
  assert.match(parsed[0].text, /@AI:Fake/);
  assert.equal(parsed[1].speaker, 'Actual');
});

test('speaker attribution rejects ambiguous or malformed headers', () => {
  assert.throws(() => parseConversationBody('A heading\n@Person:User\ntext'), /Unexpected/);
  assert.throws(() => serializeConversationBody([{ speakerType: 'AI', speaker: 'bad:name', text: '' }]), /Invalid/);
});

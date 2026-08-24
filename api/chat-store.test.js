import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadChat, appendMessage, markRead, unreadFor, MAX_TEXT } from './chat-store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));

test('missing file reads as empty conversation', () => {
  assert.deepEqual(loadChat(tmp(), 'u1'), { messages: [], lastReadClient: 0, lastReadCoach: 0 });
});

test('append assigns sequential ids and trims', () => {
  const dir = tmp();
  const m1 = appendMessage(dir, 'u1', 'client', '  hello  ');
  const m2 = appendMessage(dir, 'u1', 'coach', 'hi');
  assert.equal(m1.id, 1); assert.equal(m2.id, 2); assert.equal(m1.text, 'hello');
  assert.equal(loadChat(dir, 'u1').messages.length, 2);
});

test('rejects empty and oversized text', () => {
  const dir = tmp();
  assert.throws(() => appendMessage(dir, 'u1', 'client', '   '), /required/);
  assert.throws(() => appendMessage(dir, 'u1', 'client', 'x'.repeat(MAX_TEXT + 1)), /too long/);
});

test('sending marks your own side read; unread counts the other side', () => {
  const dir = tmp();
  appendMessage(dir, 'u1', 'client', 'a');
  appendMessage(dir, 'u1', 'client', 'b');
  let chat = loadChat(dir, 'u1');
  assert.equal(unreadFor(chat, 'coach'), 2);
  assert.equal(unreadFor(chat, 'client'), 0);
  chat = markRead(dir, 'u1', 'coach', 2);
  assert.equal(unreadFor(chat, 'coach'), 0);
});

test('read cursor never goes backwards', () => {
  const dir = tmp();
  appendMessage(dir, 'u1', 'client', 'a');
  markRead(dir, 'u1', 'coach', 1);
  const chat = markRead(dir, 'u1', 'coach', 0);
  assert.equal(chat.lastReadCoach, 1);
});

test('uid is sanitized in the filename', () => {
  const dir = tmp();
  appendMessage(dir, '../evil', 'client', 'a');
  assert.ok(fs.existsSync(path.join(dir, 'chat-evil.json')));
});

test('corrupt file reads as empty conversation', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'chat-u1.json'), '{broken');
  assert.deepEqual(loadChat(dir, 'u1'), { messages: [], lastReadClient: 0, lastReadCoach: 0 });
});

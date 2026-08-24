/* Chat storage — one JSON file per client (chat-<uid>.json), mirroring the
   state-<uid>.json conventions in server.js: sanitized uid in the filename,
   atomic writes, a corrupt or missing file reads as an empty conversation. */
import fs from 'node:fs';
import path from 'node:path';

export const MAX_TEXT = 2000;

const chatFile = (dir, uid) => path.join(dir, 'chat-' + String(uid).replace(/[^a-zA-Z0-9_-]/g, '') + '.json');

function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function loadChat(dir, uid) {
  try {
    const c = JSON.parse(fs.readFileSync(chatFile(dir, uid), 'utf8'));
    return { messages: c.messages || [], lastReadClient: +c.lastReadClient || 0, lastReadCoach: +c.lastReadCoach || 0 };
  } catch { return { messages: [], lastReadClient: 0, lastReadCoach: 0 }; }
}

const save = (dir, uid, chat) => atomicWrite(chatFile(dir, uid), JSON.stringify(chat));

// from: 'client' | 'coach'. Returns the stored message; throws on invalid text.
export function appendMessage(dir, uid, from, text) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('text required');
  if (t.length > MAX_TEXT) throw new Error('text too long');
  const chat = loadChat(dir, uid);
  const id = chat.messages.length ? chat.messages[chat.messages.length - 1].id + 1 : 1;
  const msg = { id, from, text: t, ts: Date.now() };
  chat.messages.push(msg);
  // Your own send is implicitly read up to that point.
  if (from === 'client') chat.lastReadClient = id; else chat.lastReadCoach = id;
  save(dir, uid, chat);
  return msg;
}

// who: 'client' | 'coach' — advances that side's read cursor, never backwards.
export function markRead(dir, uid, who, upTo) {
  const chat = loadChat(dir, uid);
  const key = who === 'coach' ? 'lastReadCoach' : 'lastReadClient';
  const v = Math.max(chat[key], Math.floor(+upTo) || 0);
  if (v !== chat[key]) { chat[key] = v; save(dir, uid, chat); }
  return chat;
}

// Unread messages *from the other side*, for `who`.
export function unreadFor(chat, who) {
  const cursor = who === 'coach' ? chat.lastReadCoach : chat.lastReadClient;
  const other = who === 'coach' ? 'client' : 'coach';
  return chat.messages.filter(m => m.from === other && m.id > cursor).length;
}

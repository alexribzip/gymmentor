import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerChatRoutes } from './chat.js';
import { loadChat } from './chat-store.js';

let routes, deps, pushes, session;
const jsonOut = [];
const call = async (key, { url = '/x', body = {} } = {}) => {
  jsonOut.length = 0;
  deps.readBody = async () => body;
  await routes[key]({ url }, {});
  return jsonOut[0];
};

beforeEach(() => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'chatapi-'));
  pushes = [];
  session = null;
  const db = {
    users: [
      { id: 'coach1', name: 'Alexis', admin: true },
      { id: 'cli1', name: 'Marc', coached: true, email: 'marc@gmail.com' },
      { id: 'cli2', name: 'Zoe' }
    ]
  };
  deps = {
    DATA, db,
    saveDb: () => {},
    json: (res, code, obj) => jsonOut.push({ code, obj }),
    readBody: async () => ({}),
    readSession: () => session,
    requireAdmin: (req, res) => {
      if (session?.admin) return session;
      jsonOut.push({ code: 403, obj: { error: 'forbidden' } });
      return null;
    },
    isAdmin: u => !!u.admin,
    sendPush: (uid, payload) => pushes.push({ uid, payload }),
    audit: () => {},
    readState: () => ({ workouts: [{ d: '2026-08-20' }] }),
    livePresence: () => null,
    RP_NAME: 'openGym Coach'
  };
  routes = {};
  registerChatRoutes(routes, deps);
});

test('discovery: non-coached can read and gets discovery counters', async () => {
  session = deps.db.users[2];                    // cli2, non coaché
  const r = await call('GET /api/chat');
  assert.equal(r.code, 200);
  assert.deepEqual(r.obj.discovery, { used: 0, max: 5 });
});

test('discovery: non-coached can send up to DISCOVERY_MSGS then 403', async () => {
  session = deps.db.users[2];
  for (let i = 0; i < 5; i++) {
    const r = await call('POST /api/chat', { body: { text: 'msg ' + i } });
    assert.equal(r.code, 200);
  }
  const r6 = await call('POST /api/chat', { body: { text: 'one too many' } });
  assert.equal(r6.code, 403);
  assert.equal(r6.obj.error, 'not-coached');
  const g = await call('GET /api/chat');
  assert.equal(g.obj.discovery.used, 5);
});

test('discovery: coach replies do not consume the quota', async () => {
  session = deps.db.users[2];
  await call('POST /api/chat', { body: { text: 'hi' } });
  session = { id: 'coach1', name: 'Alexis', admin: true };
  await call('POST /api/coach/thread', { body: { id: 'cli2', text: 'réponse' } });
  session = deps.db.users[2];
  const g = await call('GET /api/chat');
  assert.equal(g.obj.discovery.used, 1);
});

test('coached user keeps unlimited access and no discovery field', async () => {
  session = deps.db.users[1];                    // cli1, coaché
  const r = await call('GET /api/chat');
  assert.equal(r.obj.discovery, undefined);
});

test('discovery: read and unread routes are open to non-coached', async () => {
  session = deps.db.users[2];
  assert.equal((await call('POST /api/chat/read', { body: { upTo: 1 } })).code, 200);
  assert.equal((await call('GET /api/chat/unread')).code, 200);
});

test('client POST appends and pushes every admin', async () => {
  session = deps.db.users[1];          // cli1, coached
  const r = await call('POST /api/chat', { body: { text: 'salut coach' } });
  assert.equal(r.code, 200);
  assert.equal(r.obj.message.from, 'client');
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].uid, 'coach1');
  assert.equal(pushes[0].payload.tag, 'chat');
  assert.equal(pushes[0].payload.url, '#/coach');
});

test('client GET returns messages after cursor', async () => {
  session = deps.db.users[1];
  await call('POST /api/chat', { body: { text: 'un' } });
  await call('POST /api/chat', { body: { text: 'deux' } });
  const r = await call('GET /api/chat', { url: '/api/chat?after=1' });
  assert.equal(r.obj.messages.length, 1);
  assert.equal(r.obj.messages[0].text, 'deux');
});

test('bad text is a 400', async () => {
  session = deps.db.users[1];
  const r = await call('POST /api/chat', { body: { text: '   ' } });
  assert.equal(r.code, 400);
});

test('coach threads exclude admins, sort by last message, count unread', async () => {
  session = deps.db.users[1];
  await call('POST /api/chat', { body: { text: 'hello' } });
  session = { id: 'coach1', name: 'Alexis', admin: true };
  const r = await call('GET /api/coach/threads');
  assert.equal(r.obj.threads.length, 2);                    // cli1 + cli2, pas coach1
  assert.equal(r.obj.threads[0].id, 'cli1');                // dernier message en tête
  assert.equal(r.obj.threads[0].email, 'marc@gmail.com');
  assert.equal(r.obj.threads[0].unread, 1);
  assert.equal(r.obj.threads[0].lastWorkout, '2026-08-20');
});

test('coach reply pushes the client with #/chat', async () => {
  session = { id: 'coach1', name: 'Alexis', admin: true };
  const r = await call('POST /api/coach/thread', { body: { id: 'cli1', text: 'bien joué' } });
  assert.equal(r.obj.message.from, 'coach');
  assert.deepEqual(pushes[0], { uid: 'cli1', payload: { title: '💬 openGym Coach', body: 'bien joué', tag: 'chat', url: '#/chat' } });
});

test('coached toggle flips the flag and refuses admins', async () => {
  session = { id: 'coach1', name: 'Alexis', admin: true };
  let r = await call('POST /api/coach/coached', { body: { id: 'cli2', coached: true } });
  assert.equal(r.obj.coached, true);
  assert.equal(deps.db.users[2].coached, true);
  r = await call('POST /api/coach/coached', { body: { id: 'coach1', coached: true } });
  assert.equal(r.code, 400);
});

test('coach routes are admin-gated', async () => {
  session = deps.db.users[1];          // simple client
  const r = await call('GET /api/coach/threads');
  assert.equal(r.code, 403);
});

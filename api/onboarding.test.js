import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerOnboardingRoutes, welcomeText } from './onboarding.js';
import { loadChat } from './chat-store.js';

let routes, deps, pushes, session;
const jsonOut = [];
const call = async (key, body = {}) => {
  jsonOut.length = 0;
  deps.readBody = async () => body;
  await routes[key]({ url: '/x' }, {});
  return jsonOut[0];
};

beforeEach(() => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'onb-'));
  pushes = [];
  session = null;
  const db = { users: [{ id: 'coach1', name: 'Alexis', admin: true }, { id: 'cli1', name: 'Marc' }] };
  deps = {
    DATA, db, saveDb: () => {},
    json: (res, code, obj) => jsonOut.push({ code, obj }),
    readBody: async () => ({}),
    readSession: () => session,
    sendPush: (uid, payload) => pushes.push({ uid, payload }),
    isAdmin: u => !!u.admin
  };
  routes = {};
  registerOnboardingRoutes(routes, deps);
});

const ANSWERS = { objectif: 'muscle', niveau: 'debutant', jours: 3, materiel: 'salle' };

test('requires a session', async () => {
  const r = await call('POST /api/onboarding/complete', { answers: ANSWERS });
  assert.equal(r.code, 401);
});

test('validates answers enums', async () => {
  session = deps.db.users[1];
  const r = await call('POST /api/onboarding/complete', { answers: { ...ANSWERS, objectif: 'bogus' } });
  assert.equal(r.code, 400);
});

test('writes the coach welcome message and pushes admins once', async () => {
  session = deps.db.users[1];
  const r = await call('POST /api/onboarding/complete', { answers: ANSWERS });
  assert.equal(r.code, 200);
  const chat = loadChat(deps.DATA, 'cli1');
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].from, 'coach');
  assert.ok(chat.messages[0].text.includes('Marc'));
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].uid, 'coach1');
  assert.ok(pushes[0].payload.title.includes('Marc'));
  assert.equal(pushes[0].payload.url, '#/coach');
  assert.ok(deps.db.users[1].onboarded);
});

test('second call is a no-op (idempotent)', async () => {
  session = deps.db.users[1];
  await call('POST /api/onboarding/complete', { answers: ANSWERS });
  const r2 = await call('POST /api/onboarding/complete', { answers: ANSWERS });
  assert.equal(r2.obj.already, true);
  assert.equal(loadChat(deps.DATA, 'cli1').messages.length, 1);
  assert.equal(pushes.length, 1);
});

test('welcomeText varies by objectif and includes the name', () => {
  const a = welcomeText('Marc', { ...ANSWERS, objectif: 'muscle' });
  const b = welcomeText('Marc', { ...ANSWERS, objectif: 'forme' });
  assert.ok(a.includes('Marc') && b.includes('Marc'));
  assert.notEqual(a, b);
});

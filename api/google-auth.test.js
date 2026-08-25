import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { registerGoogleRoutes } from './google-auth.js';

const SECRET = 'test-secret';
const sign = p => p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
const verifySig = t => {
  const i = t.lastIndexOf('.');
  if (i < 0) return null;
  const p = t.slice(0, i);
  return t.slice(i + 1) === crypto.createHmac('sha256', SECRET).update(p).digest('base64url') ? p : null;
};

let routes, deps, headersOut, fetchCalls, fetchResponses;
const call = async (key, url) => {
  headersOut.length = 0;
  const res = {
    writeHead: (code, headers) => headersOut.push({ code, headers }),
    end: () => {}
  };
  await routes[key]({ url }, res);
  return headersOut[0];
};

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-test';
  headersOut = [];
  fetchCalls = [];
  fetchResponses = [];
  deps = {
    db: { users: [] },
    saveDb: () => {},
    json: (res, code, obj) => headersOut.push({ code, obj }),
    sign, verifySig,
    sessionCookie: u => 'gymsid=sess-' + u.id,
    ORIGIN: 'https://gymmentor.app',
    INVITE_ONLY: false,
    audit: () => {},
    fetchFn: async (url, opts) => { fetchCalls.push({ url, opts }); return fetchResponses.shift(); }
  };
  routes = {};
  assert.equal(registerGoogleRoutes(routes, deps), true);
});
afterEach(() => { delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; });

const ok = obj => ({ ok: true, json: async () => obj });
const validState = () => sign(crypto.randomBytes(8).toString('base64url') + ':' + (Date.now() + 600000));

test('inert without env vars', () => {
  delete process.env.GOOGLE_CLIENT_ID;
  const r = {};
  assert.equal(registerGoogleRoutes(r, deps), false);
  assert.equal(Object.keys(r).length, 0);
});

test('GET /api/auth/google redirects to Google with signed state', async () => {
  const h = await call('GET /api/auth/google', '/api/auth/google');
  assert.equal(h.code, 302);
  const loc = h.headers.Location;
  assert.ok(loc.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.ok(loc.includes('prompt=select_account'));
  const state = new URL(loc).searchParams.get('state');
  assert.ok(verifySig(state));
});

test('callback with bad state redirects home without cookie', async () => {
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=x&state=forged');
  assert.equal(h.code, 302);
  assert.equal(h.headers.Location, '/');
  assert.equal(h.headers['Set-Cookie'], undefined);
  assert.equal(fetchCalls.length, 0);
});

test('callback with expired state is refused', async () => {
  const expired = sign('nonce:' + (Date.now() - 1000));
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=x&state=' + encodeURIComponent(expired));
  assert.equal(h.headers.Location, '/');
  assert.equal(fetchCalls.length, 0);
});

test('first sign-in creates the user and sets the session cookie', async () => {
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-123', email: 'marc@gmail.com', given_name: 'Marc' })];
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(validState()));
  assert.equal(h.code, 302);
  assert.equal(h.headers.Location, '/');
  assert.ok(h.headers['Set-Cookie'].startsWith('gymsid=sess-'));
  assert.equal(deps.db.users.length, 1);
  const u = deps.db.users[0];
  assert.equal(u.google, 'g-123');
  assert.equal(u.email, 'marc@gmail.com');
  assert.equal(u.name, 'Marc');
  assert.ok(u.id && u.created);
});

test('second sign-in with same sub reuses the account', async () => {
  deps.db.users.push({ id: 'u1', name: 'Marc', google: 'g-123', email: 'marc@gmail.com' });
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-123', email: 'marc@gmail.com' })];
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(validState()));
  assert.equal(deps.db.users.length, 1);
  assert.ok(h.headers['Set-Cookie'].includes('u1'));
});

test('wrong aud is refused', async () => {
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'evil-client', sub: 'g-9' })];
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(validState()));
  assert.equal(h.headers.Location, '/');
  assert.equal(h.headers['Set-Cookie'], undefined);
  assert.equal(deps.db.users.length, 0);
});

test('disabled account gets no cookie', async () => {
  deps.db.users.push({ id: 'u1', name: 'Marc', google: 'g-123', disabled: true });
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-123' })];
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(validState()));
  assert.equal(h.headers['Set-Cookie'], undefined);
});

test('INVITE_ONLY blocks new Google accounts but not existing ones', async () => {
  deps.INVITE_ONLY = true;
  routes = {}; registerGoogleRoutes(routes, deps);
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-new' })];
  let h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(validState()));
  assert.equal(h.headers.Location, '/#/login-invite-required');
  assert.equal(deps.db.users.length, 0);
  deps.db.users.push({ id: 'u1', name: 'Marc', google: 'g-old' });
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-old' })];
  h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(validState()));
  assert.ok(h.headers['Set-Cookie']);
});

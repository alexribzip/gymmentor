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
const call = async (key, url, cookie) => {
  headersOut.length = 0;
  const res = {
    writeHead: (code, headers) => headersOut.push({ code, headers }),
    end: () => {}
  };
  await routes[key]({ url, headers: { cookie: cookie || '' } }, res);
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

// Extracts the `gstate` cookie value from a Set-Cookie header (string) produced by the
// GET /api/auth/google redirect.
const gstateFromSetCookie = setCookie => {
  const m = /gstate=([^;]*)/.exec(setCookie || '');
  return m ? m[1] : null;
};

// Drives the full "start the flow" step and returns the signed state plus the matching
// double-submit cookie a real browser would be carrying when it hits the callback.
const beginFlow = async () => {
  const h = await call('GET /api/auth/google', '/api/auth/google');
  const loc = h.headers.Location;
  const state = new URL(loc).searchParams.get('state');
  const nonce = gstateFromSetCookie(h.headers['Set-Cookie']);
  return { state, cookie: 'gstate=' + nonce };
};

test('inert without env vars', () => {
  delete process.env.GOOGLE_CLIENT_ID;
  const r = {};
  assert.equal(registerGoogleRoutes(r, deps), false);
  assert.equal(Object.keys(r).length, 0);
});

test('GET /api/auth/google redirects to Google with signed state and sets gstate cookie', async () => {
  const h = await call('GET /api/auth/google', '/api/auth/google');
  assert.equal(h.code, 302);
  const loc = h.headers.Location;
  assert.ok(loc.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.ok(loc.includes('prompt=select_account'));
  const state = new URL(loc).searchParams.get('state');
  const payload = verifySig(state);
  assert.ok(payload);
  const nonce = gstateFromSetCookie(h.headers['Set-Cookie']);
  assert.ok(nonce);
  assert.ok(h.headers['Set-Cookie'].startsWith('gstate=' + nonce));
  assert.equal(payload.split(':')[0], nonce);
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
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=x&state=' + encodeURIComponent(expired), 'gstate=nonce');
  assert.equal(h.headers.Location, '/');
  assert.equal(fetchCalls.length, 0);
});

test('callback with valid state but missing/mismatched gstate cookie is refused', async () => {
  const { state } = await beginFlow();
  // No cookie at all.
  let h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(state));
  assert.equal(h.headers.Location, '/');
  assert.equal(h.headers['Set-Cookie'], undefined);
  assert.equal(fetchCalls.length, 0);

  // Wrong nonce.
  h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(state), 'gstate=some-other-nonce');
  assert.equal(h.headers.Location, '/');
  assert.equal(h.headers['Set-Cookie'], undefined);
  assert.equal(fetchCalls.length, 0);
});

test('first sign-in creates the user and sets the session cookie', async () => {
  const { state, cookie } = await beginFlow();
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-123', email: 'marc@gmail.com', email_verified: 'true', given_name: 'Marc' })];
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(state), cookie);
  assert.equal(h.code, 302);
  assert.equal(h.headers.Location, '/');
  assert.ok(Array.isArray(h.headers['Set-Cookie']));
  assert.ok(h.headers['Set-Cookie'].some(c => c.startsWith('gymsid=sess-')));
  assert.ok(h.headers['Set-Cookie'].some(c => c.startsWith('gstate=;')));
  assert.equal(deps.db.users.length, 1);
  const u = deps.db.users[0];
  assert.equal(u.google, 'g-123');
  assert.equal(u.email, 'marc@gmail.com');
  assert.equal(u.name, 'Marc');
  assert.ok(u.id && u.created);
});

test('unverified email is not stored', async () => {
  const { state, cookie } = await beginFlow();
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-456', email: 'unverified@gmail.com', email_verified: 'false', given_name: 'Alex' })];
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(state), cookie);
  assert.equal(deps.db.users.length, 1);
  const u = deps.db.users[0];
  assert.equal(u.email, null);
});

test('second sign-in with same sub reuses the account', async () => {
  deps.db.users.push({ id: 'u1', name: 'Marc', google: 'g-123', email: 'marc@gmail.com' });
  const { state, cookie } = await beginFlow();
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-123', email: 'marc@gmail.com', email_verified: 'true' })];
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(state), cookie);
  assert.equal(deps.db.users.length, 1);
  assert.ok(h.headers['Set-Cookie'].some(c => c.includes('u1')));
});

test('wrong aud is refused', async () => {
  const { state, cookie } = await beginFlow();
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'evil-client', sub: 'g-9' })];
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(state), cookie);
  assert.equal(h.headers.Location, '/');
  assert.equal(h.headers['Set-Cookie'], undefined);
  assert.equal(deps.db.users.length, 0);
});

test('disabled account gets no cookie', async () => {
  deps.db.users.push({ id: 'u1', name: 'Marc', google: 'g-123', disabled: true });
  const { state, cookie } = await beginFlow();
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-123' })];
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(state), cookie);
  assert.equal(h.headers['Set-Cookie'], undefined);
});

test('token endpoint http error is refused', async () => {
  const { state, cookie } = await beginFlow();
  fetchResponses = [{ ok: false, status: 400, json: async () => ({}) }];
  const h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(state), cookie);
  assert.equal(h.headers.Location, '/');
  assert.equal(h.headers['Set-Cookie'], undefined);
  assert.equal(deps.db.users.length, 0);
});

test('INVITE_ONLY blocks new Google accounts but not existing ones', async () => {
  deps.INVITE_ONLY = true;
  routes = {}; registerGoogleRoutes(routes, deps);
  let flow = await beginFlow();
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-new' })];
  let h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(flow.state), flow.cookie);
  assert.equal(h.headers.Location, '/#/login-invite-required');
  assert.equal(deps.db.users.length, 0);
  deps.db.users.push({ id: 'u1', name: 'Marc', google: 'g-old' });
  flow = await beginFlow();
  fetchResponses = [ok({ id_token: 'idt' }), ok({ aud: 'cid.apps.googleusercontent.com', sub: 'g-old' })];
  h = await call('GET /api/auth/google/callback', '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(flow.state), flow.cookie);
  assert.ok(h.headers['Set-Cookie']);
});

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { registerBillingRoutes } from './billing.js';

const WHSEC = 'whsec_testsecret';

let routes, deps, out, pushes, fetchCalls, fetchResponses;
const mkReq = (url, rawBody) => {
  const req = rawBody === undefined ? { url, headers: {} } : Object.assign(Readable.from([Buffer.from(rawBody)]), { url, headers: {} });
  return req;
};
const call = async (key, req) => {
  out.length = 0;
  const res = { writeHead: (code, headers) => out.push({ code, headers }), end: body => { if (body && !out.length) out.push({ code: 200, body }); } };
  await routes[key](req, res);
  return out[0];
};
const sig = (raw, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', WHSEC).update(`${t}.${raw}`).digest('hex')}`;
const ok = obj => ({ ok: true, json: async () => obj });

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_PRICE_ID = 'price_x';
  process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
  out = []; pushes = []; fetchCalls = []; fetchResponses = [];
  deps = {
    db: { users: [
      { id: 'coach1', name: 'Alexis', admin: true },
      { id: 'cli1', name: 'Marc' },
      { id: 'cli2', name: 'Zoe', coached: true, stripeCustomer: 'cus_zoe' }
    ] },
    saveDb: () => {},
    json: (res, code, obj) => out.push({ code, obj }),
    readSession: () => deps._session,
    sendPush: (uid, payload) => pushes.push({ uid, payload }),
    isAdmin: u => !!u.admin,
    ORIGIN: 'https://gymmentor.app',
    audit: () => {},
    fetchFn: async (url, opts) => { fetchCalls.push({ url, opts }); return fetchResponses.shift(); },
    _session: null
  };
  routes = {};
  assert.equal(registerBillingRoutes(routes, deps), true);
});
afterEach(() => { delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_PRICE_ID; delete process.env.STRIPE_WEBHOOK_SECRET; });

test('inert without env vars', () => {
  delete process.env.STRIPE_PRICE_ID;
  const r = {};
  assert.equal(registerBillingRoutes(r, deps), false);
  assert.equal(Object.keys(r).length, 0);
});

test('checkout creates a Stripe session and redirects to it', async () => {
  deps._session = deps.db.users[1];
  fetchResponses = [ok({ url: 'https://checkout.stripe.com/c/pay_123' })];
  const h = await call('GET /api/billing/checkout', mkReq('/api/billing/checkout'));
  assert.equal(h.code, 302);
  assert.equal(h.headers.Location, 'https://checkout.stripe.com/c/pay_123');
  const body = String(fetchCalls[0].opts.body);
  assert.ok(body.includes('client_reference_id=cli1'));
  assert.ok(body.includes('mode=subscription'));
  assert.ok(decodeURIComponent(body).includes('line_items[0][price]=price_x'));
});

test('checkout for an already coached user goes home', async () => {
  deps._session = deps.db.users[2];
  const h = await call('GET /api/billing/checkout', mkReq('/api/billing/checkout'));
  assert.equal(h.headers.Location, '/');
  assert.equal(fetchCalls.length, 0);
});

test('webhook rejects bad and stale signatures', async () => {
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'cli1', customer: 'cus_m' } } });
  let req = mkReq('/api/stripe/webhook', raw); req.headers['stripe-signature'] = 't=1,v1=deadbeef';
  assert.equal((await call('POST /api/stripe/webhook', req)).code, 400);
  const old = Math.floor(Date.now() / 1000) - 600;
  req = mkReq('/api/stripe/webhook', raw); req.headers['stripe-signature'] = sig(raw, old);
  assert.equal((await call('POST /api/stripe/webhook', req)).code, 400);
  assert.equal(deps.db.users[1].coached, undefined);
});

test('checkout.session.completed activates the user and pushes both sides', async () => {
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'cli1', customer: 'cus_m' } } });
  const req = mkReq('/api/stripe/webhook', raw); req.headers['stripe-signature'] = sig(raw);
  const h = await call('POST /api/stripe/webhook', req);
  assert.equal(h.code, 200);
  assert.equal(deps.db.users[1].coached, true);
  assert.equal(deps.db.users[1].stripeCustomer, 'cus_m');
  assert.ok(pushes.some(p => p.uid === 'cli1'));
  assert.ok(pushes.some(p => p.uid === 'coach1'));
});

test('redelivered completed event is a no-op', async () => {
  deps.db.users[1].coached = true; deps.db.users[1].stripeCustomer = 'cus_m';
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'cli1', customer: 'cus_m' } } });
  const req = mkReq('/api/stripe/webhook', raw); req.headers['stripe-signature'] = sig(raw);
  assert.equal((await call('POST /api/stripe/webhook', req)).code, 200);
  assert.equal(pushes.length, 0);
});

test('a disabled account is not reactivated by a payment', async () => {
  deps.db.users[1].disabled = true;
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'cli1', customer: 'cus_m' } } });
  const req = mkReq('/api/stripe/webhook', raw); req.headers['stripe-signature'] = sig(raw);
  assert.equal((await call('POST /api/stripe/webhook', req)).code, 200);
  assert.equal(deps.db.users[1].coached, undefined);
  assert.ok(pushes.some(p => p.uid === 'coach1'));
});

test('subscription.deleted deactivates by stripeCustomer', async () => {
  const raw = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_zoe' } } });
  const req = mkReq('/api/stripe/webhook', raw); req.headers['stripe-signature'] = sig(raw);
  assert.equal((await call('POST /api/stripe/webhook', req)).code, 200);
  assert.equal(deps.db.users[2].coached, false);
  assert.ok(pushes.some(p => p.uid === 'coach1'));
});

test('unknown events are acknowledged and ignored', async () => {
  const raw = JSON.stringify({ type: 'invoice.paid', data: { object: {} } });
  const req = mkReq('/api/stripe/webhook', raw); req.headers['stripe-signature'] = sig(raw);
  assert.equal((await call('POST /api/stripe/webhook', req)).code, 200);
  assert.equal(pushes.length, 0);
});

test('portal redirects for a customer, home otherwise', async () => {
  deps._session = deps.db.users[2];
  fetchResponses = [ok({ url: 'https://billing.stripe.com/p/session_x' })];
  let h = await call('GET /api/billing/portal', mkReq('/api/billing/portal'));
  assert.equal(h.headers.Location, 'https://billing.stripe.com/p/session_x');
  deps._session = deps.db.users[1];
  h = await call('GET /api/billing/portal', mkReq('/api/billing/portal'));
  assert.equal(h.headers.Location, '/');
});

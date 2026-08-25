/* Stripe billing — Checkout for the coaching subscription, webhook that flips
   user.coached automatically, and the customer portal. Zero dependencies: the
   Stripe API is plain HTTPS + form encoding, the webhook signature is native
   HMAC. Inert unless all three STRIPE_* env vars are set. */
import crypto from 'node:crypto';

const API = 'https://api.stripe.com/v1';
const SIG_TOLERANCE = 300; // seconds
const MAX_RAW = 1024 * 1024;

export function registerBillingRoutes(routes, deps) {
  const KEY = process.env.STRIPE_SECRET_KEY;
  const PRICE = process.env.STRIPE_PRICE_ID;
  const WHSEC = process.env.STRIPE_WEBHOOK_SECRET;
  if (!KEY || !PRICE || !WHSEC) return false;

  const { db, saveDb, json, readSession, sendPush, isAdmin, ORIGIN, audit } = deps;
  const fetchFn = deps.fetchFn || globalThis.fetch;

  const redirect = (res, to) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
  const stripe = (path, params) => fetchFn(API + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const pushAdmins = payload => { for (const a of db.users.filter(isAdmin)) sendPush(a.id, payload); };

  routes['GET /api/billing/checkout'] = async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (user.coached) return redirect(res, '/');
    try {
      const r = await stripe('/checkout/sessions', {
        mode: 'subscription',
        'line_items[0][price]': PRICE,
        'line_items[0][quantity]': '1',
        client_reference_id: user.id,
        success_url: ORIGIN + '/#/chat?sub=ok',
        cancel_url: ORIGIN + '/#/chat',
        locale: 'fr'
      });
      const session = await r.json();
      if (!r.ok || !session.url) throw new Error('no session url');
      audit(req, 'billing.checkout', { user });
      redirect(res, session.url);
    } catch (e) {
      audit(req, 'billing.checkout.fail', { ok: false, user });
      redirect(res, ORIGIN + '/#/chat?sub=err');
    }
  };

  routes['GET /api/billing/portal'] = async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!user.stripeCustomer) return redirect(res, '/');
    try {
      const r = await stripe('/billing_portal/sessions', { customer: user.stripeCustomer, return_url: ORIGIN });
      const session = await r.json();
      if (!r.ok || !session.url) throw new Error('no portal url');
      redirect(res, session.url);
    } catch (e) { redirect(res, '/'); }
  };

  // Called by Stripe, not by a browser: signature is the only authentication.
  routes['POST /api/stripe/webhook'] = async (req, res) => {
    let raw;
    try { raw = await readRaw(req); } catch (e) { return json(res, 400, { error: 'body' }); }
    if (!verifyStripeSig(raw, req.headers['stripe-signature'] || '', WHSEC)) {
      audit(req, 'billing.webhook.fail', { ok: false, msg: 'bad-signature' });
      return json(res, 400, { error: 'bad signature' });
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'bad json' }); }
    const obj = event?.data?.object || {};

    if (event.type === 'checkout.session.completed') {
      const user = db.users.find(u => u.id === obj.client_reference_id);
      if (user && user.disabled) {
        audit(req, 'billing.subscribed.disabled', { ok: false, user });
        pushAdmins({ title: '⚠️ Paiement sur un compte désactivé', body: user.name, tag: 'chat', url: '#/coach' });
      } else if (user && !user.coached) {
        user.coached = true;
        user.stripeCustomer = obj.customer || user.stripeCustomer || null;
        saveDb();
        audit(req, 'billing.subscribed', { user });
        sendPush(user.id, { title: '🎉 Ton coaching est actif', body: 'Ton coach t\'attend dans le chat.', tag: 'chat', url: '#/chat' });
        pushAdmins({ title: '💶 ' + user.name + ' vient de s\'abonner', body: 'Coaching activé automatiquement.', tag: 'chat', url: '#/coach' });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const user = db.users.find(u => u.stripeCustomer && u.stripeCustomer === obj.customer);
      if (user && user.coached) {
        user.coached = false;
        saveDb();
        audit(req, 'billing.cancelled', { user });
        pushAdmins({ title: '⚠️ ' + user.name + ' a résilié', body: 'Coaching désactivé.', tag: 'chat', url: '#/coach' });
      }
    }
    json(res, 200, { received: true });
  };

  return true;
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_RAW) { reject(new Error('too large')); req.destroy?.(); return; }
      chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Stripe-Signature: t=<unix>,v1=<hex hmac of `${t}.${raw}`>[,v1=…]
function verifyStripeSig(raw, header, secret) {
  const parts = Object.create(null);
  const v1s = [];
  for (const kv of String(header).split(',')) {
    const i = kv.indexOf('=');
    if (i < 0) continue;
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (k === 'v1') v1s.push(v); else parts[k] = v;
  }
  const t = +parts.t;
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > SIG_TOLERANCE) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.').update(raw).digest('hex');
  return v1s.some(v => {
    try { return v.length === expected.length && crypto.timingSafeEqual(Buffer.from(v, 'hex'), Buffer.from(expected, 'hex')); }
    catch { return false; }
  });
}

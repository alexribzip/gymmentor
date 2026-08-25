/* Google Sign-In — server-side OAuth code flow, zero dependencies.
   Identity anchor is the stable Google `sub`; email is stored for the coach's
   CRM view only and never used as an identifier. Inert unless both
   GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. */
import crypto from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const STATE_TTL = 600000; // 10 min

export function registerGoogleRoutes(routes, deps) {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  if (!CLIENT_ID || !CLIENT_SECRET) return false;

  const { db, saveDb, sign, verifySig, sessionCookie, ORIGIN, INVITE_ONLY, audit } = deps;
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const REDIRECT = ORIGIN + '/api/auth/google/callback';
  // Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
  // (mirrors the SECURE pattern in server.js).
  const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';
  const GSTATE_PATH = '/api/auth/google/callback';
  const clearGstateCookie = `gstate=; Path=${GSTATE_PATH}; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

  const redirect = (res, to, cookie) => {
    const headers = { Location: to, 'Cache-Control': 'no-store' };
    if (cookie) headers['Set-Cookie'] = cookie;
    res.writeHead(302, headers);
    res.end();
  };

  const readCookie = (req, name) => {
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
      const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
    }));
    return cookies[name];
  };

  routes['GET /api/auth/google'] = async (req, res) => {
    // The nonce both anchors the signed `state` payload and rides along as a double-submit
    // cookie, so the callback can bind the redirect back to the browser that started the flow
    // (login-CSRF: without this, an attacker can plant their own signed state+code in a victim's
    // browser and log them into the attacker's account).
    const nonce = crypto.randomBytes(16).toString('base64url');
    const state = sign(nonce + ':' + (Date.now() + STATE_TTL));
    const q = new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code',
      scope: 'openid email profile', prompt: 'select_account', state
    });
    const gstateCookie = `gstate=${nonce}; Path=${GSTATE_PATH}; Max-Age=600; HttpOnly;${SECURE} SameSite=Lax`;
    redirect(res, AUTH_URL + '?' + q, gstateCookie);
  };

  routes['GET /api/auth/google/callback'] = async (req, res) => {
    const params = new URL(req.url, 'http://x').searchParams;
    const payload = verifySig(params.get('state') || '');
    const [nonce, expStr] = payload ? payload.split(':') : [];
    const exp = expStr && +expStr;
    if (!exp || exp < Date.now()) { audit(req, 'auth.google.fail', { ok: false, msg: 'bad-state' }); return redirect(res, '/'); }
    const gstate = readCookie(req, 'gstate');
    if (!gstate || gstate !== nonce) { audit(req, 'auth.google.fail', { ok: false, msg: 'bad-state' }); return redirect(res, '/'); }
    const code = params.get('code');
    if (!code) { audit(req, 'auth.google.fail', { ok: false, msg: 'no-code' }); return redirect(res, '/'); }

    let info;
    try {
      const tokenRes = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' })
      });
      if (!tokenRes.ok) throw new Error('token http ' + tokenRes.status);
      const { id_token } = await tokenRes.json();
      if (!id_token) throw new Error('no id_token');
      // Google validates the signature server-side; we check aud + sub.
      const infoRes = await fetchFn(INFO_URL + '?id_token=' + encodeURIComponent(id_token));
      if (!infoRes.ok) throw new Error('tokeninfo http ' + infoRes.status);
      info = await infoRes.json();
    } catch (e) {
      audit(req, 'auth.google.fail', { ok: false, msg: 'exchange-error' });
      return redirect(res, '/');
    }
    if (info.aud !== CLIENT_ID || !info.sub) { audit(req, 'auth.google.fail', { ok: false, msg: 'bad-token' }); return redirect(res, '/'); }

    let user = db.users.find(u => u.google === info.sub);
    if (!user) {
      if (INVITE_ONLY) { audit(req, 'auth.google.fail', { ok: false, msg: 'invite-required' }); return redirect(res, '/#/login-invite-required'); }
      // tokeninfo returns email_verified as the string 'true'/'false' (occasionally boolean);
      // only trust the email when Google itself vouches it's verified.
      const emailVerified = info.email_verified === 'true' || info.email_verified === true;
      user = {
        id: crypto.randomBytes(12).toString('base64url'),
        name: String(info.given_name || info.name || 'Sportif').slice(0, 40),
        created: new Date().toISOString(),
        google: info.sub,
        email: emailVerified && info.email ? info.email : null
      };
      db.users.push(user);
      saveDb();
      audit(req, 'auth.google.register', { user });
    } else if (user.disabled) {
      audit(req, 'auth.google.fail', { ok: false, user, msg: 'account-disabled' });
      return redirect(res, '/');
    } else {
      audit(req, 'auth.google.ok', { user });
    }
    redirect(res, '/', [sessionCookie(user), clearGstateCookie]);
  };

  return true;
}

# Google Sign-In — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « Continuer avec Google » — flow OAuth code côté serveur sans dépendance, email en CRM coach — spec `docs/superpowers/specs/2026-08-25-google-auth-design.md`.

**Architecture:** Module `api/google-auth.js` (pattern registerXRoutes + deps, `fetchFn` injectable), state HMAC via `sign`/`verifySig` existants, session cookie existant. Front : bouton principal sur Login si `config.google`, email affiché dans Coach/Admin.

**Tech Stack:** Node ESM sans framework (fetch natif, node --test), React 19 + vitest. Aucune dépendance nouvelle.

## Global Constraints

- Repo `C:\Users\AlexisRibéry\opengym-coach`, branche `google-auth` (créée depuis `main`). Style : api avec points-virgules ; frontend sans, quotes simples. Trailer commit habituel.
- Env : `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. L'un absent → `registerGoogleRoutes` retourne `false` et n'enregistre RIEN.
- Ancre d'identité = `sub` Google (`user.google`), jamais l'email. `aud` vérifié === GOOGLE_CLIENT_ID. `state` = `sign(nonce + ':' + (Date.now()+600000))`, vérifié + non expiré au callback.
- URL d'autorisation : `https://accounts.google.com/o/oauth2/v2/auth` avec `client_id`, `redirect_uri = ORIGIN + '/api/auth/google/callback'`, `response_type=code`, `scope=openid email profile`, `prompt=select_account`, `state`.
- Échecs du callback : 302 vers `/` sans cookie (silencieux) ; création refusée si `INVITE_ONLY` → 302 vers `/#/login-invite-required` ; `disabled` → 302 `/` sans cookie.
- `email`/`google` ne sortent JAMAIS dans `publicUser` (client final) ; exposés uniquement dans les réponses admin/coach.
- ⚠️ Dockerfile : ajouter `google-auth.js` au COPY.
- Tests : `cd api && node --test *.test.js` ; `cd frontend && npx vitest run`.

---

### Task 0: Branche

- [ ] `git checkout main && git checkout -b google-auth`. Aucun commit.

---

### Task 1: Module `api/google-auth.js` + tests

**Files:**
- Create: `api/google-auth.js`
- Test: `api/google-auth.test.js`

**Interfaces:**
- Consumes: deps `{ db, saveDb, json, sign, verifySig, sessionCookie, ORIGIN, INVITE_ONLY, audit, fetchFn }` (fetchFn défaut `globalThis.fetch`). Lit `process.env.GOOGLE_CLIENT_ID/SECRET` à l'appel.
- Produces: `registerGoogleRoutes(routes, deps) → boolean` (true si routes enregistrées). Routes `GET /api/auth/google`, `GET /api/auth/google/callback`.

- [ ] **Step 1: Tests qui échouent** — `api/google-auth.test.js` :

```js
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
```

- [ ] **Step 2:** `cd api && node --test google-auth.test.js` — FAIL (module inexistant).

- [ ] **Step 3: Implémentation** — `api/google-auth.js` :

```js
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

  const redirect = (res, to, cookie) => {
    const headers = { Location: to, 'Cache-Control': 'no-store' };
    if (cookie) headers['Set-Cookie'] = cookie;
    res.writeHead(302, headers);
    res.end();
  };

  routes['GET /api/auth/google'] = async (req, res) => {
    const state = sign(crypto.randomBytes(16).toString('base64url') + ':' + (Date.now() + STATE_TTL));
    const q = new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code',
      scope: 'openid email profile', prompt: 'select_account', state
    });
    redirect(res, AUTH_URL + '?' + q);
  };

  routes['GET /api/auth/google/callback'] = async (req, res) => {
    const params = new URL(req.url, 'http://x').searchParams;
    const payload = verifySig(params.get('state') || '');
    const exp = payload && +payload.split(':')[1];
    if (!exp || exp < Date.now()) { audit(req, 'auth.google.fail', { ok: false, msg: 'bad-state' }); return redirect(res, '/'); }
    const code = params.get('code');
    if (!code) { audit(req, 'auth.google.fail', { ok: false, msg: 'no-code' }); return redirect(res, '/'); }

    let info;
    try {
      const tokenRes = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' })
      });
      const { id_token } = await tokenRes.json();
      if (!id_token) throw new Error('no id_token');
      // Google validates the signature server-side; we check aud + sub.
      const infoRes = await fetchFn(INFO_URL + '?id_token=' + encodeURIComponent(id_token));
      info = await infoRes.json();
    } catch (e) {
      audit(req, 'auth.google.fail', { ok: false, msg: 'exchange-error' });
      return redirect(res, '/');
    }
    if (info.aud !== CLIENT_ID || !info.sub) { audit(req, 'auth.google.fail', { ok: false, msg: 'bad-token' }); return redirect(res, '/'); }

    let user = db.users.find(u => u.google === info.sub);
    if (!user) {
      if (INVITE_ONLY) { audit(req, 'auth.google.fail', { ok: false, msg: 'invite-required' }); return redirect(res, '/#/login-invite-required'); }
      user = {
        id: crypto.randomBytes(12).toString('base64url'),
        name: String(info.given_name || info.name || 'Sportif').slice(0, 40),
        created: new Date().toISOString(),
        google: info.sub,
        email: info.email || null
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
    redirect(res, '/', sessionCookie(user));
  };

  return true;
}
```

- [ ] **Step 4:** `node --test google-auth.test.js` — 9 tests PASS ; `node --test *.test.js` — tout passe.

- [ ] **Step 5: Commit**

```bash
git add api/google-auth.js api/google-auth.test.js
git commit -m "feat(api): Google Sign-In — server-side OAuth code flow, zero deps"
```

---

### Task 2: Câblage serveur + email pour le coach + Dockerfile + env

**Files:**
- Modify: `api/server.js`, `api/chat.js` (threads : email), `api/Dockerfile`, `.env.example`
- Test: `api/chat.test.js` (assertion email)

**Interfaces:**
- Consumes: Task 1 `registerGoogleRoutes(routes, deps) → boolean`.
- Produces: `GET /api/config` renvoie `google: boolean` ; `GET /api/admin/user` renvoie `user.email` ; `GET /api/coach/threads` renvoie `email` par fil.

- [ ] **Step 1: server.js** :
  - Import : `import { registerGoogleRoutes } from './google-auth.js';`
  - Avant l'objet `routes` (près des consts) : `let GOOGLE_ON = false;`
  - Route config — remplacer le handler existant par :
    `'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY, allow_guest: ALLOW_GUEST, google: GOOGLE_ON }),`
  - `GET /api/admin/user` : dans l'objet `user:` renvoyé, ajouter `email: u.email || null,` (après `name`).
  - Après les autres register : `GOOGLE_ON = registerGoogleRoutes(routes, { db, saveDb, json, sign, verifySig, sessionCookie, ORIGIN, INVITE_ONLY, audit });`

- [ ] **Step 2: chat.js threads** — dans le map de `GET /api/coach/threads`, ajouter `email: u.email || null,` après `name`. Test : dans `api/chat.test.js`, test « coach threads … », ajouter un email au user cli1 du beforeEach (`{ id: 'cli1', name: 'Marc', coached: true, email: 'marc@gmail.com' }`) et l'assertion `assert.equal(r.obj.threads[0].email, 'marc@gmail.com');`.

- [ ] **Step 3: Dockerfile** — `COPY server.js chat.js chat-store.js onboarding.js google-auth.js ./`.

- [ ] **Step 4: .env.example** — après le bloc RP_NAME, ajouter :

```
# ── « Continuer avec Google » (optionnel) ─────────────────────────────────
# Crée un client OAuth Web dans la console Google Cloud (URI de redirection :
# https://TON-DOMAINE/api/auth/google/callback). Les deux absents = bouton masqué.
#
#   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
#   GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
```

- [ ] **Step 5:** `node --check server.js && node --test *.test.js` — tout passe.

- [ ] **Step 6: Commit**

```bash
git add api/server.js api/chat.js api/chat.test.js api/Dockerfile .env.example
git commit -m "feat(api): wire Google auth — config flag, coach email, Dockerfile, env docs"
```

---

### Task 3: Front — bouton Login, toast invitation, email vue Coach/Admin, i18n

**Files:**
- Modify: `frontend/src/views/Login.jsx`, `frontend/src/App.jsx` (toast invite), `frontend/src/views/Coach.jsx`, `frontend/src/views/Admin.jsx`, `frontend/src/locales/fr.js`
- Test: `frontend/src/views/Login.test.jsx` (create)

**Interfaces:**
- Consumes: `config.google` (store `config`, chargé par boot/loadConfig existants) ; threads `email` (Task 2).

- [ ] **Step 1: Test qui échoue** — `frontend/src/views/Login.test.jsx` (pattern linkedom/mocks maison) :

```jsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ config: null }))
vi.mock('../store/useStore.js', () => ({
  useStore: Object.assign(
    selector => selector({ setUser: () => {}, pullState: async () => {}, setGuest: () => {}, config: mocks.config }),
    { getState: () => ({ S: {} }) }
  ),
  hasData: () => false
}))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {}, openSheet: () => {} }) } }))
vi.mock('../lib/api.js', () => ({ webauthnOK: () => true, passkeyLogin: async () => ({}), passkeyRegister: async () => ({}), BIO: 'Face ID' }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'x' }))
vi.mock('../lib/guest.js', () => ({ guestAllowed: () => true }))

import Login from './Login.jsx'

let dom, root, host
beforeEach(() => {
  dom = parseHTML('<!doctype html><html><body></body></html>')
  globalThis.document = dom.document
  globalThis.window = dom.window
  host = dom.document.createElement('div')
  dom.document.body.appendChild(host)
})
afterEach(() => { act(() => root?.unmount()); vi.clearAllMocks() })
const render = () => act(() => { root = createRoot(host); root.render(<Login />) })

describe('Login Google button', () => {
  it('shows Continue with Google first when config.google is on', () => {
    mocks.config = { google: true }
    render()
    const a = host.querySelector('a[href="/api/auth/google"]')
    expect(a).toBeTruthy()
    expect(a.textContent).toContain('Google')
  })
  it('hides it when config.google is off', () => {
    mocks.config = { google: false }
    render()
    expect(host.querySelector('a[href="/api/auth/google"]')).toBeFalsy()
  })
})
```

(Adapter les mocks si Login.jsx consomme le store autrement — la source de vérité est le composant réel ; ne pas affaiblir les deux assertions.)

- [ ] **Step 2:** `npx vitest run src/views/Login.test.jsx` — FAIL (asserts sur l'ancre absente).

- [ ] **Step 3: Login.jsx** — dans le bloc `webauthnOK() ? <>…`, AVANT le bouton passkey :

```jsx
        {config?.google && <>
          <a className="btn primary" style={{ display: 'block' }} href="/api/auth/google">{t('Continue with Google')}</a>
          <div style={{ height: 10 }} />
        </>}
```

  et le bouton passkey passe de `variant="primary"` à secondaire quand Google est présent : `<Button variant={config?.google ? undefined : 'primary'} icon="person" …>`. Cas navigateur sans WebAuthn : afficher aussi le bouton Google au-dessus du message d'avertissement si `config?.google` (un compte Google ne dépend pas de WebAuthn) — même ancre, même style.

- [ ] **Step 4: Toast invitation** — dans `App.jsx` (Shell), effet :

```jsx
  // OAuth callback may bounce here when the instance is invite-only.
  useEffect(() => {
    if (loc.pathname === '/login-invite-required') {
      useUI.getState().toast(t('This app is invite-only — ask for an invite code.'))
      navigate('/home', { replace: true })
    }
  }, [loc.pathname])
```

  (`useUI` et `t` déjà importés dans App.jsx ; vérifier et compléter les imports sinon.)

- [ ] **Step 5: Email côté coach/admin** —
  - `Coach.jsx`, composant `Thread`, sous le `div.sub` du header : rien (le header est déjà dense). À la place, dans `ClientData`, première ligne au-dessus des tiles : `<div className="small muted" style={{ marginBottom: 8 }}>{d.user?.email || 'Pas d\'email (compte passkey)'}</div>` — nécessite que `ClientData` lise `d.user` (déjà renvoyé par /api/admin/user).
  - `Admin.jsx`, `UserDetail`, sous la ligne des tags : `{d.user.email && <div className="small muted" style={{ marginBottom: 8 }}>{d.user.email}</div>}`.

- [ ] **Step 6: i18n fr** :

```js
  'Continue with Google': 'Continuer avec Google',
  'This app is invite-only — ask for an invite code.': "Cette appli est sur invitation, demande un code d'accès.",
```

- [ ] **Step 7:** `npx vitest run` complet + `npx vite build` — tout vert.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/Login.jsx frontend/src/views/Login.test.jsx frontend/src/App.jsx frontend/src/views/Coach.jsx frontend/src/views/Admin.jsx frontend/src/locales/fr.js
git commit -m "feat(front): Continue with Google — primary login button, coach email display"
```

---

### Task 4: Vérification finale + doc

**Files:**
- Modify: `docs/DEPLOY-COACH.md`

- [ ] **Step 1:** Vérif complète : `cd api && node --check server.js && node --test *.test.js` puis `cd ../frontend && npx vitest run && npx vite build`.

- [ ] **Step 2:** DEPLOY-COACH.md — dans Installation, après l'édition du .env, ajouter la ligne : `#  + GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET pour « Continuer avec Google » (client OAuth Web, redirect https://gymmentor.app/api/auth/google/callback)`. Dans la checklist E2E, ajouter : `- [ ] « Continuer avec Google » → compte créé, wizard, email visible dans la vue Coach (panneau Données).`

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOY-COACH.md
git commit -m "docs: Google Sign-In setup + smoke item"
```

---

## Self-review (à l'écriture)

- **Couverture spec** : §2 module/routes/state/find-or-create/INVITE_ONLY/disabled → T1 ; §2 retouches config/admin/threads/Dockerfile/env → T2 ; §3 Login/toast/CRM/i18n → T3 ; §5 tests → T1/T2/T3 ; §4 sécurité portée par T1 (aud, state, sub) ; §6 hors périmètre respecté (prompt=select_account inclus T1).
- **Placeholders** : aucun ; la note du T3 Step 1 fixe la source de vérité (composant réel) sans affaiblir les assertions.
- **Cohérence** : `registerGoogleRoutes(routes, deps) → boolean` identique T1/T2 ; `config.google` produit T2, consommé T3 ; `email` produit T2 (threads + admin/user), consommé T3 ; deps `{ db, saveDb, json, sign, verifySig, sessionCookie, ORIGIN, INVITE_ONLY, audit }` = fonctions/consts réellement présentes dans server.js.

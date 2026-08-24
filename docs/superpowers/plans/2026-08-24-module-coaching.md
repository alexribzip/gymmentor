# Module Coaching (chat + vue Coach) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au fork openGym un chat coach↔client intégré (texte seul) gated par un flag `coached`, une vue Coach dédiée, et le rebrand léger placeholder — conformément au spec `docs/superpowers/specs/2026-08-24-opengym-coach-chat-design.md`.

**Architecture:** Un fichier `chat-<uid>.json` par conversation (pattern `state-<uid>.json`), module de routes `api/chat.js` branché sur la map plate de `server.js`, polling + push existants (pas de temps réel). Front : 6ᵉ onglet `/chat` (3 états), vue `/coach` admin-only en français, logique pure testée dans `lib/chat-core.js`.

**Tech Stack:** Node.js sans framework (ESM, `node --test` natif), React 19 + Vite + zustand + react-router (HashRouter), vitest + linkedom, Web Push existant.

## Global Constraints

- Repo : `C:\Users\AlexisRibéry\opengym-coach`, branche `coaching`. Commits fréquents, messages `feat:`/`docs:` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Aucune dépendance npm nouvelle** (ni front ni api).
- Style : `frontend/` sans point-virgule, quotes simples, 2 espaces ; `api/` avec points-virgules (styles maison respectifs).
- Texte de message : trim, 1 à 2 000 caractères (constante `MAX_TEXT = 2000`).
- Erreur d'accès client non coaché : HTTP 403 `{ error: 'not-coached' }` (le front s'en sert pour basculer sur l'upsell).
- Chaînes i18n : source = anglais (clés dans le code), traduction ajoutée dans `frontend/src/locales/fr.js`. Vue Coach : français en dur, hors packs (convention admin).
- LICENSE et NOTICE.md upstream : ne jamais toucher.
- Placeholder de marque : `openGym Coach` (nom final choisi plus tard avec Alexis — un seul point de changement par surface).
- Tests front : `cd frontend && npx vitest run` (faire `npm install` au premier besoin). Tests api : `cd api && node --test *.test.js` (zéro dépendance).

---

### Task 1: Stockage chat côté API (`chat-store.js`)

**Files:**
- Create: `api/chat-store.js`
- Test: `api/chat-store.test.js`

**Interfaces:**
- Consumes: rien (fs/path natifs uniquement).
- Produces: `MAX_TEXT: number` ; `loadChat(dir, uid) → {messages:[{id,from,text,ts}], lastReadClient:number, lastReadCoach:number}` ; `appendMessage(dir, uid, from:'client'|'coach', text) → message` (throw `Error('text required'|'text too long')`) ; `markRead(dir, uid, who:'client'|'coach', upTo) → chat` ; `unreadFor(chat, who) → number`.

- [ ] **Step 1: Écrire les tests qui échouent** — `api/chat-store.test.js` :

```js
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
```

- [ ] **Step 2: Vérifier l'échec** — Run: `cd api && node --test chat-store.test.js` — Expected: FAIL (`Cannot find module ... chat-store.js`).

- [ ] **Step 3: Implémenter** — `api/chat-store.js` :

```js
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
```

- [ ] **Step 4: Vérifier le succès** — Run: `cd api && node --test chat-store.test.js` — Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add api/chat-store.js api/chat-store.test.js
git commit -m "feat(api): chat storage — one JSON file per client, read cursors"
```

---

### Task 2: Routes chat (`api/chat.js`)

**Files:**
- Create: `api/chat.js`
- Test: `api/chat.test.js`

**Interfaces:**
- Consumes: Task 1 (`loadChat`, `appendMessage`, `markRead`, `unreadFor`).
- Produces: `registerChatRoutes(routes, deps)` — deps = `{ DATA, db, saveDb, json, readBody, readSession, requireAdmin, isAdmin, sendPush, audit, readState, livePresence, RP_NAME }`. Enregistre : `GET/POST /api/chat`, `POST /api/chat/read`, `GET /api/chat/unread`, `GET/POST /api/coach/thread`, `GET /api/coach/threads`, `POST /api/coach/read`, `POST /api/coach/coached`.

- [ ] **Step 1: Écrire les tests qui échouent** — `api/chat.test.js` (deps mockées, handlers appelés directement) :

```js
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
      { id: 'cli1', name: 'Marc', coached: true },
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

test('client GET /api/chat refuses non-coached with not-coached', async () => {
  session = deps.db.users[2];          // cli2, not coached
  const r = await call('GET /api/chat');
  assert.equal(r.code, 403);
  assert.equal(r.obj.error, 'not-coached');
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
```

- [ ] **Step 2: Vérifier l'échec** — Run: `cd api && node --test chat.test.js` — Expected: FAIL (`Cannot find module ... chat.js`).

- [ ] **Step 3: Implémenter** — `api/chat.js` :

```js
/* Coaching chat routes — client side (/api/chat/*) and coach side (/api/coach/*).
   Registered into server.js's flat route map; every server helper comes in via
   `deps` so this module has no reach into server.js's module-locals. */
import { loadChat, appendMessage, markRead, unreadFor } from './chat-store.js';

export function registerChatRoutes(routes, deps) {
  const { DATA, db, saveDb, json, readSession, requireAdmin, isAdmin, sendPush, audit, readState, livePresence, RP_NAME } = deps;

  // Client guard: signed in AND flagged coached. The distinct 'not-coached'
  // error is what flips the front to the upsell screen.
  const requireCoached = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    if (!user.coached) { json(res, 403, { error: 'not-coached' }); return null; }
    return user;
  };

  const q = req => new URL(req.url, 'http://x').searchParams;
  const after = (chat, id) => (id ? chat.messages.filter(m => m.id > id) : chat.messages);

  /* ---------- client ---------- */
  routes['GET /api/chat'] = async (req, res) => {
    const user = requireCoached(req, res); if (!user) return;
    const chat = loadChat(DATA, user.id);
    json(res, 200, { messages: after(chat, +q(req).get('after') || 0), lastReadCoach: chat.lastReadCoach });
  };

  routes['POST /api/chat'] = async (req, res) => {
    const user = requireCoached(req, res); if (!user) return;
    const body = await deps.readBody(req);
    let msg;
    try { msg = appendMessage(DATA, user.id, 'client', body.text); }
    catch (e) { return json(res, 400, { error: e.message }); }
    // Notify every admin — single coach today, harmless if there are several.
    for (const admin of db.users.filter(isAdmin)) {
      sendPush(admin.id, { title: '💬 ' + user.name, body: msg.text.slice(0, 120), tag: 'chat', url: '#/coach' });
    }
    json(res, 200, { message: msg });
  };

  routes['POST /api/chat/read'] = async (req, res) => {
    const user = requireCoached(req, res); if (!user) return;
    const body = await deps.readBody(req);
    markRead(DATA, user.id, 'client', body.upTo);
    json(res, 200, { ok: true });
  };

  routes['GET /api/chat/unread'] = async (req, res) => {
    const user = requireCoached(req, res); if (!user) return;
    json(res, 200, { n: unreadFor(loadChat(DATA, user.id), 'client') });
  };

  /* ---------- coach ---------- */
  routes['GET /api/coach/threads'] = async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const threads = db.users.filter(u => !isAdmin(u)).map(u => {
      const chat = loadChat(DATA, u.id);
      const last = chat.messages[chat.messages.length - 1] || null;
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      return {
        id: u.id, name: u.name, coached: !!u.coached, disabled: !!u.disabled,
        lastMsg: last ? { from: last.from, text: last.text.slice(0, 80), ts: last.ts } : null,
        unread: unreadFor(chat, 'coach'),
        lastWorkout: workouts.length ? workouts[workouts.length - 1].d : null,
        live: livePresence(u.id)
      };
    }).sort((a, b) => (b.lastMsg?.ts || 0) - (a.lastMsg?.ts || 0) || a.name.localeCompare(b.name));
    json(res, 200, { threads, now: Date.now() });
  };

  routes['GET /api/coach/thread'] = async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = q(req).get('id');
    if (!db.users.some(u => u.id === id)) return json(res, 404, { error: 'no such user' });
    const chat = loadChat(DATA, id);
    json(res, 200, { messages: after(chat, +q(req).get('after') || 0), lastReadClient: chat.lastReadClient });
  };

  routes['POST /api/coach/thread'] = async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await deps.readBody(req);
    const target = db.users.find(u => u.id === body.id);
    if (!target) return json(res, 404, { error: 'no such user' });
    let msg;
    try { msg = appendMessage(DATA, target.id, 'coach', body.text); }
    catch (e) { return json(res, 400, { error: e.message }); }
    sendPush(target.id, { title: '💬 ' + RP_NAME, body: msg.text.slice(0, 120), tag: 'chat', url: '#/chat' });
    json(res, 200, { message: msg });
  };

  routes['POST /api/coach/read'] = async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await deps.readBody(req);
    if (!db.users.some(u => u.id === body.id)) return json(res, 404, { error: 'no such user' });
    markRead(DATA, body.id, 'coach', body.upTo);
    json(res, 200, { ok: true });
  };

  routes['POST /api/coach/coached'] = async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await deps.readBody(req);
    const target = db.users.find(u => u.id === body.id);
    if (!target) return json(res, 404, { error: 'no such user' });
    if (isAdmin(target)) return json(res, 400, { error: 'cannot coach an admin' });
    target.coached = !!body.coached;
    saveDb();
    audit(req, target.coached ? 'admin.coached.on' : 'admin.coached.off', { user: admin, target });
    json(res, 200, { ok: true, id: target.id, coached: target.coached });
  };
}
```

- [ ] **Step 4: Vérifier le succès** — Run: `cd api && node --test chat.test.js` — Expected: 8 pass. Puis `node --test *.test.js` — Expected: tous passent.

- [ ] **Step 5: Commit**

```bash
git add api/chat.js api/chat.test.js
git commit -m "feat(api): chat routes — client /api/chat/*, coach /api/coach/*, coached flag"
```

---

### Task 3: Câblage `server.js` + flag `coached` dans les réponses auth

**Files:**
- Modify: `api/server.js:10` (imports), `api/server.js:48` (helper), `api/server.js:359-363` (/api/me), `api/server.js:437` (register/verify), `api/server.js:498` (login/verify), `api/server.js:728` (avant la fermeture de `routes`… juste APRÈS l'objet `routes`, ligne ~728)

**Interfaces:**
- Consumes: Task 2 `registerChatRoutes(routes, deps)`.
- Produces: `/api/me`, register/verify et login/verify renvoient `user.coached: boolean`. Toutes les routes chat actives sur le serveur réel.

- [ ] **Step 1: Ajouter l'import** en tête de `server.js` (après l'import `web-push`) :

```js
import { registerChatRoutes } from './chat.js';
```

- [ ] **Step 2: Ajouter le helper `publicUser`** juste sous `const isAdmin = ...` (ligne 48) :

```js
const publicUser = u => ({ id: u.id, name: u.name, admin: isAdmin(u), coached: !!u.coached });
```

- [ ] **Step 3: Remplacer les trois littéraux user.** Dans `GET /api/me`, `POST /api/register/verify` et `POST /api/login/verify`, remplacer `{ id: user.id, name: user.name, admin: isAdmin(user) }` par `publicUser(user)` :
  - `/api/me` : `json(res, 200, { user: publicUser(user) });`
  - register/verify : `json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });`
  - login/verify : `json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });`

- [ ] **Step 4: Enregistrer les routes chat** immédiatement après la fermeture de l'objet `routes` (ligne `};` ~728, avant `http.createServer`) :

```js
registerChatRoutes(routes, {
  DATA, db, saveDb, json, readBody, readSession, requireAdmin, isAdmin,
  sendPush, audit, readState, livePresence, RP_NAME
});
```

- [ ] **Step 5: Vérifier** — Run: `cd api && node --check server.js && node --test *.test.js` — Expected: syntaxe OK, tous les tests passent.

- [ ] **Step 6: Commit**

```bash
git add api/server.js
git commit -m "feat(api): wire chat routes into server, expose coached flag in auth responses"
```

---

### Task 4: Logique front pure (`lib/chat-core.js`)

**Files:**
- Create: `frontend/src/lib/chat-core.js`
- Test: `frontend/src/lib/chat-core.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `mergeMessages(existing, incoming) → messages[]` (dédupliqué par id, trié) ; `lastId(messages) → number` (0 si vide).

- [ ] **Step 1: `npm install`** si `frontend/node_modules` absent — Run: `cd frontend && npm install` (une fois).

- [ ] **Step 2: Écrire les tests qui échouent** — `frontend/src/lib/chat-core.test.js` :

```js
import { describe, expect, it } from 'vitest'
import { mergeMessages, lastId } from './chat-core.js'

const m = (id, from = 'client') => ({ id, from, text: 't' + id, ts: id })

describe('mergeMessages', () => {
  it('appends only unseen messages, ordered by id', () => {
    const out = mergeMessages([m(1), m(2)], [m(2), m(3)])
    expect(out.map(x => x.id)).toEqual([1, 2, 3])
  })
  it('returns the same array when nothing is new', () => {
    const base = [m(1)]
    expect(mergeMessages(base, [m(1)])).toBe(base)
    expect(mergeMessages(base, [])).toBe(base)
    expect(mergeMessages(base, undefined)).toBe(base)
  })
})

describe('lastId', () => {
  it('is 0 on empty and the max id otherwise', () => {
    expect(lastId([])).toBe(0)
    expect(lastId([m(1), m(4)])).toBe(4)
  })
})
```

- [ ] **Step 3: Vérifier l'échec** — Run: `cd frontend && npx vitest run src/lib/chat-core.test.js` — Expected: FAIL (module inexistant).

- [ ] **Step 4: Implémenter** — `frontend/src/lib/chat-core.js` :

```js
// Pure chat logic shared by the client view and the coach inbox — kept out of
// the components so it can be unit-tested like the rest of lib/.

// Merge a polled page into the existing list without duplicates, ordered by id.
// Returns the existing array untouched when nothing is new (cheap re-renders).
export function mergeMessages(existing, incoming) {
  if (!incoming?.length) return existing
  const seen = new Set(existing.map(m => m.id))
  const add = incoming.filter(m => !seen.has(m.id))
  return add.length ? [...existing, ...add].sort((a, b) => a.id - b.id) : existing
}

export const lastId = messages => (messages.length ? messages[messages.length - 1].id : 0)
```

- [ ] **Step 5: Vérifier le succès** — Run: `cd frontend && npx vitest run src/lib/chat-core.test.js` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/chat-core.js frontend/src/lib/chat-core.test.js
git commit -m "feat(front): chat-core — message merge + cursor helpers"
```

---

### Task 5: Vue client `Chat.jsx` (3 états) + route + i18n + CSS

**Files:**
- Create: `frontend/src/views/Chat.jsx`
- Test: `frontend/src/views/Chat.test.jsx`
- Modify: `frontend/src/App.jsx` (import + route), `frontend/src/locales/fr.js` (chaînes), `frontend/src/index.css` (styles bulles)

**Interfaces:**
- Consumes: Task 3 (`GET/POST /api/chat`, `POST /api/chat/read`, `user.coached` via `useStore`), Task 4 (`mergeMessages`, `lastId`). `useUI` : `setChatUnread` **créé en Task 6** — dans cette task, l'appel est protégé par `useUI(s => s.setChatUnread)` optionnel (`setChatUnread?.(0)`).
- Produces: composant par défaut `Chat` routé sur `/chat` ; constante exportée `CONTACT_URL`.

- [ ] **Step 1: Écrire le test des 3 états** — `frontend/src/views/Chat.test.jsx` (pattern `Modals.test.jsx` : linkedom + mocks hoisted) :

```jsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: null,
  isGuest: false,
  api: vi.fn(() => Promise.resolve({ messages: [], lastReadCoach: 0 }))
}))

vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ user: mocks.user, isGuest: () => mocks.isGuest })
}))
vi.mock('../store/useUI.js', () => ({
  useUI: selector => selector({ toast: () => {}, setChatUnread: () => {} })
}))
vi.mock('../lib/api.js', () => ({ api: (...a) => mocks.api(...a) }))
vi.mock('../lib/nav.js', () => ({ go: () => {} }))

import Chat from './Chat.jsx'

let dom, root, host
beforeEach(() => {
  dom = parseHTML('<!doctype html><html><body></body></html>')
  globalThis.document = dom.document
  globalThis.window = dom.window
  host = dom.document.createElement('div')
  dom.document.body.appendChild(host)
})
afterEach(() => { act(() => root?.unmount()); vi.clearAllMocks() })

const render = () => act(() => { root = createRoot(host); root.render(<Chat />) })

describe('Chat view states', () => {
  it('guest → account gate', () => {
    mocks.user = null; mocks.isGuest = true
    render()
    expect(host.textContent).toContain('account')
  })
  it('signed-in non-coached → upsell', () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: false }; mocks.isGuest = false
    render()
    expect(host.textContent).toContain('personal coach')
  })
  it('coached → conversation with input', () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: true }; mocks.isGuest = false
    render()
    expect(host.querySelector('textarea')).toBeTruthy()
    expect(mocks.api).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Vérifier l'échec** — Run: `cd frontend && npx vitest run src/views/Chat.test.jsx` — Expected: FAIL (Chat.jsx inexistant).

- [ ] **Step 3: Implémenter la vue** — `frontend/src/views/Chat.jsx` :

```jsx
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { go } from '../lib/nav.js'
import { mergeMessages, lastId } from '../lib/chat-core.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const POLL_MS = 20000
// Where a non-subscriber reaches the coach — swap for a Stripe/landing link later.
export const CONTACT_URL = 'mailto:alexis.riberypro@gmail.com'

// Guest mode keeps everything in the browser — the chat needs a server profile.
function AccountGate() {
  return <div className="narrow">
    <div className="hdr"><h1>{t('Coach')}</h1></div>
    <div className="card" style={{ textAlign: 'center', padding: '28px 18px' }}>
      <div style={{ fontSize: 34, color: 'var(--label-3)' }}><Icon name="chat" /></div>
      <h3>{t('Chat needs an account')}</h3>
      <p className="muted small">{t('Create your profile to talk to your coach — your workouts sync too.')}</p>
      <Button variant="primary" onClick={() => go('/settings')}>{t('Create profile')}</Button>
    </div>
  </div>
}

// The in-app sales pitch — what a paying subscriber gets.
function Upsell() {
  return <div className="narrow">
    <div className="hdr"><h1>{t('Coach')}</h1></div>
    <div className="card" style={{ padding: '24px 18px' }}>
      <h3 style={{ marginTop: 0 }}>{t('Your personal coach')}</h3>
      <ul className="small" style={{ paddingLeft: 18, margin: '10px 0 16px', display: 'grid', gap: 8 }}>
        <li>{t('A real coach who follows your training')}</li>
        <li>{t('He sees your workouts and adjusts your plan')}</li>
        <li>{t('Unlimited messages, answers within the day')}</li>
      </ul>
      <a className="btn primary" style={{ display: 'block', textAlign: 'center' }} href={CONTACT_URL}>{t('Get coaching')}</a>
    </div>
  </div>
}

function Conversation() {
  const [msgs, setMsgs] = useState([])
  const [lastReadCoach, setLastReadCoach] = useState(0)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const toast = useUI(s => s.toast)
  const setChatUnread = useUI(s => s.setChatUnread)
  const endRef = useRef(null)
  const msgsRef = useRef(msgs)
  msgsRef.current = msgs

  const load = () => api('/api/chat?after=' + lastId(msgsRef.current)).then(r => {
    setLastReadCoach(r.lastReadCoach)
    const merged = mergeMessages(msgsRef.current, r.messages)
    setMsgs(merged)
    // Everything on screen counts as read; keep the tab badge honest right away.
    const newest = lastId(merged)
    if (newest) api('/api/chat/read', { method: 'POST', body: JSON.stringify({ upTo: newest }) }).catch(() => {})
    setChatUnread?.(0)
  }).catch(() => {})

  useEffect(() => { load(); const iv = setInterval(load, POLL_MS); return () => clearInterval(iv) }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])

  const send = () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    api('/api/chat', { method: 'POST', body: JSON.stringify({ text: body }) })
      .then(({ message }) => { setText(''); setMsgs(m => mergeMessages(m, [message])) })
      .catch(e => toast(e.message))          // failed send: the text stays in the field
      .finally(() => setSending(false))
  }

  const lastMine = [...msgs].reverse().find(m => m.from === 'client')
  return <div className="narrow chatview">
    <div className="hdr"><h1>{t('Coach')}</h1></div>
    <div className="chatlog">
      {!msgs.length && <div className="empty small">{t('Say hi — your coach reads everything.')}</div>}
      {msgs.map(m => <div key={m.id} className={'bubble' + (m.from === 'client' ? ' mine' : '')}>
        {m.text}
        {m === lastMine && m.id <= lastReadCoach && <div className="seen">{t('Seen')}</div>}
      </div>)}
      <div ref={endRef} />
    </div>
    <div className="chatinput">
      <textarea rows={1} maxLength={2000} value={text} placeholder={t('Write a message…')}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
      <button className="sendbtn" disabled={!text.trim() || sending} onClick={send} aria-label={t('Send')}>
        <Icon name="arrowUp" />
      </button>
    </div>
  </div>
}

export default function Chat() {
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && isGuest) return <AccountGate />
  if (!user?.coached) return <Upsell />
  return <Conversation />
}
```

Note : `go` vient de `lib/nav.js` (le setter global posé par le Shell) — vérifier le nom exporté dans `lib/nav.js` au moment de coder ; si l'export s'appelle autrement (`navTo`…), utiliser celui-là et corriger le mock du test.

- [ ] **Step 4: Route** — dans `frontend/src/App.jsx` : ajouter `import Chat from './views/Chat.jsx'` et, dans `<Routes>`, après la route `/library` :

```jsx
<Route path="/chat" element={<Chat />} />
```

- [ ] **Step 5: CSS** — ajouter à la fin de `frontend/src/index.css` :

```css
/* ------------------------------------------------------------ coach chat -- */
.chatview{display:flex;flex-direction:column;min-height:calc(100dvh - 120px)}
.chatlog{flex:1;display:flex;flex-direction:column;gap:8px;padding-bottom:12px}
.bubble{
  max-width:82%;padding:9px 13px;border-radius:16px;font-size:.92rem;line-height:1.4;
  background:var(--bg-el);align-self:flex-start;white-space:pre-wrap;word-break:break-word;
  border-bottom-left-radius:5px;
}
.bubble.mine{
  background:var(--acc);color:var(--on-acc);align-self:flex-end;
  border-bottom-left-radius:16px;border-bottom-right-radius:5px;
}
.bubble .seen{font-size:.66rem;opacity:.7;text-align:right;margin-top:3px}
.chatinput{
  position:sticky;bottom:calc(64px + var(--sab));display:flex;gap:8px;align-items:flex-end;
  padding:8px 0;background:var(--bg);
}
.chatinput textarea{
  flex:1;resize:none;border-radius:18px;padding:10px 14px;font-size:.95rem;
  background:var(--bg-el);color:var(--label);border:var(--hair) solid var(--sep-op);
}
.chatinput .sendbtn{
  width:38px;height:38px;border-radius:50%;background:var(--acc);color:var(--on-acc);
  display:flex;align-items:center;justify-content:center;flex:none;font-size:18px;
}
.chatinput .sendbtn:disabled{opacity:.4}
```

- [ ] **Step 6: i18n fr** — ajouter dans `frontend/src/locales/fr.js` (dans l'objet existant) :

```js
  'Coach': 'Coach',
  'Chat needs an account': 'Le chat nécessite un compte',
  'Create your profile to talk to your coach — your workouts sync too.': 'Crée ton profil pour parler à ton coach — tes séances seront aussi synchronisées.',
  'Create profile': 'Créer mon profil',
  'Your personal coach': 'Ton coach personnel',
  'A real coach who follows your training': 'Un vrai coach qui suit ton entraînement',
  'He sees your workouts and adjusts your plan': 'Il voit tes séances et ajuste ton programme',
  'Unlimited messages, answers within the day': 'Messages illimités, réponse dans la journée',
  'Get coaching': 'Démarrer le coaching',
  'Say hi — your coach reads everything.': 'Dis bonjour — ton coach lit tout.',
  'Write a message…': 'Écris ton message…',
  'Send': 'Envoyer',
  'Seen': 'Vu',
```

- [ ] **Step 7: Vérifier** — Run: `cd frontend && npx vitest run src/views/Chat.test.jsx` puis `npx vitest run` — Expected: le nouveau test passe, aucun test existant cassé.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/Chat.jsx frontend/src/views/Chat.test.jsx frontend/src/App.jsx frontend/src/locales/fr.js frontend/src/index.css
git commit -m "feat(front): Chat view — guest gate, upsell, conversation with polling"
```

---

### Task 6: Icône, 6ᵉ onglet, pastille non-lus

**Files:**
- Modify: `frontend/src/components/Icon.jsx` (glyphe `chat`), `frontend/src/components/TabBar.jsx` (onglet + pastille), `frontend/src/store/useUI.js` (état `chatUnread`), `frontend/src/App.jsx` (poll du badge), `frontend/src/index.css` (6 onglets + dot)

**Interfaces:**
- Consumes: Task 3 (`GET /api/chat/unread`), `user.coached` via `useStore`.
- Produces: `useUI` expose `chatUnread: number` et `setChatUnread(n)` ; icône `chat` disponible ; onglet `/chat` visible avec pastille.

- [ ] **Step 1: Glyphe** — dans `Icon.jsx`, section navigation (après `gear`), ajouter :

```jsx
  chat: <path d="M3.9 7a3.1 3.1 0 0 1 3.1-3.1h10a3.1 3.1 0 0 1 3.1 3.1v6a3.1 3.1 0 0 1-3.1 3.1h-6.7l-4.4 3.6v-3.7A3.1 3.1 0 0 1 3.9 13Z" />,
```

- [ ] **Step 2: `useUI`** — dans l'objet du store (`create((set, get) => ({ ... }))`), ajouter après `toastMsg: ''` :

```js
  chatUnread: 0,       // badge on the Coach tab — server-truth, set by the shell poll
```

et après la méthode `toast(msg) {...}` :

```js
  setChatUnread(n) { set({ chatUnread: n }) },
```

- [ ] **Step 3: TabBar** — dans `TabBar.jsx` : importer `useUI` (`import { useUI } from '../store/useUI.js'`), lire `const chatUnread = useUI(s => s.chatUnread)`, ajouter la prop badge au composant `Tab` et l'onglet :

```jsx
  const Tab = ({ k, icon, to, label, badge }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => nav(to)}>
      {badge > 0 && <span className="tabdot" />}
      <Icon name={icon} /><span>{label}</span>
    </button>
  )
```

et après l'onglet Exercises :

```jsx
      <Tab k="chat" icon="chat" to="/chat" label={t('Coach')} badge={chatUnread} />
```

- [ ] **Step 4: Poll du badge** — dans `App.jsx` (composant `Shell`), importer `api` (`import { api } from './lib/api.js'`) et ajouter l'effet après l'effet `useWakeLock` :

```jsx
  // Chat badge — light unread poll; push is the instant signal, this keeps the dot honest.
  const setChatUnread = useUI(s => s.setChatUnread)
  useEffect(() => {
    if (!user?.coached) return
    const load = () => { if (!document.hidden) api('/api/chat/unread').then(r => setChatUnread(r.n)).catch(() => {}) }
    load()
    const iv = setInterval(load, 60000)
    document.addEventListener('visibilitychange', load)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', load) }
  }, [user?.coached])
```

- [ ] **Step 5: CSS** — dans `index.css`, à côté des règles `#tabbar` existantes (~ligne 288) :

```css
#tabbar button{position:relative}
#tabbar .tabdot{
  position:absolute;top:1px;left:calc(50% + 6px);width:8px;height:8px;
  border-radius:50%;background:var(--red);
}
/* 6 tabs: slightly tighter labels so nothing wraps on narrow phones */
#tabbar button{font-size:9.5px;letter-spacing:0}
```

- [ ] **Step 6: Vérifier** — Run: `cd frontend && npx vitest run` — Expected: tous les tests passent. Puis contrôle visuel : `npm run dev`, ouvrir http://localhost:5173, vérifier 6 onglets lisibles (mobile viewport 375px) et l'onglet Coach → vue Chat.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Icon.jsx frontend/src/components/TabBar.jsx frontend/src/store/useUI.js frontend/src/App.jsx frontend/src/index.css
git commit -m "feat(front): Coach tab with unread badge"
```

---

### Task 7: Vue Coach (`/coach`) + entrée Réglages

**Files:**
- Create: `frontend/src/views/Coach.jsx`
- Modify: `frontend/src/App.jsx` (route), `frontend/src/views/Settings.jsx:89` (entrée sous Admin)

**Interfaces:**
- Consumes: Task 3 (`GET /api/coach/threads`, `GET/POST /api/coach/thread`, `POST /api/coach/read`, `POST /api/coach/coached`, `GET /api/admin/user?id=`), Task 4 (`mergeMessages`, `lastId`), Task 6 (icône `chat`).
- Produces: composant par défaut `Coach` routé sur `/coach` (admin-only).

- [ ] **Step 1: Implémenter la vue** — `frontend/src/views/Coach.jsx` (français en dur, convention Admin) :

```jsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtVol, fmtDur } from '../lib/format.js'
import { fmtWhen } from '../lib/audit.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { mergeMessages, lastId } from '../lib/chat-core.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Poste de travail coach — français en dur : surface opérateur, hors packs i18n
// (même convention que Admin.jsx, qui est anglais en dur).

const THREADS_MS = 15000
const THREAD_MS = 20000

// Panneau latéral : les données d'entraînement du client, via l'endpoint admin existant.
function ClientData({ id }) {
  const [d, setD] = useState(null)
  useEffect(() => { api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(() => {}) }, [id])
  if (!d) return <div className="muted small">Chargement…</div>
  return <>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">Séances</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">Pesées</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">Poids</div><div className="v" style={{ fontSize: '1.1rem' }}>
        {d.bodyweight.length ? d.bodyweight[d.bodyweight.length - 1].kg + ' ' + d.unit : '—'}</div></div>
    </div>
    <h4 className="sec">Dernières séances</h4>
    {d.workouts.slice(0, 10).map(w => <div key={w.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
      <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} séries{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
      <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
    </div>)}
    {!d.workouts.length && <div className="empty small">Aucune séance.</div>}
  </>
}

function Thread({ th, back, reloadThreads }) {
  const toast = useUI(s => s.toast)
  const [msgs, setMsgs] = useState([])
  const [lastReadClient, setLastReadClient] = useState(0)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showData, setShowData] = useState(false)
  const endRef = useRef(null)
  const msgsRef = useRef(msgs)
  msgsRef.current = msgs

  const load = () => api('/api/coach/thread?id=' + encodeURIComponent(th.id) + '&after=' + lastId(msgsRef.current))
    .then(r => {
      setLastReadClient(r.lastReadClient)
      const merged = mergeMessages(msgsRef.current, r.messages)
      setMsgs(merged)
      const newest = lastId(merged)
      if (newest) api('/api/coach/read', { method: 'POST', body: JSON.stringify({ id: th.id, upTo: newest }) }).catch(() => {})
    }).catch(() => {})

  useEffect(() => { load(); const iv = setInterval(load, THREAD_MS); return () => { clearInterval(iv); reloadThreads() } }, [th.id])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])

  const send = () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    api('/api/coach/thread', { method: 'POST', body: JSON.stringify({ id: th.id, text: body }) })
      .then(({ message }) => { setText(''); setMsgs(m => mergeMessages(m, [message])) })
      .catch(e => toast(e.message))
      .finally(() => setSending(false))
  }

  const lastMine = [...msgs].reverse().find(m => m.from === 'coach')
  return <div className="narrow chatview">
    <div className="hdr">
      <button className="iconbtn" onClick={back} aria-label="Retour"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}>
        <h1 style={{ margin: 0 }} className="capitalize">{th.name}</h1>
        <div className="sub">{th.live ? 's\'entraîne maintenant' : th.lastWorkout ? 'dernière séance ' + fmtDate(th.lastWorkout) : 'aucune séance'}</div>
      </div>
      <button className="iconbtn" onClick={() => setShowData(v => !v)} aria-label="Données"><Icon name="chart" /></button>
    </div>
    {showData && <div className="card"><ClientData id={th.id} /></div>}
    <div className="chatlog">
      {!msgs.length && <div className="empty small">Pas encore de messages.</div>}
      {msgs.map(m => <div key={m.id} className={'bubble' + (m.from === 'coach' ? ' mine' : '')}>
        {m.text}
        {m === lastMine && m.id <= lastReadClient && <div className="seen">Vu</div>}
      </div>)}
      <div ref={endRef} />
    </div>
    <div className="chatinput">
      <textarea rows={1} maxLength={2000} value={text} placeholder="Répondre…"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
      <button className="sendbtn" disabled={!text.trim() || sending} onClick={send} aria-label="Envoyer">
        <Icon name="arrowUp" />
      </button>
    </div>
  </div>
}

export default function Coach() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [threads, setThreads] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState(null)      // thread ouvert (objet de la liste)

  const load = () => api('/api/coach/threads').then(d => { setThreads(d.threads); setNow(d.now) }).catch(e => toast(e.message))
  useEffect(() => { if (!user?.admin) return; load(); const iv = setInterval(load, THREADS_MS); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const toggleCoached = th => api('/api/coach/coached', { method: 'POST', body: JSON.stringify({ id: th.id, coached: !th.coached }) })
    .then(() => { toast(th.coached ? 'Coaching désactivé' : 'Coaching activé'); load() })
    .catch(e => toast(e.message))

  if (open) return <Thread th={open} back={() => setOpen(null)} reloadThreads={load} />

  const unreadTotal = (threads || []).reduce((n, t) => n + t.unread, 0)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="Retour"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Coach</h1>
        <div className="sub">{threads ? threads.filter(t => t.coached).length + ' coachés · ' + unreadTotal + ' non lus' : 'Chargement…'}</div></div>
      <button className="iconbtn" onClick={load} aria-label="rafraîchir">↻</button>
    </div>
    <div className="list">
      {(threads || []).map(th => <div key={th.id} className="item" style={th.disabled ? { opacity: .55 } : null}>
        <div className="grow" onClick={() => th.coached && setOpen(th)}>
          <div className="tt">
            {th.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}
            <span className="capitalize">{th.name}</span>
            {th.unread > 0 && <span className="tag" style={{ marginLeft: 6, background: 'var(--red)', color: '#fff' }}>{th.unread}</span>}
          </div>
          <div className="ss">
            {th.lastMsg ? (th.lastMsg.from === 'coach' ? 'Toi : ' : '') + th.lastMsg.text + ' · ' + fmtWhen(th.lastMsg.ts, now)
              : th.coached ? 'Pas encore de messages' : 'Non coaché'}
          </div>
        </div>
        <Button size="sm" variant={th.coached ? undefined : 'primary'} onClick={() => toggleCoached(th)}>
          {th.coached ? 'Désactiver' : 'Activer'}
        </Button>
      </div>)}
      {threads && !threads.length && <div className="empty">Aucun client pour l'instant.</div>}
    </div>
  </div>
}
```

- [ ] **Step 2: Route** — dans `App.jsx` : `import Coach from './views/Coach.jsx'` et, à côté de la route `/admin` :

```jsx
<Route path="/coach" element={user?.admin ? <Coach /> : <Navigate to="/home" replace />} />
```

- [ ] **Step 3: Entrée Réglages** — dans `Settings.jsx`, juste sous la ligne Admin (ligne 89) :

```jsx
        {user.admin && <Row icon="chat" iconTint="var(--acc)" title="Coach" accessory="chevron" onClick={() => nav('/coach')} />}
```

- [ ] **Step 4: Vérifier** — Run: `cd frontend && npx vitest run` — Expected: tous les tests passent. Contrôle visuel `npm run dev` : Réglages → Coach → liste (vide), navigation retour OK. (`fmtWhen(ts, now)` et la signature de `Button` : vérifier à l'implémentation dans `lib/audit.js` / `components/ui.jsx` que les props utilisées existent bien ; ajuster sinon.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Coach.jsx frontend/src/App.jsx frontend/src/views/Settings.jsx
git commit -m "feat(front): Coach inbox — threads, conversation, client data panel, coached toggle"
```

---

### Task 8: Deep-link des notifications push (`sw.js`)

**Files:**
- Modify: `frontend/public/sw.js` (listeners `push` et `notificationclick`)

**Interfaces:**
- Consumes: payloads push de Task 2 (`{ title, body, tag, url }` avec `url` = `'#/chat'` ou `'#/coach'`).
- Produces: clic sur une notif chat → app ouverte/focus sur la bonne vue.

- [ ] **Step 1: Transporter l'url** — dans le listener `push`, ajouter `data` aux options de `showNotification` :

```js
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(data.title || 'openGym Coach', {
    body: data.body || '',
    icon: 'icon-512.png',
    badge: 'icon-180.png',
    tag: data.tag || 'opengym',
    renotify: true,
    data: { url: data.url || null }
  }))
})
```

- [ ] **Step 2: Naviguer au clic** — remplacer le listener `notificationclick` :

```js
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const c = clients.find(c => 'focus' in c)
    if (c) { if (url && c.navigate) c.navigate('./' + url); return c.focus() }
    return self.clients.openWindow('./' + (url || ''))
  }))
})
```

- [ ] **Step 3: Vérifier** — Run: `cd frontend && npx vitest run` (rien ne casse) + revue manuelle du diff (`git diff frontend/public/sw.js`). Le test E2E du push se fait au déploiement (Task 10).

- [ ] **Step 4: Commit**

```bash
git add frontend/public/sw.js
git commit -m "feat(front): chat push notifications deep-link to #/chat or #/coach"
```

---

### Task 9: Rebrand placeholder « openGym Coach »

**Files:**
- Modify: `frontend/public/manifest.json`, `frontend/index.html:6,12`, `.env.example:8`

**Interfaces:**
- Consumes: rien.
- Produces: nom placeholder partout où la marque apparaît côté produit. Le nom final (à choisir avec Alexis) ne demandera que ces 3 fichiers + 2 icônes PNG.

- [ ] **Step 1: manifest** — dans `frontend/public/manifest.json` :

```json
  "name": "openGym Coach",
  "short_name": "Coach",
  "description": "Ton tracker de muscu avec un vrai coach dans l'app",
```

- [ ] **Step 2: titres** — dans `frontend/index.html` : `<title>openGym Coach</title>` et `<meta name="apple-mobile-web-app-title" content="Coach">`.

- [ ] **Step 3: env** — dans `.env.example` : `RP_NAME=openGym Coach` (les deux occurrences, lignes 8 et 18).

- [ ] **Step 4: Vérifier** — Run: `cd frontend && npm run build` — Expected: build OK. LICENSE et NOTICE.md non modifiés (`git status` ne les liste pas).

- [ ] **Step 5: Commit**

```bash
git add frontend/public/manifest.json frontend/index.html .env.example
git commit -m "feat: openGym Coach placeholder branding (final name pending)"
```

---

### Task 10: Doc de déploiement + vérification finale

**Files:**
- Create: `docs/DEPLOY-COACH.md`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: procédure VM GCP + checklist de smoke test manuel E2E.

- [ ] **Step 1: Écrire le doc** — `docs/DEPLOY-COACH.md` :

```markdown
# Déploiement openGym Coach (VM GCP)

## Prérequis
- VM GCP (e2-small suffit) avec Docker + Docker Compose, ports 80/443 ouverts.
- Un domaine DÉFINITIF pointé sur la VM. ⚠️ Les passkeys sont liées au domaine
  (`RP_ID`) : en changer ensuite casse tous les logins. Ne pas onboarder de
  client avant que le domaine final soit en place.
- HTTPS obligatoire pour les passkeys et le push (reverse proxy Caddy ou
  certbot+nginx devant le compose, cf. docs/SELF_HOSTING.md upstream).

## Installation
    git clone <URL_DU_FORK> && cd openGym
    cp .env.example .env
    # Éditer .env : RP_ID=mondomaine.fr  ORIGIN=https://mondomaine.fr
    #               RP_NAME=openGym Coach  WEB_PORT=8080
    docker compose up -d --build        # build depuis le fork, PAS docker compose pull

## Premier compte = coach
1. Ouvrir https://mondomaine.fr, créer le profil « Alexis » (passkey).
2. Récupérer l'uid : `cat data/db.json` → users[0].id.
3. Dans .env : `ADMIN_UIDS=<cet uid>` puis `docker compose restart api`.
4. Vérifier : Réglages → les entrées Admin et Coach apparaissent.

## Smoke test E2E (à chaque déploiement)
- [ ] `curl -s https://mondomaine.fr/api/health` → `{"ok":true,...}`
- [ ] Créer un 2ᵉ compte test (autre navigateur/profil) → onglet Coach = upsell.
- [ ] Vue Coach : le compte test apparaît, « Activer » → son onglet devient chat.
- [ ] Client envoie un message → pastille + notif push côté coach (activer le
      push dans Réglages des deux comptes d'abord).
- [ ] Coach répond depuis /coach → notif push côté client, clic → ouvre #/chat.
- [ ] « Vu » s'affiche sous le dernier message de chacun après lecture en face.
- [ ] Désactiver le coaching du compte test → son onglet réaffiche l'upsell.

## Rappels
- Backup = copier ./data (db.json, state-*.json, chat-*.json, secret, vapid.json).
- ⚠️ Médias exercices © Gym Visual : licence à acheter pour l'usage commercial,
  ou désactiver les médias, AVANT le lancement payant (cf. NOTICE.md).
- AGPL : le fork (chat compris) doit rester publié sur un dépôt public.
```

- [ ] **Step 2: Vérification finale complète** — Run:

```bash
cd api && node --check server.js && node --test *.test.js
cd ../frontend && npx vitest run && npm run build
```

Expected: tout passe, build OK.

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOY-COACH.md
git commit -m "docs: deployment guide + E2E smoke checklist"
```

---

## Self-review (fait à l'écriture du plan)

- **Couverture spec** : données §3 → T1 ; API §4 → T2-T3 ; client §5 → T4-T6 ; coach §6 → T7 ; sw §5 → T8 ; rebrand §7 → T9 ; i18n §8 → T5 ; erreurs §9 → T2 (400/403), T5 (texte conservé, toast) ; tests §10 → T1/T2/T4/T5 ; déploiement §11 → T10. Cas « 403 not-coached en cours de session » : couvert structurellement — `Chat` lit `user.coached` du store ; le polling échoue silencieusement et l'écran bascule au prochain boot/refresh de `/api/me` (fidèle au spec « bascule sur l'upsell »).
- **Placeholders** : aucun TBD ; deux points de vigilance explicites et bornés (nom d'export de `lib/nav.js` en T5, signatures `fmtWhen`/`Button` en T7) avec instruction de vérification à l'implémentation.
- **Cohérence de types** : `registerChatRoutes(routes, deps)` identique T2/T3 ; `mergeMessages`/`lastId` identiques T4/T5/T7 ; `chatUnread`/`setChatUnread` identiques T5/T6 ; payload push `{title, body, tag, url}` identique T2/T8.

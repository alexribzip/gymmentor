# Onboarding « premier programme » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wizard d'onboarding 6 étapes générant le premier programme, message de bienvenue « du coach » + push admin, mini-chat découverte (5 messages), spotlights — spec `docs/superpowers/specs/2026-08-25-onboarding-design.md`.

**Architecture:** Front : vue wizard + `lib/programs.js` (templates purs testés) écrivant dans `S.routines`/`S.week` via `update(mut)` existant ; spotlights = composant overlay. Serveur : module `api/onboarding.js` (message coach via `chat-store`, idempotent par `user.onboarded`) + évolution de la garde chat (`requireChatAccess`, quota `DISCOVERY_MSGS=5`).

**Tech Stack:** React 19 + Vite + zustand (front, vitest), Node ESM sans framework (api, node --test). Aucune dépendance nouvelle.

## Global Constraints

- Repo `C:\Users\AlexisRibéry\opengym-coach`, branche de travail `onboarding` (à créer depuis `main`). Style : frontend sans point-virgule/quotes simples ; api avec points-virgules. Commits `feat:`/`test:`/`docs:` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `DISCOVERY_MSGS = 5` (constante serveur exportée). Quota épuisé → 403 `{ error: 'not-coached' }` (même code que l'existant).
- Énumérations wizard exactes : objectif `muscle|force|forme` ; niveau `debutant|inter` ; jours `2|3|4` (number) ; materiel `salle|maison|pdc`.
- Fourchettes reps : force 5-8, muscle 8-12, forme 12-15. `debutant` = dernier exercice de chaque séance retiré.
- `S.week` = objet `{ <jourIndex 0-6>: routineId }` (lundi=1). Poses : 2j → {1,4} ; 3j → {1,3,5} ; 4j → {1,2,4,5}.
- i18n : clés anglaises via `t()`, traductions ajoutées à `frontend/src/locales/fr.js`. Message coach serveur : français en dur.
- ⚠️ Leçon du déploiement : tout nouveau fichier `api/*.js` importé par `server.js` DOIT être ajouté au `COPY` de `api/Dockerfile`.
- Tests : `cd frontend && npx vitest run` ; `cd api && node --test *.test.js`.
- IDs d'exercices : la table du Task 1 est vérifiée dans `lib/exercises-data.js` (`EXDB`, entrées `{id, n, eq, ...}`). Deux slots marqués `[VÉRIFIER]` : l'implémenteur confirme le nom dans EXDB avant usage et liste ses choix dans son rapport (validation finale par Alexis).

---

### Task 0: Branche de travail

- [ ] `cd C:\Users\AlexisRibéry\opengym-coach && git checkout -b onboarding` (depuis `main` à jour). Aucun commit.

---

### Task 1: `lib/programs.js` — templates + modulateurs

**Files:**
- Create: `frontend/src/lib/programs.js`
- Test: `frontend/src/lib/programs.test.js`

**Interfaces:**
- Consumes: `uid` de `./format.js`, `starterRoutines` de `./starter.js`.
- Produces: `buildProgram({ objectif, niveau, jours, materiel }) → { routines: [{id,name,emoji,ex:[{id,sets,reps,weight}]}], week: {dayIndex: routineId} }` ; `REP_RANGES = { force:[5,8], muscle:[8,12], forme:[12,15] }` ; `WEEK_SLOTS = { 2:[1,4], 3:[1,3,5], 4:[1,2,4,5] }`.

- [ ] **Step 1: Tests qui échouent** — `frontend/src/lib/programs.test.js` :

```js
import { describe, expect, it } from 'vitest'
import { buildProgram, REP_RANGES, WEEK_SLOTS } from './programs.js'

const OBJ = ['muscle', 'force', 'forme']
const NIV = ['debutant', 'inter']
const JOURS = [2, 3, 4]
const MAT = ['salle', 'maison', 'pdc']

describe('buildProgram', () => {
  it('always returns a valid program for every combination', () => {
    for (const objectif of OBJ) for (const niveau of NIV) for (const jours of JOURS) for (const materiel of MAT) {
      const p = buildProgram({ objectif, niveau, jours, materiel })
      expect(p.routines.length).toBeGreaterThan(0)
      for (const r of p.routines) {
        expect(r.id).toBeTruthy()
        expect(r.ex.length).toBeGreaterThanOrEqual(3)
        for (const e of r.ex) {
          expect(e.id).toMatch(/^\d{4}$/)
          expect(e.sets).toBeGreaterThanOrEqual(3)
          expect(e.weight).toBe(0)
        }
      }
      const days = Object.keys(p.week).map(Number)
      expect(days.length).toBeGreaterThan(0)
      for (const d of days) expect(p.routines.some(r => r.id === p.week[d])).toBe(true)
    }
  })
  it('reps follow the objectif range', () => {
    for (const objectif of OBJ) {
      const [lo, hi] = REP_RANGES[objectif]
      const p = buildProgram({ objectif, niveau: 'inter', jours: 3, materiel: 'salle' })
      for (const r of p.routines) for (const e of r.ex) {
        expect(e.reps).toBeGreaterThanOrEqual(lo)
        expect(e.reps).toBeLessThanOrEqual(hi)
      }
    }
  })
  it('debutant removes the last exercise of each session', () => {
    const inter = buildProgram({ objectif: 'muscle', niveau: 'inter', jours: 3, materiel: 'maison' })
    const deb = buildProgram({ objectif: 'muscle', niveau: 'debutant', jours: 3, materiel: 'maison' })
    for (let i = 0; i < deb.routines.length; i++)
      expect(deb.routines[i].ex.length).toBe(inter.routines[i].ex.length - 1)
  })
  it('week slots match the jours count after fallbacks', () => {
    expect(Object.keys(buildProgram({ objectif: 'muscle', niveau: 'inter', jours: 3, materiel: 'salle' }).week).map(Number).sort()).toEqual(WEEK_SLOTS[3])
    // bascules: 2j pdc → 3j pdc ; 4j maison → 3j maison ; 4j pdc → 3j pdc
    expect(Object.keys(buildProgram({ objectif: 'forme', niveau: 'debutant', jours: 2, materiel: 'pdc' }).week).length).toBe(3)
    expect(Object.keys(buildProgram({ objectif: 'muscle', niveau: 'inter', jours: 4, materiel: 'maison' }).week).length).toBe(3)
    expect(Object.keys(buildProgram({ objectif: 'force', niveau: 'inter', jours: 4, materiel: 'pdc' }).week).length).toBe(3)
  })
  it('3j salle reuses the starter PPL shape (3 distinct routines)', () => {
    const p = buildProgram({ objectif: 'muscle', niveau: 'inter', jours: 3, materiel: 'salle' })
    expect(p.routines.length).toBe(3)
    expect(new Set(p.routines.map(r => r.name)).size).toBe(3)
  })
})
```

- [ ] **Step 2:** Run `cd frontend && npx vitest run src/lib/programs.test.js` — Expected: FAIL (module inexistant).

- [ ] **Step 3: Implémentation** — `frontend/src/lib/programs.js` :

```js
// Onboarding program templates. One file, meant to be edited by the coach:
// each SPEC row is [exerciseId, sets, baseReps]. Reps are re-fitted to the
// objectif range and débutant drops the last exercise of each session.
import { uid } from './format.js'
import { starterRoutines } from './starter.js'

export const REP_RANGES = { force: [5, 8], muscle: [8, 12], forme: [12, 15] }
export const WEEK_SLOTS = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5] }

// Verified against EXDB (lib/exercises-data.js). [VÉRIFIER] slots: confirm the
// name in EXDB before shipping and list picks in the implementation report.
// 1760 dumbbell goblet squat · 0289 dumbbell bench press · 0293 dumbbell bent
// over row · 0290 dumbbell bench seated press · 1459 dumbbell romanian
// deadlift · 0336 dumbbell lunge · 0294 dumbbell biceps curl · 0334 dumbbell
// lateral raise · 0662 push-up · 0129 bench dip (knees bent) · 3013 low glute
// bridge on floor · 0630 mountain climber · 1160 burpee · 0274 crunch floor ·
// 2300 inverted row bent knees · 0043 [VÉRIFIER: barbell squat] ·
// PDC_SQUAT [VÉRIFIER: mouvement squat au poids du corps simple dans EXDB]
const PDC_SQUAT = '0043' // ← remplacer par l'id vérifié d'un squat poids du corps

const FB_SALLE = [
  ['Full Body A', 'barbell', [['0043', 4, 10], ['0289', 3, 10], ['0293', 3, 10], ['0290', 3, 10], ['0274', 3, 15]]],
  ['Full Body B', 'dumbbell', [['1459', 4, 10], ['1760', 3, 10], ['0289', 3, 10], ['0334', 3, 12], ['0294', 3, 12]]]
]
const FB_MAISON = [
  ['Full Body A', 'dumbbell', [['1760', 4, 10], ['0289', 3, 10], ['0293', 3, 10], ['0290', 3, 10], ['0274', 3, 15]]],
  ['Full Body B', 'dumbbell', [['1459', 4, 10], ['0336', 3, 10], ['0293', 3, 10], ['0334', 3, 12], ['0294', 3, 12]]],
  ['Full Body C', 'dumbbell', [['1760', 4, 10], ['0290', 3, 10], ['1459', 3, 10], ['0662', 3, 12], ['0274', 3, 15]]]
]
const CIRCUIT_PDC = [
  ['Circuit A', 'figureStrength', [[PDC_SQUAT, 4, 12], ['0662', 3, 12], ['2300', 3, 10], ['3013', 3, 15], ['0274', 3, 15]]],
  ['Circuit B', 'figureRun', [['1160', 4, 10], ['0662', 3, 12], ['0630', 3, 20], ['0129', 3, 12], ['0274', 3, 15]]],
  ['Circuit C', 'figureStrength', [[PDC_SQUAT, 4, 12], ['2300', 3, 10], ['3013', 3, 15], ['0630', 3, 20], ['0129', 3, 12]]]
]
const UL_SALLE = [
  ['Upper', 'arm', [['0289', 4, 8], ['0293', 4, 10], ['0290', 3, 10], ['0334', 3, 12], ['0294', 3, 12]]],
  ['Lower', 'legs', [['0043', 4, 8], ['1459', 3, 10], ['0336', 3, 10], ['3013', 3, 15], ['0274', 3, 15]]]
]

const mk = spec => spec.map(([name, emoji, list]) =>
  ({ id: uid(), name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }))

const clampReps = (routines, [lo, hi]) => routines.map(r =>
  ({ ...r, ex: r.ex.map(e => ({ ...e, reps: Math.min(hi, Math.max(lo, e.reps)) })) }))

const trimForBeginner = routines => routines.map(r => ({ ...r, ex: r.ex.slice(0, -1) }))

// jours × materiel → squelette + jours réellement posés (bascules incluses)
function skeleton(jours, materiel) {
  if (materiel === 'pdc') return { routines: mk(CIRCUIT_PDC), jours: 3 }
  if (materiel === 'maison') return jours === 2
    ? { routines: mk(FB_MAISON.slice(0, 2)), jours: 2 }
    : { routines: mk(FB_MAISON), jours: 3 }
  // salle
  if (jours === 2) return { routines: mk(FB_SALLE), jours: 2 }
  if (jours === 4) return { routines: mk(UL_SALLE), jours: 4 }
  return { routines: starterRoutines(), jours: 3 }
}

export function buildProgram({ objectif, niveau, jours, materiel }) {
  const sk = skeleton(jours, materiel)
  let routines = clampReps(sk.routines, REP_RANGES[objectif] || REP_RANGES.muscle)
  if (niveau === 'debutant') routines = trimForBeginner(routines)
  const slots = WEEK_SLOTS[sk.jours]
  const week = {}
  slots.forEach((day, i) => { week[day] = routines[i % routines.length].id })
  return { routines, week }
}
```

- [ ] **Step 4:** Résoudre les deux `[VÉRIFIER]` dans EXDB (script node d'une ligne sur `lib/exercises-data.js` : filtrer `eq==='body weight'` + nom contenant `squat`, choisir le mouvement de base le plus simple ; confirmer que `0043` est bien un squat barre). Mettre à jour `PDC_SQUAT` et consigner les choix dans le rapport.

- [ ] **Step 5:** Run `npx vitest run src/lib/programs.test.js` — Expected: PASS (5 tests). Puis `npx vitest run` complet.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/programs.js frontend/src/lib/programs.test.js
git commit -m "feat(front): onboarding program templates — 6 skeletons, objectif/niveau modifiers"
```

---

### Task 2: Serveur — mini-chat découverte (`requireChatAccess`)

**Files:**
- Modify: `api/chat.js` (garde + GET /api/chat)
- Test: `api/chat.test.js` (ajouts)

**Interfaces:**
- Consumes: existant (`loadChat`, `unreadFor`, deps).
- Produces: `DISCOVERY_MSGS = 5` exporté de `api/chat.js` ; garde `requireChatAccess(req, res, { write })` remplaçant `requireCoached` ; `GET /api/chat` renvoie en plus `discovery: { used, max }` pour un non-coaché (champ absent pour un coaché).

- [ ] **Step 1: Tests qui échouent** — ajouter à `api/chat.test.js` (mêmes helpers `call`/`deps`) :

```js
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
```

⚠️ Le test existant `client GET /api/chat refuses non-coached with not-coached` devient obsolète : le REMPLACER par le premier test ci-dessus (lecture ouverte).

- [ ] **Step 2:** Run `cd api && node --test chat.test.js` — Expected: FAIL (nouveaux tests + l'ancien à remplacer).

- [ ] **Step 3: Implémentation** — dans `api/chat.js` :

```js
export const DISCOVERY_MSGS = 5;
```

Remplacer `requireCoached` par :

```js
  // Chat access: coached users are unlimited. A signed-in non-coached user is
  // in "discovery": full read access, and up to DISCOVERY_MSGS sent messages —
  // then the same 403 'not-coached' the front already maps to the upsell.
  const requireChatAccess = (req, res, { write } = {}) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    if (user.coached) return user;
    if (write) {
      const used = loadChat(DATA, user.id).messages.filter(m => m.from === 'client').length;
      if (used >= DISCOVERY_MSGS) { json(res, 403, { error: 'not-coached' }); return null; }
    }
    return user;
  };
```

Dans les 4 routes client : `GET /api/chat`, `POST /api/chat/read`, `GET /api/chat/unread` → `requireChatAccess(req, res)` ; `POST /api/chat` → `requireChatAccess(req, res, { write: true })`. Dans `GET /api/chat`, après le calcul de `chat` :

```js
    const out = { messages: after(chat, +q(req).get('after') || 0), lastReadCoach: chat.lastReadCoach };
    if (!user.coached) out.discovery = { used: chat.messages.filter(m => m.from === 'client').length, max: DISCOVERY_MSGS };
    json(res, 200, out);
```

- [ ] **Step 4:** Run `node --test chat.test.js` puis `node --test *.test.js` — Expected: tous passent (l'ancien test remplacé compris).

- [ ] **Step 5: Commit**

```bash
git add api/chat.js api/chat.test.js
git commit -m "feat(api): discovery chat — 5 free messages for non-coached users"
```

---

### Task 3: Serveur — `POST /api/onboarding/complete`

**Files:**
- Create: `api/onboarding.js`
- Modify: `api/server.js` (import + register), `api/Dockerfile` (COPY)
- Test: `api/onboarding.test.js`

**Interfaces:**
- Consumes: Task 1 sémantique des réponses ; `appendMessage` de `./chat-store.js` ; deps serveur `{ DATA, db, saveDb, json, readBody, readSession, sendPush, isAdmin }`.
- Produces: `registerOnboardingRoutes(routes, deps)` ; route `POST /api/onboarding/complete { answers: { objectif, niveau, jours, materiel } }` → `{ ok: true }` ou `{ ok: true, already: true }` ; `welcomeText(name, answers) → string` exporté (testable).

- [ ] **Step 1: Tests qui échouent** — `api/onboarding.test.js` :

```js
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
```

- [ ] **Step 2:** Run `cd api && node --test onboarding.test.js` — Expected: FAIL (module inexistant).

- [ ] **Step 3: Implémentation** — `api/onboarding.js` :

```js
/* Onboarding completion — writes the coach's welcome message into the user's
   chat and notifies the coach. Idempotent via user.onboarded in db.json. */
import { appendMessage } from './chat-store.js';

const OBJECTIFS = { muscle: 'prise de muscle', force: 'force', forme: 'remise en forme' };
const NIVEAUX = ['debutant', 'inter'];
const JOURS = [2, 3, 4];
const MATERIELS = { salle: 'en salle', maison: 'avec haltères à la maison', pdc: 'au poids du corps' };

// French on purpose: the coach speaks French (V1 target market).
export function welcomeText(name, a) {
  const intro = `Salut ${name} 👋 Je suis Alexis, ton coach ici.`;
  const prog = {
    muscle: `J'ai vu ton programme prise de muscle, ${a.jours} séances/semaine ${MATERIELS[a.materiel]} — bonne base pour construire.`,
    force: `J'ai vu ton programme force, ${a.jours} séances/semaine ${MATERIELS[a.materiel]} — on va chercher des barres lourdes, techniquement propres.`,
    forme: `J'ai vu ton programme remise en forme, ${a.jours} séances/semaine ${MATERIELS[a.materiel]} — la régularité va tout changer.`
  }[a.objectif];
  return `${intro} ${prog} Une question, un doute sur un exercice ? Je suis là — réponds-moi ici.`;
}

const valid = a => a && OBJECTIFS[a.objectif] && NIVEAUX.includes(a.niveau)
  && JOURS.includes(+a.jours) && MATERIELS[a.materiel];

export function registerOnboardingRoutes(routes, deps) {
  const { DATA, db, saveDb, json, readSession, sendPush, isAdmin } = deps;

  routes['POST /api/onboarding/complete'] = async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await deps.readBody(req);
    const a = body.answers;
    if (!valid(a)) return json(res, 400, { error: 'invalid answers' });
    if (user.onboarded) return json(res, 200, { ok: true, already: true });
    user.onboarded = new Date().toISOString();
    saveDb();
    appendMessage(DATA, user.id, 'coach', welcomeText(user.name, { ...a, jours: +a.jours }));
    const resume = `${OBJECTIFS[a.objectif]} · ${a.niveau === 'debutant' ? 'débutant' : 'intermédiaire'} · ${a.jours}j · ${a.materiel}`;
    for (const admin of db.users.filter(isAdmin)) {
      sendPush(admin.id, { title: `🆕 ${user.name} a fini l'onboarding`, body: resume, tag: 'chat', url: '#/coach' });
    }
    json(res, 200, { ok: true });
  };
}
```

- [ ] **Step 4: Câblage** — `api/server.js` : `import { registerOnboardingRoutes } from './onboarding.js';` (après l'import chat) et, sous l'appel `registerChatRoutes(...)` :

```js
registerOnboardingRoutes(routes, { DATA, db, saveDb, json, readBody, readSession, sendPush, isAdmin });
```

`api/Dockerfile` : `COPY server.js chat.js chat-store.js ./` → `COPY server.js chat.js chat-store.js onboarding.js ./`.

- [ ] **Step 5:** Run `node --check server.js && node --test *.test.js` — Expected: tout passe.

- [ ] **Step 6: Commit**

```bash
git add api/onboarding.js api/onboarding.test.js api/server.js api/Dockerfile
git commit -m "feat(api): onboarding complete — coach welcome message + admin push, idempotent"
```

---

### Task 4: Front — Chat découverte (bandeau + upsell au quota)

**Files:**
- Modify: `frontend/src/views/Chat.jsx`, `frontend/src/App.jsx` (poll badge), `frontend/src/locales/fr.js`
- Test: `frontend/src/views/Chat.test.jsx` (ajout)

**Interfaces:**
- Consumes: Task 2 (`discovery: {used, max}` dans GET /api/chat ; POST 403 `not-coached` au quota).
- Produces: comportement — non-coaché **avec** messages OU quota restant → conversation + bandeau « Discovery » ; quota épuisé → fil lisible + bloc upsell à la place du champ ; non-coaché **sans** messages ni onboarding → upsell plein écran actuel.

- [ ] **Step 1: Test qui échoue** — ajouter à `Chat.test.jsx` :

```jsx
  it('non-coached with messages → conversation with discovery banner', async () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: false }; mocks.isGuest = false
    mocks.api.mockImplementation(path => path.startsWith('/api/chat?')
      ? Promise.resolve({ messages: [{ id: 1, from: 'coach', text: 'bienvenue', ts: 1 }], lastReadCoach: 0, discovery: { used: 2, max: 5 } })
      : Promise.resolve({ ok: true }))
    render()
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('bienvenue')
    expect(host.textContent).toContain('3')          // 5-2 messages restants
    expect(host.querySelector('textarea')).toBeTruthy()
  })
  it('non-coached with exhausted quota → readable thread, upsell instead of input', async () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: false }; mocks.isGuest = false
    mocks.api.mockImplementation(path => path.startsWith('/api/chat?')
      ? Promise.resolve({ messages: [{ id: 1, from: 'client', text: 'q', ts: 1 }], lastReadCoach: 1, discovery: { used: 5, max: 5 } })
      : Promise.resolve({ ok: true }))
    render()
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('personal coach')
    expect(host.querySelector('textarea')).toBeFalsy()
  })
```

- [ ] **Step 2:** Run `npx vitest run src/views/Chat.test.jsx` — Expected: FAIL.

- [ ] **Step 3: Implémentation** — dans `Chat.jsx` :
  - `Conversation` accepte les non-coachés : état `discovery` (`useState(null)`) alimenté par `r.discovery` dans `load()`.
  - Bandeau au-dessus du fil quand `discovery` présent et `used < max` :

```jsx
      {discovery && discovery.used < discovery.max && <div className="card small" style={{ padding: '10px 14px', marginBottom: 10 }}>
        {t('Discovery: {0} messages left with your coach', discovery.max - discovery.used)}
      </div>}
```

  - Quota épuisé (`discovery && discovery.used >= discovery.max`) : le bloc `chatinput` est remplacé par le contenu de l'upsell (extraire le corps d'`Upsell` en composant `UpsellCard` réutilisé aux deux endroits).
  - Le sélecteur d'état racine devient : invité → `AccountGate` ; connecté coaché → `Conversation` ; connecté non-coaché → `Conversation` aussi, MAIS si le premier `load()` renvoie 0 message ET `discovery.used === 0` → basculer l'affichage sur `Upsell` plein écran (compte sans onboarding). Implémentation : `Conversation` rend `<Upsell />` si `msgs.length === 0 && discovery && discovery.used === 0`.
  - Envoi : un 403 en `POST` bascule `discovery.used = discovery.max` localement (le bandeau/upsell se mettent à jour sans re-fetch).
  - `App.jsx` : la condition du poll badge passe de `user?.coached` à `user` (dépendance `[!!user]`).
  - `fr.js` : `'Discovery: {0} messages left with your coach': 'Découverte : {0} messages restants avec ton coach',`

- [ ] **Step 4:** Run `npx vitest run` — Expected: tout passe (les tests existants de Chat restent verts — le mock coaché ne renvoie pas `discovery`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Chat.jsx frontend/src/views/Chat.test.jsx frontend/src/App.jsx frontend/src/locales/fr.js
git commit -m "feat(front): discovery chat — banner, quota upsell, badge for all signed-in users"
```

---

### Task 5: Front — wizard `Onboarding.jsx`

**Files:**
- Create: `frontend/src/views/Onboarding.jsx`
- Modify: `frontend/src/App.jsx` (route + redirection), `frontend/src/locales/fr.js`
- Test: `frontend/src/views/Onboarding.test.jsx`

**Interfaces:**
- Consumes: Task 1 `buildProgram(answers)` ; store `update(mut)`, `user`, `S` ; `api()`.
- Produces: route `/onboarding` ; à la validation : `S.routines`, `S.week`, `S.onboarded = true`, `S._onboardingPending` (si POST échoue) ; `useUI.setSpotlight(true)` (créé Task 6 — appel optionnel `setSpotlight?.(true)` en attendant) ; navigation `/home`.

- [ ] **Step 1: Test qui échoue** — `frontend/src/views/Onboarding.test.jsx` (pattern Chat.test.jsx : linkedom + mocks hoisted) :

```jsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  S: { routines: [], week: {}, workouts: [], bodyweight: [] },
  update: vi.fn(mut => { mut(mocks.S) }),
  api: vi.fn(() => Promise.resolve({ ok: true })),
  nav: vi.fn()
}))
vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: mocks.S, user: { id: 'u1', name: 'Marc', coached: false }, update: mocks.update, isGuest: () => false })
}))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: () => {}, setSpotlight: () => {} }) }))
vi.mock('../lib/api.js', () => ({ api: (...a) => mocks.api(...a) }))
vi.mock('../lib/nav.js', () => ({ nav: (...a) => mocks.nav(...a) }))

import Onboarding from './Onboarding.jsx'

let dom, root, host
beforeEach(() => {
  dom = parseHTML('<!doctype html><html><body></body></html>')
  globalThis.document = dom.document
  globalThis.window = dom.window
  host = dom.document.createElement('div')
  dom.document.body.appendChild(host)
})
afterEach(() => { act(() => root?.unmount()); vi.clearAllMocks(); mocks.S = { routines: [], week: {}, workouts: [], bodyweight: [] } })
const render = () => act(() => { root = createRoot(host); root.render(<Onboarding />) })
const click = txt => act(() => {
  const b = [...host.querySelectorAll('button')].find(b => b.textContent.includes(txt))
  b.dispatchEvent(new dom.window.Event('click', { bubbles: true }))
})

describe('Onboarding wizard', () => {
  it('walks the 6 steps and writes the program', async () => {
    render()
    click('minute')                 // étape 1 → 2 (bouton « 1 minute chrono » / Commencer)
    click('muscle')                 // objectif
    click('débute')                 // niveau
    click('3')                      // jours
    click('Salle')                  // matériel
    // étape 6 : aperçu — le programme est visible puis validé
    click('parti')                  // « C'est parti »
    await act(async () => { await Promise.resolve() })
    expect(mocks.S.routines.length).toBeGreaterThan(0)
    expect(Object.keys(mocks.S.week).length).toBe(3)
    expect(mocks.S.onboarded).toBe(true)
    expect(mocks.api).toHaveBeenCalledWith('/api/onboarding/complete', expect.objectContaining({ method: 'POST' }))
    expect(mocks.nav).toHaveBeenCalledWith('/home')
  })
  it('Plus tard marks onboarded without writing a program', () => {
    render()
    click('Plus tard')
    expect(mocks.S.onboarded).toBe(true)
    expect(mocks.S.routines.length).toBe(0)
    expect(mocks.nav).toHaveBeenCalledWith('/home')
  })
})
```

Note : les libellés cliqués doivent correspondre au texte réel rendu (source EN via `t()` → le test tourne en anglais par défaut ; utiliser les libellés ANGLAIS dans `click()` et ajuster : `click('minute')`→ texte du CTA étape 1, `click('muscle')` → 'Build muscle', `click('débute')` → "I'm new to this", `click('Salle')` → 'Full gym', `click('parti')` → "Let's go". Ajuster le test aux chaînes exactes choisies à l'implémentation — les chaînes du Step 3 font foi.)

- [ ] **Step 2:** Run `npx vitest run src/views/Onboarding.test.jsx` — Expected: FAIL.

- [ ] **Step 3: Implémentation** — `frontend/src/views/Onboarding.jsx` :

```jsx
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import { buildProgram } from '../lib/programs.js'
import { exName } from '../lib/exercises.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// 6-step first-program wizard. Writes into S via update(); the coach welcome
// message is requested fire-and-forget (retried at boot via S._onboardingPending).
const STEPS = ['welcome', 'objectif', 'niveau', 'jours', 'materiel', 'preview']

const CHOICES = {
  objectif: [['muscle', 'Build muscle', '💪'], ['force', 'Get stronger', '🏋️'], ['forme', 'Get back in shape', '🔥']],
  niveau: [['debutant', "I'm new to this", '🌱'], ['inter', "I've trained before", '📈']],
  jours: [[2, '2 days / week', '🗓️'], [3, '3 days / week', '🗓️'], [4, '4 days / week', '🗓️']],
  materiel: [['salle', 'Full gym', '🏢'], ['maison', 'Dumbbells at home', '🏠'], ['pdc', 'Bodyweight only', '🤸']]
}

export default function Onboarding() {
  const update = useStore(s => s.update)
  const setSpotlight = useUI(s => s.setSpotlight)
  const toast = useUI(s => s.toast)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})

  const later = () => { update(S => { S.onboarded = true }); nav('/home') }
  const pick = (key, value) => { setAnswers(a => ({ ...a, [key]: value })); setStep(s => s + 1) }

  const finish = () => {
    const program = buildProgram(answers)
    update(S => {
      S.routines = program.routines
      S.week = program.week
      S.onboarded = true
    })
    api('/api/onboarding/complete', { method: 'POST', body: JSON.stringify({ answers }) })
      .catch(() => update(S => { S._onboardingPending = answers }))
    setSpotlight?.(true)
    nav('/home')
  }

  const name = STEPS[step]
  const preview = name === 'preview' ? buildProgram(answers) : null

  return <div className="narrow" style={{ paddingTop: 24 }}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <div className="chips">{STEPS.map((s, i) => <span key={s} className={'chip' + (i <= step ? ' on' : '')} style={{ width: 22, padding: 0, height: 6, borderRadius: 3 }} />)}</div>
      <button className="small muted" onClick={later}>{t('Later')}</button>
    </div>

    {name === 'welcome' && <div className="card" style={{ textAlign: 'center', padding: '32px 18px' }}>
      <div style={{ fontSize: 40 }}>👋</div>
      <h2>{t("Let's build your first program")}</h2>
      <p className="muted small">{t('4 quick questions — about a minute.')}</p>
      <Button variant="primary" onClick={() => setStep(1)}>{t('Start — 1 minute')}</Button>
    </div>}

    {['objectif', 'niveau', 'jours', 'materiel'].includes(name) && <div className="card" style={{ padding: '22px 16px' }}>
      <h3 style={{ marginTop: 0 }}>{{
        objectif: t("What's your goal?"), niveau: t('Your level?'),
        jours: t('How many days a week?'), materiel: t('What equipment do you have?')
      }[name]}</h3>
      <div className="list">
        {CHOICES[name].map(([value, label, emoji]) =>
          <button key={value} className="item" onClick={() => pick(name, value)}>
            <span style={{ fontSize: 22, marginRight: 10 }}>{emoji}</span>
            <span className="grow tt">{t(label)}</span>
            <Icon name="chevronRight" className="chev" />
          </button>)}
      </div>
    </div>}

    {name === 'preview' && <div className="card" style={{ padding: '22px 16px' }}>
      <h3 style={{ marginTop: 0 }}>{t('Your program')}</h3>
      {preview.routines.map(r => <div key={r.id} style={{ marginBottom: 12 }}>
        <div className="tt">{r.emoji && <Icon name={r.emoji} style={{ marginRight: 6 }} />}{r.name}</div>
        {r.ex.map(e => <div key={e.id} className="small muted" style={{ padding: '3px 0' }}>{exName(e.id)} — {e.sets}×{e.reps}</div>)}
      </div>)}
      <p className="small muted">{t('Your coach will review it — you can adjust everything later in Plan.')}</p>
      <Button variant="primary" onClick={finish}>{t("Let's go 💪")}</Button>
    </div>}
  </div>
}
```

Vérifier à l'implémentation : le nom exact du helper « id exercice → nom affiché » dans `lib/exercises.js` (`exName` supposé — sinon adapter l'import et le test).

- [ ] **Step 4: Route + redirection + retry** — `App.jsx` :
  - `import Onboarding from './views/Onboarding.jsx'` + route `<Route path="/onboarding" element={<Onboarding />} />`.
  - Dans `Shell`, après le calcul de `authed` : redirection déclarative en tête des Routes :

```jsx
{user && !isGuest && !S.onboarded && !(S.routines || []).length && loc.pathname !== '/onboarding'
  ? <Navigate to="/onboarding" replace /> : null}
```

  (implémentation concrète : une route index conditionnelle OU un `useEffect` qui `navigate('/onboarding')` sous ces conditions — suivre le pattern le plus simple qui passe les tests existants ; conditions exactes ci-dessus.)
  - Retry du POST au boot : effet dans `Shell` :

```jsx
  const update = useStore(s => s.update)
  useEffect(() => {
    const pending = S._onboardingPending
    if (!user || !pending) return
    api('/api/onboarding/complete', { method: 'POST', body: JSON.stringify({ answers: pending }) })
      .then(() => update(St => { delete St._onboardingPending }))
      .catch(() => {})
  }, [!!user])
```

- [ ] **Step 5: i18n fr** — ajouter à `fr.js` :

```js
  'Later': 'Plus tard',
  "Let's build your first program": 'On va créer ton premier programme',
  '4 quick questions — about a minute.': '4 questions rapides — une minute chrono.',
  'Start — 1 minute': 'Commencer — 1 minute',
  "What's your goal?": 'Ton objectif ?',
  'Build muscle': 'Prendre du muscle',
  'Get stronger': 'Devenir plus fort',
  'Get back in shape': 'Me remettre en forme',
  'Your level?': 'Ton niveau ?',
  "I'm new to this": 'Je débute',
  "I've trained before": "J'ai déjà pratiqué",
  'How many days a week?': 'Combien de jours par semaine ?',
  '2 days / week': '2 jours / semaine',
  '3 days / week': '3 jours / semaine',
  '4 days / week': '4 jours / semaine',
  'What equipment do you have?': 'Quel matériel as-tu ?',
  'Full gym': 'Salle complète',
  'Dumbbells at home': 'Haltères à la maison',
  'Bodyweight only': 'Poids du corps',
  'Your program': 'Ton programme',
  'Your coach will review it — you can adjust everything later in Plan.': 'Ton coach va le relire — tout reste modifiable dans Plan.',
  "Let's go 💪": "C'est parti 💪",
```

- [ ] **Step 6:** Aligner les libellés du test (Step 1) sur ces chaînes EN exactes, puis `npx vitest run` — Expected: tout passe.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/Onboarding.jsx frontend/src/views/Onboarding.test.jsx frontend/src/App.jsx frontend/src/locales/fr.js
git commit -m "feat(front): onboarding wizard — 6 steps, program written to plan, coach handoff"
```

---

### Task 6: Front — Spotlights + relance Réglages

**Files:**
- Create: `frontend/src/components/Spotlight.jsx`
- Modify: `frontend/src/store/useUI.js` (état `spotlight`), `frontend/src/views/Home.jsx` (ancres + rendu), `frontend/src/components/TabBar.jsx` (ancre onglet Coach), `frontend/src/views/Settings.jsx` (relance), `frontend/src/index.css`, `frontend/src/locales/fr.js`
- Test: rendu basique dans `frontend/src/components/Spotlight.test.jsx`

**Interfaces:**
- Consumes: Task 5 (`setSpotlight(true)` appelé à la fin du wizard).
- Produces: `useUI` : `spotlight: false`, `setSpotlight(v)` ; composant `<Spotlight />` monté dans `Home.jsx`, 3 étapes ciblant `#spot-week` (carte semaine Home), `#tabbar .start` (bouton Démarrer existant), `#spot-coach-tab` (onglet Coach) ; drapeau purement en mémoire (jamais persisté).

- [ ] **Step 1: useUI** — ajouter `spotlight: false,` après `chatUnread: 0,` et `setSpotlight(v) { set({ spotlight: v }) },` après `setChatUnread`.

- [ ] **Step 2: Ancres** — `Home.jsx` : ajouter `id="spot-week"` sur la `div.card` de la semaine (première carte). `TabBar.jsx` : ajouter `id="spot-coach-tab"` sur le bouton de l'onglet Coach (passer une prop `idAttr` au composant `Tab` : `<button id={idAttr} …>`).

- [ ] **Step 3: Test de rendu** — `Spotlight.test.jsx` :

```jsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spotlight: true, setSpotlight: vi.fn() }))
vi.mock('../store/useUI.js', () => ({
  useUI: selector => selector({ spotlight: mocks.spotlight, setSpotlight: mocks.setSpotlight })
}))
import Spotlight from './Spotlight.jsx'

let dom, root, host
beforeEach(() => {
  dom = parseHTML('<!doctype html><html><body><div id="spot-week"></div><div id="tabbar"><button class="start"></button></div><button id="spot-coach-tab"></button></body></html>')
  globalThis.document = dom.document
  globalThis.window = dom.window
  host = dom.document.createElement('div')
  dom.document.body.appendChild(host)
})
afterEach(() => { act(() => root?.unmount()); vi.clearAllMocks() })

describe('Spotlight', () => {
  it('renders the first step and advances to the end', () => {
    act(() => { root = createRoot(host); root.render(<Spotlight />) })
    expect(host.textContent).toContain('week')        // légende étape 1
    const next = [...host.querySelectorAll('button')].pop()
    act(() => next.dispatchEvent(new dom.window.Event('click', { bubbles: true })))
    act(() => { [...host.querySelectorAll('button')].pop().dispatchEvent(new dom.window.Event('click', { bubbles: true })) })
    act(() => { [...host.querySelectorAll('button')].pop().dispatchEvent(new dom.window.Event('click', { bubbles: true })) })
    expect(mocks.setSpotlight).toHaveBeenCalledWith(false)
  })
  it('renders nothing when spotlight is off', () => {
    mocks.spotlight = false
    act(() => { root = createRoot(host); root.render(<Spotlight />) })
    expect(host.textContent).toBe('')
    mocks.spotlight = true
  })
})
```

- [ ] **Step 4:** Run `npx vitest run src/components/Spotlight.test.jsx` — FAIL, puis implémenter `Spotlight.jsx` :

```jsx
import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

// Post-onboarding tour: 3 dim-overlay steps anchoring existing UI. Session-only
// (never persisted) — closing the app mid-tour just ends it, no nagging.
const STEPS = [
  { sel: '#spot-week', text: '📅 Your week plan lives here' },
  { sel: '#tabbar .start', text: '▶️ Start your workout here on training days' },
  { sel: '#spot-coach-tab', text: '💬 Your coach already wrote to you' }
]

export default function Spotlight() {
  const on = useUI(s => s.spotlight)
  const setSpotlight = useUI(s => s.setSpotlight)
  const [i, setI] = useState(0)
  if (!on) return null

  // Skip steps whose target is missing; past the end → done.
  let idx = i
  while (idx < STEPS.length && !document.querySelector(STEPS[idx].sel)) idx++
  if (idx >= STEPS.length) { setSpotlight(false); return null }

  const target = document.querySelector(STEPS[idx].sel)
  const r = target.getBoundingClientRect()
  const next = () => (idx + 1 >= STEPS.length ? setSpotlight(false) : setI(idx + 1))

  return <div className="spotlight-overlay" onClick={next}>
    <div className="spotlight-hole" style={{ left: r.left - 8, top: r.top - 8, width: r.width + 16, height: r.height + 16 }} />
    <div className="spotlight-caption" style={{ top: Math.min(r.bottom + 18, window.innerHeight - 120) }}>
      <p>{t(STEPS[idx].text)}</p>
      <Button variant="primary" size="sm" onClick={next}>{idx + 1 >= STEPS.length ? t('OK') : t('Next')}</Button>
    </div>
  </div>
}
```

CSS (fin d'`index.css`) :

```css
/* ------------------------------------------------------------ spotlight -- */
.spotlight-overlay{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.6)}
.spotlight-hole{
  position:absolute;border-radius:14px;
  box-shadow:0 0 0 9999px rgba(0,0,0,.6);background:transparent;
  outline:2px solid var(--acc);
}
.spotlight-overlay{background:transparent}   /* le voile vient du box-shadow du trou */
.spotlight-caption{
  position:absolute;left:16px;right:16px;background:var(--bg-el);
  border-radius:14px;padding:14px 16px;text-align:center;
}
.spotlight-caption p{margin:0 0 10px;font-size:.95rem}
```

Monter `<Spotlight />` à la fin du JSX de `Home.jsx` (dans le fragment racine).

- [ ] **Step 5: Relance Réglages** — dans `Settings.jsx`, section Account connecté, sous la ligne profil :

```jsx
        {!S.routines.length && <Row icon="sparkles" iconTint="var(--acc)" title={t('Create my first program')} accessory="chevron" onClick={() => nav('/onboarding')} />}
```

(vérifier que `S` est accessible dans Settings — il l'est via `useStore` déjà importé.)

- [ ] **Step 6: i18n fr** :

```js
  '📅 Your week plan lives here': '📅 Ton programme est posé sur ta semaine',
  '▶️ Start your workout here on training days': '▶️ Le jour J, ta séance se lance ici',
  '💬 Your coach already wrote to you': "💬 Ton coach t'a déjà écrit",
  'Next': 'Suivant',
  'Create my first program': 'Créer mon premier programme',
```

(`'OK'` n'a pas besoin d'entrée fr.)

- [ ] **Step 7:** Run `npx vitest run` + `npx vite build` — Expected: tout passe, build propre.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Spotlight.jsx frontend/src/components/Spotlight.test.jsx frontend/src/store/useUI.js frontend/src/views/Home.jsx frontend/src/components/TabBar.jsx frontend/src/views/Settings.jsx frontend/src/index.css frontend/src/locales/fr.js
git commit -m "feat(front): post-onboarding spotlights + restart entry in Settings"
```

---

### Task 7: Vérification finale + doc déploiement

**Files:**
- Modify: `docs/DEPLOY-COACH.md` (section smoke test)

- [ ] **Step 1: Vérification complète** :

```bash
cd api && node --check server.js && node --test *.test.js
cd ../frontend && npx vitest run && npx vite build
```

Expected: tout vert, build propre.

- [ ] **Step 2: Smoke checklist** — ajouter à la checklist E2E de `docs/DEPLOY-COACH.md` :

```markdown
- [ ] Nouveau compte → wizard onboarding : 4 réponses → programme visible dans Plan,
      posé sur la semaine, spotlights, message du coach dans l'onglet Coach (+ push
      admin « 🆕 … a fini l'onboarding »).
- [ ] Le nouveau compte répond 5 fois → 6ᵉ message bloqué, bandeau découverte
      remplacé par l'upsell, le fil reste lisible.
- [ ] « Plus tard » depuis le wizard → app accessible ; Réglages → « Créer mon
      premier programme » relance le wizard.
```

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOY-COACH.md
git commit -m "docs: onboarding smoke checklist"
```

---

## Self-review (fait à l'écriture)

- **Couverture spec** : §2 déclenchement/relance → T5/T6 ; §3 wizard → T5 ; §4 templates → T1 ; §5 route complete → T3 ; §6 découverte → T2/T4 ; §7 spotlights → T6 ; §8 i18n → T4/T5/T6 ; §9 tests → chaque task ; §10 hors périmètre respecté.
- **Placeholders** : les deux `[VÉRIFIER]` du T1 sont des procédures bornées avec critères, consignées au rapport (pas des TODO) ; la note « adapter les libellés du test aux chaînes du Step 3 » du T5 fixe la source de vérité.
- **Cohérence** : `buildProgram` (T1) consommé tel quel en T5 ; `discovery {used,max}` (T2) consommé en T4 ; `setSpotlight` (T6) appelé en optionnel en T5 (même séquencement que `setChatUnread` au projet précédent) ; énumérations identiques T1/T3/T5 ; `#spot-*`/`#tabbar .start` définis T6 et utilisés uniquement T6.

# Design — Module coaching (chat intégré + vue Coach) sur fork openGym

Date : 2026-08-24
Statut : validé par Alexis (sections présentées et approuvées une à une)

## 1. Contexte et objectif

Fork d'[openGym](https://github.com/DuarteSantos8/openGym) (AGPL v3, React 19 + Vite,
Node.js sans framework, stockage JSON par utilisateur) pour lancer une offre de
coaching sportif payante : l'app de tracking reste gratuite et sert de produit
d'appel ; l'abonnement payant donne accès à un chat intégré avec un coach humain
(Alexis répond lui-même en phase de test du concept).

Le business model, la cible et la tarification sont hors périmètre de ce document —
seul le dev est cadré ici.

### Décisions de cadrage (actées)

| Sujet | Décision |
|---|---|
| Contenu des messages | **Texte seul** (2 000 caractères max). Photos/vidéos = V2. |
| Accès client au chat | **6ᵉ onglet** dans la TabBar. |
| Poste coach | **Vue dédiée `/coach`** (l'admin existant reste inchangé). |
| Modèle d'accès | **App ouverte, chat payant** : inscription libre, flag `coached` activé à la main par le coach après paiement hors app. |
| Branding | **Rebrand léger** : nom + icône + accent. Nom non encore choisi — placeholder `openGym Coach` partout où le nom est paramétré (un seul point de changement par surface : env `RP_NAME`, manifest, titre). |
| Distribution | **PWA seule** (installation « Ajouter à l'écran d'accueil », iOS + Android). Pas d'APK en V1. |
| Transport chat | **Option A** : fichier JSON par conversation + polling + push existant. Pas de SSE/WebSocket. |

## 2. Architecture d'ensemble

```
┌─ frontend (React) ─────────────────────────┐   ┌─ api (Node, sans framework) ──────────┐
│ TabBar + Chat.jsx (client)                 │   │ server.js  (≈ inchangé, importe chat) │
│ Coach.jsx (/coach, admin only)             │──▶│ chat.js    (nouveau, ~150 l.)         │
│ lib/chat-core.js (logique pure + tests)    │   │  - routes /api/chat/* et /api/coach/* │
│ sw.js (push → ouvre #/chat)                │   │  - réutilise sendPush, requireAdmin,  │
└────────────────────────────────────────────┘   │    readSession, atomicWrite           │
                                                 └───────────────┬───────────────────────┘
                                                                 ▼
                                                 data/chat-<uid>.json  (1 fichier / client)
                                                 data/db.json          (+ flag coached)
```

Principes : prolonger les patterns maison (fichier par utilisateur, polling,
push, map de routes plate), aucune dépendance nouvelle, `server.js` touché au
minimum (import du module + `coached` dans `/api/me`).

## 3. Données

### `data/chat-<uid>.json` (créé au premier message)

```json
{
  "messages": [
    { "id": 1, "from": "client", "text": "…", "ts": 1756000000000 },
    { "id": 2, "from": "coach",  "text": "…", "ts": 1756000090000 }
  ],
  "lastReadClient": 2,
  "lastReadCoach": 1
}
```

- `id` : entier séquentiel **par conversation** (max existant + 1). Sert de
  curseur de pagination (`?after=`) et de lecture.
- `from` : `"client"` ou `"coach"`.
- `text` : trimé côté serveur, 1 à 2 000 caractères, sinon 400.
- Non-lus = messages de l'autre partie avec `id > lastRead<Moi>`.
- Écriture via l'`atomicWrite` existant. Fichier absent = conversation vide.
- Uid assaini par la même regex que `stateFile()`.

### `data/db.json`

- Utilisateur : nouveau flag booléen optionnel `coached` (aux côtés de `admin`,
  `disabled`). Absent = non coaché.
- Toggle journalisé dans l'audit log existant (`admin.coached.on` / `.off`).

## 4. API — module `api/chat.js`

Nouveau fichier exportant `registerChatRoutes(routes, deps)` appelé par
`server.js` avec les helpers existants (`readSession`, `requireAdmin`, `json`,
`readBody`, `sendPush`, `audit`, `DATA`, accès `db`). Les routes s'ajoutent à la
map plate existante.

### Côté client — session requise, et `coached` requis sinon `403 {error:'not-coached'}`

| Route | Comportement |
|---|---|
| `GET /api/chat?after=<id>` | `{ messages: [...apres id...], lastReadCoach }` |
| `POST /api/chat {text}` | Valide, append, `sendPush` à **tous les admins** (`titre: "💬 <prénom>"`, `body`: début du message, `tag:'chat'`, `url:'#/coach'`) |
| `POST /api/chat/read {upTo}` | `lastReadClient = max(actuel, upTo)` |
| `GET /api/chat/unread` | `{ n }` — pollé par le shell pour la pastille |

### Côté coach — garde `requireAdmin` existante

| Route | Comportement |
|---|---|
| `GET /api/coach/threads` | Par client : `{id, name, coached, lastMsg (extrait+ts+from), unread, lastWorkout, live}` — trié par activité desc. Inclut les non-coachés (pour activer le flag). |
| `GET /api/coach/thread?id=&after=` | `{ messages, lastReadClient }` |
| `POST /api/coach/thread {id, text}` | Append, `sendPush` au client (`titre: "💬 <RP_NAME>"`, `tag:'chat'`, `url:'#/chat'`) |
| `POST /api/coach/read {id, upTo}` | Avance `lastReadCoach` |
| `POST /api/coach/coached {id, coached}` | Toggle + audit. Refuse sur un admin. |

### Retouches `server.js` (minimales)

- `GET /api/me` : ajoute `coached: !!user.coached` (et l'objet user renvoyé par
  login/register verify, même forme).
- Import + appel `registerChatRoutes(...)`.

Le panneau « données client » de la vue Coach réutilise **tel quel**
`GET /api/admin/user?id=` (historique séances, poids, routines). Aucune
duplication d'endpoint.

## 5. Front — client

### TabBar
6ᵉ onglet `Coach` (icône bulle, route `/chat`), visible pour tous les états
connectés. CSS de la barre ajusté pour 6 boutons (labels courts, taille de
police légèrement réduite) dans le style maison. Pastille de non-lus sur
l'icône quand `unread > 0`.

### `views/Chat.jsx` — trois états
1. **Invité** : écran expliquant que le chat nécessite un compte (bouton vers
   la création de compte).
2. **Connecté non coaché** : **écran d'upsell** en français — pitch court de
   l'offre + bouton contact. Le lien de contact est une constante de config
   front (mailto au lancement, page/Stripe plus tard).
3. **Coaché** : conversation — bulles (client à droite, coach à gauche),
   auto-scroll bas, champ d'envoi (textarea 1-2000 c.), indicateur « Vu »
   sous le dernier message client si `id ≤ lastReadCoach`.
   Polling `GET /api/chat?after=` toutes les **20 s vue montée uniquement** ;
   `POST /api/chat/read` automatique quand des messages sont affichés.

### Pastille (shell)
Poll `GET /api/chat/unread` toutes les **60 s** si connecté + coaché, +
rafraîchissement sur `visibilitychange` (retour au premier plan). Stocké dans
`useUI`. La push notification reste le signal instantané.

### Service worker
`notificationclick` : si `data.url` présent dans le payload, ouvrir/focus sur
cette URL (`#/chat` ou `#/coach`) au lieu de la racine. Push payloads du chat
portent `tag:'chat'` (renotify existant conserve le comportement actuel).

## 6. Front — vue Coach (`/coach`)

Réservée `user.admin` (garde de route identique à `/admin`), **en français**
(surface opérateur, hors packs i18n — même convention que l'admin anglais).
Accès : entrée dans Réglages (à côté d'Admin) + lien croisé depuis l'admin.

- **Liste des fils** : clients triés par activité — pastille non-lus, point
  vert « s'entraîne » (présence existante), extrait du dernier message,
  dernière séance, toggle Coaché. Poll 15 s (pattern admin).
- **Détail client** (navigation dans la vue) : conversation + champ de réponse,
  et panneau **Données** (repliable sur mobile) : dernières séances
  (nom, date, durée, sets, volume, PRs), courbe de poids, routines — alimenté
  par `GET /api/admin/user`. Poll 20 s sur le fil ouvert, marquage lu auto.

## 7. Rebrand léger

- Nom : env `RP_NAME` (existant) propagé partout où « openGym » apparaît côté
  produit client : `manifest.json` (name/short_name), `<title>`, écran de
  login, notification par défaut du sw. Icônes (`icon-512/180`) et couleur
  d'accent par défaut remplacées.
- **Placeholder `openGym Coach`** tant qu'Alexis n'a pas choisi le nom — le
  changement final = 1 variable d'env + manifest + 2 icônes.
- Conformité AGPL : LICENSE et NOTICE.md conservés, le fork (chat compris) est
  publié sur un dépôt public. Mention discrète « basé sur openGym » dans les
  réglages.

## 8. i18n

Chaînes client (onglet, upsell, conversation, notifs) : ajoutées en anglais
(source) + traduction dans `locales/fr.js`. Les autres langues retombent sur
l'anglais (mécanisme existant). Vue Coach : français en dur.

## 9. Erreurs et cas limites

- Envoi échoué (offline, 500) : toast maison, **texte conservé dans le champ**.
  Pas de file d'attente offline en V1.
- `403 not-coached` en cours de session (flag retiré) : la vue bascule sur
  l'écran d'upsell.
- Compte désactivé : déjà géré (session refusée partout).
- Deux réponses coach simultanées : fenêtre de course théorique read-modify-write
  sur le JSON ; process Node mono-thread + un seul coach → risque accepté en V1
  (identique au risque existant sur `PUT /api/data`).
- Fichier chat corrompu : même convention que `readState` — retombe sur
  conversation vide, le fichier n'est réécrit qu'au prochain message.

## 10. Tests

- **`lib/chat-core.js`** (logique pure, testée) : calcul des non-lus, fusion
  des pages de messages, tri des fils, format des horodatages relatifs.
  Tests unitaires vitest comme les `lib/*.test.js` existants.
- Composants : test de rendu des trois états de `Chat.jsx` (pattern
  `Modals.test.jsx`).
- API : smoke test manuel documenté (curl) dans le doc de déploiement —
  l'api n'a pas d'infra de test automatisée en amont, on n'en introduit pas
  en V1.

## 11. Déploiement

- VM GCP + `docker compose up` (build depuis le fork, pas les images
  registry upstream). `.env` : `RP_ID`/`ORIGIN` = domaine final, `RP_NAME`,
  `ADMIN_UIDS` = uid d'Alexis (créé au premier register), `ALLOW_GUEST=1`,
  `INVITE_ONLY` off.
- ⚠️ **Le domaine doit être définitif avant le premier client** : passkeys
  liées à `RP_ID`, changer de domaine = logins cassés.
- ⚠️ **Médias exercices** : images/GIFs © Gym Visual, licence requise pour
  usage commercial (cf. NOTICE upstream). Décision commerciale à prendre
  avant le lancement payant : acheter la licence ou désactiver les médias.
  N'impacte pas le dev du module chat.

## 12. Hors périmètre V1 (explicite)

Photos/vidéos dans le chat, paiement intégré (Stripe in-app), file d'attente
offline, temps réel (SSE/WS), APK, assistance IA à la rédaction des réponses
coach, multi-coachs (tous les admins reçoivent les push — suffisant à un seul
coach).

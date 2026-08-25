# Design — « Continuer avec Google » (Google Sign-In)

Date : 2026-08-25
Statut : validé par Alexis (design présenté en conversation, « go »)

## 1. Contexte et objectif

GymMentor n'accepte que les passkeys (WebAuthn) et le mode invité. Pour les
bêta-testeurs grand public, « Continuer avec Google » réduit la friction
d'inscription, et fournit l'email de l'utilisateur : premier canal CRM du
projet (les comptes passkey n'ont aucune coordonnée).

### Décisions actées

| Sujet | Décision |
|---|---|
| Position | Google = bouton PRINCIPAL de l'écran de connexion, passkey en second, invité inchangé. |
| Liaison de comptes | Aucune en V1 : un compte Google et un compte passkey de la même personne sont deux comptes distincts. |
| Email | Stocké dans db.json, affiché dans la vue Coach (détail client) et l'admin. Jamais utilisé comme identifiant (l'ancre est le `sub` Google, stable). |
| Implémentation | Flow OAuth « authorization code » côté serveur, ZÉRO dépendance (fetch natif Node 22, vérification id_token via l'endpoint officiel tokeninfo de Google). |
| Activation | Par `.env` : `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Absents → la feature n'existe pas (bouton masqué, routes 404). `/api/config` expose `google: true|false`. |

## 2. Serveur — module `api/google-auth.js`

`registerGoogleRoutes(routes, deps)` (pattern chat/onboarding). Deps :
`{ db, saveDb, json, sign, verifySig, sessionCookie, RP_NAME, ORIGIN, INVITE_ONLY, audit, fetchFn }`
(`fetchFn` = fetch injectable pour les tests ; défaut `globalThis.fetch`).
Le module lit `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` via `process.env` au
moment de l'enregistrement ; si l'un manque, il n'enregistre AUCUNE route.

### `GET /api/auth/google`
302 vers `https://accounts.google.com/o/oauth2/v2/auth` avec :
`client_id`, `redirect_uri = ORIGIN + '/api/auth/google/callback'`,
`response_type=code`, `scope=openid email profile`, `prompt=select_account`,
`state = sign(nonce aléatoire + ':' + expiration 10 min)` (HMAC avec le
SECRET de session existant — anti-CSRF sans stockage serveur).

### `GET /api/auth/google/callback?code=&state=`
1. `state` vérifié (`verifySig` + expiration) — sinon 302 vers `/` (échec
   silencieux, pas de page d'erreur dédiée en V1).
2. POST `https://oauth2.googleapis.com/token` (fetchFn) : code + client_id +
   client_secret + redirect_uri + grant_type.
3. GET `https://oauth2.googleapis.com/tokeninfo?id_token=...` (fetchFn) —
   Google valide la signature. Contrôles : `aud === GOOGLE_CLIENT_ID`,
   `sub` présent.
4. Find-or-create : `db.users.find(u => u.google === sub)`.
   - Trouvé : si `disabled` → 302 `/` sans cookie. Sinon session.
   - Absent : si `INVITE_ONLY` → 302 `/#/login-invite-required` (le front
     affiche un toast). Sinon création :
     `{ id: uid 12 octets base64url (comme les passkeys), name: given_name
     || name || 'Sportif', created: ISO, google: sub, email }`. `saveDb()`.
5. `Set-Cookie: sessionCookie(user)` + 302 vers `/`. `audit('auth.google.ok'
   | 'auth.google.register', ...)` ; échecs → `audit('auth.google.fail')`.

### Retouches existant
- `GET /api/config` : ajoute `google: <routes enregistrées>`.
- `publicUser` : inchangé (les champs `google`/`email` ne sortent pas vers le
  client final).
- `GET /api/admin/user` et `GET /api/coach/threads`/detail : exposent
  `email` (admin/coach seulement).
- `api/Dockerfile` : `google-auth.js` ajouté au COPY (leçon retenue).
- `.env.example` : bloc commenté GOOGLE_CLIENT_ID/SECRET + explication.

## 3. Front

- `Login.jsx` : si `config.google`, bouton principal « Continuer avec
  Google » = `<a className="btn primary" href="/api/auth/google">` (redirect
  plein cadre, compatible PWA standalone). Passkey passe en bouton
  secondaire. Si `config.google` absent → écran actuel inchangé.
- Retour de callback : l'app se recharge sur `/`, `boot()` appelle `/api/me`
  → connecté. Compte neuf = état vierge → le wizard d'onboarding se
  déclenche par la redirection existante (aucun code à ajouter).
- `#/login-invite-required` : toast « Cette instance est sur invitation »
  puis retour login (3 lignes dans le shell).
- Vue Coach (détail) + admin UserDetail : ligne email si présent, sinon
  « pas d'email » discret.
- i18n : nouvelles clés EN + fr.js.

## 4. Sécurité

- Ancre d'identité = `sub` (jamais l'email). `aud` vérifié. `state` HMAC
  10 min. Secret uniquement en `.env` serveur. Cookies/session/logout/
  disable : mécanismes existants inchangés (y compris `sv`).
- tokeninfo est un appel réseau par connexion : volumétrie négligeable à
  notre échelle, et Google le documente pour ce cas (< 100 QPS).

## 5. Tests

- `api/google-auth.test.js` (node --test, fetchFn mocké) : redirect avec
  state signé ; callback state invalide/expiré → pas de cookie ; création
  (user en db avec google/email, cookie posé) ; reconnexion même sub → pas
  de doublon ; `aud` incorrect refusé ; disabled refusé ; INVITE_ONLY
  refuse la création ; module inerte sans env vars.
- Front : test Login (bouton présent si config.google, absent sinon).
- E2E manuel post-déploiement (checklist DEPLOY-COACH.md).

## 6. Hors périmètre V1

Liaison passkey↔Google, autres providers (Apple…), refresh tokens (aucun
besoin : session cookie maison), révocation Google, page d'erreur OAuth
dédiée, choix du compte forcé (`prompt=select_account` ajouté quand même :
1 paramètre, évite les mauvaises surprises multi-comptes).

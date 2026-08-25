# Design — Abonnement intégré (Stripe Checkout + webhook)

Date : 2026-08-25
Statut : validé par Alexis (prix 14,90 €/mois, compte Stripe B&C actif)

## 1. Objectif

Remplacer le mailto de l'upsell par un vrai parcours d'abonnement : bouton
« S'abonner » dans l'app → page de paiement Stripe Checkout → retour dans
l'app avec le statut `coached` activé AUTOMATIQUEMENT par webhook. Gestion/
annulation via le portail client Stripe. Le toggle manuel du coach reste
(invités, cas particuliers).

## 2. Décisions actées

| Sujet | Décision |
|---|---|
| Prix | 14,90 €/mois, abonnement mensuel Stripe (Produit « GymMentor Coaching » créé par Alexis dans son dashboard B&C). |
| Parcours | In-app jusqu'au clic « S'abonner », page de paiement = Stripe Checkout (standard PCI), retour automatique dans l'app. |
| Activation | Webhook `checkout.session.completed` → `user.coached = true` + `user.stripeCustomer` + push au client (« 🎉 ») et au coach. `customer.subscription.deleted` → `coached = false` + push coach. |
| Implémentation | ZÉRO dépendance : API Stripe en `fetch` (clé secrète serveur), signature webhook vérifiée en HMAC-SHA256 natif (en-tête `Stripe-Signature`, schéma `t=…,v1=…`, tolérance 5 min). |
| Config | `.env` : `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`. L'un absent → module inerte, `/api/config` expose `billing:false` → le front garde le bouton contact actuel (mailto) en secours. |
| Identité | Lien Stripe↔compte par `client_reference_id = uid` au checkout, puis par `user.stripeCustomer` (id client Stripe) pour le portail et la résiliation. Jamais l'email. |

## 3. Serveur — module `api/billing.js`

`registerBillingRoutes(routes, deps) → boolean` ; deps
`{ db, saveDb, json, readSession, sendPush, isAdmin, ORIGIN, audit, fetchFn }`
(fetchFn injectable pour les tests). Lit les 3 env vars à l'enregistrement.

### `GET /api/billing/checkout` (session requise)
- Utilisateur déjà `coached` → 302 `/` (rien à vendre).
- POST `https://api.stripe.com/v1/checkout/sessions` (Authorization Bearer
  SECRET_KEY, corps form-urlencoded) : `mode=subscription`,
  `line_items[0][price]=PRICE_ID`, `line_items[0][quantity]=1`,
  `client_reference_id=<uid>`, `success_url=ORIGIN/#/chat?sub=ok`,
  `cancel_url=ORIGIN/#/chat`, `locale=fr`. → 302 vers `session.url`.
- Échec API → 302 `ORIGIN/#/chat?sub=err` (le front toast).

### `POST /api/stripe/webhook` (PAS de session — appelé par Stripe)
- Lit le CORPS BRUT lui-même (chunks du stream ; la vérification de
  signature exige les octets exacts, pas le JSON reparsé). Limite 1 Mo.
- Vérifie `Stripe-Signature` : `signed_payload = t + '.' + rawBody`,
  HMAC-SHA256 avec WEBHOOK_SECRET, comparaison `timingSafeEqual` avec `v1`,
  et `|now/1000 − t| ≤ 300`. Échec → 400 (Stripe réessaie sinon).
- Événements :
  - `checkout.session.completed` : `uid = data.object.client_reference_id` ;
    user trouvé et non désactivé → `coached = true`,
    `stripeCustomer = data.object.customer`, `saveDb`,
    `audit('billing.subscribed')`, push au client (« 🎉 Ton coaching est
    actif, ton coach t'attend dans le chat ») et à chaque admin
    (« 💶 <nom> vient de s'abonner »).
  - `customer.subscription.deleted` : user par
    `stripeCustomer === data.object.customer` → `coached = false`, `saveDb`,
    `audit('billing.cancelled')`, push aux admins (« ⚠️ <nom> a résilié »).
  - Tout autre événement → 200 `{received:true}` (ignoré).
- Toujours répondre vite en 200 après traitement (Stripe exige < 20 s).

### `GET /api/billing/portal` (session + `stripeCustomer` requis)
- POST `/v1/billing_portal/sessions` (`customer`, `return_url=ORIGIN`) →
  302 `session.url`. Sans `stripeCustomer` → 302 `/`.

### Retouches
- `/api/config` : `billing: <routes enregistrées>`.
- Dockerfile : `billing.js` dans le COPY. `.env.example` : bloc commenté.

## 4. Front

- `UpsellCard` (Chat.jsx) : si `config.billing` → bouton principal
  « S'abonner · 14,90 €/mois » = `<a className="btn primary"
  href="/api/billing/checkout">` + mention « Sans engagement, annulable en
  1 clic ». Sinon → bouton contact actuel (mailto) conservé.
  Le prix est affiché en dur côté front (source de vérité = Stripe ; V1
  assume la cohérence, constante `PRICE_LABEL = '14,90 €/mois'`).
- Retour checkout : `Chat.jsx` lit `?sub=` dans `location` au montage —
  `ok` → toast « Paiement confirmé, ton coaching s'active… » + re-fetch
  `/api/me` via `boot()`/pullState léger (le webhook peut prendre quelques
  secondes : re-poll `/api/me` 3× à 2 s d'écart jusqu'à `coached`) ;
  `err` → toast d'échec.
- Réglages (section Account, utilisateur coaché avec `stripeCustomer`) :
  Row « Gérer mon abonnement » → `/api/billing/portal`. Pour savoir si
  l'utilisateur a un `stripeCustomer` : `publicUser` gagne
  `billing: !!u.stripeCustomer` (booléen, pas l'id).
- i18n EN + fr pour toutes les nouvelles chaînes.

## 5. Sécurité

Clé secrète uniquement serveur. Webhook : signature HMAC + fenêtre 5 min +
comparaison constante ; le corps est borné à 1 Mo ; uid depuis
`client_reference_id` (défini par NOTRE serveur au checkout, pas par le
client). `stripeCustomer` jamais exposé au front (seulement le booléen).
Un utilisateur `disabled` n'est pas réactivé par un paiement (log + push
admin pour traitement manuel). Idempotence : re-livraison d'un
`checkout.session.completed` déjà traité → no-op silencieux (coached déjà
true).

## 6. Ce qu'Alexis fait dans Stripe (5 min, je guide au déploiement)

1. Produit « GymMentor Coaching » → prix récurrent 14,90 €/mois → copier le
   `price_…`.
2. Développeurs → Webhooks → endpoint `https://gymmentor.app/api/stripe/webhook`,
   événements `checkout.session.completed` + `customer.subscription.deleted`
   → copier le `whsec_…`.
3. Me transmettre `sk_live_…`, `price_…`, `whsec_…` → je pose le `.env` VM.

## 7. Tests

- `api/billing.test.js` (fetchFn mocké + corps bruts signés à la main) :
  checkout 302 avec bons paramètres ; coached → skip ; webhook signature
  invalide/expirée → 400 ; completed → coached+stripeCustomer+pushes ;
  re-livraison → no-op ; subscription.deleted → coached=false ; disabled
  non réactivé ; module inerte sans env ; portal 302 / sans customer → `/`.
- Front : test UpsellCard (bouton S'abonner si config.billing, mailto sinon).

## 8. Hors périmètre

Changement de prix in-app, annuel/trimestriel, essais gratuits, TVA/OSS
(géré côté Stripe Tax si besoin plus tard), factures dans l'app (le portail
Stripe les fournit), remboursements (dashboard Stripe).

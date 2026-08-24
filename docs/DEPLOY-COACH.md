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

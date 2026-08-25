# Déploiement GymMentor (VM GCP free tier)

## Prérequis
- Domaine DÉFINITIF : **gymmentor.app** (à acheter avant le 1er testeur).
  ⚠️ Les passkeys sont liées au domaine (`RP_ID`) : en changer ensuite casse
  tous les logins. Ne JAMAIS onboarder quelqu'un sur un domaine provisoire.
- HTTPS obligatoire pour les passkeys et le push — assuré par Caddy ci-dessous
  (le TLD .app force HTTPS de toute façon, HSTS préloadé).
- Phase de test : **VM e2-micro du free tier GCP** (gratuite à vie — 1 par
  compte de facturation, régions us-west1 / us-central1 / us-east1 uniquement,
  disque standard ≤ 30 Go). Si le slot gratuit du compte principal est occupé
  (bnc-watcher), utiliser un autre compte Google — il lui faudra son propre
  compte de facturation (CB) même si rien n'est débité.

## Création de la VM (une fois, ~5 min)
    # Depuis le compte Google choisi (gcloud auth login si autre compte) :
    gcloud compute instances create gymmentor \
      --zone=us-west1-b --machine-type=e2-micro \
      --image-family=debian-12 --image-project=debian-cloud \
      --boot-disk-size=30GB --boot-disk-type=pd-standard \
      --tags=http-server,https-server
    gcloud compute firewall-rules create allow-http  --allow=tcp:80  --target-tags=http-server  2>/dev/null || true
    gcloud compute firewall-rules create allow-https --allow=tcp:443 --target-tags=https-server 2>/dev/null || true
    # Noter l'IP externe, puis chez le registrar : A gymmentor.app -> <IP>
    # (Réserver l'IP en statique : gcloud compute addresses create ... --addresses=<IP> --region=us-west1)

## Préparation VM (SSH : gcloud compute ssh gymmentor --zone=us-west1-b)
    # Swap 2 Go — l'e2-micro n'a que 1 Go de RAM, le build en a besoin :
    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
    sudo mkswap /swapfile && sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    # Docker :
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker $USER    # puis se reconnecter
    # Caddy (reverse proxy HTTPS auto Let's Encrypt) :
    sudo apt install -y caddy
    echo 'gymmentor.app {
      reverse_proxy localhost:8080
    }' | sudo tee /etc/caddy/Caddyfile
    sudo systemctl reload caddy

## Installation de l'app
    git clone <URL_DU_FORK> && cd openGym
    cp .env.example .env
    # Éditer .env : RP_ID=gymmentor.app  ORIGIN=https://gymmentor.app
    #               RP_NAME=GymMentor  WEB_PORT=8080
    docker compose up -d --build        # build depuis le fork, PAS docker compose pull

## Premier compte = coach
1. Ouvrir https://gymmentor.app, créer le profil « Alexis » (passkey).
2. Récupérer l'uid : `cat data/db.json` → users[0].id.
3. Dans .env : `ADMIN_UIDS=<cet uid>` puis `docker compose restart api`.
4. Vérifier : Réglages → les entrées Admin et Coach apparaissent.

## Smoke test E2E (à chaque déploiement)
- [ ] `curl -s https://gymmentor.app/api/health` → `{"ok":true,...}`
- [ ] Créer un 2ᵉ compte test (autre navigateur/profil) → wizard onboarding : 4 réponses →
      programme visible dans Plan, posé sur la semaine, spotlights, message du coach dans
      l'onglet Coach (+ push admin « 🆕 … a fini l'onboarding »).
- [ ] Le nouveau compte répond 5 fois → 6ᵉ message bloqué, bandeau découverte
      remplacé par l'upsell, le fil reste lisible.
- [ ] « Plus tard » depuis le wizard (compte ayant passé le wizard via « Plus tard »
      sans envoyer de message) → onglet Coach = upsell ; app accessible ; Réglages →
      « Créer mon premier programme » relance le wizard.
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

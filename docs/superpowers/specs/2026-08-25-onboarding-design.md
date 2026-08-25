# Design — Onboarding « premier programme avec ton coach »

Date : 2026-08-25
Statut : validé par Alexis (approche + sections approuvées en conversation)

## 1. Contexte et objectif

GymMentor (fork openGym, déployé sur gymmentor.app) accueille aujourd'hui un
nouveau compte sur un écran vide. Objectif : à l'inscription, créer le premier
programme de façon guidée (wizard), faire visiter l'app, et créer le premier
contact avec le coach humain — qui est à la fois l'expérience produit et le
canal de conversion vers l'abonnement coaching.

### Décisions de cadrage (actées)

| Sujet | Décision |
|---|---|
| Qui guide | **Wizard app + coach en filigrane** : l'app pose les questions et génère le programme ; à la fin, message de bienvenue « du coach » dans le chat + push vers le coach. |
| Chat pour les gratuits | **Mini-chat découverte** : un non-coaché peut envoyer **5 messages** (constante serveur `DISCOVERY_MSGS = 5`), lecture illimitée ; quota épuisé → écran d'upsell actuel. |
| Programme généré | **Templates adaptés** : ~6 squelettes préconstruits (jours × matériel), modulés par objectif (fourchettes de reps) et niveau (volume). Contenu validé par Alexis. |
| Visite de l'app | **Wizard plein écran + 3 spotlights** à l'arrivée sur l'accueil. |
| Invités (sans compte) | Pas de wizard en V1 (nécessite le serveur pour le message coach) ; ils gardent le bouton starter existant. |
| Architecture | **Approche A** : wizard front + quota découverte côté serveur. Zéro nouveau stockage : programme écrit dans `S.routines`/`S.week`, message coach dans `chat-<uid>.json` existant. |

## 2. Déclenchement et sortie

- Shell (`App.jsx`) : si utilisateur connecté (non invité), `!hasData(S)` et
  `!S.onboarded` → redirection vers `/onboarding`.
- `S.onboarded = true` est posé : à la validation finale, OU au clic « Plus
  tard » (présent à chaque étape). Le flag vit dans l'état synchronisé `S`
  (même mécanique que `S.lang`, `S.theme`).
- Relance : Réglages → ligne « Créer mon premier programme » (visible tant que
  `S.routines` est vide) → rouvre `/onboarding`.
- Aucune erreur réseau ne bloque : le wizard écrit d'abord l'état local
  (persisté/synchronisé par la mécanique existante), l'appel
  `/api/onboarding/complete` est fire-and-forget avec retry silencieux au
  prochain boot si échec (voir §5).

## 3. Le wizard — vue `Onboarding.jsx`, 6 étapes

Plein écran, barre de progression, « Plus tard » discret en haut à droite.
Réutilise les composants UI existants (`Button`, chips, cards).

1. **Bienvenue** — « On va créer ton premier programme. 1 minute chrono. »
2. **Objectif** — `muscle` (Prendre du muscle) / `force` (Devenir plus fort) /
   `forme` (Me remettre en forme)
3. **Niveau** — `debutant` (Je débute) / `inter` (J'ai déjà pratiqué)
4. **Disponibilité** — `2`, `3` ou `4` séances/semaine
5. **Matériel** — `salle` (Salle complète) / `maison` (Haltères à la maison) /
   `pdc` (Poids du corps)
6. **Aperçu** — le programme proposé (jours, exercices, séries×reps) +
   « C'est parti 💪 »

À la validation de l'étape 6 :
- `S.routines` = routines générées ; `S.week` = jours posés (2j → lun/jeu,
  3j → lun/mer/ven, 4j → lun/mar/jeu/ven) ;
- `S.onboarded = true` ;
- `POST /api/onboarding/complete { answers }` (fire-and-forget) ;
- navigation vers `/home` avec spotlights (§6).

## 4. Templates — `frontend/src/lib/programs.js`

Un seul fichier, même esprit que `starter.js` : IDs d'exercices de la
bibliothèque + séries/reps. Export principal :

```
buildProgram({ objectif, niveau, jours, materiel })
  → { routines: [...], week: {0..6: routineId|null} }
```

Matrice jours × matériel (6 squelettes) :

| | salle | maison | pdc |
|---|---|---|---|
| **2 j** | Full-body ×2 | Full-body haltères ×2 | → bascule sur 3 j pdc |
| **3 j** | PPL (réutilise `starterRoutines()`) | Full-body haltères ×3 | Circuit PDC ×3 |
| **4 j** | Upper/Lower ×2 | → bascule sur 3 j maison | → bascule sur 3 j pdc |

Modulateurs appliqués au squelette :
- **objectif** : `force` → reps 5-8 ; `muscle` → 8-12 ; `forme` → 12-15
  (les reps du squelette sont recalées dans la fourchette).
- **niveau** : `debutant` → retire le dernier exercice de chaque séance.

Combinaisons sans squelette dédié (cases « → bascule ») : redirection sur le
squelette voisin indiqué — jamais d'erreur, toujours un programme.

Les exercices exacts (IDs) sont choisis à l'implémentation dans
`exercises-data.js` (mouvements de base : squat/goblet, développé, tirage,
soulevé, épaules, gainage…) et **validés par Alexis avant mise en ligne** —
le fichier est fait pour être édité par lui ensuite.

## 5. La touche coach — `POST /api/onboarding/complete`

Nouvelle route (module `api/chat.js` ou petit module dédié réutilisant
`chat-store`) :

- Auth : session requise (pas de flag coached requis).
- Idempotence : `user.onboarded = <ISO date>` dans `db.json` ; si déjà posé →
  200 `{ ok: true, already: true }`, rien d'autre.
- Actions (première fois) :
  1. `appendMessage(DATA, uid, 'coach', <texte de bienvenue>)` — texte
     personnalisé : prénom + résumé des réponses. Exemple : « Salut Marc 👋
     J'ai vu ton programme prise de masse, 3 séances/semaine en salle — bon
     choix pour démarrer. Une question, un doute sur un exo ? Je suis là. »
     (gabarits par objectif, en français — cible V1).
  2. `sendPush` vers tous les admins : titre « 🆕 <prénom> a fini
     l'onboarding », corps « <objectif> · <niveau> · <jours>j · <matériel> »,
     tag `chat`, url `#/coach`.
- Body `{ answers: { objectif, niveau, jours, materiel } }` validé (valeurs
  dans les énumérations du §3, sinon 400).
- Retry silencieux : le front mémorise `S._onboardingPending = answers` si
  l'appel échoue, et le retente au boot suivant ; purgé au succès.

## 6. Mini-chat découverte (évolution serveur + front)

Serveur (`api/chat.js`) :
- `DISCOVERY_MSGS = 5` (constante exportée).
- La garde client `requireCoached` devient `requireChatAccess` :
  - coached → accès complet (comportement actuel) ;
  - non-coached connecté → `GET /api/chat`, `/read`, `/unread` autorisés ;
    `POST /api/chat` autorisé tant que
    `count(messages.from === 'client') < DISCOVERY_MSGS`, sinon
    403 `{ error: 'not-coached' }` (même code que l'existant → le front
    bascule sur l'upsell sans nouveau cas).
  - `GET /api/chat` renvoie en plus `discovery: { used, max }` pour les
    non-coachés (absent pour les coachés).

Front (`Chat.jsx`) :
- Non-coaché **avec** messages dans son fil (ou quota non nul restant) → vue
  conversation avec bandeau « Découverte : X/5 messages » ; quota épuisé →
  le champ d'envoi est remplacé par le bloc upsell (le fil reste lisible).
- Non-coaché **sans** aucun message (compte antérieur à l'onboarding, wizard
  passé) → écran d'upsell actuel inchangé.
- Badge non-lus (shell) : le poll n'est plus conditionné à `coached` mais à
  « connecté » (le serveur répond désormais pour tous les connectés).

Vue Coach : aucune modification nécessaire — les fils découverte apparaissent
déjà ; le libellé « Non coaché » existant suffit à les distinguer.

## 7. Spotlights — composant `Spotlight.jsx`

Au premier atterrissage sur `/home` après le wizard (drapeau de session en
mémoire, pas persisté — si l'utilisateur ferme avant la fin, tant pis, on ne
harcèle pas) : 3 étapes successives, overlay sombre + découpe sur la cible +
légende, « Suivant » / « OK » :
1. Le plan de la semaine (carte Home) — « 📅 Ton programme est posé sur ta
   semaine » ;
2. Le bouton central Démarrer — « ▶️ Le jour J, ta séance guidée se lance
   ici » ;
3. L'onglet Coach — « 💬 Ton coach t'a déjà écrit » (la pastille non-lus est
   déjà visible grâce au message de bienvenue).

Ciblage par sélecteurs stables (ids/classes existantes) ; si une cible est
absente (layout inattendu), l'étape est sautée sans erreur.

## 8. i18n

Chaînes wizard/spotlights/bandeau découverte : clés anglaises (source) via
`t()` + traductions complètes dans `locales/fr.js`. Le message de bienvenue
coach est généré côté serveur en français (cible V1, cohérent avec le coach
francophone) — gabarits dans le module serveur.

## 9. Tests

- `lib/programs.js` : tests unitaires vitest — matrice complète (12
  combinaisons → toujours un programme), modulateurs reps/volume, bascules.
- Serveur : tests node du quota découverte (0→5 messages, 6ᵉ refusé, coached
  illimité) et de l'idempotence d'`/api/onboarding/complete` (2ᵉ appel
  no-op), gabarit du message par objectif.
- `Onboarding.jsx` : test de rendu du parcours (sélections → étape aperçu →
  validation écrit routines/week/onboarded) avec stores mockés (pattern
  Chat.test.jsx).
- Spotlights : logique de séquencement dans un module pur testé si non
  triviale, sinon test de rendu basique.

## 10. Hors périmètre V1 (explicite)

Wizard pour les invités, génération fine par règles exercice par exercice,
édition du programme dans le wizard (l'édition passe par Plan existant),
localisation du message coach serveur, A/B tests, e-mails.

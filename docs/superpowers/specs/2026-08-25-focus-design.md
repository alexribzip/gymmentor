# Design — Étape « Focus » dans l'onboarding

Date : 2026-08-25
Statut : validé par Alexis (« ok » après présentation)

## 1. Objectif

Le wizard ne demande pas ce que la personne veut travailler ; une cliente qui
vise les fessiers reçoit le même programme qu'un client qui vise les pecs.
Nouvelle étape « Tu veux mettre l'accent où ? » et adaptation du programme
généré. Principe : **un accent, pas une spécialisation** — la base reste
complète, le coach affine ensuite.

## 2. Décisions actées

| Sujet | Décision |
|---|---|
| Choix (4) | `equilibre` ⚖️ Équilibré, tout le corps · `bas` 🍑 Bas du corps & fessiers · `haut` 💪 Haut du corps · `dos` 🧘 Dos & posture |
| Position | Étape insérée juste APRÈS l'objectif (le wizard passe à 7 étapes). |
| Mécanique | `equilibre` = inchangé. Sinon : **+1 série** sur les exercices de la zone visée, et **1 exercice remplacé par séance** (hors zone → zone) via des pools de swap par matériel. `dos` vise les tirages/posture. |
| Coach | `focus` ajouté aux enums serveur, au résumé du push admin (« … · focus fessiers ») et mentionné dans le message de bienvenue. |
| Compat | `answers.focus` absent (anciens clients du retry, appels directs) = `equilibre`. Comptes déjà onboardés non affectés. |

## 3. `lib/programs.js`

- Une map unique `ZONES = { exerciseId: zone }` (`bas` / `push` haut-pousser /
  `pull` haut-tirer / `tronc`) couvre TOUS les IDs utilisés : ceux des
  templates, ceux du starter PPL upstream (0025, 0047, 0426, 0334, 0241,
  0251, 2330, 0027, 1323, 0031, 0313, 0043, 0085, 0739, 0585, 0586, 0605 —
  zones à assigner à l'implémentation en vérifiant chaque nom dans EXDB) et
  ceux des pools de swap. Les tuples SPEC restent à 3 éléments. Un id absent
  de la map = zone `tronc` (neutre : jamais boosté, jamais swappé).
- `FOCUS_ZONES = { bas: ['bas'], haut: ['push', 'pull'], dos: ['pull'] }` —
  les zones boostées (+1 série, plafonné à 5).
- **Swap** : pour `bas`/`haut`/`dos`, dans chaque séance le PREMIER exercice
  d'une zone non visée (pour `bas` : un `push` ; pour `haut` : un `bas` ;
  pour `dos` : un `push`) est remplacé par le premier exercice du pool de
  swap (par matériel) absent de la séance. Aucun candidat au swap dans la
  séance → pas de swap (jamais d'erreur).
- Pools de swap (IDs vérifiés dans EXDB, à confirmer à l'implémentation) :
  - `bas` : salle `['1409' glute bridge barre, '0431' step-up]` ; maison
    `['0431' step-up, '0410' split squat]` ; pdc `['3645' single leg bridge,
    '3769' curtsey squat]`
  - `haut` : salle `['0437' upright row, '0348' rear lateral raise couché]` ;
    maison `['0437', '0348']` ; pdc `['0259' close-grip push-up, '0129'
    bench dip]`
  - `dos` : salle `['0180' cable seated row, '0044' good morning]` ; maison
    `['0348' rear lateral raise, '0293' bent over row]` ; pdc `['3433'
    swimmer kicks, '2300' inverted row bent knees]`
- `buildProgram({ objectif, niveau, jours, materiel, focus })` — `focus`
  optionnel, défaut `equilibre`. Ordre d'application : squelette → swap
  focus → clamp reps objectif → boost séries focus → trim débutant.
  (Le trim débutant reste en dernier : il retire le dernier exercice,
  les templates gardent leur exercice clef en tête de séance.)

## 4. Wizard (`Onboarding.jsx`)

- `STEPS` : `['welcome', 'objectif', 'focus', 'niveau', 'jours', 'materiel',
  'preview']`.
- `CHOICES.focus` : les 4 options avec émojis du §2, libellés EN sources
  (`'Balanced, whole body'`, `'Lower body & glutes'`, `'Upper body'`,
  `'Back & posture'`) + question `'Where do you want the focus?'` ; fr.js
  complété.
- L'aperçu (étape 7) reflète déjà le focus puisqu'il appelle `buildProgram`.

## 5. Serveur (`api/onboarding.js`)

- `FOCUS = { equilibre: null, bas: 'bas du corps et fessiers', haut: 'haut
  du corps', dos: 'dos et posture' }` ; `valid()` accepte `focus` absent ou
  dans l'énumération.
- Résumé push : `… · 3j · salle` devient `… · 3j · salle · focus <libellé>`
  (rien d'ajouté si `equilibre`).
- `welcomeText` : quand focus ≠ equilibre, une phrase courte naturelle est
  insérée selon le focus (3 variantes rédigées, ton humain, sans tirets),
  ex. bas : « J'ai bien noté l'accent bas du corps et fessiers, le programme
  est orienté pour. »

## 6. Tests

- `programs.test.js` : zones présentes sur tous les exercices ; focus bas →
  au moins un exercice du pool bas dans chaque séance et séries des `bas`
  boostées ; haut/dos idem sur leurs zones ; equilibre/absent → identique à
  avant ; le boost plafonne à 5 ; toutes les 48 combinaisons (12 × 4 focus)
  produisent un programme valide.
- `onboarding.test.js` : focus invalide → 400 ; focus absent → 200 ;
  `welcomeText` varie avec focus ; résumé push contient le libellé.
- `Onboarding.test.jsx` : le parcours passe par la nouvelle étape (7 clics).

## 7. Hors périmètre

Choix par muscles précis, multi-sélection, modification du focus après coup
(passe par le coach), reflet du focus dans la vue Coach au-delà du push.

/* Onboarding completion — writes the coach's welcome message into the user's
   chat and notifies the coach. Idempotent via user.onboarded in db.json. */
import { appendMessage } from './chat-store.js';

const OBJECTIFS = { muscle: 'prise de muscle', force: 'force', forme: 'remise en forme' };
const NIVEAUX = ['debutant', 'inter'];
const JOURS = [2, 3, 4];
const MATERIELS = { salle: 'en salle', maison: 'avec haltères à la maison', pdc: 'au poids du corps' };
const FOCUS = { equilibre: null, bas: 'bas du corps et fessiers', haut: 'haut du corps', dos: 'dos et posture' };

// French on purpose: the coach speaks French (V1 target market).
// Written to read like a real DM typed on a phone: short sentences, no dashes,
// each objectif has its own shape and length so the three never feel templated.
export function welcomeText(name, a) {
  const j = a.jours;
  const mat = MATERIELS[a.materiel];
  const focusSentences = {
    bas: 'J\'ai bien noté que tu veux mettre l\'accent sur le bas du corps et les fessiers, ton programme est orienté pour.',
    haut: 'Et j\'ai vu que tu veux prioriser le haut du corps, c\'est prévu dans le programme.',
    dos: 'Tu m\'as dit vouloir bosser le dos et la posture, le programme insiste dessus, tu vas le sentir.'
  };
  const base = {
    muscle: `Salut ${name} ! Moi c'est Alexis, ton coach. Je viens de voir ton programme, prise de muscle sur ${j} séances par semaine ${mat}. Bon choix pour démarrer. ${a.focus && FOCUS[a.focus] ? focusSentences[a.focus] + ' ' : ''}Si t'as une question sur un exo ou une charge, écris-moi ici, je réponds dans la journée.`,
    force: `Salut ${name}, Alexis, ton coach. Ton programme force est posé, ${j} séances par semaine ${mat}. On va monter les charges petit à petit, la technique d'abord. ${a.focus && FOCUS[a.focus] ? focusSentences[a.focus] + ' ' : ''}Dès que t'as un doute sur un mouvement tu m'écris ici, je suis là pour ça.`,
    forme: `Salut ${name} ! Alexis, ton coach. J'ai vu ton programme remise en forme, ${j} séances par semaine ${mat}. Le plus dur c'est les 3 premières semaines, après ça roule tout seul. ${a.focus && FOCUS[a.focus] ? focusSentences[a.focus] + ' ' : ''}Si t'as la moindre question tu m'écris ici et je te réponds dans la journée.`
  }[a.objectif];
  return base;
}

const valid = a => a && OBJECTIFS[a.objectif] && NIVEAUX.includes(a.niveau)
  && JOURS.includes(+a.jours) && MATERIELS[a.materiel] && (a.focus === undefined || a.focus in FOCUS);

export function registerOnboardingRoutes(routes, deps) {
  const { DATA, db, saveDb, json, readSession, sendPush, isAdmin } = deps;

  routes['POST /api/onboarding/complete'] = async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await deps.readBody(req);
    const a = body.answers;
    if (!valid(a)) return json(res, 400, { error: 'invalid answers' });
    if (user.onboarded) return json(res, 200, { ok: true, already: true });
    appendMessage(DATA, user.id, 'coach', welcomeText(user.name, { ...a, jours: +a.jours }));
    user.onboarded = new Date().toISOString();
    saveDb();
    const resume = `${OBJECTIFS[a.objectif]} · ${a.niveau === 'debutant' ? 'débutant' : 'intermédiaire'} · ${a.jours}j · ${a.materiel}${a.focus && FOCUS[a.focus] ? ` · focus ${FOCUS[a.focus]}` : ''}`;
    for (const admin of db.users.filter(isAdmin)) {
      sendPush(admin.id, { title: `🆕 ${user.name} a fini l'onboarding`, body: resume, tag: 'chat', url: '#/coach' });
    }
    json(res, 200, { ok: true });
  };
}

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

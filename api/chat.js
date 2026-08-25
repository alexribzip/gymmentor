/* Coaching chat routes — client side (/api/chat/*) and coach side (/api/coach/*).
   Registered into server.js's flat route map; every server helper comes in via
   `deps` so this module has no reach into server.js's module-locals. */
import { loadChat, appendMessage, markRead, unreadFor } from './chat-store.js';

export const DISCOVERY_MSGS = 5;

export function registerChatRoutes(routes, deps) {
  const { DATA, db, saveDb, json, readSession, requireAdmin, isAdmin, sendPush, audit, readState, livePresence, RP_NAME } = deps;

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

  const q = req => new URL(req.url, 'http://x').searchParams;
  const after = (chat, id) => (id ? chat.messages.filter(m => m.id > id) : chat.messages);

  /* ---------- client ---------- */
  routes['GET /api/chat'] = async (req, res) => {
    const user = requireChatAccess(req, res); if (!user) return;
    const chat = loadChat(DATA, user.id);
    const out = { messages: after(chat, +q(req).get('after') || 0), lastReadCoach: chat.lastReadCoach };
    if (!user.coached) out.discovery = { used: chat.messages.filter(m => m.from === 'client').length, max: DISCOVERY_MSGS };
    json(res, 200, out);
  };

  routes['POST /api/chat'] = async (req, res) => {
    const user = requireChatAccess(req, res, { write: true }); if (!user) return;
    const body = await deps.readBody(req);
    let msg;
    try { msg = appendMessage(DATA, user.id, 'client', body.text); }
    catch (e) { return json(res, 400, { error: e.message }); }
    // Notify every admin — single coach today, harmless if there are several.
    for (const admin of db.users.filter(isAdmin)) {
      sendPush(admin.id, { title: '💬 ' + user.name, body: msg.text.slice(0, 120), tag: 'chat', url: '#/coach' });
    }
    json(res, 200, { message: msg });
  };

  routes['POST /api/chat/read'] = async (req, res) => {
    const user = requireChatAccess(req, res); if (!user) return;
    const body = await deps.readBody(req);
    markRead(DATA, user.id, 'client', body.upTo);
    json(res, 200, { ok: true });
  };

  routes['GET /api/chat/unread'] = async (req, res) => {
    const user = requireChatAccess(req, res); if (!user) return;
    json(res, 200, { n: unreadFor(loadChat(DATA, user.id), 'client') });
  };

  /* ---------- coach ---------- */
  routes['GET /api/coach/threads'] = async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const threads = db.users.filter(u => !isAdmin(u)).map(u => {
      const chat = loadChat(DATA, u.id);
      const last = chat.messages[chat.messages.length - 1] || null;
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      return {
        id: u.id, name: u.name, coached: !!u.coached, disabled: !!u.disabled,
        lastMsg: last ? { from: last.from, text: last.text.slice(0, 80), ts: last.ts } : null,
        unread: unreadFor(chat, 'coach'),
        lastWorkout: workouts.length ? workouts[workouts.length - 1].d : null,
        live: livePresence(u.id)
      };
    }).sort((a, b) => (b.lastMsg?.ts || 0) - (a.lastMsg?.ts || 0) || a.name.localeCompare(b.name));
    json(res, 200, { threads, now: Date.now() });
  };

  routes['GET /api/coach/thread'] = async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = q(req).get('id');
    if (!db.users.some(u => u.id === id)) return json(res, 404, { error: 'no such user' });
    const chat = loadChat(DATA, id);
    json(res, 200, { messages: after(chat, +q(req).get('after') || 0), lastReadClient: chat.lastReadClient });
  };

  routes['POST /api/coach/thread'] = async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await deps.readBody(req);
    const target = db.users.find(u => u.id === body.id);
    if (!target) return json(res, 404, { error: 'no such user' });
    let msg;
    try { msg = appendMessage(DATA, target.id, 'coach', body.text); }
    catch (e) { return json(res, 400, { error: e.message }); }
    sendPush(target.id, { title: '💬 ' + RP_NAME, body: msg.text.slice(0, 120), tag: 'chat', url: '#/chat' });
    json(res, 200, { message: msg });
  };

  routes['POST /api/coach/read'] = async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await deps.readBody(req);
    if (!db.users.some(u => u.id === body.id)) return json(res, 404, { error: 'no such user' });
    markRead(DATA, body.id, 'coach', body.upTo);
    json(res, 200, { ok: true });
  };

  routes['POST /api/coach/coached'] = async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await deps.readBody(req);
    const target = db.users.find(u => u.id === body.id);
    if (!target) return json(res, 404, { error: 'no such user' });
    if (isAdmin(target)) return json(res, 400, { error: 'cannot coach an admin' });
    target.coached = !!body.coached;
    saveDb();
    audit(req, target.coached ? 'admin.coached.on' : 'admin.coached.off', { user: admin, target });
    json(res, 200, { ok: true, id: target.id, coached: target.coached });
  };
}

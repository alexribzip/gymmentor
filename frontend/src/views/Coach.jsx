import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtVol, fmtDur } from '../lib/format.js'
import { fmtWhen } from '../lib/audit.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { mergeMessages, lastId } from '../lib/chat-core.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Poste de travail coach — français en dur : surface opérateur, hors packs i18n
// (même convention que Admin.jsx, qui est anglais en dur).

const THREADS_MS = 15000
const THREAD_MS = 20000

// Panneau latéral : les données d'entraînement du client, via l'endpoint admin existant.
function ClientData({ id }) {
  const [d, setD] = useState(null)
  useEffect(() => { api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(() => {}) }, [id])
  if (!d) return <div className="muted small">Chargement…</div>
  return <>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">Séances</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">Pesées</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">Poids</div><div className="v" style={{ fontSize: '1.1rem' }}>
        {d.bodyweight.length ? d.bodyweight[d.bodyweight.length - 1].w + ' ' + d.unit : '—'}</div></div>
    </div>
    <h4 className="sec">Dernières séances</h4>
    {d.workouts.slice(0, 10).map(w => <div key={w.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
      <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} séries{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
      <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
    </div>)}
    {!d.workouts.length && <div className="empty small">Aucune séance.</div>}
  </>
}

function Thread({ th, back, reloadThreads }) {
  const toast = useUI(s => s.toast)
  const [msgs, setMsgs] = useState([])
  const [lastReadClient, setLastReadClient] = useState(0)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showData, setShowData] = useState(false)
  const endRef = useRef(null)
  const msgsRef = useRef(msgs)
  msgsRef.current = msgs

  const load = () => api('/api/coach/thread?id=' + encodeURIComponent(th.id) + '&after=' + lastId(msgsRef.current))
    .then(r => {
      setLastReadClient(r.lastReadClient)
      const merged = mergeMessages(msgsRef.current, r.messages)
      setMsgs(merged)
      const newest = lastId(merged)
      if (newest) api('/api/coach/read', { method: 'POST', body: JSON.stringify({ id: th.id, upTo: newest }) }).catch(() => {})
    }).catch(() => {})

  useEffect(() => { load(); const iv = setInterval(load, THREAD_MS); return () => { clearInterval(iv); reloadThreads() } }, [th.id])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])

  const send = () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    api('/api/coach/thread', { method: 'POST', body: JSON.stringify({ id: th.id, text: body }) })
      .then(({ message }) => { setText(''); setMsgs(m => mergeMessages(m, [message])) })
      .catch(e => toast(e.message))
      .finally(() => setSending(false))
  }

  const lastMine = [...msgs].reverse().find(m => m.from === 'coach')
  return <div className="narrow chatview">
    <div className="hdr">
      <button className="iconbtn" onClick={back} aria-label="Retour"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}>
        <h1 style={{ margin: 0 }} className="capitalize">{th.name}</h1>
        <div className="sub">{th.live ? 's\'entraîne maintenant' : th.lastWorkout ? 'dernière séance ' + fmtDate(th.lastWorkout) : 'aucune séance'}</div>
      </div>
      <button className="iconbtn" onClick={() => setShowData(v => !v)} aria-label="Données"><Icon name="chart" /></button>
    </div>
    {showData && <div className="card"><ClientData id={th.id} /></div>}
    <div className="chatlog">
      {!msgs.length && <div className="empty small">Pas encore de messages.</div>}
      {msgs.map(m => <div key={m.id} className={'bubble' + (m.from === 'coach' ? ' mine' : '')}>
        {m.text}
        {m === lastMine && m.id <= lastReadClient && <div className="seen">Vu</div>}
      </div>)}
      <div ref={endRef} />
    </div>
    <div className="chatinput">
      <textarea rows={1} maxLength={2000} value={text} placeholder="Répondre…"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
      <button className="sendbtn" disabled={!text.trim() || sending} onClick={send} aria-label="Envoyer">
        <Icon name="arrowUp" />
      </button>
    </div>
  </div>
}

export default function Coach() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [threads, setThreads] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState(null)      // thread ouvert (objet de la liste)

  const load = () => api('/api/coach/threads').then(d => { setThreads(d.threads); setNow(d.now) }).catch(e => toast(e.message))
  useEffect(() => { if (!user?.admin) return; load(); const iv = setInterval(load, THREADS_MS); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const toggleCoached = th => api('/api/coach/coached', { method: 'POST', body: JSON.stringify({ id: th.id, coached: !th.coached }) })
    .then(() => { toast(th.coached ? 'Coaching désactivé' : 'Coaching activé'); load() })
    .catch(e => toast(e.message))

  if (open) return <Thread th={open} back={() => setOpen(null)} reloadThreads={load} />

  const unreadTotal = (threads || []).reduce((n, t) => n + t.unread, 0)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="Retour"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Coach</h1>
        <div className="sub">{threads ? threads.filter(t => t.coached).length + ' coachés · ' + unreadTotal + ' non lus' : 'Chargement…'}</div></div>
      <button className="iconbtn" onClick={load} aria-label="rafraîchir">↻</button>
    </div>
    <div className="list">
      {(threads || []).map(th => <div key={th.id} className="item" style={th.disabled ? { opacity: .55 } : null}>
        <div className="grow" onClick={() => th.coached && setOpen(th)}>
          <div className="tt">
            {th.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}
            <span className="capitalize">{th.name}</span>
            {th.unread > 0 && <span className="tag" style={{ marginLeft: 6, background: 'var(--red)', color: '#fff' }}>{th.unread}</span>}
          </div>
          <div className="ss">
            {th.lastMsg ? (th.lastMsg.from === 'coach' ? 'Toi : ' : '') + th.lastMsg.text + ' · ' + fmtWhen(th.lastMsg.ts, now)
              : th.coached ? 'Pas encore de messages' : 'Non coaché'}
          </div>
        </div>
        <Button size="sm" variant={th.coached ? undefined : 'primary'} onClick={() => toggleCoached(th)}>
          {th.coached ? 'Désactiver' : 'Activer'}
        </Button>
      </div>)}
      {threads && !threads.length && <div className="empty">Aucun client pour l'instant.</div>}
    </div>
  </div>
}

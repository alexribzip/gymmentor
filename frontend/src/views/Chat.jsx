import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import { mergeMessages, lastId } from '../lib/chat-core.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const POLL_MS = 20000
// Where a non-subscriber reaches the coach — swap for a Stripe/landing link later.
export const CONTACT_URL = 'mailto:alexis.riberypro@gmail.com'

// Guest mode keeps everything in the browser — the chat needs a server profile.
function AccountGate() {
  return <div className="narrow">
    <div className="hdr"><h1>{t('Coach')}</h1></div>
    <div className="card" style={{ textAlign: 'center', padding: '28px 18px' }}>
      <div style={{ fontSize: 34, color: 'var(--label-3)' }}><Icon name="chat" /></div>
      <h3>{t('Chat needs an account')}</h3>
      <p className="muted small">{t('Create your profile to talk to your coach. Your workouts sync too.')}</p>
      <Button variant="primary" onClick={() => nav('/settings')}>{t('Create profile')}</Button>
    </div>
  </div>
}

// The sales pitch body — reused full-screen (no messages yet) and inline once a
// non-coached user's discovery quota runs out (replaces the message input).
function UpsellCard() {
  return <div className="card" style={{ padding: '24px 18px' }}>
    <h3 style={{ marginTop: 0 }}>{t('Your personal coach')}</h3>
    <ul className="small" style={{ paddingLeft: 18, margin: '10px 0 16px', display: 'grid', gap: 8 }}>
      <li>{t('A real coach who follows your training')}</li>
      <li>{t('He sees your workouts and adjusts your plan')}</li>
      <li>{t('Unlimited messages, answers within the day')}</li>
    </ul>
    <a className="btn primary" style={{ display: 'block', textAlign: 'center' }} href={CONTACT_URL}>{t('Get coaching')}</a>
  </div>
}

// The in-app sales pitch — what a paying subscriber gets.
function Upsell() {
  return <div className="narrow">
    <div className="hdr"><h1>{t('Coach')}</h1></div>
    <UpsellCard />
  </div>
}

function Conversation({ coached }) {
  const [msgs, setMsgs] = useState([])
  const [lastReadCoach, setLastReadCoach] = useState(0)
  const [discovery, setDiscovery] = useState(null) // non-coached only: {used, max}
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const toast = useUI(s => s.toast)
  const setChatUnread = useUI(s => s.setChatUnread)
  const endRef = useRef(null)
  const msgsRef = useRef(msgs)
  msgsRef.current = msgs

  const load = () => api('/api/chat?after=' + lastId(msgsRef.current)).then(r => {
    setLastReadCoach(r.lastReadCoach)
    setDiscovery(r.discovery || null)
    const merged = mergeMessages(msgsRef.current, r.messages)
    setMsgs(merged)
    // Everything on screen counts as read; keep the tab badge honest right away.
    const newest = lastId(merged)
    if (newest) api('/api/chat/read', { method: 'POST', body: JSON.stringify({ upTo: newest }) }).catch(() => {})
    setChatUnread?.(0)
  }).catch(() => {})

  useEffect(() => { load(); const iv = setInterval(load, POLL_MS); return () => clearInterval(iv) }, [])
  useEffect(() => {
    const el = endRef.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'end' })
  }, [msgs.length])

  const send = () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    api('/api/chat', { method: 'POST', body: JSON.stringify({ text: body }) })
      .then(({ message }) => { setText(''); setMsgs(m => mergeMessages(m, [message])) })
      .catch(e => {
        // Quota just ran out server-side — reflect it locally without waiting for a re-fetch.
        if (e.status === 403) setDiscovery(d => d && { ...d, used: d.max })
        toast(e.message)
      })
      .finally(() => setSending(false))
  }

  // Non-coached account with nothing to show yet (no messages, quota untouched) — the
  // regular upsell screen, same as before onboarding existed.
  if (!coached && msgs.length === 0 && discovery && discovery.used === 0) return <Upsell />

  const quotaExhausted = discovery && discovery.used >= discovery.max
  const lastMine = [...msgs].reverse().find(m => m.from === 'client')
  return <div className="narrow chatview">
    <div className="hdr"><h1>{t('Coach')}</h1></div>
    {discovery && discovery.used < discovery.max && <div className="card small" style={{ padding: '10px 14px', marginBottom: 10 }}>
      {t('Discovery: {0} messages left with your coach', discovery.max - discovery.used)}
    </div>}
    <div className="chatlog">
      {!msgs.length && <div className="empty small">{t('Say hi, your coach reads everything.')}</div>}
      {msgs.map(m => <div key={m.id} className={'bubble' + (m.from === 'client' ? ' mine' : '')}>
        {m.text}
        {m === lastMine && m.id <= lastReadCoach && <div className="seen">{t('Seen')}</div>}
      </div>)}
      <div ref={endRef} />
    </div>
    {quotaExhausted ? <UpsellCard /> : <div className="chatinput">
      <textarea rows={1} maxLength={2000} value={text} placeholder={t('Write a message…')}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
      <button className="sendbtn" disabled={!text.trim() || sending} onClick={send} aria-label={t('Send')}>
        <Icon name="arrowUp" />
      </button>
    </div>}
  </div>
}

export default function Chat() {
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && isGuest) return <AccountGate />
  return <Conversation coached={!!user?.coached} />
}

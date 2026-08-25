import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
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
  const config = useStore(s => s.config)
  return <div className="card" style={{ padding: '24px 18px' }}>
    <h3 style={{ marginTop: 0 }}>{t('Your personal coach')}</h3>
    <ul className="small" style={{ paddingLeft: 18, margin: '10px 0 16px', display: 'grid', gap: 8 }}>
      <li>{t('A real coach who follows your training')}</li>
      <li>{t('He sees your workouts and adjusts your plan')}</li>
      <li>{t('Unlimited messages, answers within the day')}</li>
    </ul>
    {config?.billing ? <>
      <a className="btn primary" style={{ display: 'block', textAlign: 'center' }} href="/api/billing/checkout">{t('Subscribe · 14,90 €/month')}</a>
      <div className="dim small" style={{ textAlign: 'center', marginTop: 8 }}>{t('No commitment, cancel anytime in one tap.')}</div>
    </> : <a className="btn primary" style={{ display: 'block', textAlign: 'center' }} href={CONTACT_URL}>{t('Get coaching')}</a>}
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

const CHECKOUT_POLL_MS = 2000
const CHECKOUT_POLL_TRIES = 5

export default function Chat() {
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const toast = useUI(s => s.toast)
  const loc = useLocation()
  const handledSearch = useRef(null)

  // Stripe redirects back to /#/chat?sub=ok|err. `coached` flips server-side once the webhook
  // lands, which can trail the redirect by a couple seconds — so on sub=ok we poll /api/me for
  // it instead of trusting the redirect alone, then clean the query either way.
  useEffect(() => {
    if (!loc.search || handledSearch.current === loc.search) return
    handledSearch.current = loc.search
    const sub = new URLSearchParams(loc.search).get('sub')
    if (sub === 'err') { toast(t('Payment failed or cancelled.')); nav('/chat'); return }
    if (sub !== 'ok') return
    toast(t('Payment confirmed, your coaching is activating…'))
    let stopped = false
    let timer = null
    let attempts = 0
    // nav('/chat') strips the query — which changes loc.search and re-runs this effect,
    // whose cleanup would kill the poll. So we only nav once the poll settles (success or
    // exhaustion), never right after starting it.
    const tick = () => {
      attempts++
      api('/api/me').then(me => {
        if (stopped) return
        if (me?.user?.coached) { useStore.getState().setUser(me.user); nav('/chat'); return }
        if (attempts < CHECKOUT_POLL_TRIES) timer = setTimeout(tick, CHECKOUT_POLL_MS)
        else nav('/chat')
      }).catch(() => {
        if (stopped) return
        if (attempts < CHECKOUT_POLL_TRIES) timer = setTimeout(tick, CHECKOUT_POLL_MS)
        else nav('/chat')
      })
    }
    tick()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [loc.search])

  if (!user && isGuest) return <AccountGate />
  return <Conversation coached={!!user?.coached} />
}

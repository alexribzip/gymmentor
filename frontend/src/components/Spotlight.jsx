import { useLayoutEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

// Post-onboarding tour: 3 dim-overlay steps anchoring existing UI. Session-only
// (never persisted) — closing the app mid-tour just ends it, no nagging.
const STEPS = [
  { sel: '#spot-week', text: '📅 Your week plan lives here' },
  { sel: '#tabbar .start', text: '▶️ Start your workout here on training days' },
  { sel: '#spot-coach-tab', text: '💬 Your coach already wrote to you' }
]

export default function Spotlight() {
  const on = useUI(s => s.spotlight)
  const setSpotlight = useUI(s => s.setSpotlight)
  const [i, setI] = useState(0)
  const [resolved, setResolved] = useState(null) // { idx, rect } once a live target is found

  // Resolve (and re-resolve on resize) the current step's target after commit —
  // querying the DOM during render can run before a sibling's initial mount lands.
  useLayoutEffect(() => {
    if (!on) { setResolved(null); return }

    // Skip steps whose target is missing; past the end → done.
    let idx = i
    while (idx < STEPS.length && !document.querySelector(STEPS[idx].sel)) idx++
    if (idx >= STEPS.length) { setSpotlight(false); setResolved(null); return }

    const update = () => {
      const target = document.querySelector(STEPS[idx].sel)
      setResolved(target ? { idx, rect: target.getBoundingClientRect() } : null)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [on, i])

  if (!on || !resolved) return null

  const { idx, rect: r } = resolved
  const next = () => (idx + 1 >= STEPS.length ? setSpotlight(false) : setI(idx + 1))

  return <div className="spotlight-overlay" onClick={next}>
    <div className="spotlight-hole" style={{ left: r.left - 8, top: r.top - 8, width: r.width + 16, height: r.height + 16 }} />
    <div className="spotlight-caption" style={{ top: Math.min(r.bottom + 18, window.innerHeight - 120) }}>
      <p>{t(STEPS[idx].text)}</p>
      <Button variant="primary" size="sm" onClick={next}>{idx + 1 >= STEPS.length ? t('OK') : t('Next')}</Button>
    </div>
  </div>
}

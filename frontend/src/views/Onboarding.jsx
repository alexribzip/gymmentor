import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import { buildProgram } from '../lib/programs.js'
import { exOr } from '../lib/exercises.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// 7-step first-program wizard. Writes into S via update(); the coach welcome
// message is requested fire-and-forget (retried at boot via S._onboardingPending).
const STEPS = ['welcome', 'objectif', 'focus', 'niveau', 'jours', 'materiel', 'preview']

const CHOICES = {
  objectif: [['muscle', 'Build muscle', '💪'], ['force', 'Get stronger', '🏋️'], ['forme', 'Get back in shape', '🔥']],
  focus: [['equilibre', 'Balanced, whole body', '⚖️'], ['bas', 'Lower body & glutes', '🍑'], ['haut', 'Upper body', '💪'], ['dos', 'Back & posture', '🧘']],
  niveau: [['debutant', "I'm new to this", '🌱'], ['inter', "I've trained before", '📈']],
  jours: [[2, '2 days / week', '🗓️'], [3, '3 days / week', '🗓️'], [4, '4 days / week', '🗓️']],
  materiel: [['salle', 'Full gym', '🏢'], ['maison', 'Dumbbells at home', '🏠'], ['pdc', 'Bodyweight only', '🤸']]
}

export default function Onboarding() {
  const update = useStore(s => s.update)
  const setSpotlight = useUI(s => s.setSpotlight)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})

  const later = () => { update(S => { S.onboarded = true }); nav('/home') }
  const pick = (key, value) => { setAnswers(a => ({ ...a, [key]: value })); setStep(s => s + 1) }

  const finish = () => {
    const program = buildProgram(answers)
    update(S => {
      S.routines = program.routines
      S.week = program.week
      S.onboarded = true
    })
    api('/api/onboarding/complete', { method: 'POST', body: JSON.stringify({ answers }) })
      .catch(() => update(S => { S._onboardingPending = answers }))
    setSpotlight?.(true)
    nav('/home')
  }

  const name = STEPS[step]
  const preview = name === 'preview' ? buildProgram(answers) : null

  return <div className="narrow" style={{ paddingTop: 24 }}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <div className="chips">{STEPS.map((s, i) => <span key={s} className={'chip' + (i <= step ? ' on' : '')} style={{ width: 22, padding: 0, height: 6, borderRadius: 3 }} />)}</div>
      <button className="small muted" onClick={later}>{t('Later')}</button>
    </div>

    {name === 'welcome' && <div className="card" style={{ textAlign: 'center', padding: '32px 18px' }}>
      <div style={{ fontSize: 40 }}>👋</div>
      <h2>{t("Let's build your first program")}</h2>
      <p className="muted small">{t('5 quick questions, about a minute.')}</p>
      <Button variant="primary" onClick={() => setStep(1)}>{t('Create my program')}</Button>
    </div>}

    {['objectif', 'focus', 'niveau', 'jours', 'materiel'].includes(name) && <div className="card" style={{ padding: '22px 16px' }}>
      <h3 style={{ marginTop: 0 }}>{{
        objectif: t("What's your goal?"), focus: t('Where do you want the focus?'), niveau: t('Your level?'),
        jours: t('How many days a week?'), materiel: t('What equipment do you have?')
      }[name]}</h3>
      <div className="list">
        {CHOICES[name].map(([value, label, emoji]) =>
          <button key={value} className="item" onClick={() => pick(name, value)}>
            <span style={{ fontSize: 22, marginRight: 10 }}>{emoji}</span>
            <span className="grow tt">{t(label)}</span>
            <Icon name="chevronRight" className="chev" />
          </button>)}
      </div>
    </div>}

    {name === 'preview' && <div className="card" style={{ padding: '22px 16px' }}>
      <h3 style={{ marginTop: 0 }}>{t('Your program')}</h3>
      {preview.routines.map(r => <div key={r.id} style={{ marginBottom: 12 }}>
        <div className="tt">{r.emoji && <Icon name={r.emoji} style={{ marginRight: 6 }} />}{r.name}</div>
        {r.ex.map(e => <div key={e.id} className="small muted" style={{ padding: '3px 0' }}>{exOr(e.id).n} · {e.sets}×{e.reps}</div>)}
      </div>)}
      <p className="small muted">{t('Your coach will review it. You can adjust everything later in Plan.')}</p>
      <Button variant="primary" onClick={finish}>{t("Let's go 💪")}</Button>
    </div>}
  </div>
}

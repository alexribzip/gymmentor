import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { api } from './lib/api.js'
import { ACCENTS } from './lib/format.js'
import { setLang, useLang, t } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { initBackButton } from './lib/back.js'
import { useWakeLock } from './lib/wakelock.js'
import { startFlow } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import Login from './views/Login.jsx'
import Onboarding from './views/Onboarding.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Chat from './views/Chat.jsx'
import Settings from './views/Settings.jsx'
import Admin from './views/Admin.jsx'
import Coach from './views/Coach.jsx'

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = theme === 'light' ? 'light' : 'dark'
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const update = useStore(s => s.update)
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  // First-run onboarding: a real (non-guest) user with no program yet gets routed to the
  // wizard until they finish it or skip via "Later" (both set S.onboarded).
  useEffect(() => {
    if (user && !isGuest && !S.onboarded && !(S.routines || []).length && loc.pathname !== '/onboarding') navigate('/onboarding')
  }, [user, S.onboarded, loc.pathname])
  // Retry the coach-handoff POST at boot if it failed when the wizard finished offline.
  useEffect(() => {
    const pending = S._onboardingPending
    if (!user || !pending) return
    api('/api/onboarding/complete', { method: 'POST', body: JSON.stringify({ answers: pending }) })
      .then(() => update(St => { delete St._onboardingPending }))
      .catch(() => {})
  }, [!!user])
  useEffect(() => { applyPrefs(S.theme, S.accent) }, [S.theme, S.accent])
  // French by default — GymMentor's launch market; the language picker in
  // Settings still lets anyone switch.
  useEffect(() => { setLang(S.lang || 'fr') }, [S.lang])
  useEffect(() => { document.documentElement.lang = S.lang || 'fr' }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // OAuth callback may bounce here when the instance is invite-only.
  useEffect(() => {
    if (loc.pathname === '/login-invite-required') {
      useUI.getState().toast(t('This app is invite-only — ask for an invite code.'))
      navigate('/home', { replace: true })
    }
  }, [loc.pathname])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  // Chat badge — light unread poll; push is the instant signal, this keeps the dot honest.
  const setChatUnread = useUI(s => s.setChatUnread)
  useEffect(() => {
    if (!user) return
    const load = () => { if (!document.hidden) api('/api/chat/unread').then(r => setChatUnread(r.n)).catch(() => {}) }
    load()
    const iv = setInterval(load, 60000)
    document.addEventListener('visibilitychange', load)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', load) }
  }, [!!user])

  const authed = user || isGuest
  if (!ready && !authed) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Icon name="dumbbell" />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {!authed ? <Login /> : (
            <Routes>
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Library />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="/coach" element={user?.admin ? <Coach /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          )}
        </ErrorBoundary>
      </div>
      <TabBar onStart={startFlow} />
      <RestTimer />
      <Modals />
      <Toast />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  // Android system back — sheet, then page, then press-again-to-exit (see lib/back.js)
  useEffect(() => {
    let stop = null, gone = false
    initBackButton().then(fn => { if (gone) fn(); else stop = fn })
    return () => { gone = true; stop?.() }
  }, [])
  return <HashRouter><Shell /></HashRouter>
}

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  S: { routines: [], week: {}, workouts: [], bodyweight: [] },
  update: vi.fn(mut => { mut(mocks.S) }),
  api: vi.fn(() => Promise.resolve({ ok: true })),
  nav: vi.fn(),
  confirmSheet: vi.fn(opts => opts.onConfirm())
}))
vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: mocks.S, user: { id: 'u1', name: 'Marc', coached: false }, update: mocks.update, isGuest: () => false })
}))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: () => {}, setSpotlight: () => {} }) }))
vi.mock('../lib/api.js', () => ({ api: (...a) => mocks.api(...a) }))
vi.mock('../lib/nav.js', () => ({ nav: (...a) => mocks.nav(...a) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: (...a) => mocks.confirmSheet(...a) }))

import Onboarding from './Onboarding.jsx'

let dom, root, host
beforeEach(() => {
  dom = parseHTML('<!doctype html><html><body></body></html>')
  globalThis.document = dom.document
  globalThis.window = dom.window
  host = dom.document.createElement('div')
  dom.document.body.appendChild(host)
})
afterEach(() => { act(() => root?.unmount()); vi.clearAllMocks(); mocks.S = { routines: [], week: {}, workouts: [], bodyweight: [] } })
const render = () => act(() => { root = createRoot(host); root.render(<Onboarding />) })
const click = txt => act(() => {
  const b = [...host.querySelectorAll('button')].find(b => b.textContent.includes(txt))
  b.dispatchEvent(new dom.window.Event('click', { bubbles: true }))
})

describe('Onboarding wizard', () => {
  it('walks the 7 steps and writes the program', async () => {
    render()
    click('Create my program')  // step 1 → 2
    click('muscle')            // objectif → « Build muscle »
    click('Lower body')        // focus → « Lower body & glutes »
    click('new to this')       // niveau → « I'm new to this »
    click('3 days')            // jours → « 3 days / week »
    click('Full gym')          // materiel → « Full gym »
    // step 7: preview — the program is visible then confirmed
    click("Let's go")          // « Let's go 💪 »
    await act(async () => { await Promise.resolve() })
    expect(mocks.S.routines.length).toBeGreaterThan(0)
    expect(Object.keys(mocks.S.week).length).toBe(3)
    expect(mocks.S.onboarded).toBe(true)
    const call = mocks.api.mock.calls.find(c => c[0] === '/api/onboarding/complete')
    expect(call).toBeDefined()
    const body = JSON.parse(call[1].body)
    expect(body.answers.focus).toBe('bas')
    expect(mocks.nav).toHaveBeenCalledWith('/home')
  })
  it('re-run over an existing program asks for confirmation then replaces', async () => {
    mocks.S.routines = [{ id: 'old-routine', name: 'Ancien', emoji: 'barbell', ex: [{ id: '0043', sets: 3, reps: 10, weight: 0 }] }]
    mocks.S.week = { 1: 'old-routine' }
    mocks.S.onboarded = true
    render()
    click('Create my program')
    click('stronger')          // objectif → « Get stronger »
    click('Balanced')          // focus
    click('trained before')    // niveau
    click('2 days')            // jours
    click('Dumbbells')         // materiel
    click("Let's go")
    await act(async () => { await Promise.resolve() })
    expect(mocks.confirmSheet).toHaveBeenCalledTimes(1)
    expect(mocks.S.routines.some(r => r.id === 'old-routine')).toBe(false)
    expect(mocks.S.routines.length).toBeGreaterThan(0)
    expect(Object.keys(mocks.S.week).length).toBe(2)
  })
  it('first run does not ask for confirmation', async () => {
    render()
    click('Create my program')
    click('muscle')
    click('Balanced')
    click('new to this')
    click('3 days')
    click('Full gym')
    click("Let's go")
    await act(async () => { await Promise.resolve() })
    expect(mocks.confirmSheet).not.toHaveBeenCalled()
  })
  it('Later marks onboarded without writing a program', () => {
    render()
    click('Later')
    expect(mocks.S.onboarded).toBe(true)
    expect(mocks.S.routines.length).toBe(0)
    expect(mocks.nav).toHaveBeenCalledWith('/home')
  })
})

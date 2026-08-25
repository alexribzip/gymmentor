import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: null,
  isGuest: false,
  config: {},
  search: '',
  nav: vi.fn(),
  setUser: vi.fn(),
  api: vi.fn(() => Promise.resolve({ messages: [], lastReadCoach: 0 })) // coached-shaped default; non-coached tests set discovery explicitly
}))

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector({ user: mocks.user, isGuest: () => mocks.isGuest, config: mocks.config })
  useStore.getState = () => ({ setUser: mocks.setUser })
  return { useStore }
})
vi.mock('../store/useUI.js', () => ({
  useUI: selector => selector({ toast: () => {}, setChatUnread: () => {} })
}))
vi.mock('../lib/api.js', () => ({ api: (...a) => mocks.api(...a) }))
vi.mock('../lib/nav.js', () => ({ nav: (...a) => mocks.nav(...a) }))
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search: mocks.search }) }))

import Chat from './Chat.jsx'

let dom, root, host
beforeEach(() => {
  dom = parseHTML('<!doctype html><html><body></body></html>')
  globalThis.document = dom.document
  globalThis.window = dom.window
  host = dom.document.createElement('div')
  dom.document.body.appendChild(host)
  mocks.config = {}
  mocks.search = ''
})
afterEach(() => { act(() => root?.unmount()); vi.clearAllMocks() })

const render = () => act(() => { root = createRoot(host); root.render(<Chat />) })

describe('Chat view states', () => {
  it('guest → account gate', () => {
    mocks.user = null; mocks.isGuest = true
    render()
    expect(host.textContent).toContain('account')
  })
  it('signed-in non-coached → upsell', async () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: false }; mocks.isGuest = false
    mocks.api.mockImplementation(() => Promise.resolve({ messages: [], lastReadCoach: 0, discovery: { used: 0, max: 5 } }))
    render()
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('personal coach')
  })
  it('coached → conversation with input', () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: true }; mocks.isGuest = false
    render()
    expect(host.querySelector('textarea')).toBeTruthy()
    expect(mocks.api).toHaveBeenCalled()
  })
  it('coached → auto read-marks messages and shows Seen', async () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: true }; mocks.isGuest = false
    mocks.api.mockImplementation(path => path.startsWith('/api/chat?')
      ? Promise.resolve({ messages: [{ id: 1, from: 'client', text: 'yo', ts: 1 }, { id: 2, from: 'coach', text: 'salut', ts: 2 }], lastReadCoach: 1 })
      : Promise.resolve({ ok: true }))
    render()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(host.textContent).toContain('yo')
    expect(host.textContent).toContain('salut')
    const readCall = mocks.api.mock.calls.find(c => c[0] === '/api/chat/read')
    expect(readCall).toBeTruthy()
    expect(readCall[1].body).toContain('"upTo":2')
    expect(host.textContent).toContain('Seen')
  })
  it('non-coached with messages → conversation with discovery banner', async () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: false }; mocks.isGuest = false
    mocks.api.mockImplementation(path => path.startsWith('/api/chat?')
      ? Promise.resolve({ messages: [{ id: 1, from: 'coach', text: 'bienvenue', ts: 1 }], lastReadCoach: 0, discovery: { used: 2, max: 5 } })
      : Promise.resolve({ ok: true }))
    render()
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('bienvenue')
    expect(host.textContent).toContain('3')          // 5-2 messages restants
    expect(host.querySelector('textarea')).toBeTruthy()
  })
  it('signed-in non-coached, config.billing:true → UpsellCard shows checkout link with price', async () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: false }; mocks.isGuest = false; mocks.config = { billing: true }
    mocks.api.mockImplementation(() => Promise.resolve({ messages: [], lastReadCoach: 0, discovery: { used: 0, max: 5 } }))
    render()
    await act(async () => { await Promise.resolve() })
    const a = host.querySelector('a[href="/api/billing/checkout"]')
    expect(a).toBeTruthy()
    expect(a.textContent).toContain('14,90')
  })
  it('signed-in non-coached, config.billing:false → UpsellCard keeps mailto contact', async () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: false }; mocks.isGuest = false; mocks.config = { billing: false }
    mocks.api.mockImplementation(() => Promise.resolve({ messages: [], lastReadCoach: 0, discovery: { used: 0, max: 5 } }))
    render()
    await act(async () => { await Promise.resolve() })
    const a = host.querySelector('a[href^="mailto:"]')
    expect(a).toBeTruthy()
    expect(host.querySelector('a[href="/api/billing/checkout"]')).toBeFalsy()
  })
  it('non-coached with exhausted quota → readable thread, upsell instead of input', async () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: false }; mocks.isGuest = false
    mocks.api.mockImplementation(path => path.startsWith('/api/chat?')
      ? Promise.resolve({ messages: [{ id: 1, from: 'client', text: 'q', ts: 1 }], lastReadCoach: 1, discovery: { used: 5, max: 5 } })
      : Promise.resolve({ ok: true }))
    render()
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('personal coach')
    expect(host.querySelector('textarea')).toBeFalsy()
  })
})

describe('Chat view — checkout return (sub=ok)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('poll survives the interim nav and activates the user once coached flips true', async () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: false }; mocks.isGuest = false
    mocks.search = '?sub=ok'
    let meCalls = 0
    mocks.api.mockImplementation(path => {
      if (path === '/api/me') {
        meCalls++
        return meCalls === 1
          ? Promise.resolve({ user: { id: 'u1', name: 'Marc', coached: false } })
          : Promise.resolve({ user: { id: 'u1', name: 'Marc', coached: true } })
      }
      return Promise.resolve({ messages: [], lastReadCoach: 0 })
    })
    render()
    // Flush the first /api/me resolution (attempt #1, not coached yet).
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.nav).not.toHaveBeenCalled()

    // Drive the 2nd attempt (2s later) and flush the timer + promise chain it triggers.
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })

    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'u1', name: 'Marc', coached: true })
    expect(mocks.nav).toHaveBeenCalledWith('/chat')
    expect(mocks.setUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.nav.mock.invocationCallOrder[0])
  })
})

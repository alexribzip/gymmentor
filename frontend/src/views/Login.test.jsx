import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ config: null }))
// Login.jsx calls useStore() with NO selector (destructure { setUser, pullState, setGuest })
// AND useStore(s => s.config) WITH a selector — the mock must serve both shapes, unlike a
// selector-only stub that would throw on the no-arg call.
vi.mock('../store/useStore.js', () => ({
  useStore: Object.assign(
    selector => {
      const state = { setUser: () => {}, pullState: async () => {}, setGuest: () => {}, config: mocks.config }
      return selector ? selector(state) : state
    },
    { getState: () => ({ S: {} }) }
  ),
  hasData: () => false
}))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {}, openSheet: () => {} }) } }))
vi.mock('../lib/api.js', () => ({ webauthnOK: () => true, passkeyLogin: async () => ({}), passkeyRegister: async () => ({}), BIO: 'Face ID' }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'x' }))
vi.mock('../lib/guest.js', () => ({ guestAllowed: () => true }))

import Login from './Login.jsx'

let dom, root, host
beforeEach(() => {
  dom = parseHTML('<!doctype html><html><body></body></html>')
  globalThis.document = dom.document
  globalThis.window = dom.window
  host = dom.document.createElement('div')
  dom.document.body.appendChild(host)
})
afterEach(() => { act(() => root?.unmount()); vi.clearAllMocks() })
const render = () => act(() => { root = createRoot(host); root.render(<Login />) })

describe('Login Google button', () => {
  it('shows Continue with Google first when config.google is on', () => {
    mocks.config = { google: true }
    render()
    const a = host.querySelector('a[href="/api/auth/google"]')
    expect(a).toBeTruthy()
    expect(a.textContent).toContain('Google')
  })
  it('hides it when config.google is off', () => {
    mocks.config = { google: false }
    render()
    expect(host.querySelector('a[href="/api/auth/google"]')).toBeFalsy()
  })
})

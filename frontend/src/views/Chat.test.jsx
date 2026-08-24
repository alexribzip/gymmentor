import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: null,
  isGuest: false,
  api: vi.fn(() => Promise.resolve({ messages: [], lastReadCoach: 0 }))
}))

vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ user: mocks.user, isGuest: () => mocks.isGuest })
}))
vi.mock('../store/useUI.js', () => ({
  useUI: selector => selector({ toast: () => {}, setChatUnread: () => {} })
}))
vi.mock('../lib/api.js', () => ({ api: (...a) => mocks.api(...a) }))
vi.mock('../lib/nav.js', () => ({ nav: () => {} }))

import Chat from './Chat.jsx'

let dom, root, host
beforeEach(() => {
  dom = parseHTML('<!doctype html><html><body></body></html>')
  globalThis.document = dom.document
  globalThis.window = dom.window
  host = dom.document.createElement('div')
  dom.document.body.appendChild(host)
})
afterEach(() => { act(() => root?.unmount()); vi.clearAllMocks() })

const render = () => act(() => { root = createRoot(host); root.render(<Chat />) })

describe('Chat view states', () => {
  it('guest → account gate', () => {
    mocks.user = null; mocks.isGuest = true
    render()
    expect(host.textContent).toContain('account')
  })
  it('signed-in non-coached → upsell', () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: false }; mocks.isGuest = false
    render()
    expect(host.textContent).toContain('personal coach')
  })
  it('coached → conversation with input', () => {
    mocks.user = { id: 'u1', name: 'Marc', coached: true }; mocks.isGuest = false
    render()
    expect(host.querySelector('textarea')).toBeTruthy()
    expect(mocks.api).toHaveBeenCalled()
  })
})

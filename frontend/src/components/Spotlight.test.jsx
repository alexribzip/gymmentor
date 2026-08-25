import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spotlight: true, setSpotlight: vi.fn() }))
vi.mock('../store/useUI.js', () => ({
  useUI: selector => selector({ spotlight: mocks.spotlight, setSpotlight: mocks.setSpotlight })
}))
import Spotlight from './Spotlight.jsx'

let dom, root, host
beforeEach(() => {
  dom = parseHTML('<!doctype html><html><body><div id="spot-week"></div><div id="tabbar"><button class="start"></button></div><button id="spot-coach-tab"></button></body></html>')
  globalThis.document = dom.document
  globalThis.window = dom.window
  host = dom.document.createElement('div')
  dom.document.body.appendChild(host)
})
afterEach(() => { act(() => root?.unmount()); vi.clearAllMocks() })

describe('Spotlight', () => {
  it('renders the first step and advances to the end', () => {
    act(() => { root = createRoot(host); root.render(<Spotlight />) })
    expect(host.textContent).toContain('week')        // légende étape 1
    const next = [...host.querySelectorAll('button')].pop()
    act(() => next.dispatchEvent(new dom.window.Event('click', { bubbles: true })))
    act(() => { [...host.querySelectorAll('button')].pop().dispatchEvent(new dom.window.Event('click', { bubbles: true })) })
    act(() => { [...host.querySelectorAll('button')].pop().dispatchEvent(new dom.window.Event('click', { bubbles: true })) })
    expect(mocks.setSpotlight).toHaveBeenCalledWith(false)
  })
  it('renders nothing when spotlight is off', () => {
    mocks.spotlight = false
    act(() => { root = createRoot(host); root.render(<Spotlight />) })
    expect(host.textContent).toBe('')
    mocks.spotlight = true
  })
})

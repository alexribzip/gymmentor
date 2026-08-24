import { describe, expect, it } from 'vitest'
import { mergeMessages, lastId } from './chat-core.js'

const m = (id, from = 'client') => ({ id, from, text: 't' + id, ts: id })

describe('mergeMessages', () => {
  it('appends only unseen messages, ordered by id', () => {
    const out = mergeMessages([m(1), m(2)], [m(2), m(3)])
    expect(out.map(x => x.id)).toEqual([1, 2, 3])
  })
  it('returns the same array when nothing is new', () => {
    const base = [m(1)]
    expect(mergeMessages(base, [m(1)])).toBe(base)
    expect(mergeMessages(base, [])).toBe(base)
    expect(mergeMessages(base, undefined)).toBe(base)
  })
})

describe('lastId', () => {
  it('is 0 on empty and the max id otherwise', () => {
    expect(lastId([])).toBe(0)
    expect(lastId([m(1), m(4)])).toBe(4)
  })
})

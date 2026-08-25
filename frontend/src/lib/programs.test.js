import { describe, expect, it } from 'vitest'
import { buildProgram, REP_RANGES, WEEK_SLOTS, ZONES, FOCUS_ZONES, SWAP_POOLS } from './programs.js'

const OBJ = ['muscle', 'force', 'forme']
const NIV = ['debutant', 'inter']
const JOURS = [2, 3, 4]
const MAT = ['salle', 'maison', 'pdc']

describe('buildProgram', () => {
  it('always returns a valid program for every combination', () => {
    for (const objectif of OBJ) for (const niveau of NIV) for (const jours of JOURS) for (const materiel of MAT) {
      const p = buildProgram({ objectif, niveau, jours, materiel })
      expect(p.routines.length).toBeGreaterThan(0)
      for (const r of p.routines) {
        expect(r.id).toBeTruthy()
        expect(r.ex.length).toBeGreaterThanOrEqual(3)
        for (const e of r.ex) {
          expect(e.id).toMatch(/^\d{4}$/)
          expect(e.sets).toBeGreaterThanOrEqual(3)
          expect(e.weight).toBe(0)
        }
      }
      const days = Object.keys(p.week).map(Number)
      expect(days.length).toBeGreaterThan(0)
      for (const d of days) expect(p.routines.some(r => r.id === p.week[d])).toBe(true)
    }
  })
  it('reps follow the objectif range', () => {
    for (const objectif of OBJ) {
      const [lo, hi] = REP_RANGES[objectif]
      const p = buildProgram({ objectif, niveau: 'inter', jours: 3, materiel: 'salle' })
      for (const r of p.routines) for (const e of r.ex) {
        expect(e.reps).toBeGreaterThanOrEqual(lo)
        expect(e.reps).toBeLessThanOrEqual(hi)
      }
    }
  })
  it('debutant removes the last exercise of each session', () => {
    const inter = buildProgram({ objectif: 'muscle', niveau: 'inter', jours: 3, materiel: 'maison' })
    const deb = buildProgram({ objectif: 'muscle', niveau: 'debutant', jours: 3, materiel: 'maison' })
    for (let i = 0; i < deb.routines.length; i++)
      expect(deb.routines[i].ex.length).toBe(inter.routines[i].ex.length - 1)
  })
  it('week slots match the jours count after fallbacks', () => {
    expect(Object.keys(buildProgram({ objectif: 'muscle', niveau: 'inter', jours: 3, materiel: 'salle' }).week).map(Number).sort()).toEqual(WEEK_SLOTS[3])
    // bascules: 2j pdc → 3j pdc ; 4j maison → 3j maison ; 4j pdc → 3j pdc
    expect(Object.keys(buildProgram({ objectif: 'forme', niveau: 'debutant', jours: 2, materiel: 'pdc' }).week).length).toBe(3)
    expect(Object.keys(buildProgram({ objectif: 'muscle', niveau: 'inter', jours: 4, materiel: 'maison' }).week).length).toBe(3)
    expect(Object.keys(buildProgram({ objectif: 'force', niveau: 'inter', jours: 4, materiel: 'pdc' }).week).length).toBe(3)
  })
  it('3j salle reuses the starter PPL shape (3 distinct routines)', () => {
    const p = buildProgram({ objectif: 'muscle', niveau: 'inter', jours: 3, materiel: 'salle' })
    expect(p.routines.length).toBe(3)
    expect(new Set(p.routines.map(r => r.name)).size).toBe(3)
  })
})

describe('focus', () => {
  const base = { objectif: 'muscle', niveau: 'inter', jours: 3, materiel: 'maison' }

  it('every template and starter exercise has a zone', () => {
    for (const materiel of ['salle', 'maison', 'pdc']) for (const jours of [2, 3, 4]) {
      const p = buildProgram({ ...base, jours, materiel })
      for (const r of p.routines) for (const e of r.ex) expect(ZONES[e.id], e.id + ' sans zone').toBeTruthy()
    }
  })

  it('absent or equilibre focus leaves the program unchanged', () => {
    const a = buildProgram(base)
    const b = buildProgram({ ...base, focus: 'equilibre' })
    const strip = p => p.routines.map(r => r.ex.map(e => [e.id, e.sets, e.reps]))
    expect(strip(a)).toEqual(strip(b))
  })

  it('focus bas: boosted lower sets and a pool exercise in each session', () => {
    const eq = buildProgram(base)
    const bas = buildProgram({ ...base, focus: 'bas' })
    for (let i = 0; i < bas.routines.length; i++) {
      const ids = bas.routines[i].ex.map(e => e.id)
      expect(SWAP_POOLS.bas.maison.some(id => ids.includes(id))).toBe(true)
      // chaque exercice 'bas' déjà présent dans la version équilibrée gagne +1 série
      for (const e of eq.routines[i].ex) {
        if (ZONES[e.id] === 'bas') {
          const after = bas.routines[i].ex.find(x => x.id === e.id)
          if (after) expect(after.sets).toBe(Math.min(5, e.sets + 1))
        }
      }
    }
  })

  it('focus haut and dos boost their zones', () => {
    const haut = buildProgram({ ...base, focus: 'haut' })
    const dos = buildProgram({ ...base, focus: 'dos' })
    expect(haut.routines.some(r => r.ex.some(e => ['push', 'pull'].includes(ZONES[e.id]) && e.sets >= 4))).toBe(true)
    expect(dos.routines.some(r => r.ex.some(e => ZONES[e.id] === 'pull' && e.sets >= 4))).toBe(true)
  })

  it('all 48 combinations still produce valid programs', () => {
    for (const objectif of ['muscle', 'force', 'forme']) for (const niveau of ['debutant', 'inter'])
      for (const jours of [2, 3, 4]) for (const materiel of ['salle', 'maison', 'pdc'])
        for (const focus of ['equilibre', 'bas', 'haut', 'dos']) {
          const p = buildProgram({ objectif, niveau, jours, materiel, focus })
          for (const r of p.routines) {
            expect(r.ex.length).toBeGreaterThanOrEqual(3)
            for (const e of r.ex) { expect(e.sets).toBeLessThanOrEqual(5); expect(e.sets).toBeGreaterThanOrEqual(3) }
          }
        }
  })
})

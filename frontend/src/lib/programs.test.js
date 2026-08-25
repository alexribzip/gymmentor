import { describe, expect, it } from 'vitest'
import { buildProgram, REP_RANGES, WEEK_SLOTS } from './programs.js'

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

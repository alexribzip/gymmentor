// Onboarding program templates. One file, meant to be edited by the coach:
// each SPEC row is [exerciseId, sets, baseReps]. Reps are re-fitted to the
// objectif range and débutant drops the last exercise of each session.
import { uid } from './format.js'
import { starterRoutines } from './starter.js'

export const REP_RANGES = { force: [5, 8], muscle: [8, 12], forme: [12, 15] }
export const WEEK_SLOTS = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5] }

// Verified against EXDB (lib/exercises-data.js).
// 1760 dumbbell goblet squat · 0289 dumbbell bench press · 0293 dumbbell bent
// over row · 0290 dumbbell bench seated press · 1459 dumbbell romanian
// deadlift · 0336 dumbbell lunge · 0294 dumbbell biceps curl · 0334 dumbbell
// lateral raise · 0662 push-up · 0129 bench dip (knees bent) · 3013 low glute
// bridge on floor · 0630 mountain climber · 1160 burpee · 0274 crunch floor ·
// 2300 inverted row bent knees · 0043 barbell full squat (verified: barbell
// squat pattern, confirmed in EXDB) · PDC_SQUAT = 3119 potty squat (verified:
// simplest body weight squat pattern in EXDB — plain stand/lower "as if
// sitting on a chair", no jump/pistol/single-leg/support variant)
const PDC_SQUAT = '3119'

const FB_SALLE = [
  ['Full Body A', 'barbell', [['0043', 4, 10], ['0289', 3, 10], ['0293', 3, 10], ['0290', 3, 10], ['0274', 3, 15]]],
  ['Full Body B', 'dumbbell', [['1459', 4, 10], ['1760', 3, 10], ['0289', 3, 10], ['0334', 3, 12], ['0294', 3, 12]]]
]
const FB_MAISON = [
  ['Full Body A', 'dumbbell', [['1760', 4, 10], ['0289', 3, 10], ['0293', 3, 10], ['0290', 3, 10], ['0274', 3, 15]]],
  ['Full Body B', 'dumbbell', [['1459', 4, 10], ['0336', 3, 10], ['0293', 3, 10], ['0334', 3, 12], ['0294', 3, 12]]],
  ['Full Body C', 'dumbbell', [['1760', 4, 10], ['0290', 3, 10], ['1459', 3, 10], ['0662', 3, 12], ['0274', 3, 15]]]
]
const CIRCUIT_PDC = [
  ['Circuit A', 'figureStrength', [[PDC_SQUAT, 4, 12], ['0662', 3, 12], ['2300', 3, 10], ['3013', 3, 15], ['0274', 3, 15]]],
  ['Circuit B', 'figureRun', [['1160', 4, 10], ['0662', 3, 12], ['0630', 3, 20], ['0129', 3, 12], ['0274', 3, 15]]],
  ['Circuit C', 'figureStrength', [[PDC_SQUAT, 4, 12], ['2300', 3, 10], ['3013', 3, 15], ['0630', 3, 20], ['0129', 3, 12]]]
]
const UL_SALLE = [
  ['Upper', 'arm', [['0289', 4, 8], ['0293', 4, 10], ['0290', 3, 10], ['0334', 3, 12], ['0294', 3, 12]]],
  ['Lower', 'legs', [['0043', 4, 8], ['1459', 3, 10], ['0336', 3, 10], ['3013', 3, 15], ['0274', 3, 15]]]
]

const mk = spec => spec.map(([name, emoji, list]) =>
  ({ id: uid(), name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }))

const clampReps = (routines, [lo, hi]) => routines.map(r =>
  ({ ...r, ex: r.ex.map(e => ({ ...e, reps: Math.min(hi, Math.max(lo, e.reps)) })) }))

const trimForBeginner = routines => routines.map(r => ({ ...r, ex: r.ex.slice(0, -1) }))

// jours × materiel → squelette + jours réellement posés (bascules incluses)
function skeleton(jours, materiel) {
  if (materiel === 'pdc') return { routines: mk(CIRCUIT_PDC), jours: 3 }
  if (materiel === 'maison') return jours === 2
    ? { routines: mk(FB_MAISON.slice(0, 2)), jours: 2 }
    : { routines: mk(FB_MAISON), jours: 3 }
  // salle
  if (jours === 2) return { routines: mk(FB_SALLE), jours: 2 }
  if (jours === 4) return { routines: mk(UL_SALLE), jours: 4 }
  return { routines: starterRoutines(), jours: 3 }
}

export function buildProgram({ objectif, niveau, jours, materiel }) {
  const sk = skeleton(jours, materiel)
  let routines = clampReps(sk.routines, REP_RANGES[objectif] || REP_RANGES.muscle)
  if (niveau === 'debutant') routines = trimForBeginner(routines)
  const slots = WEEK_SLOTS[sk.jours]
  const week = {}
  slots.forEach((day, i) => { week[day] = routines[i % routines.length].id })
  return { routines, week }
}

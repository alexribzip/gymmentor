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

// Note: for débutant+pdc+focus bas, Circuit C loses its swapped-in exercise here
// (the sacrificed push sat last) — accepted: the zone boost and the other two
// sessions keep the focus expressed. Not a bug, do not "fix" without the spec.
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

// Zone of every exercise id used by the templates, the upstream starter PPL
// and the swap pools. bas = lower body · push/pull = upper · tronc = core
// (never boosted, never sacrificed). Ids outside this map count as tronc.
// Verified against EXDB (lib/exercises-data.js) id → n/bp/tg/eq — see
// task-1-report.md for the full verification table. 3433 "swimmer kicks v.2
// (male)" was removed from SWAP_POOLS.dos.pdc (it's bp:upper legs/tg:glutes,
// i.e. 'bas' not 'pull' — swapping it in for a sacrificed push inverted the
// dos focus) and dropped from this map since nothing references it anymore.
export const ZONES = {
  // templates + starter
  '0043': 'bas', '1459': 'bas', '1760': 'bas', '0336': 'bas', '3013': 'bas',
  '3119': 'bas', '0085': 'bas', '0739': 'bas', '0585': 'bas', '0586': 'bas', '0605': 'bas',
  '0289': 'push', '0290': 'push', '0334': 'push', '0662': 'push', '0129': 'push',
  '0025': 'push', '0047': 'push', '0426': 'push', '0241': 'push', '0251': 'push',
  '0293': 'pull', '2330': 'pull', '0294': 'pull', '2300': 'pull',
  '0027': 'pull', '1323': 'pull', '0031': 'pull', '0313': 'pull',
  '0274': 'tronc', '0630': 'tronc', '1160': 'tronc',
  // pools
  '1409': 'bas', '0431': 'bas', '0410': 'bas', '3645': 'bas', '3769': 'bas',
  '0437': 'pull', '0348': 'pull', '0259': 'push',
  '0180': 'pull', '0044': 'bas'
}

export const FOCUS_ZONES = { bas: ['bas'], haut: ['push', 'pull'], dos: ['pull'] }
const SACRIFICE = { bas: 'push', haut: 'bas', dos: 'push' }

export const SWAP_POOLS = {
  bas: { salle: ['1409', '0431'], maison: ['0431', '0410'], pdc: ['3645', '3769'] },
  haut: { salle: ['0437', '0348'], maison: ['0437', '0348'], pdc: ['0259', '0129'] },
  dos: { salle: ['0180', '0044'], maison: ['0348', '0293'], pdc: ['2300'] }
}

const zone = id => ZONES[id] || 'tronc'

// One swap per session: first exercise of the sacrificed zone is replaced by
// the first pool id not already in the session. No candidate → no swap.
function applySwap(routines, focus, materiel) {
  const pool = SWAP_POOLS[focus]?.[materiel]
  const sac = SACRIFICE[focus]
  if (!pool || !sac) return routines
  return routines.map(r => {
    const idx = r.ex.findIndex(e => zone(e.id) === sac)
    if (idx < 0) return r
    const ids = r.ex.map(e => e.id)
    const repl = pool.find(id => !ids.includes(id))
    if (!repl) return r
    const ex = r.ex.slice()
    ex[idx] = { ...ex[idx], id: repl }
    return { ...r, ex }
  })
}

const applyBoost = (routines, focus) => {
  const zones = FOCUS_ZONES[focus]
  if (!zones) return routines
  return routines.map(r => ({ ...r, ex: r.ex.map(e => zones.includes(zone(e.id)) ? { ...e, sets: Math.min(5, e.sets + 1) } : e) }))
}

export function buildProgram({ objectif, niveau, jours, materiel, focus = 'equilibre' }) {
  const sk = skeleton(jours, materiel)
  let routines = applySwap(sk.routines, focus, materiel)
  routines = clampReps(routines, REP_RANGES[objectif] || REP_RANGES.muscle)
  routines = applyBoost(routines, focus)
  if (niveau === 'debutant') routines = trimForBeginner(routines)
  const slots = WEEK_SLOTS[sk.jours]
  const week = {}
  slots.forEach((day, i) => { week[day] = routines[i % routines.length].id })
  return { routines, week }
}

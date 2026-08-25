import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { EXDB, BODYPARTS, allExercises, equipmentOf } from '../lib/exercises.js'
import { MUSCLES, MUSCLE_NAME, muscleGroupsOf } from '../lib/muscles.js'
import { bestWeightFor } from '../lib/history.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, addToRoutineSheet, customExSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export default function Library() {
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [mus, setMus] = useState('')
  const [eq, setEq] = useState('')
  const [shown, setShown] = useState(40)
  const ql = q.toLowerCase().trim()
  const base = allExercises(S).filter(e => (!bp || e.bp === bp) && (!ql || e.n.toLowerCase().includes(ql) || e.tg.includes(ql) || e.eq.includes(ql) || (e.desc || '').toLowerCase().includes(ql)))
  // A body part groups several muscles ("upper legs" holds glutes, quads,
  // hamstrings…): once one is picked, offer one pill per primary muscle in it.
  const primary = useMemo(() => {
    const m = new Map()
    for (const e of base) m.set(e.id, muscleGroupsOf(e)[0] || '')
    return m
  }, [S, bp, ql])
  const musOpts = bp ? MUSCLES.filter(mu => base.some(e => primary.get(e.id) === mu)) : []
  const musOn = musOpts.includes(mus) ? mus : ''
  const base2 = musOn ? base.filter(e => primary.get(e.id) === musOn) : base
  const eqOpts = equipmentOf(base2)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? base2.filter(e => e.eq === eqOn) : base2

  return <>
    <div className="hdr"><div><h1>{t('Exercises')}</h1><div className="sub">{t('{0} exercises with animations', EXDB.length)}</div></div></div>
    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} /></div>
    <div className="chips" style={{ marginBottom: musOpts.length > 1 || eqOpts.length > 1 ? 8 : 12 }}>
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setMus(''); setEq(''); setShown(40) }}>{t('All')}</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setMus(''); setEq(''); setShown(40) }}>{t(b)}</button>)}
    </div>
    {musOpts.length > 1 && <div className="chips" style={{ marginBottom: eqOpts.length > 1 ? 8 : 12 }}>
      <button className={'chip nocap' + (!musOn ? ' on' : '')} onClick={() => { setMus(''); setShown(40) }}>{t('All muscles')}</button>
      {musOpts.map(mu => <button key={mu} className={'chip' + (musOn === mu ? ' on' : '')} onClick={() => { setMus(mu); setShown(40) }}>{t(MUSCLE_NAME[mu])}</button>)}
    </div>}
    {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 12 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(40) }}>{t('Any equipment')}</button>
      {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(40) }}>{t(x)}</button>)}
    </div>}
    <div className="list">
      <div className="item" onClick={() => customExSheet(null, ex => exerciseDetailSheet(ex), q.trim())}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, no animation')}</div></div><Icon name="plus" className="chev" />
      </div>
      {f.slice(0, shown).map(e => {
        const best = bestWeightFor(S, e.id)
        return <div key={e.id} className="item" onClick={() => exerciseDetailSheet(e)}>
          <Thumb ex={e} />
          <div className="grow"><div className="tt capitalize">{e.n}</div><div className="ss capitalize">{t(e.tg || e.bp)} · {t(e.eq)}</div></div>
          {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
          <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); addToRoutineSheet(e) }}>{t('Plan')}</Button>
        </div>
      })}
      {f.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 10 }} /><Button onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
  </>
}

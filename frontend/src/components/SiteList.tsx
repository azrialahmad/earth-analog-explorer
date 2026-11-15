import { useEffect, useRef, useState } from 'react'
import type { RankedSite, Target } from '../types'
import { fmt, pct } from '../ui'
import './SiteList.css'

type SiteFilter = 'all' | 'known' | 'new'
const FILTERS: { key: SiteFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'known', label: 'Known' }, { key: 'new', label: 'New' },
]

export interface SiteListProps {
  ranked: RankedSite[]
  target: Target
  selectedId: string | null
  onSelect: (id: string) => void
  /** Compact context, all from config and current controls. */
  mainWindowKm: number
  weightsText: string
}

/**
 * The ranked Earth candidates for the current target, one row each, in engine order.
 * Selecting a row never scrolls the list or moves focus; changing the target goes back to the top.
 */
export default function SiteList({ ranked, target, selectedId, onSelect, mainWindowKm, weightsText }: SiteListProps) {
  const moon = target.body === 'moon'
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }) }, [target.id])
  // When the target itself has no terrain values, no site can be scored: say so once, not on every row.
  const targetEmpty = ranked.length > 0 && ranked[0].perParam.every(p => p.target === null)
  // Known analog test areas vs new candidates from the DEM scan (issue #48). Ranks stay the overall ranks.
  const knownCount = ranked.filter(r => r.site.known_analog).length
  const newCount = ranked.length - knownCount
  const [show, setShow] = useState<SiteFilter>('all')
  const shown = ranked.filter(r => show === 'all' || (show === 'known') === r.site.known_analog)

  return (
    <section className="sites" aria-labelledby="sites-title">
      <header className="sites-head">
        <h2 id="sites-title">Earth candidates</h2>
        <p>
          {newCount > 0
            ? <><span className="num">{knownCount}</span> known analogs and <span className="num">{newCount}</span> new candidates from our DEM scan</>
            : <><span className="num">{ranked.length}</span> sites in this app</>}
          , ranked by Terrain Match to <b>{target.name}</b> ({moon ? 'Moon' : 'Mars'}). Not a search of all of Earth.
        </p>
        <p className="sites-meta">
          <span><span className="num">{mainWindowKm} km</span> window</span>
          <span>{weightsText}</span>
          <span>{moon ? 'Low sun shown separately' : 'Lighting not compared (Mars)'}</span>
        </p>
        {newCount > 0 && (
          <div className="sites-filter" role="group" aria-label="Show sites">
            {FILTERS.map(f => (
              <button key={f.key} type="button" aria-pressed={show === f.key} onClick={() => setShow(f.key)}>
                {f.label} <span className="num">{f.key === 'all' ? ranked.length : f.key === 'known' ? knownCount : newCount}</span>
              </button>
            ))}
          </div>
        )}
      </header>
      {targetEmpty && (
        <p className="sites-note" role="status">{target.name} has no terrain values yet, so no Earth site can be scored against it.</p>
      )}
      <ol ref={listRef} className="sites-list" aria-label={`Earth sites ranked for ${target.name}`}>
        {shown.map(r => {
          const siteMissing = r.perParam.filter(p => p.site === null).length
          const valuesKnown = r.perParam.length - siteMissing
          const selected = r.site.id === selectedId
          return (
            <li key={r.site.id}>
              <button type="button" className="site-row" aria-pressed={selected} onClick={() => onSelect(r.site.id)}>
                <span className="rk num">{String(r.rank).padStart(2, '0')}</span>
                <span className="row-main">
                  <span className="nm">{r.site.name}</span>
                  <span className="row-facts">
                    <span className={`tm${r.terrainMatch === null ? ' missing-text' : ''}`}>
                      <span className="num">{r.terrainMatch === null ? 'not scored' : fmt(r.terrainMatch)}</span>{' '}
                      <span className="sub">Terrain Match</span>
                    </span>
                    {moon && <span className="sun num">{pct(r.lowSunShare)} low sun</span>}
                  </span>
                  {(r.warning.fired || siteMissing > 0 || newCount > 0 || r.site.known_analog) && (
                    <span className="chips">
                      {r.warning.fired && <span className="chip warn"><i aria-hidden="true" />Light mismatch</span>}
                      {siteMissing > 0 && <span className="chip dashed">{valuesKnown} of {r.perParam.length} values</span>}
                      {r.site.known_analog && <span className="chip">Known analog</span>}
                      {!r.site.known_analog && newCount > 0 && <span className="chip new">New candidate</span>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

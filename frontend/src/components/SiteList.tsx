import { useEffect, useRef } from 'react'
import type { RankedSite, Target } from '../types'
import { fmt, pct } from '../ui'
import './SiteList.css'

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

  return (
    <section className="sites" aria-labelledby="sites-title">
      <header className="sites-head">
        <h2 id="sites-title">Earth candidates</h2>
        <p>
          <span className="num">{ranked.length}</span> sites in this app, ranked by Terrain Match to <b>{target.name}</b>{' '}
          ({moon ? 'Moon' : 'Mars'}). Not a search of all of Earth.
        </p>
        <p className="sites-meta">
          <span><span className="num">{mainWindowKm} km</span> window</span>
          <span>{weightsText}</span>
          <span>{moon ? 'Low sun shown separately' : 'Lighting not compared (Mars)'}</span>
        </p>
      </header>
      {targetEmpty && (
        <p className="sites-note" role="status">{target.name} has no terrain values yet, so no Earth site can be scored against it.</p>
      )}
      <ol ref={listRef} className="sites-list" aria-label={`Earth sites ranked for ${target.name}`}>
        {ranked.map(r => {
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
                  {(r.warning.fired || siteMissing > 0 || r.site.known_analog) && (
                    <span className="chips">
                      {r.warning.fired && <span className="chip warn"><i aria-hidden="true" />Light mismatch</span>}
                      {siteMissing > 0 && <span className="chip dashed">{valuesKnown} of {r.perParam.length} values</span>}
                      {r.site.known_analog && <span className="chip">Known analog</span>}
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

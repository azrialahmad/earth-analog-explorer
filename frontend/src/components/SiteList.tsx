import { useEffect, useRef } from 'react'
import type { RankedSite, Target } from '../types'
import { fmt, pct } from '../ui'
import './SiteList.css'

export interface SiteListProps {
  ranked: RankedSite[]
  target: Target
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * Every loaded Earth site for the current target, one row each, in engine order (issue #95):
 * one list, no category filter. Window, weights and method limits are in the details pane.
 * Selecting a row never scrolls the list or moves focus; changing the target goes back to the top.
 */
export default function SiteList({ ranked, target, selectedId, onSelect }: SiteListProps) {
  const moon = target.body === 'moon'
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }) }, [target.id])
  // When the target itself has no terrain values, no site can be scored: say so once, not on every row.
  const targetEmpty = ranked.length > 0 && ranked[0].perParam.every(p => p.target === null)
  const listName = `Earth sites ranked by Terrain Match for ${target.name}`

  return (
    <div className="sites">
      {targetEmpty && (
        <p className="sites-note" role="status">{target.name} has no terrain values yet, so no Earth site can be scored against it.</p>
      )}
      {ranked.length === 0 ? (
        <p className="sites-note" role="status">No Earth sites are loaded.</p>
      ) : (
        <ol ref={listRef} className="sites-list" aria-label={listName}>
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
                    {(r.warning.fired || siteMissing > 0) && (
                      <span className="chips">
                        {r.warning.fired && <span className="chip warn"><i aria-hidden="true" />Light mismatch</span>}
                        {siteMissing > 0 && <span className="chip dashed">{valuesKnown} of {r.perParam.length} values</span>}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

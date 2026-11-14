import { useEffect, useRef } from 'react'
import type { RankedSite, Stability, Target } from '../types'
import { fmt, pct } from '../ui'
import './SiteShelf.css'

export interface SiteShelfProps {
  ranked: RankedSite[]
  stability: Stability
  body: Target['body']
  /** The current target; the shelf scrolls back to rank 1 when it changes. */
  targetId: string
  targetName: string
  selectedId: string | null
  onSelect: (id: string) => void
}

/** Two rings: outer = Terrain Match (teal), inner = low-sun share (amber, Moon only). Empty dashed ring = missing. */
function Rings({ tm, sun, moon }: { tm: number | null; sun: number | null; moon: boolean }) {
  const c1 = 2 * Math.PI * 27
  const c2 = 2 * Math.PI * 19
  return (
    <svg className="rings" viewBox="0 0 62 62" aria-hidden="true">
      <circle cx="31" cy="31" r="27" className={`track${tm === null ? ' empty' : ''}`} />
      {tm !== null && <circle cx="31" cy="31" r="27" className="ring-t" strokeDasharray={`${c1 * tm} ${c1}`} />}
      {moon && <circle cx="31" cy="31" r="19" className={`track sun${sun === null ? ' empty' : ''}`} />}
      {moon && sun !== null && <circle cx="31" cy="31" r="19" className="ring-s" strokeDasharray={`${c2 * sun} ${c2}`} />}
    </svg>
  )
}

export default function SiteShelf({ ranked, stability, body, targetId, targetName, selectedId, onSelect }: SiteShelfProps) {
  const moon = body === 'moon'
  const shelfRef = useRef<HTMLOListElement>(null)
  useEffect(() => { shelfRef.current?.scrollTo({ left: 0 }) }, [targetId])
  // When the target itself has no terrain values, no site can be scored: say so once, not on every card.
  const targetEmpty = ranked.length > 0 && ranked[0].perParam.every(p => p.target === null)
  return (
    <>
    {targetEmpty && (
      <p className="shelf-note glass" role="status">
        {targetName} has no terrain values yet, so no Earth site can be scored against it.
      </p>
    )}
    <ol ref={shelfRef} className="shelf" aria-label="Earth sites, ranked by Terrain Match">
      {ranked.map(r => {
        const stab = stability[r.site.id]
        // count only the site's own gaps; gaps on the target side are reported once above
        const siteMissing = r.perParam.filter(p => p.site === null).length
        const valuesKnown = r.perParam.length - siteMissing
        return (
          <li key={r.site.id}>
            <button type="button" className="site-card glass" aria-pressed={r.site.id === selectedId} onClick={() => onSelect(r.site.id)}>
              <span className="rk num">{String(r.rank).padStart(2, '0')}</span>
              <span className="stab num">{r.terrainMatch === null ? 'not scored' : stab === undefined ? 'stability missing' : `top-3 ${pct(stab)}`}</span>
              <span className="body">
                <Rings tm={r.terrainMatch} sun={moon ? r.lowSunShare : null} moon={moon} />
                <span>
                  <span className={`tm dot${r.terrainMatch === null ? ' is-missing' : ''}`}>{fmt(r.terrainMatch)}</span>
                  <span className="sub-label">Terrain Match</span>
                  <span className={`ss num${moon ? '' : ' na'}`}>
                    {moon ? `${pct(r.lowSunShare)} low sun` : 'Lighting: not applicable to Mars targets'}
                  </span>
                </span>
              </span>
              <span className="nm">
                <b>{r.site.name}</b>
                <span className="chips">
                  {r.site.known_analog && <span className="chip">Known analog</span>}
                  {siteMissing > 0 && <span className="chip dashed">{valuesKnown} of {r.perParam.length} values</span>}
                </span>
              </span>
              {r.warning.fired && <span className="flag" role="img" aria-label="Light mismatch warning" />}
            </button>
          </li>
        )
      })}
    </ol>
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
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
  // which ends have more cards past the edge, so the arrows show only when there is somewhere to go
  const [more, setMore] = useState({ start: false, end: false })
  const measure = () => {
    const el = shelfRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setMore(m => {
      const next = { start: el.scrollLeft > 4, end: el.scrollLeft < max - 4 }
      return m.start === next.start && m.end === next.end ? m : next
    })
  }
  useEffect(() => { shelfRef.current?.scrollTo({ left: 0 }); measure() }, [targetId])
  useEffect(measure, [ranked.length])
  useEffect(() => {
    const el = shelfRef.current
    if (!el) return
    // A mouse wheel scrolls up and down; turn that into sideways movement along the shelf.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return // trackpad swipes already scroll sideways
      const max = el.scrollWidth - el.clientWidth
      const dy = e.deltaY * (e.deltaMode === 1 ? 40 : 1)
      if (max <= 0 || (dy < 0 && el.scrollLeft <= 0) || (dy > 0 && el.scrollLeft >= max - 1)) return
      e.preventDefault()
      el.scrollBy({ left: dy, behavior: 'instant' })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', measure, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('wheel', onWheel); el.removeEventListener('scroll', measure) }
  }, [])
  const page = (dir: 1 | -1) => {
    const el = shelfRef.current
    if (!el) return
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: smooth ? 'smooth' : 'instant' })
  }
  // When the target itself has no terrain values, no site can be scored: say so once, not on every card.
  const targetEmpty = ranked.length > 0 && ranked[0].perParam.every(p => p.target === null)
  return (
    <>
    {targetEmpty && (
      <p className="shelf-note glass" role="status">
        {targetName} has no terrain values yet, so no Earth site can be scored against it.
      </p>
    )}
    <div className={`shelf-wrap${more.start ? ' more-start' : ''}${more.end ? ' more-end' : ''}`}>
    {/* mouse helpers only: keyboard users reach every card with Tab, which scrolls it into view */}
    <button type="button" className="shelf-nav prev glass" aria-label="Show earlier sites" tabIndex={-1} hidden={!more.start} onClick={() => page(-1)}>‹</button>
    <button type="button" className="shelf-nav next glass" aria-label="Show more sites" tabIndex={-1} hidden={!more.end} onClick={() => page(1)}>›</button>
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
                    {moon ? `${pct(r.lowSunShare)} low sun` : 'No lighting check on Mars'}
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
    </div>
    </>
  )
}

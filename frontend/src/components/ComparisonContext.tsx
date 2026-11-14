import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ComparisonSummary } from '../context/summary'
import { listText } from '../context/summary'
import './ComparisonContext.css'

export interface ComparisonContextProps {
  summary: ComparisonSummary
}

/**
 * The always-visible answer to "what am I looking at?": target, which Earth sites are ranked,
 * which terrain parameters and window drive Terrain Match, and how lighting is handled.
 * The longer method notes sit behind a disclosure button so they never compete with the ranking.
 */
export default function ComparisonContext({ summary: s }: ComparisonContextProps) {
  const moon = s.body === 'Moon'
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  // The explanation opens upward; cap its height to the room above the strip so it never runs off the top.
  const [room, setRoom] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const top = sectionRef.current?.getBoundingClientRect().top
      if (top !== undefined) setRoom(Math.max(120, top - 24))
    }
    measure()
    addEventListener('resize', measure)
    return () => removeEventListener('resize', measure)
  }, [open])
  const closeOnEscape = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || !open) return
    setOpen(false)
    toggleRef.current?.focus()
  }
  const weightsText = s.weights === 'adjusted' ? 'adjusted' : s.provisional ? 'provisional defaults' : 'defaults'

  return (
    <section ref={sectionRef} className="context glass" aria-labelledby="context-title" onKeyDown={closeOnEscape}>
      <p id="context-title" className="context-title">
        Earth sites ranked by terrain similarity to{' '}
        <b>{s.targetName}</b>{' '}
        <span className="context-body"><i className={`orb ${moon ? 'moon' : 'mars'}`} aria-hidden="true" />{s.body}</span>
      </p>

      <button
        ref={toggleRef}
        type="button"
        className="context-more"
        aria-expanded={open}
        aria-controls="context-explain"
        onClick={() => setOpen(o => !o)}
      >
        How to read this comparison
      </button>
      {/* opens upward over the scene, so the ranked cards below never move */}
      <div
        id="context-explain"
        className="context-explain"
        role="region"
        aria-label="How to read this comparison"
        tabIndex={0}
        hidden={!open}
        style={room === null ? undefined : { maxBlockSize: `min(${room}px, 460px)` }}
      >
        <ul>
          <li>
            <b>Terrain Match</b> is a weighted average of how close each Earth site&apos;s terrain values are to{' '}
            {s.targetName}&apos;s, from 0 to 1, where 1 means identical values. It uses{' '}
            {s.params.length
              ? <>{listText(s.params.map(p => `${p.label} [${p.unit}]`))} with the current weights ({weightsText})</>
              : 'no parameter right now, because every weight is 0'}
            . It is not a probability, a safety or suitability rating, or a claim that other mission conditions match.
            {s.unweighted.length > 0 && <> {listText(s.unweighted.map(p => p.label))} {s.unweighted.length === 1 ? 'has' : 'have'} weight 0 and do{s.unweighted.length === 1 ? 'es' : ''} not count.</>}
          </li>
          <li>
            <b>Which sites.</b> The list ranks only the {s.siteCount} Earth sites included in this app. It does not search the
            rest of Earth. The first card is the highest-ranked of these sites for {s.targetName} and these weights, not the best
            place on Earth.
          </li>
          <li>
            <b>Window.</b> The values come from the {s.mainWindowKm} km main analysis window.
            {s.otherWindowsKm.length > 0 && <> Data shows Terrain Match for the {listText(s.otherWindowsKm.map(w => `${w} km`))} {s.otherWindowsKm.length === 1 ? 'window' : 'windows'} for the selected site.</>}
          </li>
          <li>
            <b>Lighting.</b>{' '}
            {moon
              ? 'Low-sun share (the inner amber ring on each card) is a separate lighting comparison. It does not change Terrain Match or the order.'
              : 'Lighting comparison is not applicable to Mars targets, so it plays no part here.'}
          </li>
          <li>
            <b>3D view.</b> The scene shows the two terrains for orientation. Terrain Match comes from the parameter values above,
            not from the picture.
          </li>
          {s.provisional && (
            <li><b>Provisional.</b> The default weights, ranges and thresholds are marked provisional in the configuration; they are not final values.</li>
          )}
        </ul>
      </div>

      <dl className="context-facts">
        <div>
          <dt className="label">Sites</dt>
          <dd><span className="num">{s.siteCount}</span> in this app, not all of Earth</dd>
        </div>
        {/* Terrain and Weights fold into the disclosure on narrow screens (ComparisonContext.css) */}
        <div className="context-optional">
          <dt className="label">Terrain</dt>
          <dd>{s.params.length ? s.params.map(p => p.label).join(', ') : <span className="missing-text">none (all weights are 0)</span>}</dd>
        </div>
        <div>
          <dt className="label">Window</dt>
          <dd><span className="num">{s.mainWindowKm} km</span> main</dd>
        </div>
        <div className="context-optional">
          <dt className="label">Weights</dt>
          <dd>{weightsText}</dd>
        </div>
        <div>
          <dt className="label">Lighting</dt>
          <dd>{moon ? 'separate from Terrain Match' : 'not applicable on Mars'}</dd>
        </div>
      </dl>
    </section>
  )
}

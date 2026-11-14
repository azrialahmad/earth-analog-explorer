import { useEffect, useRef } from 'react'
import type { CardExplanation, Neighbour } from '../explain/card'
import { listText, ordinal } from '../explain/card'
import { Bar, fmt, fmtUnit, pct } from '../ui'
import './RankExplainer.css'

export interface RankExplainerProps {
  ex: CardExplanation
  onClose: () => void
}

const gapList = (gaps: Neighbour['ahead']) =>
  listText(gaps.map(g => `${g.label} (${fmt(g.mine)} vs ${fmt(g.theirs)})`))

/** One neighbour sentence: how far apart the two Terrain Match values are, and which parameters make the difference. */
function Compare({ me, n, dir }: { me: number; n: Neighbour; dir: 'above' | 'below' }) {
  const who = <b>#{n.rank} {n.name}</b>
  if (n.terrainMatch === null) return <li>Sites from {who} down have no score, so they are listed after every scored site.</li>
  if (n.tie) return <li>Same Terrain Match as {who} (<span className="num">{fmt(n.terrainMatch)}</span>). Equal scores are put in site-id order.</li>
  const gap = Math.abs(me - n.terrainMatch)
  return (
    <li>
      <span className="num">{fmt(gap)}</span> {dir === 'above' ? 'below' : 'above'} {who} (<span className="num">{fmt(n.terrainMatch)}</span>).
      {n.ahead.length > 0 && <> This site is closer on {gapList(n.ahead)}.</>}
      {n.behind.length > 0 && <> {n.name} is closer on {gapList(n.behind)}.</>}
    </li>
  )
}

/**
 * Explains the numbers on the selected site card: Terrain Match, its rank, top-3 stability and low sun.
 * Every number is the engine's own output or a config value; this view never recalculates a score.
 */
export default function RankExplainer({ ex, onClose }: RankExplainerProps) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const tm = ex.terrainMatch
  const used = ex.params.filter(p => p.similarity !== null && p.weight > 0)
  const weightSum = used.reduce((s, p) => s + p.weight, 0)
  const weightsText = ex.weights === 'adjusted' ? 'your adjusted weights' : ex.provisional ? 'the provisional default weights' : 'the default weights'

  return (
    <section
      ref={ref}
      id="rank-explainer"
      className="explainer panel glass"
      role="dialog"
      aria-labelledby="explainer-title"
      tabIndex={-1}
    >
      <header>
        <div>
          <span className="label">Rank {String(ex.rank).padStart(2, '0')} of {ex.total} · {ex.targetName}</span>
          <h2 id="explainer-title">
            {tm === null ? `Why ${ex.siteName} has no score` : `Why ${ex.siteName} ranks ${ordinal(ex.rank)}`}
          </h2>
        </div>
        <button type="button" className="close" aria-label="Close explanation" onClick={onClose}>×</button>
      </header>

      <section aria-labelledby="ex-tm">
        <h3 id="ex-tm"><span className="label">Terrain Match</span> <span className={`big num${tm === null ? ' missing-text' : ''}`}>{fmt(tm)}</span></h3>
        <p>
          How close this site&apos;s terrain is to {ex.targetName}, as a weighted average over the terrain parameters in
          the {ex.mainWindowKm} km main window, using {weightsText}. Each parameter&apos;s similarity is 1 for identical values
          and falls to 0 at its range apart. It is a terrain similarity, not a probability or a safety or suitability rating.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Parameter</th><th>Site</th><th>Target</th><th>Similarity</th><th>Weight</th></tr></thead>
            <tbody>
              {ex.params.map(p => (
                <tr key={p.key}>
                  <td>{p.label}<div className="src">0 at {fmtUnit(p.range, p.unit)} apart</div></td>
                  <td className="num">{p.site === null ? <span className="missing-text">missing</span> : fmtUnit(p.site, p.unit)}</td>
                  <td className="num">{p.target === null ? <span className="missing-text">missing</span> : fmtUnit(p.target, p.unit)}</td>
                  <td className="num">{fmt(p.similarity)}<Bar value={p.similarity} label={`${p.label} similarity`} /></td>
                  <td className="num">{fmt(p.weight, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tm !== null && used.length > 0 && (
          <p className="formula num" aria-label={`Terrain Match is the weighted average of the similarities: ${fmt(tm)}`}>
            ({used.map(p => `${fmt(p.weight, 1)} × ${fmt(p.similarity)}`).join(' + ')}) ÷ {fmt(weightSum, 1)} = {fmt(tm)}
          </p>
        )}
        {ex.missing.length > 0 && (
          <p className="note">
            {listText(ex.missing)} {ex.missing.length === 1 ? 'is' : 'are'} left out because a value is missing
            (completeness <span className="num">{pct(ex.completeness)}</span>).
          </p>
        )}
      </section>

      <section aria-labelledby="ex-rank">
        <h3 id="ex-rank" className="label">{tm === null ? 'Rank' : `Why ${ordinal(ex.rank)}`}</h3>
        {tm === null ? (
          <p>No parameter has a value for both this site and {ex.targetName}, so it cannot be scored and is listed after every scored site.</p>
        ) : (
          <ul>
            {ex.above === null && (
              <li>
                Highest Terrain Match of the {ex.total} Earth sites in this app for {ex.targetName} with these weights. That makes it the
                closest terrain match in this set, not the best or safest place on Earth.
              </li>
            )}
            {ex.above && <Compare me={tm} n={ex.above} dir="above" />}
            {ex.below && <Compare me={tm} n={ex.below} dir="below" />}
          </ul>
        )}
      </section>

      <section aria-labelledby="ex-stab">
        <h3 id="ex-stab"><span className="label">Top-{ex.topN} stability</span> <span className="num">{tm === null ? 'not scored' : pct(ex.stability)}</span></h3>
        {tm === null ? <p>Not computed for a site without a score.</p> : (
          <p>
            In {ex.stabilityRuns} reruns, the weights were randomly varied around the current ones and every site&apos;s terrain values
            were shifted by up to ±{Math.round(ex.noiseRel * 100)}%. This site stayed in the top {ex.topN} in{' '}
            {ex.stability === null ? <span className="missing-text">missing</span> : pct(ex.stability)} of them. It shows how sensitive the
            rank is to those choices; it is not a probability.
          </p>
        )}
      </section>

      <section aria-labelledby="ex-sun">
        {ex.lowSun ? (
          <>
            <h3 id="ex-sun"><span className="label">Low sun</span> <span className="num sun">{pct(ex.lowSun.site)}</span></h3>
            <p>
              Share of daylight hours with the sun under 10° at this site; {ex.targetName}: <span className="num">{pct(ex.lowSun.target)}</span>.
              It is a separate lighting comparison and does not change Terrain Match or the rank.
            </p>
            {ex.warning.fired && (
              <p className="warning" role="note">
                {ex.warning.text} The flag shows when Terrain Match is at least <span className="num">{fmt(ex.warning.terrainMatchMin)}</span> and
                low sun is under <span className="num">{pct(ex.warning.lowSunMax)}</span>.
              </p>
            )}
          </>
        ) : (
          <>
            <h3 id="ex-sun" className="label">Lighting</h3>
            <p>Lighting comparison is not applicable to Mars targets, so it plays no part in this ranking.</p>
          </>
        )}
      </section>

      <p className="foot">
        Ranked among the {ex.total} Earth sites in this app, not a search of all of Earth.
        {ex.provisional && ' Weights, ranges and thresholds are provisional defaults.'} The 3D view is for orientation; these numbers
        come from the terrain values above. Data shows sources and the other window sizes.
      </p>
    </section>
  )
}

import type { CardExplanation, Neighbour } from '../explain/card'
import { listText, ordinal } from '../explain/card'
import { Bar, fmt, fmtUnit, pct, TierBadge } from '../ui'
import WhyText from './WhyText'
import './SiteDetails.css'

export interface SiteDetailsProps {
  /** Null when there is no selected site (for example an empty site list). */
  ex: CardExplanation | null
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

/** Coordinates no more precise than the site's caveat allows. */
function coords(lat: number, lon: number, approximate: boolean): string {
  const d = approximate ? 2 : 3
  const c = `${Math.abs(lat).toFixed(d)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(d)}°${lon >= 0 ? 'E' : 'W'}`
  return approximate ? `≈ ${c} (approximate)` : c
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The selected site's details and interpretation, always visible. Starts with the site itself
 * (name, rank, Terrain Match), then why it ranks there, the per-parameter breakdown, lighting,
 * reliability and sources. Every number is the engine's own output or a config value.
 */
export default function SiteDetails({ ex }: SiteDetailsProps) {
  if (!ex) {
    return (
      <section className="details" aria-label="Selected site">
        <p className="details-empty">No Earth site is selected.</p>
      </section>
    )
  }
  const tm = ex.terrainMatch
  const used = ex.params.filter(p => p.similarity !== null && p.weight > 0)
  const weightSum = used.reduce((s, p) => s + p.weight, 0)
  const weightsText = ex.weights === 'adjusted' ? 'your adjusted weights' : ex.provisional ? 'the provisional default weights' : 'the default weights'
  const otherFlags = ex.site.flags.filter(f => f !== 'coordinates approximate')

  return (
    <section className="details" aria-labelledby="details-name">
      {/* stays at the top while the rest scrolls, so the site being explained is always clear */}
      <header className="details-id">
        <span className="label">Rank {String(ex.rank).padStart(2, '0')} of {ex.total} · for {ex.targetName}</span>
        <h2 id="details-name">{ex.siteName}</h2>
        <p className="tm-line">
          <span className={`big num${tm === null ? ' missing-text' : ''}`}>{tm === null ? 'not scored' : fmt(tm)}</span>
          <span className="label">Terrain Match</span>
        </p>
      </header>

      <div className="details-body">
        <section aria-label="Site">
          <p className="coords num">{coords(ex.site.lat, ex.site.lon, ex.site.coordsApproximate)}</p>
          <WhyText why={ex.site.why} kind={ex.site.whyKind} targetName={ex.targetName} />
          <p className="note entry-source">
            {ex.site.knownAnalog
              ? <>Entry source: the project&apos;s initial list of places reported as analog test areas. Being on that list is
                not an independent check of this site&apos;s terrain.</>
              : <>Entry source: picked by this project&apos;s terrain scan of a limited set of DEM tiles (issue #48). Not a
                search of all of Earth, and not checked on imagery or in the field.</>}
          </p>
          {otherFlags.length > 0 && (
            <ul className="flags" aria-label="Site caveats">
              {otherFlags.map(f => <li key={f} className="chip caveat">{sentence(f)}</li>)}
            </ul>
          )}
        </section>

        <section aria-labelledby="ex-rank">
          <h3 id="ex-rank" className="label">{tm === null ? 'Not scored' : `Ranked ${ordinal(ex.rank)}`}</h3>
          <p>
            Terrain Match is how close this site&apos;s terrain is to {ex.targetName}: a weighted average of per-parameter
            similarity in the {ex.mainWindowKm} km window, using {weightsText}. It is a terrain similarity, not a probability or a
            safety or suitability rating.
          </p>
          {tm === null ? (
            <p>No parameter has a value for both this site and {ex.targetName}, so it cannot be scored and is listed after every scored site.</p>
          ) : (
            <ul>
              {ex.above === null && (
                <li>
                  Highest Terrain Match of the {ex.total} Earth sites in this app for {ex.targetName} with these weights: the closest
                  terrain match in this set, not the best or safest place on Earth.
                </li>
              )}
              {ex.above && <Compare me={tm} n={ex.above} dir="above" />}
              {ex.below && <Compare me={tm} n={ex.below} dir="below" />}
            </ul>
          )}
        </section>

        <section aria-labelledby="ex-params">
          <h3 id="ex-params" className="label">Parameters</h3>
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
          <p className="note">Each similarity is 1 for identical values and falls to 0 at the range shown.</p>
          {tm !== null && used.length > 0 && (
            <p className="formula num" aria-label={`Terrain Match is the weighted average of the similarities: ${fmt(tm)}`}>
              ({used.map(p => `${fmt(p.weight, 1)} × ${fmt(p.similarity)}`).join(' + ')}) ÷ {fmt(weightSum, 1)} = {fmt(tm)}
            </p>
          )}
          {ex.missing.length > 0 && (
            <p className="note missing-text">
              {listText(ex.missing)} {ex.missing.length === 1 ? 'is' : 'are'} left out because a value is missing.
            </p>
          )}
        </section>

        <section aria-labelledby="ex-sun">
          <h3 id="ex-sun" className="label">Lighting</h3>
          {ex.lowSun && !ex.lowSun.compared ? (
            <p>
              Lighting is not compared for Mars targets and plays no part in this ranking. For reference, the share of daylight
              with the sun under 10° is <b className="num sun">{pct(ex.lowSun.site)}</b> at this site and{' '}
              <b className="num">{pct(ex.lowSun.target)}</b> at {ex.targetName}.
            </p>
          ) : ex.lowSun ? (
            <>
              <p>
                Low sun (share of daylight with the sun under 10°): this site <b className="num sun">{pct(ex.lowSun.site)}</b>,{' '}
                {ex.targetName} <b className="num">{pct(ex.lowSun.target)}</b>. A separate lighting comparison: it does not change
                Terrain Match or the rank.
              </p>
              {ex.warning.fired && (
                <p className="warning" role="note">
                  <b>The ground matches. The light doesn&apos;t.</b> {ex.warning.text} The flag shows when Terrain Match is at
                  least <span className="num">{fmt(ex.warning.terrainMatchMin)}</span> and low sun is under{' '}
                  <span className="num">{pct(ex.warning.lowSunMax)}</span>.
                </p>
              )}
            </>
          ) : (
            <p>Lighting comparison is not applicable to Mars targets, so it plays no part in this ranking.</p>
          )}
        </section>

        <section aria-labelledby="ex-rel">
          <h3 id="ex-rel" className="label">Reliability</h3>
          <dl className="facts">
            <div><dt className="label">Completeness</dt><dd className="num">{pct(ex.completeness)}</dd></div>
            <div><dt className="label">Top-{ex.topN} stability</dt><dd className="num">{tm === null ? 'not scored' : pct(ex.stability)}</dd></div>
          </dl>
          <p className="note">
            Completeness is the share of the weight with a value on both sides.
            {tm !== null && <> Stability: in {ex.stabilityRuns} reruns with the weights varied around the current ones and every
            site&apos;s values shifted by up to ±{Math.round(ex.noiseRel * 100)}%, the share in which this site stayed in the top {ex.topN}.
            It shows how sensitive the rank is; it is not a probability.</>}
          </p>
          <dl className="windows" aria-label="Terrain Match by window size">
            {ex.windows.map(w => (
              <div key={w.km} className={w.main ? 'main' : undefined}>
                <dt className="label">{w.km} km{w.main ? ' · main' : ''}</dt>
                <dd className="num">{fmt(w.terrainMatch)}</dd>
              </div>
            ))}
          </dl>
          <p className="note">Terrain Match by window size. The ranking uses the main window.</p>
        </section>

        <details className="sources">
          <summary>Sources</summary>
          <ul>
            {ex.params.map(p => (
              <li key={p.key}>
                <b>{p.label}</b> <TierBadge tier={p.tier} /> {p.source ?? <span className="missing-text">no source</span>}
              </li>
            ))}
            {ex.lowSun && (
              <>
                <li><b>Low sun, this site</b> <TierBadge tier={ex.lowSun.siteTier} /> {ex.lowSun.siteSource ?? <span className="missing-text">no source</span>}</li>
                <li><b>Low sun, {ex.targetName}</b> <TierBadge tier={ex.lowSun.targetTier} /> {ex.lowSun.targetSource ?? <span className="missing-text">no source</span>}</li>
              </>
            )}
          </ul>
          <p className="note">Data has exact values, hillshades and depth evidence for this site.</p>
        </details>

        <p className="foot">
          Ranked among the {ex.total} Earth sites in this app, not a search of all of Earth.
          {ex.provisional && ' Weights, ranges and thresholds are provisional defaults.'} The 3D views are for orientation; these
          numbers come from the terrain values above.
        </p>
      </div>
    </section>
  )
}

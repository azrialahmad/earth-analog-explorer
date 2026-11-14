import type { Config, Evidence, RankedSite, Target } from '../types'
import { WINDOW_KEYS } from '../types'
import { weakestParam } from '../engine'
import { fmt, fmtUnit, pct, TierBadge, Bar } from '../ui'
import Hillshade from './Hillshade'
import './DataDrawer.css'

export interface DataDrawerProps {
  open: boolean
  entry: RankedSite | null
  target: Target
  config: Config
  /** Share of reruns that keep this site in the top N; null when not computed. */
  stability: number | null
  evidence: Evidence
  onClose: () => void
}

const coord = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`

const Missing = ({ text = 'missing' }: { text?: string }) => <span className="missing-text">{text}</span>

/** Exact numbers for the selected site, in the order of brief F3. */
export default function DataDrawer({ open, entry, target, config, stability, evidence, onClose }: DataDrawerProps) {
  const moon = target.body === 'moon'
  const site = entry?.site
  const weak = entry ? weakestParam(entry.perParam) : null

  return (
    <aside id="data-drawer" className="drawer panel glass" aria-label="Site data" hidden={!open}>
      <header>
        <div>
          <span className="label">{entry ? `Rank ${entry.rank} · ${target.name}` : target.name}</span>
          <h2>{site?.name ?? 'No site selected'}</h2>
          {site && <p className="coords num">{coord(site.lat, site.lon)}</p>}
        </div>
        <button type="button" className="close" aria-label="Close site data" onClick={onClose}>×</button>
      </header>

      {entry && site && (
        <>
          <p className="why">{site.why}</p>

          {entry.warning.fired && <p className="warning" role="note">{entry.warning.text}</p>}

          <dl className="facts">
            <div><dt className="label">Terrain Match</dt><dd className="num">{fmt(entry.terrainMatch)}</dd></div>
            <div><dt className="label">Completeness</dt><dd className="num">{pct(entry.completeness)}</dd></div>
            <div><dt className="label">Top-3 stability</dt><dd className="num">{pct(stability)}</dd></div>
          </dl>

          <p className="weakest">
            {weak
              ? <>Weakest: <b>{config.params[weak.key].label}</b> <span className="num">({fmt(weak.similarity)})</span></>
              : <>Weakest: <Missing text="no parameter has a value" /></>}
          </p>

          <table className="table">
            <thead><tr><th>Parameter</th><th>Site</th><th>Target</th><th>Similarity</th></tr></thead>
            <tbody>
              {entry.perParam.map(p => {
                const meta = config.params[p.key]
                const v = site.params[p.key]
                return (
                  <tr key={p.key}>
                    <td>
                      {meta.label}
                      <div className="src"><TierBadge tier={v.tier} /> weight <span className="num">{fmt(p.weight, 1)}</span></div>
                      <div className="src">{v.source ?? <Missing text="no source" />}</div>
                    </td>
                    <td className="num">{p.site === null ? <Missing /> : fmtUnit(p.site, meta.unit)}</td>
                    <td className="num">{p.target === null ? <Missing /> : fmtUnit(p.target, meta.unit)}</td>
                    <td className="num">{fmt(p.similarity)}<Bar value={p.similarity} label={`${meta.label} similarity`} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <p className="line">
            <span className="label">Missing parameters</span>{' '}
            {entry.missing.length ? entry.missing.map(k => config.params[k].label).join(', ') : 'none'}
          </p>

          <section aria-label="Lighting">
            <h3 className="label">Lighting</h3>
            {moon ? (
              <dl className="pair">
                <div>
                  <dt>This site <TierBadge tier={site.conditions.low_sun_share.tier} /></dt>
                  <dd className="num">{pct(site.conditions.low_sun_share.value)} <small>of daylight with the sun under 10°</small></dd>
                </div>
                <div>
                  <dt>{target.name} <TierBadge tier={target.low_sun_share?.tier ?? 'missing'} /></dt>
                  <dd className="num">{pct(target.low_sun_share?.value ?? null)}</dd>
                </div>
              </dl>
            ) : <p className="muted small">Lighting: not applicable to Mars targets</p>}
          </section>

          <section aria-label="Ground cover">
            <h3 className="label">Ground cover</h3>
            <dl className="pair one">
              <div>
                <dt>Bare ground <TierBadge tier={site.conditions.bare_ground_share.tier} /></dt>
                <dd className="num">
                  {site.conditions.bare_ground_share.value === null
                    ? <Missing />
                    : <>{pct(site.conditions.bare_ground_share.value)} <small>of land in the {config.main_window_km} km window is bare or sparsely vegetated</small></>}
                </dd>
              </div>
            </dl>
            <p className="src">{site.conditions.bare_ground_share.source ?? 'No land-cover value for this site.'}</p>
            <p className="muted small">A site condition only: it does not change Terrain Match or the rank.</p>
          </section>

          <section aria-label="Window sensitivity">
            <h3 className="label">Terrain Match by window size</h3>
            <dl className="windows">
              {WINDOW_KEYS.map(k => (
                <div key={k} className={Number(k) === config.main_window_km ? 'main' : undefined}>
                  <dt className="label">{k} km{Number(k) === config.main_window_km ? ' · main' : ''}</dt>
                  <dd className="num">{fmt(entry.windowSensitivity[k])}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-label="Depth evidence for this site">
            <h3 className="label">Depth evidence here</h3>
            {site.depth_evidence.length === 0
              ? <p className="muted small">No ground-level depth data for this site.</p>
              : (
                <table className="table">
                  <thead><tr><th>Dataset</th><th>Model</th><th>δ1</th></tr></thead>
                  <tbody>
                    {site.depth_evidence.map((d, i) => (
                      <tr key={i}>
                        <td>{d.dataset}<div className="src"><TierBadge tier={d.tier} /> {d.source}</div></td>
                        <td>{d.model}</td>
                        <td className="num">{fmt(d.delta1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </section>
        </>
      )}

      {/* the caveat contrasts Earth's sky with the airless Moon; it does not describe Mars */}
      {moon && <p className="caveat">{evidence.sky_caveat}</p>}

      {entry && site && (
        <section aria-label="Hillshades">
          <h3 className="label">Hillshade</h3>
          <div className="hills">
            <Hillshade path={site.hillshade} title={site.name} source={site.params.slope_mean_deg.source} />
            <Hillshade path={target.hillshade} title={target.name} source={target.params.slope_mean_deg.source} />
          </div>
        </section>
      )}

    </aside>
  )
}

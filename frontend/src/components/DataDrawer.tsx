import type { Config, Evidence, RankedSite, Target } from '../types'
import { fmt, pct, TierBadge, Bar } from '../ui'
import DepthEvidence from './DepthEvidence'
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

/**
 * Exact numbers for the selected site. F0 builds the frame and the parameter table;
 * brief F3 (#7) adds the weakest-parameter line, windows and hillshades.
 */
export default function DataDrawer({ open, entry, target, config, stability, evidence, onClose }: DataDrawerProps) {
  const moon = target.body === 'moon'
  return (
    <aside id="data-drawer" className="drawer panel glass" aria-label="Site data" hidden={!open}>
      <header>
        <div>
          <span className="label">{entry ? `Rank ${entry.rank} · ${target.name}` : target.name}</span>
          <h2>{entry?.site.name ?? 'No site selected'}</h2>
        </div>
        <button type="button" className="close" aria-label="Close site data" onClick={onClose}>×</button>
      </header>

      {entry && (
        <>
          <dl className="facts">
            <div><dt className="label">Terrain Match</dt><dd className="num">{fmt(entry.terrainMatch)}</dd></div>
            <div><dt className="label">Completeness</dt><dd className="num">{pct(entry.completeness)}</dd></div>
            <div><dt className="label">Top-3 stability</dt><dd className="num">{pct(stability)}</dd></div>
          </dl>

          <table className="table">
            <thead><tr><th>Parameter</th><th>Site</th><th>Target</th><th>Similarity</th></tr></thead>
            <tbody>
              {entry.perParam.map(p => {
                const meta = config.params[p.key]
                const v = entry.site.params[p.key]
                const unit = meta.unit === '°' ? '°' : ` ${meta.unit}`
                return (
                  <tr key={p.key}>
                    <td>{meta.label}<div className="src"><TierBadge tier={v.tier} /> {v.source ?? <span className="missing-text">no source</span>}</div></td>
                    <td className="num">{p.site === null ? <span className="missing-text">missing</span> : `${p.site}${unit}`}</td>
                    <td className="num">{p.target === null ? <span className="missing-text">missing</span> : `${p.target}${unit}`}</td>
                    <td className="num">{fmt(p.similarity)}<Bar value={p.similarity} label={`${meta.label} similarity`} /></td>
                  </tr>
                )
              })}
              <tr>
                <td>Low-sun share<div className="src">{moon ? <><TierBadge tier={entry.site.conditions.low_sun_share.tier} /> target: by definition</> : 'Mars has an ordinary day and night'}</div></td>
                <td className="num">{moon ? pct(entry.site.conditions.low_sun_share.value) : 'not applicable'}</td>
                <td className="num">{moon ? pct(target.low_sun_share?.value ?? null) : 'not applicable'}</td>
                <td className="num">—</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <p className="caveat">{evidence.sky_caveat}</p>
      <DepthEvidence evidence={evidence} />
    </aside>
  )
}

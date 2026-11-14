import type { Evidence } from '../types'
import { asset, fmt, TierBadge } from '../ui'
import './DepthEvidence.css'

export interface DepthEvidenceProps {
  evidence: Evidence
}

const None = ({ children }: { children: string }) => <p className="ev-none">{children}</p>

/**
 * Three separate parts: what was published (cited), what we measured (computed, always next to
 * the flat-ground baseline), and what we left out. None of it is evidence that the ranking is right:
 * it is about how well a depth model sees this kind of ground, not about which site matches best.
 */
export default function DepthEvidence({ evidence }: DepthEvidenceProps) {
  const { cited, ours, not_shown } = evidence
  return (
    <div className="depth-evidence">
      <p className="ev-scope">
        How well a depth-from-images model reads ground like this. It does not rank the sites and is not a check on the ranking.
      </p>

      <section aria-labelledby="ev-cited">
        <h3 id="ev-cited" className="ev-head">1. Published <TierBadge tier="cited" /></h3>
        <p className="ev-src">{cited.source} · model {cited.model} · metric {cited.metric}</p>
        {cited.rows.length === 0 ? <None>No published rows yet.</None> : (
          <table className="table">
            <thead><tr><th>Dataset</th><th>Kind</th><th>δ1</th><th>Site</th></tr></thead>
            <tbody>
              {cited.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.dataset}</td>
                  <td>{r.kind}</td>
                  <td className="num">{fmt(r.delta1)}</td>
                  <td>{r.site_id ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="ev-ours">
        <h3 id="ev-ours" className="ev-head">2. Our test <TierBadge tier="computed" /></h3>
        <p className="ev-src">{ours.source} · model {ours.model}</p>
        <p className="ev-note">{ours.metric_note}</p>
        {ours.images.length > 0 && (
          <div className="ev-images">
            {ours.images.map(img => (
              <figure key={img.src}>
                <img src={asset(img.src)} alt={img.caption} loading="lazy" />
                <figcaption>{img.caption}</figcaption>
              </figure>
            ))}
          </div>
        )}
        {ours.rows.length === 0 ? <None>No rows from our test yet.</None> : (
          <ul className="ev-rows">
            {ours.rows.map((r, i) => (
              <li key={i} className="ev-row">
                <p className="ev-row-head"><b>{r.set}</b> <span className="num muted">n = {r.n}</span></p>
                <dl className="ev-pair">
                  <div><dt>δ1 model</dt><dd className="num">{fmt(r.delta1)}</dd></div>
                  <div><dt>δ1 flat-ground baseline</dt><dd className="num">{fmt(r.plane_delta1)}</dd></div>
                </dl>
                <dl className="ev-skill">
                  <div><dt>Relief skill, median</dt><dd className="num">{fmt(r.relief_skill_median)}</dd></div>
                  <div><dt>Share beating flat ground</dt><dd className="num">{fmt(r.share_beating_plane)}</dd></div>
                  <div><dt>Relief skill in shadow</dt><dd className="num">{fmt(r.relief_skill_shadow)}</dd></div>
                  <div><dt>Relief skill in light</dt><dd className="num">{fmt(r.relief_skill_lit)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ev-not">
        <h3 id="ev-not" className="ev-head">3. What we did not show</h3>
        {not_shown.length === 0 ? <None>Nothing listed.</None> : <ul className="ev-list">{not_shown.map(s => <li key={s}>{s}</li>)}</ul>}
      </section>
    </div>
  )
}

import type { Evidence } from '../types'

export interface DepthEvidenceProps {
  evidence: Evidence
}

/**
 * F0 placeholder with its final props. Brief F4 (#8) builds the three labelled parts:
 * published (cited), our test (with the flat-ground baseline next to every δ1), and what we did not show.
 */
export default function DepthEvidence({ evidence }: DepthEvidenceProps) {
  return (
    <section aria-label="Depth evidence">
      <h3 className="label">Depth evidence</h3>
      <p className="muted" style={{ fontSize: 12.5, marginBlockStart: 6 }}>
        DepthEvidence placeholder: {evidence.cited.rows.length} cited rows, {evidence.ours.rows.length} rows from our test,
        {' '}{evidence.not_shown.length} items we did not show.
      </p>
    </section>
  )
}

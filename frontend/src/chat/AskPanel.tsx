import type { Config, Evidence, RankedSite, Stability, Target, Weights } from '../types'

export interface AskRun {
  target: Target
  ranked: RankedSite[]
  stability: Stability
  config: Config
  weights: Weights
  evidence: Evidence
}

export interface AskPanelProps {
  open: boolean
  run: AskRun
  onRerun: (w: Weights) => RankedSite[]
  onClose: () => void
}

/** F0 placeholder with final props. Brief F5 (#11) builds Ask AI, if it is not cut. It never writes a score. */
export default function AskPanel({ open, run, onClose }: AskPanelProps) {
  return (
    <section className="panel glass" aria-label="Ask AI" hidden={!open}
      style={{ position: 'absolute', zIndex: 6, insetInlineEnd: 16, insetBlockStart: 72, inlineSize: 320 }}>
      <p>AskPanel placeholder for {run.target.name}.</p>
      <button type="button" className="btn glass" onClick={onClose}>Close</button>
    </section>
  )
}

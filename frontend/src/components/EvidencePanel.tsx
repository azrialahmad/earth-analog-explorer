import type { Evidence } from '../types'
import DepthEvidence from './DepthEvidence'
import './DataDrawer.css'

export interface EvidencePanelProps {
  open: boolean
  evidence: Evidence
  onClose: () => void
}

/** Side panel holding the depth evidence; same frame as the site data drawer. */
export default function EvidencePanel({ open, evidence, onClose }: EvidencePanelProps) {
  return (
    <aside id="evidence-panel" className="drawer panel glass" aria-label="Depth evidence" hidden={!open}>
      <header>
        <div>
          <span className="label">Rover vision</span>
          <h2>Depth evidence</h2>
        </div>
        <button type="button" className="close" aria-label="Close depth evidence" onClick={onClose}>×</button>
      </header>
      <DepthEvidence evidence={evidence} />
      <p className="caveat">{evidence.sky_caveat}</p>
    </aside>
  )
}

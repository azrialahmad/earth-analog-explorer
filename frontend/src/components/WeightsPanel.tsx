import type { CSSProperties } from 'react'
import type { Config, Weights } from '../types'
import { PARAM_KEYS } from '../types'
import './WeightsPanel.css'

export interface WeightsPanelProps {
  embedded?: boolean
  open: boolean
  config: Config
  weights: Weights
  onWeights: (w: Weights) => void
  onReset: () => void
  onClose: () => void
}

const MAX_WEIGHT = 3

export default function WeightsPanel({ embedded = false, open, config, weights, onWeights, onReset, onClose }: WeightsPanelProps) {
  return (
    <section id="weights-panel" className={`weights panel glass${embedded ? ' embedded' : ''}`} aria-label="Weights" hidden={!open}>
      <header>
        <h2>Weights</h2>
        {config.provisional && <span className="label provisional">Provisional defaults</span>}
        {!embedded && <button type="button" className="close" aria-label="Close weights" onClick={onClose}>×</button>}
      </header>
      {PARAM_KEYS.map(k => {
        const id = `w-${k}`
        const v = weights[k]
        return (
          <div className="weight" key={k}>
            <label htmlFor={id}>{config.params[k].label}</label>
            <output htmlFor={id} className="num">{v.toFixed(1)}</output>
            <input
              id={id}
              type="range"
              min={0}
              max={MAX_WEIGHT}
              step={0.1}
              value={v}
              aria-valuetext={`weight ${v.toFixed(1)}`}
              style={{ '--attr-min': 0, '--attr-max': MAX_WEIGHT, '--control-value': v } as CSSProperties}
              onChange={e => onWeights({ ...weights, [k]: Number(e.target.value) })}
            />
          </div>
        )
      })}
      <button type="button" className="btn glass reset" onClick={onReset}>Reset to defaults</button>
    </section>
  )
}

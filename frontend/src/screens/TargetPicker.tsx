import type { Config, Target } from '../types'
import { PARAM_KEYS } from '../types'
import Hillshade from '../components/Hillshade'
import './TargetPicker.css'

export interface TargetPickerProps {
  targets: Target[]
  /** Labels and units for the terrain values. */
  config: Config
  onPick: (id: string) => void
  /** Present when a target is already chosen, so the picker can be dismissed. */
  onClose?: () => void
}

/** The opening screen: choose a Moon or Mars target, then explore its Earth analogs. */
export default function TargetPicker({ targets, config, onPick, onClose }: TargetPickerProps) {
  return (
    <div className="picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <div className="picker-inner">
        <header className="picker-head">
          <div>
            <h1 id="picker-title" className="dot">Earth Analog Explorer</h1>
            <p className="label">Mission: rover navigation testing</p>
            <p className="picker-lede">
              Pick a place on the Moon or Mars. We rank Earth sites by how closely their ground matches it, and show where the light does not.
            </p>
          </div>
          {onClose && <button type="button" className="close" aria-label="Close target picker" onClick={onClose}>×</button>}
        </header>

        <ul className="picker-cards">
          {targets.map(t => (
            <li key={t.id} className="picker-card glass">
              <div className="pc-top">
                <i className={`orb ${t.body}`} aria-hidden="true" />
                <span className="label">{t.body === 'moon' ? 'Moon' : 'Mars'}</span>
              </div>
              <h2>{t.name}</h2>
              <p className="pc-note">{t.note}</p>
              <Hillshade path={t.hillshade} title={t.name} source={t.params.slope_mean_deg.source} />
              <dl className="pc-values">
                {PARAM_KEYS.map(k => {
                  const meta = config.params[k]
                  const v = t.params[k].value
                  return (
                    <div key={k}>
                      <dt>{meta.label}</dt>
                      <dd className="num">{v === null ? <span className="missing-text">missing</span> : `${v}${meta.unit === '°' ? '°' : ` ${meta.unit}`}`}</dd>
                    </div>
                  )
                })}
              </dl>
              <button type="button" className="btn primary" onClick={() => onPick(t.id)}>Find Earth analogs</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

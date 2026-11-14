import type { Target } from '../types'
import './TopBar.css'

export type Panel = 'none' | 'weights' | 'data' | 'ask'

export interface TopBarProps {
  targets: Target[]
  targetId: string
  onPickTarget: (id: string) => void
  fixture: boolean
  panel: Panel
  onTogglePanel: (p: Exclude<Panel, 'none'>) => void
}

const GROUPS: { body: Target['body']; label: string }[] = [
  { body: 'moon', label: 'Moon' },
  { body: 'mars', label: 'Mars' },
]

export default function TopBar({ targets, targetId, onPickTarget, fixture, panel, onTogglePanel }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand glass">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.3" />
          <path d="M12 2a10 10 0 0 1 0 20c-3-2.6-4.2-6.2-4.2-10S9 4.6 12 2z" fill="var(--sun)" />
        </svg>
        <h1>Earth Analog Explorer</h1>
        {fixture && <span className="fixture-tag" title="Hand-written development fixture. Not data.">Fixture data</span>}
      </div>

      <nav className="targets glass" aria-label="Target">
        {GROUPS.map(g => {
          const list = targets.filter(t => t.body === g.body)
          if (!list.length) return null
          return (
            <div key={g.body} className="target-group" role="group" aria-label={g.label}>
              <span className="label">{g.label}</span>
              {list.map(t => (
                <button key={t.id} type="button" aria-pressed={t.id === targetId} onClick={() => onPickTarget(t.id)}>
                  <i className={`orb ${t.body}`} aria-hidden="true" />
                  {t.name}
                </button>
              ))}
            </div>
          )
        })}
      </nav>

      <div className="tools">
        <button type="button" className="btn glass" aria-expanded={panel === 'weights'} aria-controls="weights-panel" onClick={() => onTogglePanel('weights')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="8" r="2.5" /><circle cx="12" cy="8" r="2.5" /><path d="M4 1v4.5M4 10.5V15M12 1v4.5M12 10.5V15" /></svg>
          <span className="tool-label">Weights</span>
        </button>
        <button type="button" className="btn glass" aria-expanded={panel === 'data'} aria-controls="data-drawer" onClick={() => onTogglePanel('data')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13h12M4 13V8M8 13V3M12 13V6" /></svg>
          <span className="tool-label">Data</span>
        </button>
      </div>
    </header>
  )
}

import type { Target } from '../types'
import './TopBar.css'

export type Panel = 'none' | 'data' | 'evidence'

export interface TopBarProps {
  targets: Target[]
  targetId: string
  onPickTarget: (id: string) => void
  fixture: boolean
  panel: Panel
  onTogglePanel: (p: Exclude<Panel, 'none'>) => void
  onPlayDemo: () => void
  onControlsMount?: (node: HTMLDivElement | null) => void
}

const GROUPS: { body: Target['body']; label: string }[] = [
  { body: 'moon', label: 'Moon' },
  { body: 'mars', label: 'Mars' },
]

export default function TopBar({ targets, targetId, onPickTarget, fixture, panel, onTogglePanel, onPlayDemo, onControlsMount }: TopBarProps) {
  const body = targets.find(t => t.id === targetId)?.body
  return (
    <header className="topbar">
      <div className="brand glass">
        <div className="brand-lockup">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.3" />
            <path d="M12 2a10 10 0 0 1 0 20c-3-2.6-4.2-6.2-4.2-10S9 4.6 12 2z" fill="var(--sun)" />
          </svg>
          <span className="brand-text">
            <h1>Earth Analog Explorer</h1>
            <span className="mission">Rover navigation testing · {body === 'mars' ? 'Mars' : 'lunar south pole'}</span>
          </span>
        </div>
        {fixture && <span className="fixture-tag" title="Hand-written development fixture. Not data.">Fixture data</span>}
      </div>

      <div className="header-center">
        <div className="header-view-controls" ref={onControlsMount} />
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
      </div>

      <div className="tools">
        <button type="button" className="btn glass" title="Data" aria-expanded={panel === 'data'} aria-controls="data-drawer" onClick={() => onTogglePanel('data')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13h12M4 13V8M8 13V3M12 13V6" /></svg>
          <span className="tool-label">Data</span>
        </button>
        <button type="button" className="btn glass" title="Evidence" aria-expanded={panel === 'evidence'} aria-controls="evidence-panel" onClick={() => onTogglePanel('evidence')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.5" /><path d="M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5z" /></svg>
          <span className="tool-label">Evidence</span>
        </button>
        <button type="button" className="btn glass" title="Play demo" onClick={onPlayDemo}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" /></svg>
          <span className="tool-label">Demo</span>
        </button>
      </div>
    </header>
  )
}

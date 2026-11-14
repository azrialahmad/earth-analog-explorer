import type { RankedSite, Target } from '../types'
import './MismatchCallout.css'

export interface MismatchCalloutProps {
  entry: RankedSite | null
  body: Target['body']
  relit: boolean
  onToggleRelit: () => void
}

/** Shown only when the engine fired the warning for the selected site (never for Mars targets). */
export default function MismatchCallout({ entry, body, relit, onToggleRelit }: MismatchCalloutProps) {
  if (!entry || body !== 'moon' || !entry.warning.fired) return null
  return (
    <div className="callout warning" role="status">
      <p>
        <strong>The ground matches. The light doesn't.</strong>
        {entry.warning.text && <span className="callout-text">{entry.warning.text}</span>}
      </p>
      <button type="button" className="btn primary" aria-pressed={relit} onClick={onToggleRelit}>
        {relit ? 'Back to Earth light' : 'Light it like the pole'}
      </button>
    </div>
  )
}

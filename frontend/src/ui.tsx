import type { Tier } from './types'

/** A number with fixed digits, or the word "missing". Never 0 or a blank for unknown values. */
export function fmt(x: number | null | undefined, digits = 2): string {
  return x === null || x === undefined || !Number.isFinite(x) ? 'missing' : x.toFixed(digits)
}

/** A share 0..1 as a whole percent ("16%"), or "missing". */
export function pct(x: number | null | undefined): string {
  return x === null || x === undefined || !Number.isFinite(x) ? 'missing' : `${Math.round(x * 100)}%`
}

const TIER_LABEL: Record<Tier, string> = {
  computed: 'Computed', cited: 'Cited', estimated: 'Estimated', missing: 'Missing', 'by definition': 'By definition',
}

export function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`badge ${tier === 'by definition' ? 'definition' : tier}`}>{TIER_LABEL[tier]}</span>
}

/** Horizontal 0..1 bar. `kind` picks the terrain (teal) or sun (amber) colour. A null value draws an empty, dashed track. */
export function Bar({ value, kind = 'terrain', label }: { value: number | null; kind?: 'terrain' | 'sun'; label: string }) {
  const v = value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(1, value))
  return (
    <span className={`bar ${kind}${v === null ? ' empty' : ''}`} role="img" aria-label={`${label}: ${v === null ? 'missing' : v.toFixed(2)}`}>
      {v !== null && <span style={{ inlineSize: `${v * 100}%` }} />}
    </span>
  )
}

/** CSS colour token for a 0..1 Terrain Match. Colour is never the only signal: always show the number too. */
export function scoreColor(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return 'var(--faint)'
  if (x >= 0.8) return 'var(--terrain)'
  if (x >= 0.5) return 'var(--terrain-mid)'
  return 'var(--muted)'
}

/** Resolve a path under public/ against the deploy base (GitHub Pages serves under /<repo>/). */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

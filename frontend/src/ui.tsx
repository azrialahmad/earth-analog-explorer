import { useSyncExternalStore } from 'react'
import type { Tier } from './types'

/** A number with fixed digits, or the word "missing". Never 0 or a blank for unknown values. */
export function fmt(x: number | null | undefined, digits = 2): string {
  return x === null || x === undefined || !Number.isFinite(x) ? 'missing' : x.toFixed(digits)
}

/** A terrain value with its unit: degrees to 1 decimal ("22.8°"), anything else to 2 ("1.39 m"), or "missing". */
export function fmtUnit(x: number | null | undefined, unit: string): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return 'missing'
  return unit === '°' ? `${x.toFixed(1)}°` : `${x.toFixed(2)} ${unit}`
}

/** A share 0..1 as a whole percent ("16%"), or "missing". */
export function pct(x: number | null | undefined): string {
  return x === null || x === undefined || !Number.isFinite(x) ? 'missing' : `${Math.round(x * 100)}%`
}

/**
 * Coordinates no more precise than the site's caveat allows: 3 decimals, or 2 with "≈ … (approximate)"
 * when the site carries the "coordinates approximate" flag. Used by every view that shows them.
 */
export function coordText(lat: number, lon: number, approximate: boolean): string {
  const d = approximate ? 2 : 3
  const c = `${Math.abs(lat).toFixed(d)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(d)}°${lon >= 0 ? 'E' : 'W'}`
  return approximate ? `≈ ${c} (approximate)` : c
}

/**
 * Display wording for a pipeline site flag, so every view says the same thing.
 * "includes water" is set by the pipeline from the share of near-flat cells (flat_share), not from a
 * water map, so it is shown as a possibility. Unknown flags are shown as supplied.
 */
export function flagText(flag: string): string {
  switch (flag) {
    case 'includes water': return 'May include water (a flatness check, not a water map)'
    case 'coordinates approximate': return 'Coordinates approximate'
    case 'non-NASA elevation source': return 'Non-NASA elevation source'
    case 'scan candidate, not field-checked': return 'Scan candidate, not field-checked'
    default: return flag.charAt(0).toUpperCase() + flag.slice(1)
  }
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

/** Whether a CSS media query matches, kept in sync as the viewport changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    cb => { const m = matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => matchMedia(query).matches,
    () => false,
  )
}

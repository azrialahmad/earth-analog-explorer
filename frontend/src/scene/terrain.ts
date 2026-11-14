// Height fields for the split scene. Pure functions, no three.js, so they are unit-tested.
// Display only: nothing here feeds a score. Generated terrain is an illustration and the
// scene labels it as such; real relief comes from a ReliefGrid built by the pipeline.
import type { ReliefGrid } from '../types'
import { rng } from '../engine/stability'

/** Vertices per side of every terrain tile (matches ReliefGrid.size from the pipeline). */
export const GRID = 129
/** Width of a tile in scene units. */
export const SPAN = 120

export type TerrainKind = 'moon' | 'mars' | 'earth'

/** Stable 32-bit hash of a string (FNV-1a), used to seed generated terrain per place. */
export function seedOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return h >>> 0
}

function valueNoise(seed: number): (x: number, y: number) => number {
  const r = rng(seed)
  const perm = new Uint8Array(512)
  for (let i = 0; i < 256; i++) perm[i] = i
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]] }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]
  const vals = Float32Array.from({ length: 256 }, () => r() * 2 - 1)
  const smooth = (t: number) => t * t * (3 - 2 * t)
  return (x, y) => {
    const X = Math.floor(x), Y = Math.floor(y), fx = x - X, fy = y - Y, xi = X & 255, yi = Y & 255
    const a = vals[perm[perm[xi] + yi]], b = vals[perm[perm[xi + 1] + yi]]
    const c = vals[perm[perm[xi] + yi + 1]], d = vals[perm[perm[xi + 1] + yi + 1]]
    const u = smooth(fx), v = smooth(fy)
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
  }
}

/**
 * Illustrative terrain for a place without elevation data: rolling noise plus craters
 * (Moon, Mars) or a few cones (Earth). Deterministic per seed. Not derived from any measurement.
 */
export function generatedHeights(seed: number, kind: TerrainKind): Float32Array {
  const n = GRID - 1
  const r = rng(seed ^ 0x9e3779b9)
  const noise = valueNoise(seed)
  const craterCount = { moon: 26, mars: 18, earth: 5 }[kind]
  const craters: [number, number, number][] = []
  for (let i = 0; i < craterCount; i++) {
    const R = 3 + Math.pow(r(), 2.2) * (kind === 'moon' ? 26 : 18)
    craters.push([(r() - 0.5) * SPAN, (r() - 0.5) * SPAN, R])
  }
  const cones: [number, number, number, number][] = []
  if (kind === 'earth') for (let i = 0; i < 6; i++) cones.push([(r() - 0.5) * SPAN * 0.8, (r() - 0.5) * SPAN * 0.8, 6 + r() * 10, 2 + r() * 5])

  const h = new Float32Array(GRID * GRID)
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = (i / n - 0.5) * SPAN, z = (j / n - 0.5) * SPAN
      let v = 0, amp = 1, f = 0.018
      for (let o = 0; o < 6; o++) {
        v += noise(x * f + o * 17, z * f - o * 11) * amp * (o < 2 ? 6 : 1.6)
        amp *= 0.5; f *= 2.05
      }
      for (const [cx, cz, R] of craters) {
        const d = Math.hypot(x - cx, z - cz) / R
        if (d < 1.7) { const depth = R * 0.32; if (d < 1) v += depth * (d * d - 1); v += depth * 0.3 * Math.exp(-(((d - 1) / 0.22) ** 2)) }
      }
      for (const [cx, cz, R, H] of cones) {
        const d = Math.hypot(x - cx, z - cz) / R
        if (d < 1) v += H * (1 - d) - (d < 0.3 ? H * 0.5 * (1 - d / 0.3) : 0)
      }
      h[j * GRID + i] = v
    }
  }
  return h
}

/**
 * Heights from a pipeline ReliefGrid, at true scale (same factor horizontally and vertically),
 * centred on the mean elevation, resampled to GRID × GRID. Nodata cells take the mean.
 * Null when the grid has no usable values.
 */
export function reliefHeights(grid: ReliefGrid): Float32Array | null {
  const { size, cell_m, elev_m } = grid
  if (!(size >= 2) || !(cell_m > 0) || elev_m.length !== size * size) return null
  let sum = 0, count = 0
  for (const e of elev_m) if (e !== null && Number.isFinite(e)) { sum += e; count++ }
  if (count === 0) return null
  const mean = sum / count
  const scale = SPAN / ((size - 1) * cell_m)
  const at = (i: number, j: number) => { const e = elev_m[j * size + i]; return e !== null && Number.isFinite(e) ? e : mean }

  const h = new Float32Array(GRID * GRID)
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      // bilinear sample (identity when size === GRID)
      const x = (i / (GRID - 1)) * (size - 1), y = (j / (GRID - 1)) * (size - 1)
      const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1)
      const fx = x - x0, fy = y - y0
      const e = (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy
      h[j * GRID + i] = (e - mean) * scale
    }
  }
  return h
}

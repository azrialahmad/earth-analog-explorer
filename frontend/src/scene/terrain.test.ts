import { describe, expect, it } from 'vitest'
import { GRID, SPAN, generatedHeights, reliefHeights, seedOf } from './terrain'

describe('generatedHeights', () => {
  it('is deterministic per seed and finite', () => {
    const a = generatedHeights(7, 'moon'), b = generatedHeights(7, 'moon')
    expect(a).toEqual(b)
    expect(a.length).toBe(GRID * GRID)
    expect(a.every(Number.isFinite)).toBe(true)
    expect(generatedHeights(8, 'moon')).not.toEqual(a)
  })
  it('seeds differ for different ids', () => expect(seedOf('a')).not.toBe(seedOf('b')))
})

describe('reliefHeights', () => {
  const grid = (elev: (number | null)[], size = 3, cell_m = 100) => ({ id: 't', size, cell_m, elev_m: elev })

  it('keeps true scale and centres on the mean', () => {
    // 3×3 grid, 200 m across; a 100 m step becomes 100 * SPAN / 200 scene units
    const h = reliefHeights(grid([0, 0, 0, 0, 0, 0, 100, 100, 100]))!
    const mean = 100 / 3
    expect(h[0]).toBeCloseTo((0 - mean) * SPAN / 200)
    expect(h[GRID * GRID - 1]).toBeCloseTo((100 - mean) * SPAN / 200)
  })
  it('fills nodata with the mean', () => {
    const h = reliefHeights(grid([10, 10, 10, 10, null, 10, 10, 10, 10]))!
    expect(h.every(v => Math.abs(v) < 1e-9)).toBe(true)
  })
  it('is null without usable values or with a malformed grid', () => {
    expect(reliefHeights(grid(Array(9).fill(null)))).toBeNull()
    expect(reliefHeights(grid([1, 2, 3]))).toBeNull()
  })
})

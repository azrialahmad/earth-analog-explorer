import { describe, expect, it } from 'vitest'
import { GRID, SPAN, generatedHeights, reliefHeights, reliefStatusText, seedOf } from './terrain'

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
  const heights = (g: ReturnType<typeof grid>) => {
    const r = reliefHeights(g)
    if (!r.ok) throw new Error(`expected heights, got ${r.problem.kind}`)
    return r.heights
  }

  it('keeps true scale and centres on the mean', () => {
    // 3×3 grid, 200 m across; a 100 m step becomes 100 * SPAN / 200 scene units
    const h = heights(grid([0, 0, 0, 0, 0, 0, 100, 100, 100]))
    const mean = 100 / 3
    expect(h.length).toBe(GRID * GRID)
    expect(h[0]).toBeCloseTo((0 - mean) * SPAN / 200)
    expect(h[GRID * GRID - 1]).toBeCloseTo((100 - mean) * SPAN / 200)
  })

  // issue #61: a gap used to be filled with the mean and drawn as if measured
  it('rejects a partial grid instead of filling its nodata cells', () => {
    expect(reliefHeights(grid([10, 10, 10, 10, null, 10, 10, 10, 10]))).toEqual({ ok: false, problem: { kind: 'incomplete', missing: 1, total: 9 } })
    expect(reliefHeights(grid([10, NaN, 10, 10, 10, 10, 10, Infinity, 10]))).toEqual({ ok: false, problem: { kind: 'incomplete', missing: 2, total: 9 } })
  })
  it('rejects an all-null grid as incomplete', () => {
    expect(reliefHeights(grid(Array(9).fill(null)))).toEqual({ ok: false, problem: { kind: 'incomplete', missing: 9, total: 9 } })
  })
  it('rejects a grid with a bad length, size or cell spacing as malformed', () => {
    const malformed = { ok: false, problem: { kind: 'malformed' } }
    expect(reliefHeights(grid([1, 2, 3]))).toEqual(malformed)
    expect(reliefHeights(grid([1], 1))).toEqual(malformed)
    expect(reliefHeights(grid([1, 2, 3, 4], 2.5))).toEqual(malformed)
    expect(reliefHeights(grid(Array(9).fill(1), 3, 0))).toEqual(malformed)
    expect(reliefHeights(grid(Array(9).fill(1), 3, -5))).toEqual(malformed)
    expect(reliefHeights(grid(Array(9).fill(1), 3, NaN))).toEqual(malformed)
  })
})

describe('reliefStatusText', () => {
  it('labels every state that draws no surface, and says gaps are not filled', () => {
    expect(reliefStatusText({ kind: 'none' }, 'X')).toContain('No elevation data for X')
    expect(reliefStatusText({ kind: 'failed' }, 'X')).toContain('could not be loaded')
    const partial = reliefStatusText({ kind: 'unusable', problem: { kind: 'incomplete', missing: 4, total: 9 } }, 'X')
    expect(partial).toContain('4 of 9 cells missing')
    expect(partial).toContain('not filled in')
    expect(reliefStatusText({ kind: 'unusable', problem: { kind: 'malformed' } }, 'X')).toContain('malformed')
  })
  it('has no status line while loading or when a surface is drawn', () => {
    expect(reliefStatusText({ kind: 'loading' }, 'X')).toBeNull()
    expect(reliefStatusText({ kind: 'relief', size: 129, cell_m: 47 }, 'X')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { fmt, pct } from './ui'

describe('fmt', () => {
  it('formats numbers with fixed digits', () => {
    expect(fmt(0.912)).toBe('0.91')
    expect(fmt(3, 1)).toBe('3.0')
  })
  it('never shows 0 or a blank for unknown values', () => {
    expect(fmt(null)).toBe('missing')
    expect(fmt(undefined)).toBe('missing')
    expect(fmt(Number.NaN)).toBe('missing')
    expect(fmt(0)).toBe('0.00')
  })
})

describe('pct', () => {
  it('rounds a share to a whole percent', () => {
    expect(pct(0.16)).toBe('16%')
    expect(pct(1)).toBe('100%')
  })
  it('shows missing for unknown values', () => {
    expect(pct(null)).toBe('missing')
    expect(pct(Number.POSITIVE_INFINITY)).toBe('missing')
  })
})

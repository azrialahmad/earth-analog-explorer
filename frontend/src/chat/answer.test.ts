import { describe, expect, it } from 'vitest'
import { renderAnswer } from './answer'

const names = { mauna_kea: 'Mauna Kea, Hawaii', bromo: 'Bromo / Tengger, Indonesia', dry_valleys: 'McMurdo Dry Valleys, Antarctica' }
const r = (t: string) => renderAnswer(t, names)

describe('renderAnswer', () => {
  it('turns a bare tag into the name', () => {
    expect(r('1. [mauna_kea] 0.866')).toBe('1. Mauna Kea, Hawaii 0.866')
  })
  it('does not repeat a name written after the tag', () => {
    expect(r('[mauna_kea] Mauna Kea scores 0.88')).toBe('Mauna Kea, Hawaii scores 0.88')
    expect(r('[bromo] - Bromo is last')).toBe('Bromo / Tengger, Indonesia is last')
    expect(r('[bromo] (Bromo / Tengger, Indonesia) is last')).toBe('Bromo / Tengger, Indonesia is last')
  })
  it('does not repeat a name written before the tag', () => {
    expect(r('McMurdo Dry Valleys, Antarctica [dry_valleys], rank 1')).toBe('McMurdo Dry Valleys, Antarctica, rank 1')
    expect(r('Bromo [bromo] is last')).toBe('Bromo is last')
  })
  it('drops bold markers and leaves unknown ids alone', () => {
    expect(r('**Bromo** and [nowhere]')).toBe('Bromo and [nowhere]')
  })
})

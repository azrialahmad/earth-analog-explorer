import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { explainCard, whyKind } from './card'
import { config, makeSite, makeTarget } from '../engine/fixture'
import { defaultWeights, rankSites } from '../engine'
import SiteDetails from '../components/SiteDetails'
import DataDrawer from '../components/DataDrawer'
import type { Evidence } from '../types'

// Issue #62: a scan candidate's why text is selection history from the scan, not the current result.
const history = 'New candidate from the DEM scan. Picked among the scanned windows for Malapert massif (0.96) Terrain Match with default weights.'
const known = { ...makeSite('known', [10, 20, 1.3]), known_analog: true, why: 'Lava field used for rover tests' }
const cand = { ...makeSite('cand', [14, 26, 1]), why: history }
const sites = [known, cand]
const w = defaultWeights(config)
const evidence: Evidence = {
  cited: { source_id: 'c', source: 's', model: 'm', metric: 'd', rows: [] },
  ours: { source_id: 'o', source: 's', model: 'm', metric_note: 'n', rows: [], images: [] },
  not_shown: [], sky_caveat: 'sky',
}

describe('whyKind', () => {
  it('is a description for known sites and selection history for scan candidates', () => {
    expect(whyKind(known)).toBe('description')
    expect(whyKind(cand)).toBe('selection history')
  })
})

describe('candidate why text in the details and data views', () => {
  for (const [label, target, weights] of [
    ['Moon, default weights', makeTarget([10, 20, 1]), w],
    ['Moon, changed weights', makeTarget([10, 20, 1]), { ...w, slope_mean_deg: 0 }],
    ['Mars', makeTarget([10, 20, 1], 'mars'), w],
  ] as const) {
    it(`labels it as history and keeps the live score separate (${label})`, () => {
      const ranked = rankSites(sites, target, config, weights)
      const entry = ranked.find(r => r.site.id === 'cand')!
      const ex = explainCard(entry, ranked, target, config, null, weights)
      expect(ex.terrainMatch).toBe(entry.terrainMatch)
      expect(ex.terrainMatch).not.toBeCloseTo(0.96, 2)
      const html = renderToStaticMarkup(<SiteDetails ex={ex} />)
      expect(html).toContain('Scan selection history')
      expect(html).toContain('is not the current Terrain Match for')
      expect(html).toContain(entry.terrainMatch!.toFixed(2))
      const drawer = renderToStaticMarkup(
        <DataDrawer open entry={entry} target={target} config={config} stability={null} evidence={evidence} onClose={() => {}} />,
      )
      expect(drawer).toContain('Scan selection history')
    })
  }

  it('shows a known site description plainly, with no history label', () => {
    const target = makeTarget([10, 20, 1])
    const ranked = rankSites(sites, target, config, w)
    const ex = explainCard(ranked.find(r => r.site.id === 'known')!, ranked, target, config, null, w)
    const html = renderToStaticMarkup(<SiteDetails ex={ex} />)
    expect(html).toContain('Lava field used for rover tests')
    expect(html).not.toContain('Scan selection history')
  })
})

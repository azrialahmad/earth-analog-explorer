import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { coordText, flagText } from '../ui'
import { config, makeSite, makeTarget } from '../engine/fixture'
import { defaultWeights, rankSites } from '../engine'
import { explainCard } from '../explain/card'
import SiteDetails from './SiteDetails'
import DataDrawer from './DataDrawer'
import TerrainViews from './TerrainViews'
import type { Evidence } from '../types'

// Issue #63: the same limitation is worded the same way in every view.
const w = defaultWeights(config)
const moon = makeTarget([10, 20, 1])
const site = { ...makeSite('s', [10, 20, 1.2]), lat: 37.7512345, lon: 14.9987654, flags: ['includes water', 'coordinates approximate'] }
const exact = { ...makeSite('e', [10, 20, 1.4]), lat: -24.0812, lon: -69.2234 }
const ranked = rankSites([site, exact], moon, config, w)
const evidence: Evidence = {
  cited: { source_id: 'c', source: 's', model: 'm', metric: 'd', rows: [] },
  ours: { source_id: 'o', source: 's', model: 'm', metric_note: 'n', rows: [], images: [] },
  not_shown: [], sky_caveat: 'sky',
}
const details = (id: string) => {
  const e = ranked.find(r => r.site.id === id)!
  return renderToStaticMarkup(<SiteDetails ex={explainCard(e, ranked, moon, config, 0.5, w)} />)
}
const drawer = (id: string) => renderToStaticMarkup(
  <DataDrawer open entry={ranked.find(r => r.site.id === id)!} target={moon} config={config} stability={0.5} evidence={evidence} onClose={() => {}} />,
)

describe('coordText', () => {
  it('drops a decimal and marks approximate coordinates', () => {
    expect(coordText(37.7512345, 14.9987654, true)).toBe('≈ 37.75°N, 15.00°E (approximate)')
    expect(coordText(-24.0812, -69.2234, false)).toBe('24.081°S, 69.223°W')
  })
})

describe('flagText', () => {
  it('words the water flag as a flatness heuristic, not a confirmed water body', () => {
    expect(flagText('includes water')).toBe('May include water (a flatness check, not a water map)')
    expect(flagText('something new')).toBe('Something new')
  })
})

describe('details and data say the same thing', () => {
  it('shows approximate coordinates the same way in both', () => {
    for (const html of [details('s'), drawer('s')]) {
      expect(html).toContain('≈ 37.75°N, 15.00°E (approximate)')
      expect(html).not.toContain('37.751')
    }
    expect(drawer('e')).toContain('24.081°S, 69.223°W')
  })
  it('words the water flag the same way in both', () => {
    for (const html of [details('s'), drawer('s')]) expect(html).toContain('May include water (a flatness check, not a water map)')
  })
  it('names stability with top N from config and says it is not a probability, in both', () => {
    for (const html of [details('s'), drawer('s')]) {
      expect(html).toContain(`Top-${config.stability.top_n} stability`)
      expect(html).toContain('not a probability')
    }
    expect(drawer('s')).toContain('Completeness is the share of the weight')
  })
})

describe('terrain view lighting copy', () => {
  const view = (relit: boolean) => renderToStaticMarkup(
    <TerrainViews target={moon} site={site} relit={relit} onToggleRelit={() => {}} mainWindowKm={config.main_window_km} />,
  )
  it('says the polar view has an ambient fill and is not an illumination simulation', () => {
    const html = view(true)
    expect(html).toContain('dim ambient fill')
    expect(html).toContain('not an illumination simulation')
    expect(html).not.toContain('no sky light')
  })
  it('says the default view is illustrative with an ambient fill', () => {
    expect(view(false)).toContain('soft ambient fill')
  })
})

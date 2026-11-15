import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AppData } from './types'
import config from '../public/data/config.json'
import targets from '../public/data/targets.json'
import sites from '../public/data/sites.json'
import evidence from '../public/data/evidence.json'
import { runFor } from './chat/context'
import TopBar from './components/TopBar'
import WeightsPanel from './components/WeightsPanel'
import AskPanel from './chat/AskPanel'
import TerrainViews from './components/TerrainViews'

const data = { config, targets, sites, evidence } as AppData
const weights = { slope_mean_deg: 1, slope_p90_deg: 1, roughness_m: 1 }

describe('production studio workbench', () => {
  it('keeps the app title, all targets and accessible Data/Evidence entry points', () => {
    const html = renderToStaticMarkup(<TopBar targets={data.targets} targetId={data.targets[0].id}
      fixture={false} panel="none" onPickTarget={() => {}} onTogglePanel={() => {}} onPlayDemo={() => {}} />)
    expect(html).toContain('<h1>Earth Analog Explorer</h1>')
    for (const target of data.targets) expect(html).toContain(target.name)
    expect(html).toContain('aria-controls="data-drawer"')
    expect(html).toContain('aria-controls="evidence-panel"')
    expect(html).not.toContain('aria-controls="weights-panel"')
    expect(html).not.toContain('aria-controls="ask-panel"')
  })

  it('embeds the real sliders without a misleading close control', () => {
    const html = renderToStaticMarkup(<WeightsPanel embedded open config={data.config} weights={weights}
      onWeights={() => {}} onReset={() => {}} onClose={() => {}} />)
    expect(html).toContain('weights panel glass embedded')
    expect(html.match(/type="range"/g)).toHaveLength(3)
    expect(html).toContain('Reset to defaults')
    expect(html).not.toContain('Close weights')
  })

  it.each(data.targets)('shows compact context and a named composer for $name', target => {
    const run = runFor(data, target.id, weights)
    const html = renderToStaticMarkup(<AskPanel embedded open run={run} onRerun={() => {}} onClose={() => {}} />)
    expect(html).toContain('Analysis assistant')
    const heading = html.slice(html.indexOf('<header>'), html.indexOf('</header>'))
    expect(heading).toContain('Next message uses')
    expect(heading).toContain(target.name)
    expect(heading).toContain('Whole ranking')
    expect(html).toContain('aria-label="Send message"')
    expect(html).toContain('for="ask-input"')
    expect(html).toContain('What would you like to explore?')
    expect(html).not.toContain('ask-examples')
    expect(html).not.toContain('Close Ask AI')
  })

  it('retains viewer caveats and offers automatic and manual arrangements', () => {
    const html = renderToStaticMarkup(<TerrainViews target={data.targets[0]} site={data.sites[0]}
      relit={false} onToggleRelit={() => {}} mainWindowKm={data.config.main_window_km} />)
    expect(html).toContain('<summary>View info</summary>')
    expect(html).toContain('The meshes are for viewing; Terrain Match uses the')
    expect(html).toContain('Terrain view arrangement')
    expect(html).toContain('Side by side')
    expect(html).toContain('Stacked')
  })
})

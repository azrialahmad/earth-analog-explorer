import { useEffect, useMemo, useState } from 'react'
import type { AppData, Config, Evidence, Site, Target, Weights } from './types'
import { defaultWeights, rankSites, stability as computeStability } from './engine'
import { asset } from './ui'
import TopBar from './components/TopBar'
import SplitScene from './components/SplitScene'
import SiteShelf from './components/SiteShelf'
import MismatchCallout from './components/MismatchCallout'
import WeightsPanel from './components/WeightsPanel'
import DataDrawer from './components/DataDrawer'
import AskPanel from './chat/AskPanel'

type Panel = 'none' | 'weights' | 'data' | 'ask'

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(asset(path))
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [weights, setWeights] = useState<Weights | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('none')
  const [relit, setRelit] = useState(false)

  useEffect(() => {
    Promise.all([
      loadJson<Config>('data/config.json'),
      loadJson<Target[]>('data/targets.json'),
      loadJson<Site[]>('data/sites.json'),
      loadJson<Evidence>('data/evidence.json'),
    ]).then(([config, targets, sites, evidence]) => {
      setData({ config, targets, sites, evidence })
      setTargetId(targets[0]?.id ?? null)
      setWeights(defaultWeights(config))
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const target = data?.targets.find(t => t.id === targetId) ?? null

  const ranked = useMemo(
    () => (data && target && weights ? rankSites(data.sites, target, data.config, weights) : []),
    [data, target, weights],
  )
  const stability = useMemo(
    () => (data && target && weights ? computeStability(data.sites, target, data.config, weights) : {}),
    [data, target, weights],
  )

  // Keep a valid selection: the top-ranked site whenever the current one is gone.
  const selected = ranked.find(r => r.site.id === siteId) ?? ranked[0] ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel('none') }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  if (error) return <div className="app-status" role="alert">Could not load the data files ({error}). Reload the page; if it persists, the build is missing public/data.</div>
  if (!data || !target || !weights) return <div className="app-status" aria-live="polite">Loading terrain data…</div>

  const toggle = (p: Panel) => setPanel(cur => (cur === p ? 'none' : p))

  return (
    <div className="app">
      <SplitScene target={target} site={selected?.site ?? null} relit={relit && target.body === 'moon'} />
      <TopBar
        targets={data.targets}
        targetId={target.id}
        onPickTarget={id => { setTargetId(id); setSiteId(null); setRelit(false) }}
        fixture={data.config._fixture === true}
        panel={panel}
        onTogglePanel={toggle}
      />
      <MismatchCallout entry={selected} body={target.body} relit={relit} onToggleRelit={() => setRelit(r => !r)} />
      <SiteShelf
        ranked={ranked}
        stability={stability}
        body={target.body}
        selectedId={selected?.site.id ?? null}
        onSelect={id => { setSiteId(id); setRelit(false) }}
      />
      <WeightsPanel
        open={panel === 'weights'}
        config={data.config}
        weights={weights}
        onWeights={setWeights}
        onReset={() => setWeights(defaultWeights(data.config))}
        onClose={() => setPanel('none')}
      />
      <DataDrawer
        open={panel === 'data'}
        entry={selected}
        target={target}
        config={data.config}
        stability={selected ? stability[selected.site.id] ?? null : null}
        evidence={data.evidence}
        onClose={() => setPanel('none')}
      />
      <AskPanel
        open={panel === 'ask'}
        run={{ target, ranked, stability, config: data.config, weights, evidence: data.evidence }}
        onRerun={w => { setWeights(w); return rankSites(data.sites, target, data.config, w) }}
        onClose={() => setPanel('none')}
      />
    </div>
  )
}

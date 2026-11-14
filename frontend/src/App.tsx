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
import EvidencePanel from './components/EvidencePanel'
import DemoTour from './components/DemoTour'
import { buildDemoSteps, type DemoStep } from './demo/steps'
import AskPanel from './chat/AskPanel'
import RankExplainer from './components/RankExplainer'
import { explainCard } from './explain/card'

type Panel = 'none' | 'weights' | 'data' | 'evidence' | 'ask'

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
  const [demo, setDemo] = useState<DemoStep[] | null>(null)
  // "Why this rank?" for the selected card: opened by clicking the card that is already selected
  const [explain, setExplain] = useState(false)

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setPanel('none')
      setExplain(open => {
        // hand focus back to the card the explanation belongs to
        if (open) setTimeout(() => document.querySelector<HTMLElement>('.site-card[aria-pressed="true"]')?.focus(), 0)
        return false
      })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  if (error) return <div className="app-status" role="alert">Could not load the data files ({error}). Reload the page; if it persists, the build is missing public/data.</div>
  if (!data || !target || !weights) return <div className="app-status" aria-live="polite">Loading terrain data…</div>

  const toggle = (p: Panel) => { setExplain(false); setPanel(cur => (cur === p ? 'none' : p)) }
  const pickTarget = (id: string) => { setTargetId(id); setSiteId(null); setRelit(false); setExplain(false) }
  const closeExplain = () => {
    setExplain(false)
    document.querySelector<HTMLElement>('.site-card[aria-pressed="true"]')?.focus()
  }
  const playDemo = () => {
    const steps = buildDemoSteps(data)
    if (!steps.length) return
    setPanel('none'); setExplain(false); setDemo(steps)
  }

  return (
    <div className="app">
      <SplitScene target={target} site={selected?.site ?? null} relit={relit && target.body === 'moon'} />
      <TopBar
        targets={data.targets}
        targetId={target.id}
        onPickTarget={pickTarget}
        onPlayDemo={playDemo}
        fixture={data.config._fixture === true}
        panel={panel}
        onTogglePanel={toggle}
      />
      {/* bottom dock: stacks upward, so the demo caption, callout or explanation never overlaps the cards */}
      <div className="dock">
        {demo && (
          <DemoTour
            steps={demo}
            actions={{
              pickTarget: id => { setTargetId(id); setSiteId(null) },
              selectSite: setSiteId,
              setRelit,
              setWeights,
              resetWeights: () => setWeights(defaultWeights(data.config)),
            }}
            onEnd={() => setDemo(null)}
          />
        )}
        {/* the explanation repeats the warning text, so the callout steps aside while it is open */}
        {!(explain && selected) && (
          <MismatchCallout entry={selected} body={target.body} relit={relit} onToggleRelit={() => setRelit(r => !r)} />
        )}
        {explain && selected && (
          <RankExplainer
            ex={explainCard(selected, ranked, target, data.config, stability[selected.site.id] ?? null, weights)}
            onClose={closeExplain}
          />
        )}
        <SiteShelf
          ranked={ranked}
          stability={stability}
          body={target.body}
          targetId={target.id}
          targetName={target.name}
          selectedId={selected?.site.id ?? null}
          explainOpen={explain}
          onSelect={id => { setSiteId(id); setRelit(false) }}
          onExplain={() => { setPanel('none'); setExplain(o => !o) }}
        />
      </div>
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
      <EvidencePanel open={panel === 'evidence'} evidence={data.evidence} onClose={() => setPanel('none')} />
      <AskPanel
        open={panel === 'ask'}
        run={{ target, ranked, stability, config: data.config, weights, evidence: data.evidence }}
        onRerun={w => { setWeights(w); return rankSites(data.sites, target, data.config, w) }}
        onClose={() => setPanel('none')}
      />
    </div>
  )
}

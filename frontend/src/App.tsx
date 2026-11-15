import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { AppData, Config, Evidence, Site, Target, Weights } from './types'
import { defaultWeights, rankSites, stability as computeStability } from './engine'
import { asset, useMediaQuery } from './ui'
import { selectedEntry } from './selection'
import TopBar from './components/TopBar'
import TerrainViews from './components/TerrainViews'
import SiteList from './components/SiteList'
import SiteDetails from './components/SiteDetails'
import WeightsPanel from './components/WeightsPanel'
import DataDrawer from './components/DataDrawer'
import EvidencePanel from './components/EvidencePanel'
import DemoTour from './components/DemoTour'
import { buildDemoSteps, type DemoStep } from './demo/steps'
import AskPanel from './chat/AskPanel'
import { explainCard } from './explain/card'

type Panel = 'none' | 'weights' | 'data' | 'evidence' | 'ask'
const PANEL_IDS: Record<Exclude<Panel, 'none'>, string> = { weights: 'weights-panel', data: 'data-drawer', evidence: 'evidence-panel', ask: 'ask-panel' }

/** Narrow screens show one pane at a time behind a Sites / View / Details switcher. */
type Pane = 'sites' | 'view' | 'details'
const PANES: { id: Pane; label: string }[] = [
  { id: 'sites', label: 'Sites' },
  { id: 'view', label: 'View' },
  { id: 'details', label: 'Details' },
]

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
  const narrow = useMediaQuery('(max-width: 899px)')
  const [pane, setPane] = useState<Pane>('sites')

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

  // One completed analysis owns the next AI request, independent of card selection/panel state.
  const askRun = useMemo(() => data && target && weights ? ({
    target, ranked, stability, config: data.config, weights, evidence: data.evidence,
    siteOrder: data.sites.map(s => s.id),
  }) : null, [data, target, weights, ranked, stability])

  // One selection drives all three panes: the chosen site, or the top-ranked one when it is gone.
  const selected = selectedEntry(ranked, siteId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel('none') }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  // When an auxiliary panel closes, give focus back to the toolbar button that opened it
  // (unless the viewer has already moved focus somewhere else).
  const lastPanel = useRef<Panel>('none')
  useEffect(() => {
    const prev = lastPanel.current
    lastPanel.current = panel
    if (prev === 'none' || panel !== 'none') return
    const el = document.activeElement
    if (el === null || el === document.body || el.closest(`#${PANEL_IDS[prev]}`)) {
      document.querySelector<HTMLElement>(`[aria-controls="${PANEL_IDS[prev]}"]`)?.focus()
    }
  }, [panel])

  if (error) return <div className="app-status" role="alert">Could not load the data files ({error}). Reload the page; if it persists, the build is missing public/data.</div>
  if (!data || !target || !weights) return <div className="app-status" aria-live="polite">Loading terrain data…</div>

  const toggle = (p: Panel) => setPanel(cur => (cur === p ? 'none' : p))
  const pickTarget = (id: string) => { setTargetId(id); setSiteId(null); setRelit(false) }
  const playDemo = () => {
    const steps = buildDemoSteps(data)
    if (!steps.length) return
    setPanel('none'); setPane('view'); setDemo(steps)
  }

  const explanation = selected
    ? explainCard(selected, ranked, target, data.config, stability[selected.site.id] ?? null, weights)
    : null

  // On narrow screens each pane is a tab panel; on wide screens all three are shown together.
  const paneProps = (p: Pane) => (narrow ? { role: 'tabpanel', 'aria-labelledby': `tab-${p}`, hidden: pane !== p } : {})
  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const i = PANES.findIndex(x => x.id === pane)
    const next = e.key === 'ArrowRight' ? (i + 1) % PANES.length : e.key === 'ArrowLeft' ? (i + PANES.length - 1) % PANES.length : -1
    if (next < 0) return
    e.preventDefault()
    setPane(PANES[next].id)
    document.getElementById(`tab-${PANES[next].id}`)?.focus()
  }

  return (
    <div className="app">
      <TopBar
        targets={data.targets}
        targetId={target.id}
        onPickTarget={pickTarget}
        onPlayDemo={playDemo}
        fixture={data.config._fixture === true}
        panel={panel}
        onTogglePanel={toggle}
      />
      {narrow && (
        <div className="pane-tabs" role="tablist" aria-label="Workbench panes">
          {PANES.map(p => (
            <button
              key={p.id}
              id={`tab-${p.id}`}
              type="button"
              role="tab"
              aria-selected={pane === p.id}
              aria-controls={`pane-${p.id}`}
              tabIndex={pane === p.id ? 0 : -1}
              onClick={() => setPane(p.id)}
              onKeyDown={onTabKey}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <main className="workspace">
        <div id="pane-sites" className="pane pane-sites glass" {...paneProps('sites')}>
          <SiteList
            ranked={ranked}
            target={target}
            selectedId={selected?.site.id ?? null}
            onSelect={setSiteId}
          />
        </div>
        <div id="pane-view" className="pane pane-view" {...paneProps('view')}>
          <TerrainViews
            target={target}
            site={selected?.site ?? null}
            relit={relit && target.body === 'moon'}
            onToggleRelit={() => setRelit(r => !r)}
            mainWindowKm={data.config.main_window_km}
          />
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
        </div>
        <div id="pane-details" className="pane pane-details glass" {...paneProps('details')}>
          <SiteDetails ex={explanation} />
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
        {askRun && <AskPanel
          open={panel === 'ask'}
          run={askRun}
          onRerun={setWeights}
          onClose={() => setPanel('none')}
        />}
      </main>
    </div>
  )
}

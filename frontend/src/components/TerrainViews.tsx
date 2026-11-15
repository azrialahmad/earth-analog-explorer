import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ReliefGrid, Site, Target } from '../types'
import { asset } from '../ui'
import { reliefHeights, reliefStatusText, type ReliefSource as Source, type TerrainKind } from '../scene/terrain'
import type { LightPreset, Side, SplitRenderer, ViewLayout } from '../scene/renderer'
import './TerrainViews.css'

export interface TerrainViewsProps {
  target: Target
  site: Site | null
  /** Moon targets only: light both views with a low polar sun and no sky. */
  relit: boolean
  onToggleRelit: () => void
  /** The analysis window from config, named so the display mesh is not mistaken for the scoring grid. */
  mainWindowKm: number
}

const TONES: Record<TerrainKind, number> = { moon: 0x8d8f93, mars: 0xb5653d, earth: 0x8a7f72 }

const reliefCache = new Map<string, Promise<ReliefGrid | null>>()
function loadRelief(path: string): Promise<ReliefGrid | null> {
  let p = reliefCache.get(path)
  if (!p) {
    p = fetch(asset(path)).then(r => (r.ok ? (r.json() as Promise<ReliefGrid>) : null)).catch(() => null)
    // a failed load is not cached, so a later selection can try again
    p.then(g => { if (g === null) reliefCache.delete(path) })
    reliefCache.set(path, p)
  }
  return p
}

/** Heights from the place's own complete relief grid, or nothing. No surface stands in for missing data. */
async function reliefFor(relief: string | null): Promise<{ heights: Float32Array | null; source: Source }> {
  if (!relief) return { heights: null, source: { kind: 'none' } }
  const grid = await loadRelief(relief)
  if (!grid) return { heights: null, source: { kind: 'failed' } }
  const r = reliefHeights(grid)
  if (!r.ok) return { heights: null, source: { kind: 'unusable', problem: r.problem } }
  return { heights: r.heights, source: { kind: 'relief', size: grid.size, cell_m: grid.cell_m } }
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function SourceTag({ source }: { source: Source }) {
  if (source.kind === 'loading') return <span className="src-tag">Loading terrain…</span>
  if (source.kind === 'relief') {
    return <span className="src-tag data">Elevation relief · display mesh {source.size}×{source.size}, {Math.round(source.cell_m)} m cells</span>
  }
  if (source.kind === 'unusable') {
    return <span className="src-tag none">{source.problem.kind === 'incomplete' ? 'Incomplete elevation data' : 'Malformed elevation data'}</span>
  }
  if (source.kind === 'failed') return <span className="src-tag none">Elevation data not loaded</span>
  return <span className="src-tag none">No elevation data</span>
}

function ViewLabel({ role, name, source }: { role: string; name: string; source: Source }) {
  return (
    <div className="view-cell">
      <div className="view-label">
        <span className="label">{role}</span>
        <h2>{name}</h2>
        <SourceTag source={source} />
      </div>
      {reliefStatusText(source, name) !== null && (
        <p className="view-empty" role="status">{reliefStatusText(source, name)}</p>
      )}
    </div>
  )
}

/**
 * Two complete terrain views, target and selected Earth site, drawn with one shared camera:
 * dragging or zooming either view moves both. Side by side when the pane is wide, stacked when it is tall.
 */
export default function TerrainViews({ target, site, relit, onToggleRelit, mainWindowKm }: TerrainViewsProps) {
  const [ctrl, setCtrl] = useState<SplitRenderer | null>(null)
  const [noGL, setNoGL] = useState(false)
  const [rotating, setRotating] = useState(false) // off by default
  const [layout, setLayout] = useState<ViewLayout>('row')
  const [sources, setSources] = useState<Record<Side, Source>>({ left: { kind: 'loading' }, right: { kind: 'loading' } })
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const orbitDrag = useRef<{ x: number; y: number } | null>(null)

  // Create the renderer once (three.js is loaded on demand).
  useEffect(() => {
    let cancelled = false
    let created: SplitRenderer | null = null
    import('../scene/renderer').then(({ createSplitRenderer }) => {
      if (cancelled || !canvasRef.current) return
      try {
        created = createSplitRenderer(canvasRef.current, reduceMotion)
        setCtrl(created)
      } catch {
        setNoGL(true)
      }
    }).catch(() => { if (!cancelled) setNoGL(true) })
    return () => { cancelled = true; created?.dispose() }
  }, [])

  // Wide pane: views side by side. Tall or narrow pane: stacked, target on top.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      if (width > 0 && height > 0) setLayout(width / height >= 1.2 ? 'row' : 'column')
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { ctrl?.setLayout(layout) }, [ctrl, layout])
  useEffect(() => { ctrl?.setAutoRotate(rotating) }, [ctrl, rotating])

  const moon = target.body === 'moon'
  const preset: LightPreset = relit && moon ? 'polar' : 'inspect'
  useEffect(() => {
    ctrl?.setLight('left', preset, reduceMotion())
    ctrl?.setLight('right', preset, reduceMotion())
  }, [ctrl, preset])

  // Load one side's relief. The ground is hidden until the current place's own relief arrives,
  // and a slower response for an earlier place is ignored, so a view never shows another place's surface.
  const useSide = (side: Side, id: string | null, relief: string | null, kind: TerrainKind) => {
    useEffect(() => {
      let stale = false
      setSources(s => ({ ...s, [side]: { kind: 'loading' } }))
      ctrl?.setVisible(side, false)
      if (id === null) { setSources(s => ({ ...s, [side]: { kind: 'none' } })); return }
      reliefFor(relief).then(({ heights, source }) => {
        if (stale) return
        setSources(s => ({ ...s, [side]: source }))
        if (ctrl && heights) { ctrl.setTerrain(side, heights, TONES[kind], true); ctrl.setVisible(side, true) }
      })
      return () => { stale = true }
    }, [ctrl, id, relief, kind])
  }
  useSide('left', target.id, target.relief, target.body)
  useSide('right', site?.id ?? null, site?.relief ?? null, 'earth')

  const onSceneKey = (e: KeyboardEvent) => {
    if (!ctrl) return
    const step: Record<string, () => void> = {
      ArrowLeft: () => ctrl.orbit(0.08, 0), ArrowRight: () => ctrl.orbit(-0.08, 0),
      ArrowUp: () => ctrl.orbit(0, 0.06), ArrowDown: () => ctrl.orbit(0, -0.06),
      '+': () => ctrl.zoom(0.9), '=': () => ctrl.zoom(0.9), '-': () => ctrl.zoom(1.1),
    }
    if (step[e.key]) { e.preventDefault(); step[e.key](); setRotating(false) }
  }

  const siteName = site?.name ?? 'No site selected'
  return (
    <div className="views-pane">
      <div className="views-tools">
        <button type="button" className="btn glass" onClick={() => { ctrl?.resetView(); setRotating(false) }} disabled={!ctrl}>Reset view</button>
        <button type="button" className="btn glass" aria-pressed={rotating} onClick={() => setRotating(r => !r)} disabled={!ctrl}>
          {rotating ? 'Stop rotating' : 'Rotate'}
        </button>
        {moon && (
          <button type="button" className="btn glass" aria-pressed={relit} onClick={onToggleRelit}>Polar sun</button>
        )}
      </div>

      <div className={`views ${layout}`} ref={rootRef}>
        <canvas
          ref={canvasRef}
          className="views-gl"
          hidden={noGL}
          tabIndex={0}
          aria-label={`3D terrain: ${target.name} and ${siteName}, linked. Drag or use arrow keys to orbit both, scroll or plus and minus to zoom.`}
          onPointerDown={e => { orbitDrag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); setRotating(false) }}
          onPointerMove={e => {
            const d = orbitDrag.current
            if (!d || !ctrl) return
            ctrl.orbit(-(e.clientX - d.x) * 0.006, (e.clientY - d.y) * 0.004)
            orbitDrag.current = { x: e.clientX, y: e.clientY }
          }}
          onPointerUp={() => { orbitDrag.current = null }}
          onPointerCancel={() => { orbitDrag.current = null }}
          onWheel={e => ctrl?.zoom(1 + Math.max(-0.3, Math.min(0.3, e.deltaY * 0.001)))}
          onKeyDown={onSceneKey}
        />
        {noGL && <p className="views-note" role="status">3D needs WebGL, which this browser has turned off. The site list and details still work.</p>}
        <div className="view-cells">
          <ViewLabel role={moon ? 'Moon target' : 'Mars target'} name={target.name} source={sources.left} />
          <ViewLabel role="Earth site" name={siteName} source={sources.right} />
        </div>
      </div>

      <p className="views-foot">
        {relit && moon
          ? 'Polar sun on both views: a sun about 2° up and no sky light, as at the lunar pole. Display lighting only.'
          : 'Same display lighting on both views, for comparing shape. It is illustrative, not a simulation of either place.'}{' '}
        The meshes are for viewing; Terrain Match uses the {mainWindowKm} km window values.
      </p>
    </div>
  )
}

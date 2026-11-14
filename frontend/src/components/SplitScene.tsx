import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { ReliefGrid, Site, Target } from '../types'
import { asset } from '../ui'
import { generatedHeights, reliefHeights, seedOf, type TerrainKind } from '../scene/terrain'
import type { LightPreset, Side, SplitRenderer } from '../scene/renderer'
import './SplitScene.css'

export interface SplitSceneProps {
  target: Target
  site: Site | null
  /** Moon targets only: light the Earth side like the pole (low sun, no sky). */
  relit: boolean
}

const TONES: Record<TerrainKind, number> = { moon: 0x8d8f93, mars: 0xb5653d, earth: 0x8a7f72 }

type Source = { kind: 'loading' } | { kind: 'relief'; cell_m: number } | { kind: 'generated' }

const reliefCache = new Map<string, Promise<ReliefGrid | null>>()
function loadRelief(path: string): Promise<ReliefGrid | null> {
  let p = reliefCache.get(path)
  if (!p) {
    p = fetch(asset(path)).then(r => (r.ok ? (r.json() as Promise<ReliefGrid>) : null)).catch(() => null)
    reliefCache.set(path, p)
  }
  return p
}

/** Heights for one place: its relief grid when it has a usable one, else labelled generated terrain. */
async function terrainFor(id: string, relief: string | null, kind: TerrainKind): Promise<{ heights: Float32Array; source: Source }> {
  const grid = relief ? await loadRelief(relief) : null
  const h = grid ? reliefHeights(grid) : null
  if (grid && h) return { heights: h, source: { kind: 'relief', cell_m: grid.cell_m } }
  return { heights: generatedHeights(seedOf(id), kind), source: { kind: 'generated' } }
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function SourceTag({ source }: { source: Source }) {
  if (source.kind === 'loading') return <span className="src-tag">Loading terrain…</span>
  if (source.kind === 'relief') return <span className="src-tag data">Elevation data · {Math.round(source.cell_m)} m grid</span>
  return <span className="src-tag gen">Generated terrain · not elevation data</span>
}

/**
 * The 3D split view: target terrain on the left under its own sun, the selected Earth site
 * on the right under its sun. Drag to orbit, scroll to zoom, drag the divider to compare.
 */
export default function SplitScene({ target, site, relit }: SplitSceneProps) {
  const [split, setSplit] = useState(0.5)
  const [ctrl, setCtrl] = useState<SplitRenderer | null>(null)
  const [noGL, setNoGL] = useState(false)
  const [rotating, setRotating] = useState(() => !reduceMotion())
  const [sources, setSources] = useState<Record<Side, Source>>({ left: { kind: 'loading' }, right: { kind: 'loading' } })
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dividerDrag = useRef(false)
  const orbitDrag = useRef<{ x: number; y: number } | null>(null)
  const shown = useRef<Record<Side, boolean>>({ left: false, right: false })

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
    return () => { cancelled = true; created?.dispose(); shown.current = { left: false, right: false } }
  }, [])

  useEffect(() => { ctrl?.setSplit(split) }, [ctrl, split])
  useEffect(() => { ctrl?.setAutoRotate(rotating) }, [ctrl, rotating])

  // Left: the target.
  useEffect(() => {
    let stale = false
    const kind: TerrainKind = target.body
    setSources(s => ({ ...s, left: { kind: 'loading' } }))
    terrainFor(target.id, target.relief, kind).then(({ heights, source }) => {
      if (stale) return
      setSources(s => ({ ...s, left: source }))
      if (ctrl) {
        ctrl.setTerrain('left', heights, TONES[kind], !shown.current.left)
        ctrl.setLight('left', target.body === 'moon' ? 'polar' : 'mars', !shown.current.left)
        shown.current.left = true
      }
    })
    return () => { stale = true }
  }, [ctrl, target.id, target.relief, target.body])

  // Right: the selected Earth site.
  const siteId = site?.id ?? null
  const siteRelief = site?.relief ?? null
  useEffect(() => {
    let stale = false
    setSources(s => ({ ...s, right: { kind: 'loading' } }))
    terrainFor(siteId ?? 'no-site', siteRelief, 'earth').then(({ heights, source }) => {
      if (stale) return
      setSources(s => ({ ...s, right: source }))
      if (ctrl) {
        ctrl.setTerrain('right', heights, TONES.earth, !shown.current.right)
        shown.current.right = true
      }
    })
    return () => { stale = true }
  }, [ctrl, siteId, siteRelief])

  useEffect(() => {
    const preset: LightPreset = relit ? 'polar' : 'earth'
    ctrl?.setLight('right', preset, !shown.current.right)
  }, [ctrl, relit])

  const move = useCallback((clientX: number) => {
    const r = rootRef.current?.getBoundingClientRect()
    if (r) setSplit(Math.min(0.9, Math.max(0.1, (clientX - r.left) / r.width)))
  }, [])

  const onSceneKey = (e: KeyboardEvent) => {
    if (!ctrl) return
    const step: Record<string, () => void> = {
      ArrowLeft: () => ctrl.orbit(0.08, 0), ArrowRight: () => ctrl.orbit(-0.08, 0),
      ArrowUp: () => ctrl.orbit(0, 0.06), ArrowDown: () => ctrl.orbit(0, -0.06),
      '+': () => ctrl.zoom(0.9), '=': () => ctrl.zoom(0.9), '-': () => ctrl.zoom(1.1),
    }
    if (step[e.key]) { e.preventDefault(); step[e.key](); setRotating(false) }
  }

  const moon = target.body === 'moon'
  const pctSplit = Math.round(split * 100)
  return (
    <div className="scene" ref={rootRef} style={{ '--split': `${split * 100}%` } as CSSProperties}>
      <div className={`half left ${target.body}`} />
      <div className={`half right ${relit ? 'relit' : 'earth'}`} />
      <canvas
        ref={canvasRef}
        className="scene-gl"
        hidden={noGL}
        tabIndex={0}
        aria-label={`3D terrain: ${target.name} on the left, ${site?.name ?? 'no site'} on the right. Drag or use arrow keys to orbit, scroll or plus and minus to zoom.`}
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
      {noGL && <p className="scene-note label" role="status">3D needs WebGL, which this browser has turned off. Everything else still works.</p>}

      {ctrl && (
        <button type="button" className="btn glass rotate" aria-pressed={!rotating} onClick={() => setRotating(r => !r)}>
          {rotating ? 'Pause rotation' : 'Rotate view'}
        </button>
      )}

      <div className="side l">
        <span className="label">{moon ? 'Moon target' : 'Mars target'}</span>
        <h2>{target.name}</h2>
        <p>{moon ? 'Polar sun · no sky · black shadows' : 'Normal day · dusty sky'}</p>
        <SourceTag source={sources.left} />
      </div>
      <div className="side r">
        <span className="label">Earth site</span>
        <h2>{site?.name ?? 'No site'}</h2>
        <p>{relit ? 'Relit with a polar sun · sky off' : 'Earth sun · blue sky fills shadows'}</p>
        <SourceTag source={sources.right} />
      </div>

      <div
        className="divider"
        role="slider"
        tabIndex={0}
        aria-label="Compare target and site"
        aria-valuemin={10}
        aria-valuemax={90}
        aria-valuenow={pctSplit}
        aria-valuetext={`${pctSplit}% target, ${100 - pctSplit}% site`}
        onPointerDown={e => { dividerDrag.current = true; e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={e => { if (dividerDrag.current) move(e.clientX) }}
        onPointerUp={() => { dividerDrag.current = false }}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') setSplit(s => Math.max(0.1, s - 0.05))
          if (e.key === 'ArrowRight') setSplit(s => Math.min(0.9, s + 0.05))
        }}
      >
        <span className="grip glass" aria-hidden="true">
          <svg viewBox="0 0 18 18"><path d="M6 5 2 9l4 4M12 5l4 4-4 4" /></svg>
        </span>
      </div>
    </div>
  )
}

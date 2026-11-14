import { useCallback, useRef, useState, type CSSProperties } from 'react'
import type { Site, Target } from '../types'
import './SplitScene.css'

export interface SplitSceneProps {
  target: Target
  site: Site | null
  /** Moon targets only: light the Earth side like the pole (low sun, no sky). */
  relit: boolean
}

/**
 * F0 placeholder for the 3D split scene. The two halves, labels and the draggable divider
 * are real; the terrain rendering (react-three-fiber, relief grids, suns) is brief F2 (#6).
 */
export default function SplitScene({ target, site, relit }: SplitSceneProps) {
  const [split, setSplit] = useState(0.5)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const move = useCallback((clientX: number) => {
    const r = rootRef.current?.getBoundingClientRect()
    if (r) setSplit(Math.min(0.9, Math.max(0.1, (clientX - r.left) / r.width)))
  }, [])

  const moon = target.body === 'moon'
  const pctSplit = Math.round(split * 100)
  return (
    <div className="scene" ref={rootRef} style={{ '--split': `${split * 100}%` } as CSSProperties}>
      <div className={`half left ${target.body}`} />
      <div className={`half right ${relit ? 'relit' : 'earth'}`} />
      <p className="scene-note label">SplitScene · 3D terrain arrives with F2</p>

      <div className="side l">
        <span className="label">{moon ? 'Moon target' : 'Mars target'}</span>
        <h2>{target.name}</h2>
        <p>{moon ? 'Polar sun · no sky · black shadows' : 'Normal day · dusty sky'}</p>
      </div>
      <div className="side r">
        <span className="label">Earth site</span>
        <h2>{site?.name ?? 'No site'}</h2>
        <p>{relit ? 'Relit with a polar sun · sky off' : 'Earth sun · blue sky fills shadows'}</p>
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
        onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={e => { if (dragging.current) move(e.clientX) }}
        onPointerUp={() => { dragging.current = false }}
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

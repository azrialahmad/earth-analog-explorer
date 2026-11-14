import { useEffect, useRef, useState } from 'react'
import type { DemoActions, DemoStep } from '../demo/steps'
import './DemoTour.css'

export interface DemoTourProps {
  steps: DemoStep[]
  actions: DemoActions
  /** Called when the tour finishes or the viewer stops it. */
  onEnd: () => void
}

/**
 * Plays the demo steps one after another. Any pointer, key or wheel input stops it at once and
 * leaves the app as it is, fully usable. The scene itself jumps instead of animating when the
 * viewer prefers reduced motion.
 */
export default function DemoTour({ steps, actions, onEnd }: DemoTourProps) {
  const [i, setI] = useState(0)
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const endRef = useRef(onEnd)
  endRef.current = onEnd

  // Run the current step, then move on after its duration.
  useEffect(() => {
    const step = steps[i]
    if (!step) { endRef.current(); return }
    step.apply(actionsRef.current)
    const t = setTimeout(() => setI(n => n + 1), step.ms)
    return () => clearTimeout(t)
  }, [i, steps])

  // Stop on any input. Attached after the click that started the tour has finished.
  useEffect(() => {
    const stop = () => endRef.current()
    const opts = { capture: true } as const
    const t = setTimeout(() => {
      addEventListener('pointerdown', stop, opts)
      addEventListener('keydown', stop, opts)
      addEventListener('wheel', stop, opts)
    }, 0)
    return () => {
      clearTimeout(t)
      removeEventListener('pointerdown', stop, opts)
      removeEventListener('keydown', stop, opts)
      removeEventListener('wheel', stop, opts)
    }
  }, [])

  const step = steps[i]
  if (!step) return null
  return (
    <div className="demo glass" role="status" aria-live="polite">
      <div className="demo-head">
        <span className="label">Demo · {i + 1} of {steps.length}</span>
        <span className="demo-hint">Touch anything to take over</span>
      </div>
      <p key={i} className="demo-caption">{step.caption}</p>
      <div className="demo-progress" aria-hidden="true">
        <span key={i} style={{ animationDuration: `${step.ms}ms` }} />
      </div>
    </div>
  )
}

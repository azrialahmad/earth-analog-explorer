import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Weights } from '../types'
import { PARAM_KEYS } from '../types'
import type { AskRun } from './prompt'
import {
  CONTEXT_VERSION, MAX_HISTORY, reference, snapshot,
  type AskRequest, type Snapshot, type Turn,
} from './context'
import { AskSession } from './session'
import { AskError, checkReply, post } from './transport'
import { renderAnswer } from './answer'
import './AskPanel.css'

const displayNames = (run: AskRun): Record<string, string> => ({
  ...Object.fromEntries(run.ranked.map(r => [r.site.id, r.site.name])),
  [run.evidence.cited.source_id]: run.evidence.cited.source,
  [run.evidence.ours.source_id]: run.evidence.ours.source,
})

export type { AskRun } from './prompt'
export interface AskPanelProps {
  open: boolean
  run: AskRun
  onRerun: (w: Weights) => void
  onClose: () => void
}

type Line = { kind: 'user' | 'answer' | 'note' | 'error'; text: string; snapshot?: Snapshot }
const ASK_URL: string = import.meta.env.VITE_ASK_URL || '/api/ask'
const EXAMPLES = [
  'Which site is the best match and why is it flagged?',
  'What changes if roughness counts three times as much?',
  'How sure is the top 3?',
]

/** No extra rounding: preserve every distinction exposed by the sliders. */
export function ContextValues({ context }: { context: Snapshot }) {
  const { target, weights, config } = context.run
  return <>
    <span>{target.name} · {target.body === 'moon' ? 'Moon' : 'Mars'} · Whole ranking</span>
    <ul className="ask-weights">
      {PARAM_KEYS.map(k => <li key={k}>{config.params[k].label}: <strong>{String(weights[k])}</strong></li>)}
    </ul>
  </>
}

/** Each displayed turn owns its snapshot; only the live strip follows the controls. */
export default function AskPanel({ open, run, onRerun, onClose }: AskPanelProps) {
  const live = useMemo(() => snapshot(run), [run])
  const sessionRef = useRef<AskSession | null>(null)
  if (!sessionRef.current) sessionRef.current = new AskSession(live)
  const session = sessionRef.current
  const history = useRef<Turn[]>([])
  const lastUsed = useRef<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)

  useLayoutEffect(() => {
    const { targetChanged, interrupted } = session.update(live)
    if (targetChanged) {
      history.current = []
      lastUsed.current = null
      setLines([{ kind: 'note', text: `New conversation for ${live.run.target.name}. Previous target conversation cleared.${interrupted ? ' Pending question interrupted.' : ''}` }])
      setText('')
    } else if (interrupted) {
      setLines(ls => [...ls, { kind: 'note', text: 'Question interrupted because the analysis changed. Ask again to use the new context.' }])
    }
    if (targetChanged || interrupted) setBusy(false)
  }, [live, session])
  useLayoutEffect(() => () => session.cancel(), [session])
  useEffect(() => { listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }) }, [lines])

  async function ask(question: string) {
    const q = question.trim()
    if (!q) return
    // The ref-owned ticket prevents double Send even before React renders disabled=true.
    const ticket = session.start()
    if (!ticket) return
    const captured = ticket.snapshot
    const changedContext = lastUsed.current !== null && lastUsed.current !== captured.key
    setText('')
    setBusy(true)
    setLines(ls => [
      ...ls,
      ...(changedContext
        ? [{ kind: 'note' as const, text: 'Analysis changed. This question uses the weights below; earlier turns keep their original context.' }]
        : []),
      { kind: 'user', text: q, snapshot: captured },
    ])
    lastUsed.current = captured.key
    try {
      const context = await reference(captured)
      if (!session.current(ticket)) return
      const request: AskRequest = {
        version: CONTEXT_VERSION, conversationId: ticket.conversationId, requestId: ticket.requestId,
        context, question: q, history: history.current.slice(-MAX_HISTORY),
      }
      const raw = await post(ASK_URL, request, ticket.controller.signal)
      if (!session.current(ticket)) return
      const { reply, snapshots } = await checkReply(raw, request, captured)
      if (!session.current(ticket)) return
      const final = snapshots.at(-1) ?? captured
      // Commit only after the complete chain has passed correlation and local-engine checks.
      // Finishing before React applies intentional weights distinguishes it from a manual edit.
      if (!session.finish(ticket)) return
      history.current = [...request.history,
        { role: 'user' as const, text: q, context },
        { role: 'assistant' as const, text: reply.answer, context: reply.context },
      ].slice(-MAX_HISTORY)
      lastUsed.current = final.key
      setLines(ls => [...ls,
        ...snapshots.map(s => ({ kind: 'note' as const, text: 'AI requested a rerun. Results below were computed by the ranking engine.', snapshot: s })),
        { kind: 'answer', text: renderAnswer(reply.answer, displayNames(final.run)), snapshot: final },
      ])
      setBusy(false)
      if (snapshots.length) onRerun({ ...final.run.weights })
    } catch (error) {
      if (!session.current(ticket)) return
      setLines(ls => [...ls, { kind: 'error', text: error instanceof AskError ? error.message : 'Ask AI could not answer right now.', snapshot: captured }])
    } finally {
      // An old failure/finally can never clear a newer request's busy state.
      if (session.finish(ticket)) setBusy(false)
    }
  }

  return (
    <aside id="ask-panel" className="drawer panel glass ask" aria-label="Ask AI" hidden={!open}>
      <header>
        <div><span className="label">About {run.target.name}</span><h2>Ask AI</h2></div>
        <button type="button" className="close" aria-label="Close Ask AI" onClick={onClose}>×</button>
      </header>
      <p className="ask-scope">Answers use the analysis data sent with your question, across the whole ranking—not the selected card. It cannot change a score; it can request new weights for the engine.</p>
      <ol ref={listRef} className="ask-lines" aria-label="Conversation" tabIndex={lines.length ? 0 : -1} aria-live="polite" aria-relevant="additions">
        {lines.map((l, i) => <li key={i} className={`ask-line ${l.kind}`}>
          <div>{l.text}</div>
          {l.snapshot && <details className="ask-context-used"><summary>{l.kind === 'error' ? 'Context requested' : 'Context used'}</summary><ContextValues context={l.snapshot} /></details>}
        </li>)}
        {busy && <li className="ask-line note" role="status">Working…</li>}
      </ol>
      {lines.length === 0 && <div className="ask-examples">
        {EXAMPLES.map(q => <button key={q} type="button" className="btn glass" onClick={() => void ask(q)} disabled={busy}>{q}</button>)}
      </div>}
      <section className="ask-context-next" aria-label="Next message context">
        <h3 className="label">Next message uses</h3>
        <ContextValues context={live} />
      </section>
      <form className="ask-form" onSubmit={e => { e.preventDefault(); void ask(text) }}>
        <label htmlFor="ask-input" className="label">Your question</label>
        <textarea id="ask-input" rows={2} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(text) } }}
          placeholder="Why is this site ranked first?" />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>Ask</button>
      </form>
    </aside>
  )
}

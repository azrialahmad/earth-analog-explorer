import { useEffect, useRef, useState } from 'react'
import type { RankedSite, Weights } from '../types'
import { PARAM_KEYS } from '../types'
import { fmt } from '../ui'
import { buildSystemPrompt, parseRerunArgs, rerunResult, RERUN_TOOL, type AskRun } from './prompt'
import './AskPanel.css'

export type { AskRun } from './prompt'

export interface AskPanelProps {
  open: boolean
  run: AskRun
  onRerun: (w: Weights) => RankedSite[]
  onClose: () => void
}

type ApiMessage =
  | { role: 'user' | 'system'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

type Line = { kind: 'user' | 'answer' | 'note' | 'error'; text: string }

const ASK_URL: string = import.meta.env.VITE_ASK_URL || '/api/ask'
const MAX_TOOL_ROUNDS = 3
const EXAMPLES = [
  'Which site is the best match and why is it flagged?',
  'What changes if roughness counts three times as much?',
  'How sure is the top 3?',
]

class AskError extends Error {}

async function post(messages: ApiMessage[]): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  let res: Response
  try {
    res = await fetch(ASK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, tools: [RERUN_TOOL] }),
    })
  } catch {
    throw new AskError('Ask AI could not be reached.')
  }
  // 503 from our function; 404/405 when the site is hosted without it (e.g. GitHub Pages)
  if (res.status === 503 || res.status === 404 || res.status === 405) throw new AskError('Ask AI is not configured.')
  if (!res.ok) throw new AskError(`Ask AI could not answer right now (error ${res.status}).`)
  const data = await res.json().catch(() => null) as { choices?: { message?: { content: string | null; tool_calls?: ToolCall[] } }[] } | null
  const msg = data?.choices?.[0]?.message
  if (!msg) throw new AskError('Ask AI sent an empty reply.')
  return msg
}

/** Ask AI: answers from the current run only, and reruns the engine through the rerun_analysis tool. */
export default function AskPanel({ open, run, onRerun, onClose }: AskPanelProps) {
  const [history, setHistory] = useState<ApiMessage[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const runRef = useRef(run)
  runRef.current = run
  const listRef = useRef<HTMLOListElement>(null)

  // A new target starts a new conversation.
  useEffect(() => { setHistory([]); setLines([]) }, [run.target.id])
  useEffect(() => { listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }) }, [lines])

  const add = (l: Line) => setLines(ls => [...ls, l])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    setText('')
    setBusy(true)
    add({ kind: 'user', text: q })
    let msgs: ApiMessage[] = [...history, { role: 'user', content: q }]
    let current = runRef.current
    try {
      for (let round = 0; ; round++) {
        const msg = await post([{ role: 'system', content: buildSystemPrompt(current) }, ...msgs])
        msgs = [...msgs, { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }]
        const calls = msg.tool_calls ?? []
        if (calls.length === 0) {
          add(msg.content ? { kind: 'answer', text: msg.content } : { kind: 'error', text: 'Ask AI sent an empty reply.' })
          break
        }
        if (round >= MAX_TOOL_ROUNDS) {
          add({ kind: 'error', text: `Stopped after ${MAX_TOOL_ROUNDS} reruns without an answer.` })
          break
        }
        for (const c of calls) {
          const w = c.function?.name === 'rerun_analysis' ? parseRerunArgs(c.function.arguments) : null
          if (!w) {
            msgs = [...msgs, { role: 'tool', tool_call_id: c.id, content: JSON.stringify({ error: 'Invalid call. rerun_analysis needs three numbers, 0 to 3.' }) }]
            continue
          }
          const ranked = onRerun(w)
          current = { ...current, weights: w, ranked }
          add({ kind: 'note', text: `Reranked with weights ${PARAM_KEYS.map(k => `${current.config.params[k].label} ${fmt(w[k], 1)}`).join(', ')}.` })
          msgs = [...msgs, { role: 'tool', tool_call_id: c.id, content: JSON.stringify(rerunResult(w, ranked)) }]
        }
      }
      setHistory(msgs)
    } catch (e) {
      // never show a made-up answer: errors are shown as errors, and the question is not kept
      add({ kind: 'error', text: e instanceof AskError ? e.message : 'Ask AI could not answer right now.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside id="ask-panel" className="drawer panel glass ask" aria-label="Ask AI" hidden={!open}>
      <header>
        <div>
          <span className="label">About {run.target.name}</span>
          <h2>Ask AI</h2>
        </div>
        <button type="button" className="close" aria-label="Close Ask AI" onClick={onClose}>×</button>
      </header>
      <p className="ask-scope">Answers come only from the numbers on screen. It cannot change a score; it can rerun the ranking with other weights.</p>

      <ol ref={listRef} className="ask-lines" aria-live="polite">
        {lines.map((l, i) => <li key={i} className={`ask-line ${l.kind}`}>{l.text}</li>)}
        {busy && <li className="ask-line note">Working…</li>}
      </ol>

      {lines.length === 0 && (
        <div className="ask-examples">
          {EXAMPLES.map(q => <button key={q} type="button" className="btn glass" onClick={() => ask(q)} disabled={busy}>{q}</button>)}
        </div>
      )}

      <form className="ask-form" onSubmit={e => { e.preventDefault(); void ask(text) }}>
        <label htmlFor="ask-input" className="label">Your question</label>
        <textarea
          id="ask-input"
          rows={2}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text) } }}
          placeholder="Why is this site ranked first?"
        />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>Ask</button>
      </form>
    </aside>
  )
}

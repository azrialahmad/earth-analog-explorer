import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { AppData, Evidence } from '../types'
import { config, makeSite, makeTarget } from '../engine/fixture'
import {
  CONTEXT_VERSION, canonical, reference, rerunSnapshot, runFor, snapshot, validWeights,
  type AskRequest, type AskReply,
} from './context'
import { AskSession } from './session'
import { checkReply, post } from './transport'
import { ContextValues } from './AskPanel'

const evidence: Evidence = {
  cited: { source_id: 'c', source: 'Cited', model: 'm', metric: 'delta1', rows: [] },
  ours: { source_id: 'o', source: 'Ours', model: 'm', metric_note: 'note', rows: [], images: [] },
  not_shown: [], sky_caveat: 'sky',
}
const data: AppData = {
  config, evidence,
  targets: [
    { ...makeTarget([10, 20, 1]), id: 'moon-a' },
    { ...makeTarget([15, 25, 2]), id: 'moon-b' },
    { ...makeTarget([10, 20, 1], 'mars'), id: 'mars' },
  ],
  // Deliberately not rank order: this order feeds the seeded stability generator.
  sites: [makeSite('z', [25, 30, 1]), makeSite('a', [10, 20, 1]), makeSite('missing', [null, null, null])],
}
const weights = { slope_mean_deg: 1, slope_p90_deg: 1, roughness_m: 1 }
const a = snapshot(runFor(data, 'moon-a', weights))
const changed = snapshot(runFor(data, 'moon-a', { ...weights, roughness_m: 2.1 }))

describe('immutable analysis contexts', () => {
  it('uses deterministic full-content identity, not labels, key insertion order or rounded weights', async () => {
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }))
    expect(await reference(snapshot(structuredClone(a.run)))).toEqual(await reference(a))
    const close = snapshot(runFor(data, 'moon-a', { ...weights, roughness_m: 1.00001 }))
    expect((await reference(close)).id).not.toBe((await reference(a)).id)
    const revised = structuredClone(a.run)
    revised.evidence.sky_caveat += ' updated'
    expect((await reference(snapshot(revised))).id).not.toBe((await reference(a)).id)
  })
  it('owns frozen nested data and captures target, config, input order, nulls, windows and stability', () => {
    const input = structuredClone(a.run)
    const captured = snapshot(input)
    input.weights.roughness_m = 3
    input.target.name = 'Changed later'
    expect(captured.run.weights.roughness_m).toBe(1)
    expect(captured.run.target.name).not.toBe('Changed later')
    expect(Object.isFrozen(captured.run.ranked[0].site)).toBe(true)
    expect(captured.run.siteOrder).toEqual(data.sites.map(s => s.id))
    expect(captured.run.ranked.find(r => r.site.id === 'missing')?.terrainMatch).toBeNull()
  })
  it('reruns with the original input order, not the previous rank order', async () => {
    expect(a.run.ranked[0].site.id).toBe('a')
    const rerun = rerunSnapshot(a, changed.run.weights)
    expect(rerun.run.stability).toEqual(changed.run.stability)
    expect(await reference(rerun)).toEqual(await reference(changed))
  })
  it('requires complete, finite nonnegative weights with a finite total; adds no upper scientific bound', () => {
    expect(validWeights(weights)).toBe(true)
    expect(validWeights({ ...weights, roughness_m: 4 })).toBe(true)
    for (const w of [null, {}, { ...weights, extra: 1 }, { ...weights, roughness_m: Infinity },
      { ...weights, roughness_m: NaN }, { ...weights, roughness_m: -1 },
      { slope_mean_deg: Number.MAX_VALUE, slope_p90_deg: Number.MAX_VALUE, roughness_m: 1 }]) {
      expect(validWeights(w)).toBe(false)
    }
  })
  it('uses native-readable target/body/scope and exact weight labels without relying on hover', () => {
    const html = renderToStaticMarkup(createElement(ContextValues, { context: changed }))
    expect(html).toContain('Moon')
    expect(html).toContain('Whole ranking')
    expect(html).toContain('2.1')
    expect(html).toContain(config.params.roughness_m.label)
    expect(renderToStaticMarkup(createElement(ContextValues, { context: snapshot(runFor(data, 'mars', weights)) }))).toContain('Mars')
  })
})

describe('request generations and cancellation', () => {
  it('keeps one conversation across Moon→Moon and Moon→Mars while cancelling old requests', () => {
    const session = new AskSession(changed)
    for (const targetId of ['moon-b', 'mars']) {
      const before = session.conversationId
      const ticket = session.start()!
      const next = snapshot(runFor(data, targetId, changed.run.weights))
      expect(session.update(next)).toEqual({ targetChanged: true, interrupted: true })
      expect(session.conversationId).toBe(before)
      expect(ticket.controller.signal.aborted).toBe(true)
      expect(session.current(ticket)).toBe(false)
      expect(session.start()!.snapshot.run.weights).toEqual(changed.run.weights)
      session.cancel()
    }
  })
  it('never revives a cross-target request after Moon→Mars→Moon', () => {
    const session = new AskSession(a)
    const old = session.start()!
    session.update(snapshot(runFor(data, 'mars', weights)))
    session.update(a)
    const newer = session.start()!
    expect(newer.conversationId).toBe(old.conversationId)
    expect(newer.requestId).not.toBe(old.requestId)
    expect(old.controller.signal.aborted).toBe(true)
    expect(session.current(old)).toBe(false)
    expect(session.finish(old)).toBe(false)
    expect(session.current(newer)).toBe(true)
  })
  it('invalidates same-target edits and A→B→A, including old success, error and finally cleanup', () => {
    const session = new AskSession(a)
    const old = session.start()!
    const generation = session.conversationId
    expect(session.start()).toBeNull()
    expect(session.update(changed)).toEqual({ targetChanged: false, interrupted: true })
    expect(session.conversationId).toBe(generation)
    session.update(a)
    const newer = session.start()!
    expect(newer.requestId).not.toBe(old.requestId)
    expect(session.current(old)).toBe(false)
    expect(session.finish(old)).toBe(false)
    expect(session.current(newer)).toBe(true)
  })
  it('ignores card/panel-only renders and distinguishes a completed intentional rerun from a manual edit', () => {
    const session = new AskSession(a)
    const ticket = session.start()!
    expect(session.update(snapshot(a.run))).toEqual({ targetChanged: false, interrupted: false })
    expect(session.current(ticket)).toBe(true)
    expect(session.finish(ticket)).toBe(true)
    expect(session.update(changed)).toEqual({ targetChanged: false, interrupted: false })
    expect(session.start()!.snapshot.key).toBe(changed.key)
  })
  it('invalidates pending work on unmount/cancel', () => {
    const session = new AskSession(a)
    const ticket = session.start()!
    session.cancel()
    expect(ticket.controller.signal.aborted).toBe(true)
    expect(session.finish(ticket)).toBe(false)
  })
})

describe('correlated transport', () => {
  const request = async (): Promise<AskRequest> => ({
    version: CONTEXT_VERSION, conversationId: 'c', requestId: 'r',
    context: await reference(a), question: 'Why?', history: [],
  })
  const reply = async (): Promise<AskReply> => ({
    version: CONTEXT_VERSION, conversationId: 'c', requestId: 'r',
    base: await reference(a), context: await reference(a), reruns: [], answer: 'Explanation',
  })
  it('accepts only the captured base and locally reproducible rerun lineage', async () => {
    const q = await request()
    const r = await reply()
    expect((await checkReply(r, q, a)).snapshots).toHaveLength(0)
    const result = await reference(changed)
    const rerun = { ...r, context: result, reruns: [{ base: q.context, result }] }
    expect((await checkReply(rerun, q, a)).snapshots[0].key).toBe(changed.key)
    for (const bad of [
      { ...r, requestId: 'old' }, { ...r, conversationId: 'old' }, { ...r, version: 2 },
      { ...r, context: result }, { ...r, base: result }, { ...r, answer: '' },
      { ...rerun, reruns: [{ base: result, result }] },
      { ...rerun, reruns: [{ base: q.context, result: { ...result, id: 'a'.repeat(64) } }] },
    ]) await expect(checkReply(bad, q, a)).rejects.toThrow()
  })
  it('forwards structured data and AbortSignal, maps safe API errors, and never sends a system prompt', async () => {
    const q = await request()
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(await reply())))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await post('/api/ask', q, controller.signal)
      const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      expect(init.signal).toBe(controller.signal)
      expect(JSON.parse(init.body as string)).toEqual(q)
      for (const [status, text] of [[503, 'not configured'], [405, 'not configured'], [409, 'Reload'], [502, 'error 502']] as const) {
        fetchMock.mockImplementation(async () => new Response('{}', { status }))
        await expect(post('/api/ask', q, controller.signal)).rejects.toThrow(text)
      }
    } finally { vi.unstubAllGlobals() }
  })
})

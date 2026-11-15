import {
  CONTEXT_VERSION, MAX_TOOL_ROUNDS, reference, rerunSnapshot, sameContext, validReference,
  type AskReply, type AskRequest, type Snapshot,
} from './context.ts'

export class AskError extends Error {}

/** Never trust correlation metadata alone: reconstruct every returned rerun from the Send snapshot. */
export async function checkReply(value: unknown, request: AskRequest, base: Snapshot): Promise<{ reply: AskReply; snapshots: Snapshot[] }> {
  if (!value || typeof value !== 'object') throw new AskError('Ask AI sent an invalid reply.')
  const reply = value as AskReply
  if (reply.version !== CONTEXT_VERSION || reply.conversationId !== request.conversationId ||
    reply.requestId !== request.requestId || !validReference(reply.base) || !sameContext(reply.base, request.context) ||
    !validReference(reply.context) || typeof reply.answer !== 'string' || !reply.answer.trim() ||
    !Array.isArray(reply.reruns) || reply.reruns.length > MAX_TOOL_ROUNDS ** 2) {
    throw new AskError('Ask AI context did not match. Reload before asking again.')
  }
  let current = base
  let ref = await reference(base)
  const snapshots: Snapshot[] = []
  for (const step of reply.reruns) {
    if (!step || !validReference(step.base) || !validReference(step.result) ||
      !sameContext(step.base, ref) || step.result.targetId !== ref.targetId) {
      throw new AskError('Ask AI returned an invalid rerun context.')
    }
    current = rerunSnapshot(current, step.result.weights)
    ref = await reference(current)
    if (!sameContext(ref, step.result)) throw new AskError('Analysis data differs from the server. Reload before asking again.')
    snapshots.push(current)
  }
  if (!sameContext(ref, reply.context)) throw new AskError('Ask AI context did not match. Reload before asking again.')
  return { reply, snapshots }
}

export async function post(url: string, request: AskRequest, signal: AbortSignal): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new AskError('Ask AI could not be reached.')
  }
  if ([503, 404, 405].includes(res.status)) throw new AskError('Ask AI is not configured.')
  if (res.status === 409) throw new AskError('Analysis data differs from the server. Reload before asking again.')
  if (!res.ok) throw new AskError(`Ask AI could not answer right now (error ${res.status}).`)
  try { return await res.json() } catch { throw new AskError('Ask AI sent an unreadable reply.') }
}

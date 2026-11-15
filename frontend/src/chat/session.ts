import type { Snapshot } from './context.ts'

export interface Ticket {
  conversationId: string
  requestId: string
  controller: AbortController
  snapshot: Snapshot
}

/** Separate request lifetime from content identity: A → B → A never revives the first A. */
export class AskSession {
  conversationId = crypto.randomUUID()
  private context: Snapshot
  private active: Ticket | null = null

  constructor(context: Snapshot) { this.context = context }

  update(next: Snapshot): { targetChanged: boolean; interrupted: boolean } {
    const targetChanged = this.context.run.target.id !== next.run.target.id
    const changed = this.context.key !== next.key
    const interrupted = changed && this.active !== null
    if (changed) this.cancel()
    this.context = next
    return { targetChanged, interrupted }
  }

  start(): Ticket | null {
    if (this.active) return null
    this.active = {
      conversationId: this.conversationId, requestId: crypto.randomUUID(),
      controller: new AbortController(), snapshot: this.context,
    }
    return this.active
  }

  current(ticket: Ticket): boolean {
    return this.active === ticket && !ticket.controller.signal.aborted &&
      ticket.conversationId === this.conversationId
  }

  finish(ticket: Ticket): boolean {
    if (!this.current(ticket)) return false
    this.active = null
    return true
  }

  cancel(): void {
    this.active?.controller.abort()
    this.active = null
  }
}

/**
 * Turn-loss notice plugin. A turn that dies mid-stream after streaming answer
 * text commits `turn/end {kind:'error'}` and its `assistant/chunk` trail, but
 * no `assistant/message` — so the user saw an answer the model has no record
 * of giving. At the next turn this plugin prepends a one-line notice so the
 * model treats the hole as known rather than silently re-deriving.
 * Notice conditions and non-triggers live in the package README; rationale
 * lives in the turn-loss-notice Agent Note.
 * @module @deepseek-ai/dsh-turn-loss-notice
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export const name = 'turn-loss-notice'

/**
 * Plugin config. Empty by design: the notice text is a model-visible contract
 * and the trigger is a correctness rule, not a deployment choice.
 */
export interface Config {}

export const Config: z<Config> = z.object({})

/**
 * The complete model-visible notice. Framing is producer-baked per the
 * projection's own contract (`deriveEventMessage`: "framing is caller-owned —
 * a producer bakes it into `content`"); the projection passes it through
 * verbatim in user role.
 */
const NOTICE_TEXT = '<system-reminder>The previous response in this '
  + 'conversation failed mid-stream and was NOT retained. You have no record '
  + 'of what it said, even though the user may have seen part of it. If the '
  + 'user refers to it, say you do not have it and re-derive rather than '
  + 'reconstructing what you might have said.</system-reminder>'

/** The `{kind:'plugin'}` source stamped on every notice — the label keeps derived history from rendering it as a user prompt. */
const NOTICE_SOURCE: MessageSource = {
  kind: 'plugin',
  plugin: 'turn-loss-notice',
  form: 'notice',
  summary: 'previous response failed mid-stream; not retained',
}

/**
 * Whether the log's most recent completed turn lost streamed answer text:
 * its `turn/end` is `{kind:'error'}` AND it holds at least one `text-delta`
 * chunk later than its last content-bearing `assistant/message`.
 *
 * Both qualifiers are load-bearing. `text-delta` only: tool-call and
 * reasoning deltas are not an answer the user saw, and an error during the
 * first tool call — before any prose — is the common error timing.
 * Content-bearing only: an empty-content `assistant/message` exists solely to
 * host a max-tokens step's usage and must not anchor the "already committed"
 * boundary. Aborted turns cannot reach the predicate at all: the loop's
 * catch tests `signal.aborted` before its error branch, so a cancellation is
 * never recorded as `{kind:'error'}`. A crash tail (no `turn/end`) is also
 * structurally out of reach — closing THAT gap belongs to session repair,
 * which owns the unbalanced-log domain; do not widen this predicate toward
 * it.
 *
 * @param events - the session's event log, in seq order.
 * @returns true when the notice is due on the next entered step.
 */
export function lostStreamedText(events: readonly SessionEvent[]): boolean {
  let lastEnd: SessionEvent<'turn/end'> | undefined
  for (const event of events) {
    if (event.type === 'turn/end') lastEnd = event
  }
  if (lastEnd === undefined || lastEnd.data.reason.kind !== 'error') return false
  const turn = lastEnd.data.turn
  let uncommittedText = false
  for (const event of events) {
    if (event.type === 'assistant/message') {
      // A content-bearing commit accounts for every delta streamed before it
      // (the in-turn retry shape: a failed attempt's deltas precede the
      // retry's commit and are superseded by it).
      if (event.data.turn === turn && event.data.message.content.length > 0) uncommittedText = false
    } else if (event.type === 'assistant/chunk') {
      if (event.data.turn === turn && event.data.chunk.type === 'text-delta') uncommittedText = true
    }
  }
  return uncommittedText
}

/**
 * Install the pre-step listener.
 * @param ctx - plugin context; the listener is scoped to it and disposed with it.
 * @param _config - validated empty {@link Config}.
 */
export function apply(ctx: Context, _config: Config): void {
  ctx.on('agent/pre-step', async ({ agent, step }, next): Promise<PreStepDecision> => {
    const decision = await next()
    // First entered step of a turn only, and never into an empty step: an
    // empty first entry owns a no-step turn, and a notice alone would create
    // a model call where none would happen.
    if (step !== 1 || decision.kind !== 'enter' || decision.messages.length === 0) return decision
    if (!lostStreamedText(agent.session.events)) return decision
    const notice = createUserMessage({
      content: [{ type: 'text', text: NOTICE_TEXT }],
      source: NOTICE_SOURCE,
    })
    // Prepend: agent-loop commits decision.messages in array order before the
    // model call, so the framing precedes the prompt in both log and request
    // — and is durable even if THIS turn also dies.
    return { kind: 'enter', messages: [notice, ...decision.messages] }
  })
}

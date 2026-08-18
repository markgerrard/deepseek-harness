import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as TurnLossNotice from '@deepseek-ai/dsh-turn-loss-notice'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Behavior suite for the turn-loss notice: a turn that dies mid-stream after
 * streaming text the user saw leaves no committed assistant message — the
 * notice tells the MODEL, at the next turn, that its previous response was
 * not retained. Driven through a real agent loop against scripted adapters.
 */

/**
 * A chunk list whose iteration throws after the last chunk. MockAdapter
 * iterates the returned array, so the failure rides the iteration itself —
 * exactly a provider stream dying mid-flight.
 */
function dying(chunks: StreamChunk[]): StreamChunk[] {
  const trapped: StreamChunk[] = [...chunks]
  Object.defineProperty(trapped, Symbol.iterator, {
    value: function* (): Generator<StreamChunk> {
      yield* chunks
      throw new Error('stream died mid-flight')
    },
  })
  return trapped
}

/** Chunks that stream some text and then die (a provider stream failure). */
function failsMidStream(text: string): (options: GenerateOptions) => StreamChunk[] {
  return () => dying([
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
  ])
}

/** Chunks that stream only REASONING and then die: nothing the user saw. */
function failsAfterReasoning(): (options: GenerateOptions) => StreamChunk[] {
  return () => dying([
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'thinking…' },
  ])
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TurnLossNotice, {})
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
}

function prompt(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** Every plugin-injected user message in the log: joined text + source. */
function notices(agent: Agent): { text: string; source: unknown }[] {
  return [...agent.session.events]
    .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message' && e.data.source.kind === 'plugin')
    .map(e => ({
      text: e.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
      source: e.data.source,
    }))
}

const NOTICE_SOURCE = {
  kind: 'plugin',
  plugin: 'turn-loss-notice',
  form: 'notice',
  summary: 'previous response failed mid-stream; not retained',
}

describe('turn-loss notice', () => {
  it('injects the notice on the turn after a mid-stream failure, before the retry prompt', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([failsMidStream('partial answer'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'review the call')
    await waitForIdle(ctx, agent)
    expect(notices(agent)).toHaveLength(0) // nothing until a next turn exists

    prompt(agent, 'retry')
    await waitForIdle(ctx, agent)

    const found = notices(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('<system-reminder>')
    expect(found[0]!.text).toContain('failed mid-stream')
    expect(found[0]!.text).toContain('NOT retained')
    expect(found[0]!.source).toEqual(NOTICE_SOURCE)

    // The second model request carries the notice BEFORE the retry prompt.
    const request = adapter.requests.at(-1)!
    const texts = request.messages.flatMap(message =>
      message.content.map(block => block.type === 'text' ? block.text : ''))
    const noticeAt = texts.findIndex(text => text.includes('failed mid-stream'))
    const retryAt = texts.findIndex(text => text === 'retry')
    expect(noticeAt).toBeGreaterThanOrEqual(0)
    expect(retryAt).toBeGreaterThan(noticeAt)
  })

  it('stays silent when the turn errored before streaming any text', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([failsMidStream(''), textResponse('fine')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a2'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'first')
    await waitForIdle(ctx, agent)

    prompt(agent, 'again')
    await waitForIdle(ctx, agent)
    expect(notices(agent)).toHaveLength(0)
  })

  it('stays silent when only reasoning streamed (the user saw no text)', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([failsAfterReasoning(), textResponse('fine')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a3'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'first')
    await waitForIdle(ctx, agent)
    prompt(agent, 'again')
    await waitForIdle(ctx, agent)
    expect(notices(agent)).toHaveLength(0)
  })

  it('stays silent when the error streamed only tool-call structure (the realistic negative)', async () => {
    // A third of real assistant/chunk traffic is tool-call deltas, and turns
    // routinely OPEN with a tool-call block — an error during the first tool
    // call, before any prose, is the COMMON error timing (mark-24, r2 review:
    // this is the fixture that distinguishes the text-delta predicate from
    // r1's any-chunk predicate; a chunkless fixture passes under both).
    const ctx = await harness()
    const failsAfterToolCallDeltas = (): StreamChunk[] => dying([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: CallId('c9'), name: 'probe', argumentsDelta: '{"q"' },
    ])
    const adapter = new MockAdapter([failsAfterToolCallDeltas, textResponse('fine')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a8'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'first')
    await waitForIdle(ctx, agent)
    prompt(agent, 'again')
    await waitForIdle(ctx, agent)
    expect(notices(agent)).toHaveLength(0)
  })

  it('logs the notice BEFORE the user prompt it rides with', async () => {
    // Prepend-vs-append is the whole difference: agent-loop appends
    // decision.messages in array order, so unshift puts the framing before
    // the prompt in both the log and the model request (mark-24: nothing
    // else would catch a push).
    const ctx = await harness()
    const adapter = new MockAdapter([failsMidStream('lost'), textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a9'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'one')
    await waitForIdle(ctx, agent)
    prompt(agent, 'the retry prompt')
    await waitForIdle(ctx, agent)
    const userEvents = [...agent.session.events]
      .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message')
    const noticeIndex = userEvents.findIndex(e => e.data.source.kind === 'plugin')
    const retryIndex = userEvents.findIndex(e =>
      e.data.content.some(block => block.type === 'text' && block.text === 'the retry prompt'))
    expect(noticeIndex).toBeGreaterThanOrEqual(0)
    expect(retryIndex).toBe(noticeIndex + 1)
  })

  it('stays silent after a completed turn', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([textResponse('all good'), textResponse('still good')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a4'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'one')
    await waitForIdle(ctx, agent)
    prompt(agent, 'two')
    await waitForIdle(ctx, agent)
    expect(notices(agent)).toHaveLength(0)
  })

  it('stays silent when the lost tail is empty: streamed text already committed, later step errored', async () => {
    const ctx = await harness()
    // Step 1 commits an assistant message (text + tool call) and executes the
    // tool; step 2's stream dies before yielding anything (script exhausted).
    // The turn errors, chunks exist, but every streamed delta landed in a
    // committed message — the model remembers its own words; no notice.
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }, 'committed words'),
      failsMidStream(''),
      textResponse('fine'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a5'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'one')
    await waitForIdle(ctx, agent)

    prompt(agent, 'two')
    await waitForIdle(ctx, agent)
    expect(notices(agent)).toHaveLength(0)
  })

  it('notices the lost tail of a multi-step turn whose earlier step committed', async () => {
    const ctx = await harness()
    // Step 1 commits (tool call), step 2 streams fresh text then dies: the
    // committed step is remembered, the streamed tail is not — notice due.
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'probe', { q: 1 }),
      failsMidStream('the lost conclusion'),
      textResponse('recovered'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a6'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'one')
    await waitForIdle(ctx, agent)
    prompt(agent, 'two')
    await waitForIdle(ctx, agent)
    expect(notices(agent)).toHaveLength(1)
  })

  it('stays silent after a user-cancelled turn, even with uncommitted streamed text', async () => {
    // The abort shape is EXACTLY the loss shape minus the error kind: text
    // streamed, nothing committed. The kind conjunct is what separates "the
    // user cancelled knowingly" from "the stream died under them" — this is
    // the only test that fails if that conjunct is dropped (mutation-proven:
    // the completed-turn tests are masked by the committed-text conjunct).
    const ctx = await harness()
    const adapter = new MockAdapter(['hang', textResponse('fine')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a10'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'one')
    await new Promise(resolve => setTimeout(resolve, 10)) // let 'partial' stream
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    prompt(agent, 'two')
    await waitForIdle(ctx, agent)
    expect(notices(agent)).toHaveLength(0)
  })

  it('an earlier turn\'s committed message does not mask the errored turn\'s loss', async () => {
    // The commit anchor is PER-TURN: turn 1 completes normally, turn 2 dies
    // mid-stream — turn 1's committed message must not read as "turn 2's
    // text was committed".
    const ctx = await harness()
    const adapter = new MockAdapter([
      textResponse('a fine first answer'),
      failsMidStream('the lost second answer'),
      textResponse('recovered'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a11'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'one')
    await waitForIdle(ctx, agent)
    prompt(agent, 'two')
    await waitForIdle(ctx, agent)
    prompt(agent, 'three')
    await waitForIdle(ctx, agent)
    expect(notices(agent)).toHaveLength(1)
  })

  it('re-notices only a NEW loss on consecutive failures', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      failsMidStream('first lost answer'),
      failsMidStream('second lost answer'),
      textResponse('finally'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('a7'), { provider: 'mock', model: 'mock' })
    prompt(agent, 'one')
    await waitForIdle(ctx, agent)
    prompt(agent, 'two')
    await waitForIdle(ctx, agent)
    prompt(agent, 'three')
    await waitForIdle(ctx, agent)
    // Turn 2 carried notice #1 and then lost its own stream; turn 3 gets
    // notice #2 for that new loss. Two notices, one per actual loss.
    expect(notices(agent)).toHaveLength(2)
  })
})

/** Controller wires busy to agent/status, not the last session event. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, AgentStatus, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { TuiController } from '../src/controller.ts'
import { formatWorkingLine } from '../src/status.ts'
import { SUGGESTION_TIMEOUT_MS } from '../src/suggestion.ts'

async function mount(stream?: (options: GenerateOptions) => AsyncIterable<StreamChunk>): Promise<{
  ctx: Context
  controller: TuiController
  agent: Agent
  session: Session
  setStatus(status: AgentStatus): void
}> {
  const ctx = new Context()
  let created: Agent | undefined
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'deepseek', model: 'v4' })
  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      let status: AgentStatus = 'idle'
      Object.assign(agent, {
        id: session.id,
        options: options.agentOptions ?? {},
        session,
        inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
        get status() { return status },
        set status(next: AgentStatus) { status = next },
        ctx: agentCtx,
        cancel: () => {},
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: (message: UserMessage) => {
          agent.inbox.append('next-turn', message)
        },
        steer: () => {},
        inject: () => {},
        whenIdle: () => Promise.resolve(),
      } satisfies Partial<Agent> & { status: AgentStatus })
      created = agent
      await options.setup?.(agentCtx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  if (stream !== undefined) {
    ctx.provide('llm', {
      stream,
      listProviders: () => [],
      listModels: async () => [],
    } as never)
  }
  const controller = new TuiController(ctx, { exit: () => {} }, {
    width: 80,
    height: 24,
    cwd: '/tmp',
    provider: 'deepseek',
    model: 'v4',
  })
  await controller.start()
  if (created === undefined) throw new Error('factory did not create an agent')
  const agent = created
  return {
    ctx,
    controller,
    agent,
    session: agent.session,
    setStatus(status) {
      ;(agent as Agent & { status: AgentStatus }).status = status
      agentEvents(ctx, agent).emit('agent/status', { status })
    },
  }
}

describe('TUI busy follows agent idle', () => {
  it('clears Working after a completed turn when the agent goes idle', async () => {
    const test = await mount()
    expect(test.controller.snapshot().busy).toBe(false)

    test.setStatus('running')
    expect(test.controller.snapshot().busy).toBe(true)
    const started = test.controller.snapshot().turnStartedAt
    expect(started).toBeTypeOf('number')

    await test.controller.submit('Test')
    const surface = { surfaceOp: 'append' as const }
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Test' }],
      source: { kind: 'user' },
    }), surface)
    test.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'Ready to work.' }],
        source: { provider: 'deepseek', model: 'v4' },
      }),
    }, surface)

    const afterReply = test.controller.snapshot()
    expect(afterReply.busy).toBe(true)
    expect(test.controller.transcript().some(item => item.kind === 'assistant' && item.text.includes('Ready to work'))).toBe(true)
    expect(formatWorkingLine(1000, 3)).toContain('Working')

    test.setStatus('idle')
    const idle = test.controller.snapshot()
    expect(idle.busy).toBe(false)
    expect(idle.turnStartedAt).toBeUndefined()
    expect(idle.lastTurnMs).toBeTypeOf('number')
    expect(idle.turnClocks.length).toBeGreaterThan(0)

    await test.ctx.fiber.dispose()
  })
})

async function* textStream(text: string): AsyncIterable<StreamChunk> {
  yield { type: 'text-delta', index: 0, text }
}

function completeTurn(test: Awaited<ReturnType<typeof mount>>, userText = 'Test', assistantText = 'Ready to work.'): void {
  test.setStatus('running')
  const surface = { surfaceOp: 'append' as const }
  test.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: userText }],
    source: { kind: 'user' },
  }), surface)
  test.session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: assistantText }],
      source: { provider: 'deepseek', model: 'v4' },
    }),
  }, surface)
  test.setStatus('idle')
}

describe('suggested next prompt', () => {
  it('requests a follow-up after idle and shows it as the ghost', async () => {
    const calls: GenerateOptions[] = []
    const test = await mount((options) => {
      calls.push(options)
      return textStream('Add unit tests next')
    })
    completeTurn(test)
    await vi.waitFor(() => {
      expect(test.controller.snapshot().suggestion).toBe('Add unit tests next')
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sessionId).toBeUndefined()
    expect(calls[0]?.purpose).toBeUndefined()
    expect(calls[0]?.system).toContain('ONLY the next user prompt')
    const body = calls[0]?.messages[0]
    expect(body !== undefined && 'content' in body).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('does not request on idle without a completed user+assistant turn', async () => {
    const stream = vi.fn(textStream)
    const test = await mount(stream)
    test.setStatus('idle')
    await Promise.resolve()
    await Promise.resolve()
    expect(stream).not.toHaveBeenCalled()
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    await test.ctx.fiber.dispose()
  })

  it('falls back to the last assistant when the LLM is missing or the call fails', async () => {
    const bare = await mount()
    completeTurn(bare, 'Test', 'Ready to work.')
    await vi.waitFor(() => {
      expect(bare.controller.snapshot().suggestion).toBe('Ready to work.')
    })
    await bare.ctx.fiber.dispose()

    const test = await mount(async function* () { throw new Error('nope') })
    completeTurn(test, 'Test', 'The girl whispered a secret about the gears tonight')
    await vi.waitFor(() => {
      expect(test.controller.snapshot().suggestion).toBe('The girl whispered a secret about the gears')
    })
    await test.ctx.fiber.dispose()
  })

  it('retries once when idle arrives before the assistant card', async () => {
    const calls: GenerateOptions[] = []
    const test = await mount((options) => {
      calls.push(options)
      return textStream('Add unit tests next')
    })
    test.setStatus('running')
    const surface = { surfaceOp: 'append' as const }
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Test' }],
      source: { kind: 'user' },
    }), surface)
    test.setStatus('idle')
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    test.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'Ready to work.' }],
        source: { provider: 'deepseek', model: 'v4' },
      }),
    }, surface)
    await vi.waitFor(() => {
      expect(test.controller.snapshot().suggestion).toBe('Add unit tests next')
    })
    expect(calls).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })

  it('ignores a stale suggestion after type, submit, or a new session', async () => {
    let release: ((text: string) => void) | undefined
    const pending = new Promise<string>((resolve) => { release = resolve })
    const test = await mount(async function* () {
      const text = await pending
      yield { type: 'text-delta', index: 0, text }
    })
    completeTurn(test)
    test.controller.dispatch({ type: 'set-input', input: 'x', cursor: 1 })
    release?.('Add unit tests next')
    await Promise.resolve()
    await Promise.resolve()
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    expect(test.controller.snapshot().input).toBe('x')

    test.controller.dispatch({ type: 'set-suggestion', suggestion: 'Add unit tests next' })
    await test.controller.submit('go')
    expect(test.controller.snapshot().suggestion).toBeUndefined()

    test.controller.dispatch({ type: 'set-suggestion', suggestion: 'Add unit tests next' })
    await test.controller.handleKey('ctrl+n')
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    await test.ctx.fiber.dispose()
  })

  it('accepts Tab through handleKey when the editor is empty', async () => {
    const test = await mount()
    test.controller.dispatch({ type: 'set-suggestion', suggestion: 'Add unit tests next' })
    expect(await test.controller.handleKey('tab')).toBe(true)
    expect(test.controller.snapshot().input).toBe('Add unit tests next')
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    await test.ctx.fiber.dispose()
  })

  it('caps junk model output and ignores a stale in-flight request when a new turn starts', async () => {
    const test = await mount(() => textStream('one two three four five six seven eight nine ten eleven'))
    completeTurn(test)
    await vi.waitFor(() => {
      expect(test.controller.snapshot().suggestion).toBe('one two three four five six seven eight nine ten')
    })
    let release: ((text: string) => void) | undefined
    const pending = new Promise<string>((resolve) => { release = resolve })
    const delayed = await mount(async function* () {
      const text = await pending
      yield { type: 'text-delta', index: 0, text }
    })
    completeTurn(delayed)
    delayed.setStatus('running')
    release?.('late suggestion')
    await Promise.resolve()
    await Promise.resolve()
    expect(delayed.controller.snapshot().suggestion).toBeUndefined()
    await test.ctx.fiber.dispose()
    await delayed.ctx.fiber.dispose()
  })

  it('dismisses the ghost on escape without accepting it', async () => {
    const test = await mount()
    test.controller.dispatch({ type: 'set-suggestion', suggestion: 'Add unit tests next' })
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    expect(test.controller.snapshot().input).toBe('')
    await test.ctx.fiber.dispose()
  })

  it('applies fallback immediately even when llm.stream never yields', async () => {
    const test = await mount(async function* (options) {
      await new Promise<never>((_, reject) => {
        const fail = (): void => { reject(new Error('aborted')) }
        if (options.signal?.aborted === true) {
          fail()
          return
        }
        options.signal?.addEventListener('abort', fail, { once: true })
      })
    })
    completeTurn(test, 'Test', 'Ready to work.')
    expect(test.controller.snapshot().suggestion).toBe('Ready to work.')
    expect(await test.controller.handleKey('tab')).toBe(true)
    expect(test.controller.snapshot().input).toBe('Ready to work.')
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    await test.ctx.fiber.dispose()
  })

  it('keeps a fallback when the stream text is empty', async () => {
    const test = await mount(() => textStream('   '))
    completeTurn(test, 'Test', 'Ready to work.')
    expect(test.controller.snapshot().suggestion).toBe('Ready to work.')
    await vi.waitFor(() => {
      expect(test.controller.snapshot().suggestion).toBe('Ready to work.')
    })
    expect(await test.controller.handleKey('tab')).toBe(true)
    expect(test.controller.snapshot().input).toBe('Ready to work.')
    await test.ctx.fiber.dispose()
  })

  it('replaces the fallback when a successful stream returns a suggestion', async () => {
    let release: ((text: string) => void) | undefined
    const pending = new Promise<string>((resolve) => { release = resolve })
    const test = await mount(async function* () {
      const text = await pending
      yield { type: 'text-delta', index: 0, text }
    })
    completeTurn(test, 'Test', 'Ready to work.')
    expect(test.controller.snapshot().suggestion).toBe('Ready to work.')
    release?.('Add unit tests next')
    await vi.waitFor(() => {
      expect(test.controller.snapshot().suggestion).toBe('Add unit tests next')
    })
    await test.ctx.fiber.dispose()
  })

  it('keeps the fallback when the stream times out or is aborted', async () => {
    const signals: AbortSignal[] = []
    const test = await mount(async function* (options) {
      if (options.signal !== undefined) signals.push(options.signal)
      await new Promise<never>((_, reject) => {
        const fail = (): void => { reject(new Error('aborted')) }
        if (options.signal?.aborted === true) {
          fail()
          return
        }
        options.signal?.addEventListener('abort', fail, { once: true })
      })
    })
    vi.useFakeTimers()
    try {
      completeTurn(test, 'Test', 'Ready to work.')
      expect(test.controller.snapshot().suggestion).toBe('Ready to work.')
      expect(signals[0]?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(SUGGESTION_TIMEOUT_MS)
      expect(signals[0]?.aborted).toBe(true)
      expect(test.controller.snapshot().suggestion).toBe('Ready to work.')
    } finally {
      vi.useRealTimers()
    }
    expect(await test.controller.handleKey('tab')).toBe(true)
    expect(test.controller.snapshot().input).toBe('Ready to work.')
    await test.ctx.fiber.dispose()
  })
})

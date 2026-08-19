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
        inbox: new Inbox(session, {
          inserted: (message) => { agentEvents(ctx, agent).emit('agent/inbox/inserted', { message }) },
          discarded: (message) => { agentEvents(ctx, agent).emit('agent/inbox/discarded', { message }) },
          claimed: (message, turn) => { agentEvents(ctx, agent).emit('agent/inbox/claimed', { message, turn }) },
        }),
        get status() { return status },
        set status(next: AgentStatus) { status = next },
        ctx: agentCtx,
        cancel: vi.fn((_cause, options?: { keepInbox?: boolean }) => {
          if (options?.keepInbox !== true) agent.inbox.clear()
        }),
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: (message: UserMessage) => {
          agent.inbox.append('next-turn', message)
        },
        steer: (message: UserMessage) => {
          agent.inbox.append('next-step', message)
        },
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
    const stream = vi.fn((_options: GenerateOptions) => textStream('unused'))
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

describe('TUI next-turn message queue', () => {
  it('appends a queued row and clears the editor when submit runs while busy', async () => {
    const test = await mount()
    test.setStatus('running')
    test.controller.dispatch({ type: 'set-input', input: 'look at tests', cursor: 13 })
    await test.controller.submit('look at tests')
    const snap = test.controller.snapshot()
    expect(snap.input).toBe('')
    expect(snap.queued).toEqual([
      { id: test.agent.inbox.nextTurn[0]?.id, text: 'look at tests' },
    ])
    expect(test.agent.inbox.nextTurn).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })

  it('drops the queued row when the inbox claims or discards it', async () => {
    const test = await mount()
    test.setStatus('running')
    await test.controller.submit('look at tests')
    expect(test.controller.snapshot().queued).toHaveLength(1)

    const claimed = test.agent.inbox.claim('next-turn', 1)
    expect(claimed).toHaveLength(1)
    expect(test.controller.snapshot().queued).toEqual([])

    await test.controller.submit('another look')
    expect(test.controller.snapshot().queued).toHaveLength(1)
    const queued = test.agent.inbox.nextTurn[0]
    expect(queued).toBeDefined()
    expect(queued !== undefined && test.agent.inbox.remove(queued.id)).toBe(true)
    expect(test.controller.snapshot().queued).toEqual([])
    expect(test.agent.inbox.nextTurn).toHaveLength(0)
    await test.ctx.fiber.dispose()
  })

  it('restores the last queued text on Up when the editor is empty', async () => {
    const test = await mount()
    test.setStatus('running')
    await test.controller.submit('first')
    await test.controller.submit('look at tests')
    expect(test.controller.snapshot().queued.map(item => item.text)).toEqual(['first', 'look at tests'])
    expect(test.controller.snapshot().input).toBe('')

    expect(await test.controller.handleKey('up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('look at tests')
    expect(test.controller.snapshot().queued.map(item => item.text)).toEqual(['first'])
    expect(test.agent.inbox.nextTurn).toHaveLength(1)
    expect(test.agent.inbox.nextTurn[0] && 'content' in test.agent.inbox.nextTurn[0]).toBe(true)

    expect(await test.controller.handleKey('up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('look at tests')
    test.controller.dispatch({ type: 'clear-input' })
    expect(await test.controller.handleKey('up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('first')
    expect(test.controller.snapshot().queued).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('keeps queued follow-ups when cancel is called with keepInbox', async () => {
    const test = await mount()
    test.setStatus('running')
    await test.controller.submit('look at tests')
    expect(test.controller.snapshot().queued).toHaveLength(1)

    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    expect(test.controller.snapshot().queued.map(item => item.text)).toEqual(['look at tests'])
    expect(test.agent.inbox.nextTurn).toHaveLength(1)

    test.agent.cancel({ kind: 'user' })
    expect(test.controller.snapshot().queued).toEqual([])
    expect(test.agent.inbox.nextTurn).toHaveLength(0)
    await test.ctx.fiber.dispose()
  })
})

describe('TUI next-step steer', () => {
  it('appends a steer row, not a queued next-turn row, when submitSteer runs while busy', async () => {
    const test = await mount()
    test.setStatus('running')
    test.controller.dispatch({ type: 'set-input', input: 'stop rewriting', cursor: 14 })
    await test.controller.submitSteer('stop rewriting')
    const snap = test.controller.snapshot()
    expect(snap.input).toBe('')
    expect(snap.queued).toEqual([])
    expect(snap.steering).toEqual([
      { id: test.agent.inbox.nextStep[0]?.id, text: 'stop rewriting' },
    ])
    expect(test.agent.inbox.nextStep).toHaveLength(1)
    expect(test.agent.inbox.nextTurn).toHaveLength(0)
    await test.ctx.fiber.dispose()
  })

  it('steers on Shift+T while busy and still followup/queues on Enter', async () => {
    const test = await mount()
    test.setStatus('running')
    test.controller.dispatch({ type: 'set-input', input: 'use the other file', cursor: 18 })
    expect(await test.controller.handleKey('shift+t')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().steering.map(item => item.text)).toEqual(['use the other file'])
    expect(test.agent.inbox.nextStep).toHaveLength(1)

    test.controller.dispatch({ type: 'set-input', input: 'also via ctrl+t', cursor: 16 })
    expect(await test.controller.handleKey('ctrl+t')).toBe(true)
    expect(test.controller.snapshot().steering.map(item => item.text)).toEqual([
      'use the other file',
      'also via ctrl+t',
    ])

    test.controller.dispatch({ type: 'set-input', input: 'look at tests', cursor: 13 })
    expect(await test.controller.handleKey('enter')).toBe(true)
    expect(test.controller.snapshot().queued.map(item => item.text)).toEqual(['look at tests'])
    expect(test.agent.inbox.nextTurn).toHaveLength(1)
    expect(test.agent.inbox.nextStep).toHaveLength(2)
    await test.ctx.fiber.dispose()
  })

  it('steers on Ctrl+T while busy and still followup/queues on Enter', async () => {
    const test = await mount()
    test.setStatus('running')
    test.controller.dispatch({ type: 'set-input', input: 'use the other file', cursor: 18 })
    expect(await test.controller.handleKey('ctrl+t')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().steering.map(item => item.text)).toEqual(['use the other file'])
    expect(test.controller.snapshot().queued).toEqual([])
    expect(test.agent.inbox.nextStep).toHaveLength(1)

    test.controller.dispatch({ type: 'set-input', input: 'look at tests', cursor: 13 })
    expect(await test.controller.handleKey('enter')).toBe(true)
    expect(test.controller.snapshot().queued.map(item => item.text)).toEqual(['look at tests'])
    expect(test.controller.snapshot().steering.map(item => item.text)).toEqual(['use the other file'])
    expect(test.agent.inbox.nextTurn).toHaveLength(1)
    expect(test.agent.inbox.nextStep).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })

  it('drops the steer row when the inbox claims or discards it', async () => {
    const test = await mount()
    test.setStatus('running')
    await test.controller.submitSteer('stop rewriting')
    expect(test.controller.snapshot().steering).toHaveLength(1)

    const claimed = test.agent.inbox.claim('next-step', 1)
    expect(claimed).toHaveLength(1)
    expect(test.controller.snapshot().steering).toEqual([])

    await test.controller.submitSteer('try again')
    expect(test.controller.snapshot().steering).toHaveLength(1)
    const steered = test.agent.inbox.nextStep[0]
    expect(steered).toBeDefined()
    expect(steered !== undefined && test.agent.inbox.remove(steered.id)).toBe(true)
    expect(test.controller.snapshot().steering).toEqual([])
    expect(test.agent.inbox.nextStep).toHaveLength(0)
    await test.ctx.fiber.dispose()
  })

  it('restores next-turn first, then next-step, on Up when the editor is empty', async () => {
    const test = await mount()
    test.setStatus('running')
    await test.controller.submitSteer('steer first')
    await test.controller.submit('queued later')
    expect(test.controller.snapshot().steering.map(item => item.text)).toEqual(['steer first'])
    expect(test.controller.snapshot().queued.map(item => item.text)).toEqual(['queued later'])
    expect(test.controller.snapshot().input).toBe('')

    expect(await test.controller.handleKey('up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('queued later')
    expect(test.controller.snapshot().queued).toEqual([])
    expect(test.controller.snapshot().steering.map(item => item.text)).toEqual(['steer first'])
    expect(test.agent.inbox.nextTurn).toHaveLength(0)
    expect(test.agent.inbox.nextStep).toHaveLength(1)

    test.controller.dispatch({ type: 'clear-input' })
    expect(await test.controller.handleKey('up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('steer first')
    expect(test.controller.snapshot().steering).toEqual([])
    expect(test.agent.inbox.nextStep).toHaveLength(0)

    test.controller.dispatch({ type: 'clear-input' })
    await test.controller.submitSteer('only steer')
    expect(await test.controller.handleKey('ctrl+up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('only steer')
    expect(test.controller.snapshot().steering).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('does not map Shift+Tab to sendMode; Enter always queues and Ctrl+Enter may still steer', async () => {
    const test = await mount()
    test.setStatus('running')
    expect(test.controller.snapshot().focus).toBe('editor')
    expect(test.controller.snapshot()).not.toHaveProperty('sendMode')

    test.controller.dispatch({ type: 'set-input', input: 'stop rewriting', cursor: 14 })
    expect(await test.controller.handleKey('shift+tab')).toBe(true)
    expect(test.controller.snapshot().input).toBe('stop rewriting')
    expect(test.controller.snapshot().steering).toEqual([])
    expect(test.controller.snapshot().queued).toEqual([])
    expect(test.controller.snapshot().focus).toBe('editor')

    expect(await test.controller.handleKey('enter')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().queued.map(item => item.text)).toEqual(['stop rewriting'])
    expect(test.controller.snapshot().steering).toEqual([])
    expect(test.agent.inbox.nextTurn).toHaveLength(1)
    expect(test.agent.inbox.nextStep).toHaveLength(0)

    test.controller.dispatch({ type: 'set-input', input: 'use the other file', cursor: 18 })
    expect(await test.controller.handleKey('ctrl+enter')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().steering.map(item => item.text)).toEqual(['use the other file'])
    expect(test.agent.inbox.nextStep).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })
})

describe('TUI prompt history', () => {
  it('recalls submitted prompts on Up when nothing is queued', async () => {
    const test = await mount()
    await test.controller.submit('look at tests')
    await test.controller.submit('ship it')
    expect(test.controller.snapshot().history).toEqual(['look at tests', 'ship it'])
    test.agent.inbox.clear()
    test.controller.dispatch({ type: 'set-queued', queued: [], steering: [] })
    expect(test.controller.snapshot().input).toBe('')

    expect(await test.controller.handleKey('up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('ship it')
    expect(await test.controller.handleKey('up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('look at tests')
    expect(await test.controller.handleKey('down')).toBe(true)
    expect(test.controller.snapshot().input).toBe('ship it')
    expect(await test.controller.handleKey('down')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    await test.ctx.fiber.dispose()
  })

  it('takes back a queued message before recalling history', async () => {
    const test = await mount()
    test.controller.dispatch({ type: 'push-history', text: 'older prompt' })
    test.setStatus('running')
    await test.controller.submit('queued later')
    expect(test.controller.snapshot().queued.map(item => item.text)).toEqual(['queued later'])
    expect(await test.controller.handleKey('up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('queued later')
    expect(test.controller.snapshot().queued).toEqual([])
    test.controller.dispatch({ type: 'clear-input' })
    expect(await test.controller.handleKey('up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('queued later')
    expect(await test.controller.handleKey('up')).toBe(true)
    expect(test.controller.snapshot().input).toBe('older prompt')
    await test.ctx.fiber.dispose()
  })

  it('reverse-searches history with Ctrl+R', async () => {
    const test = await mount()
    await test.controller.submit('look at tests')
    await test.controller.submit('ship it')
    test.controller.dispatch({ type: 'set-input', input: 'te', cursor: 2 })
    expect(await test.controller.handleKey('ctrl+r')).toBe(true)
    expect(test.controller.snapshot().input).toBe('look at tests')
    await test.ctx.fiber.dispose()
  })

  it('accepts the ghost on Right when the editor is empty', async () => {
    const test = await mount()
    test.controller.dispatch({ type: 'set-suggestion', suggestion: 'Add unit tests next' })
    expect(await test.controller.handleKey('right')).toBe(true)
    expect(test.controller.snapshot().input).toBe('Add unit tests next')
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    await test.ctx.fiber.dispose()
  })
})

describe('TUI Ctrl+C', () => {
  it('cancels a busy turn with keepInbox and does not open quit', async () => {
    const test = await mount()
    test.setStatus('running')
    await test.controller.submit('look at tests')
    expect(test.controller.snapshot().queued).toHaveLength(1)
    expect(await test.controller.handleKey('ctrl+c')).toBe(true)
    expect(test.agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    expect(test.controller.snapshot().overlay).toEqual({ kind: 'none' })
    expect(test.controller.snapshot().queued.map(item => item.text)).toEqual(['look at tests'])
    await test.ctx.fiber.dispose()
  })

  it('clears idle editor text on the first Ctrl+C', async () => {
    const test = await mount()
    test.controller.dispatch({ type: 'set-input', input: 'hello', cursor: 5 })
    expect(await test.controller.handleKey('ctrl+c')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().overlay).toEqual({ kind: 'none' })
    expect(await test.controller.handleKey('ctrl+c')).toBe(true)
    expect(test.controller.snapshot().overlay).toEqual({ kind: 'quit', selectedNope: true })
    await test.ctx.fiber.dispose()
  })
})

describe('TUI slash chrome commands', () => {
  it('clears the visual transcript without dropping the session log', async () => {
    const test = await mount()
    completeTurn(test, 'Hello', 'Ready to work.')
    expect(test.controller.transcript().some(item => item.kind === 'user')).toBe(true)
    const seq = test.session.events[test.session.events.length - 1]?.seq ?? 0
    await test.controller.submit('/clear')
    expect(test.controller.snapshot().screen).toBe('landing')
    expect(test.controller.snapshot().clearedSeq).toBe(seq)
    expect(test.controller.transcript()).toEqual([])
    expect(test.session.events.length).toBeGreaterThan(0)
    await test.ctx.fiber.dispose()
  })

  it('opens a cost overlay from token facts', async () => {
    const test = await mount()
    test.controller.dispatch({ type: 'set-tokens', usedTokens: 1280, contextWindow: 128000 })
    await test.controller.submit('/cost')
    expect(test.controller.snapshot().overlay).toEqual({ kind: 'cost' })
    await test.ctx.fiber.dispose()
  })
})

describe('TUI compact command', () => {
  it('dispatches /compact through ctx.commands', async () => {
    const test = await mount()
    const execute = vi.fn(async () => ({
      commandId: 'cmd-1',
      result: { kind: 'success', text: 'Compacted 3 history items (~10 tokens).' },
    }))
    test.ctx.provide('commands', {
      list: () => [],
      execute,
      find: () => undefined,
      register: () => () => {},
    } as never)
    await test.controller.submit('/compact')
    expect(execute).toHaveBeenCalled()
    expect(String(execute.mock.calls[0]?.[1])).toBe('/compact')
    await test.ctx.fiber.dispose()
  })
})

describe('TUI agents command', () => {
  it('opens an agents overlay from ctx.subagents.listChildren', async () => {
    const test = await mount()
    test.ctx.provide('subagents', {
      listChildren: async () => [
        { kind: 'child', id: 'child-1', mode: 'continuable', label: 'researcher' },
        { kind: 'child', id: 'child-2', mode: 'one-shot', label: 'writer' },
        { kind: 'diagnostic', id: 'child-3', reason: 'corrupt' },
      ],
    } as never)
    await test.controller.submit('/agents')
    expect(test.controller.snapshot().overlay).toEqual({ kind: 'agents', selected: 0 })
    expect(test.controller.snapshot().agents).toEqual([
      { id: 'child-1', name: 'researcher', mode: 'continuable', status: 'ready' },
      { id: 'child-2', name: 'writer', mode: 'one-shot', status: 'ready' },
    ])
    await test.controller.confirmOverlay()
    expect(test.controller.snapshot().overlay).toEqual({ kind: 'none' })
    await test.ctx.fiber.dispose()
  })
})

describe('TUI bang shell and at-path', () => {
  it('runs ! through ctx.shell and keeps the result off the session log', async () => {
    const test = await mount()
    const run = vi.fn(async () => ({
      exitCode: 0,
      timedOut: false,
      stdout: { text: 'ok' },
      stderr: { text: '' },
    }))
    test.ctx.provide('shell', {
      resolve: (request: { command: string }) => request,
      run,
    } as never)
    await test.controller.submit('!echo ok')
    expect(run).toHaveBeenCalled()
    expect(test.controller.transcript().some(item => item.kind === 'command' && item.text.includes('ok'))).toBe(true)
    expect(test.session.events.some(event => event.type === 'command/done')).toBe(false)
    await test.ctx.fiber.dispose()
  })

  it('explains the bash tool when ctx.shell is missing', async () => {
    const test = await mount()
    await test.controller.submit('!pwd')
    const card = test.controller.transcript().find(item => item.kind === 'command')
    expect(card?.text).toContain('bash tool')
    await test.ctx.fiber.dispose()
  })
})

describe('TUI permission mode', () => {
  it('cycles plan / default / accept edits through ctx.planMode and ctx.permissionPresets', async () => {
    const test = await mount()
    const setPlan = vi.fn(() => 'committed')
    const setPreset = vi.fn()
    let planActive = false
    let preset = 'workspace-write'
    test.ctx.provide('planMode', {
      get: () => ({ active: planActive }),
      set: (_agent: unknown, active: boolean) => {
        planActive = active
        return setPlan()
      },
    } as never)
    test.ctx.provide('permissionPresets', {
      names: ['workspace-write', 'danger-full-access'],
      current: () => preset,
      set: (_session: unknown, name: string) => {
        preset = name
        setPreset(name)
      },
    } as never)
    test.controller.refreshPermission()
    expect(test.controller.snapshot().permissionMode).toBe('default')

    expect(await test.controller.handleKey('shift+tab')).toBe(true)
    expect(setPreset).toHaveBeenCalledWith('danger-full-access')
    expect(planActive).toBe(false)
    expect(test.controller.snapshot().permissionMode).toBe('accept edits')

    expect(await test.controller.handleKey('shift+tab')).toBe(true)
    expect(setPlan).toHaveBeenCalled()
    expect(planActive).toBe(true)
    expect(test.controller.snapshot().permissionMode).toBe('plan')
    expect(test.controller.snapshot().notice?.text).toContain('plan')

    expect(await test.controller.handleKey('shift+tab')).toBe(true)
    expect(planActive).toBe(false)
    expect(setPreset).toHaveBeenCalledWith('workspace-write')
    expect(test.controller.snapshot().permissionMode).toBe('default')

    expect(test.controller.snapshot().input).toBe('')
    await test.ctx.fiber.dispose()
  })

  it('falls back to /plan and /permission when only commands are mounted', async () => {
    const test = await mount()
    const execute = vi.fn(async (_agent: unknown, line: string) => ({
      commandId: 'cmd-1',
      result: { kind: 'success', text: line },
    }))
    test.ctx.provide('commands', {
      list: () => [
        { name: 'plan', description: 'Enter or leave plan mode' },
        { name: 'permission', description: 'Switch the permission preset' },
      ],
      execute,
      find: () => undefined,
      register: () => () => {},
    } as never)
    test.controller.refreshPermission()
    expect(test.controller.snapshot().permissionMode).toBe('default')
    expect(await test.controller.handleKey('shift+tab')).toBe(true)
    expect(String(execute.mock.calls[0]?.[1])).toBe('/permission danger-full-access')
    await test.ctx.fiber.dispose()
  })
})

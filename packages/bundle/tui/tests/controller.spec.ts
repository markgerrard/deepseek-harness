/** Controller wires busy to agent/status, not the last session event. */

import { writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, AgentStatus, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { TuiController } from '../src/controller.ts'
import { chromeAction } from '../src/state.ts'
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

  it('does not leak last-assistant text into the editor when the LLM is missing or fails', async () => {
    const bare = await mount()
    completeTurn(bare, 'Test', 'Hi! I am your coding agent for the')
    await vi.waitFor(() => {
      expect(bare.controller.snapshot().suggestion).toBe('Hi! I am your coding agent for the')
    })
    expect(bare.controller.snapshot().input).toBe('')
    expect(bare.controller.transcript().some(item => item.kind === 'user' && item.text.includes('Suggest the next user follow-up'))).toBe(false)
    await bare.ctx.fiber.dispose()

    const test = await mount(async function* () { throw new Error('nope') })
    completeTurn(test, 'Test', 'Hi! I am your coding agent for the')
    await vi.waitFor(() => {
      expect(test.controller.snapshot().suggestion).toBe('Hi! I am your coding agent for the')
    })
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.transcript().some(item => item.kind === 'user' && item.text.includes('Suggest the next user follow-up'))).toBe(false)
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

  it('keeps Ask DSH while llm.stream has not settled', async () => {
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
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    expect(test.controller.snapshot().input).toBe('')
    expect(await test.controller.handleKey('tab')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    await test.ctx.fiber.dispose()
  })

  it('falls back to a capped last-assistant ghost when the stream text is empty', async () => {
    const test = await mount(() => textStream('   '))
    completeTurn(test, 'Test', 'Ready to work.')
    await vi.waitFor(() => {
      expect(test.controller.snapshot().suggestion).toBe('Ready to work.')
    })
    expect(test.controller.snapshot().input).toBe('')
    await test.ctx.fiber.dispose()
  })

  it('shows an LLM follow-up ghost without first copying the assistant reply', async () => {
    let release: ((text: string) => void) | undefined
    const pending = new Promise<string>((resolve) => { release = resolve })
    const test = await mount(async function* () {
      const text = await pending
      yield { type: 'text-delta', index: 0, text }
    })
    completeTurn(test, 'Test', 'Ready to work.')
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    release?.('Add unit tests next')
    await vi.waitFor(() => {
      expect(test.controller.snapshot().suggestion).toBe('Add unit tests next')
    })
    await test.ctx.fiber.dispose()
  })

  it('falls back to a capped last-assistant ghost when the stream times out', async () => {
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
      expect(test.controller.snapshot().suggestion).toBeUndefined()
      expect(signals[0]?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(SUGGESTION_TIMEOUT_MS)
      expect(signals[0]?.aborted).toBe(true)
      expect(test.controller.snapshot().suggestion).toBe('Ready to work.')
      expect(test.controller.snapshot().input).toBe('')
    } finally {
      vi.useRealTimers()
    }
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

  it('does not steer on Shift+T; Ctrl+T steers while busy and Enter still queues', async () => {
    const test = await mount()
    test.setStatus('running')
    test.controller.dispatch({ type: 'set-input', input: 'use the other file', cursor: 18 })
    expect(await test.controller.handleKey('shift+t')).toBe(false)
    expect(test.controller.snapshot().input).toBe('use the other file')
    expect(test.controller.snapshot().steering).toEqual([])
    expect(test.agent.inbox.nextStep).toHaveLength(0)

    expect(await test.controller.handleKey('ctrl+t')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().steering.map(item => item.text)).toEqual(['use the other file'])
    expect(test.agent.inbox.nextStep).toHaveLength(1)

    test.controller.dispatch({ type: 'set-input', input: 'look at tests', cursor: 13 })
    expect(await test.controller.handleKey('enter')).toBe(true)
    expect(test.controller.snapshot().queued.map(item => item.text)).toEqual(['look at tests'])
    expect(test.agent.inbox.nextTurn).toHaveLength(1)
    expect(test.agent.inbox.nextStep).toHaveLength(1)
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

  it('cycles a local default / accept edits / plan fallback when nothing is mounted', async () => {
    const test = await mount()
    expect(test.controller.snapshot().permissionMode).toBe('default')
    expect(await test.controller.handleKey('shift+tab')).toBe(true)
    expect(test.controller.snapshot().permissionMode).toBe('accept edits')
    expect(test.controller.snapshot().notice?.text).toContain('accept edits')
    expect(await test.controller.handleKey('shift+tab')).toBe(true)
    expect(test.controller.snapshot().permissionMode).toBe('plan')
    expect(await test.controller.handleKey('shift+tab')).toBe(true)
    expect(test.controller.snapshot().permissionMode).toBe('default')
    await test.ctx.fiber.dispose()
  })
})

describe('TUI transcript scrollback', () => {
  it('unpins on PageUp and re-pins on PageDown or submit', async () => {
    const test = await mount()
    const surface = { surfaceOp: 'append' as const }
    for (const [index, text] of ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].entries()) {
      test.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }), surface)
      test.session.append('assistant/message', {
        turn: index + 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: `ok ${text}` }],
          source: { provider: 'deepseek', model: 'v4' },
        }),
      }, surface)
    }
    test.controller.dispatch({ type: 'set-screen', screen: 'chat' })
    test.controller.dispatch({ type: 'resize', width: 80, height: 12 })
    expect(test.controller.snapshot().transcriptPinned).toBe(true)
    expect(await test.controller.handleKey('pageup')).toBe(true)
    expect(test.controller.snapshot().transcriptPinned).toBe(false)
    expect(test.controller.snapshot().transcriptStart).toBeGreaterThanOrEqual(0)
    expect(await test.controller.handleKey('pagedown')).toBe(true)
    expect(await test.controller.handleKey('pagedown')).toBe(true)
    expect(test.controller.snapshot().transcriptPinned).toBe(true)
    expect(await test.controller.handleKey('pageup')).toBe(true)
    expect(test.controller.snapshot().transcriptPinned).toBe(false)
    const afterPage = test.controller.snapshot().transcriptStart
    expect(await test.controller.handleKey('shift+down')).toBe(true)
    expect(await test.controller.handleKey('shift+down')).toBe(true)
    expect(test.controller.snapshot().transcriptPinned).toBe(true)
    expect(await test.controller.handleKey('shift+up')).toBe(true)
    expect(test.controller.snapshot().transcriptPinned).toBe(false)
    expect(test.controller.snapshot().transcriptStart).toBeLessThanOrEqual(afterPage)
    await test.controller.submit('re-pin please')
    expect(test.controller.snapshot().transcriptPinned).toBe(true)
    await test.ctx.fiber.dispose()
  })
})

describe('TUI Esc Esc rewind', () => {
  it('restores the last submitted prompt on a second Esc inside 2000ms', async () => {
    const test = await mount()
    await test.controller.submit('look at tests')
    await test.controller.submit('ship it')
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().history).toEqual(['look at tests', 'ship it'])
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().notice?.text).toBe('esc again to edit last')
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().input).toBe('ship it')
    expect(test.controller.snapshot().history).toEqual(['look at tests', 'ship it'])
    await test.ctx.fiber.dispose()
  })

  it('restores the last prompt when the second Esc arrives 1500ms later', async () => {
    const test = await mount()
    await test.controller.submit('say hi')
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().notice?.text).toBe('esc again to edit last')
    expect(test.controller.snapshot().input).toBe('')
    vi.setSystemTime(11_500)
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().input).toBe('say hi')
    expect(test.controller.snapshot().history).toEqual(['say hi'])
    vi.useRealTimers()
    await test.ctx.fiber.dispose()
  })

  it('does not rewind after the arm expires and does not delete session history', async () => {
    const test = await mount()
    await test.controller.submit('keep me')
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    expect(await test.controller.handleKey('escape')).toBe(true)
    test.controller.dispatch({ type: 'set-notice' })
    vi.setSystemTime(10_000 + 2001)
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().history).toEqual(['keep me'])
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().input).toBe('keep me')
    vi.useRealTimers()
    await test.ctx.fiber.dispose()
  })

  it('restores the last prompt after an idle finished turn even when a ghost is showing', async () => {
    const test = await mount()
    await test.controller.submit('sayhi')
    completeTurn(test, 'sayhi', 'Hi! I am your coding agent for the')
    test.controller.dispatch({ type: 'set-suggestion', suggestion: 'Hi! I am your coding agent for the' })
    expect(test.controller.snapshot().input).toBe('')
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().notice?.text).toBe('esc again to edit last')
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().input).toBe('sayhi')
    await test.ctx.fiber.dispose()
  })

  it('clears editor text on first Esc and restores last prompt on second Esc', async () => {
    const test = await mount()
    await test.controller.submit('look at tests')
    test.controller.dispatch({ type: 'set-input', input: 'rewind-me-please', cursor: 16 })
    test.controller.dispatch({ type: 'set-suggestion', suggestion: 'ghost leftover' })
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().suggestion).toBeUndefined()
    expect(test.controller.snapshot().notice?.text).toBe('esc again to edit last')
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().input).toBe('look at tests')
    expect(test.controller.snapshot().history).toEqual(['look at tests'])
    await test.ctx.fiber.dispose()
  })

  it('dismisses an overlay on Esc without clearing or rewinding', async () => {
    const test = await mount()
    await test.controller.submit('look at tests')
    test.controller.dispatch({ type: 'set-input', input: 'keep me', cursor: 7 })
    test.controller.dispatch({ type: 'open-overlay', overlay: { kind: 'help' } })
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().overlay).toEqual({ kind: 'none' })
    expect(test.controller.snapshot().input).toBe('keep me')
    expect(test.controller.snapshot().notice?.text).not.toBe('esc again to edit last')
    await test.ctx.fiber.dispose()
  })


  it('dismisses the slash palette on Esc without clearing the typed command', async () => {
    const test = await mount()
    await test.controller.submit('look at tests')
    test.controller.dispatch({ type: 'set-input', input: '/att', cursor: 4 })
    expect(test.controller.snapshot().overlay.kind).toBe('commands')
    expect(await test.controller.handleKey('escape')).toBe(true)
    expect(test.controller.snapshot().overlay).toEqual({ kind: 'none' })
    expect(test.controller.snapshot().input).toBe('/att')
    expect(test.controller.snapshot().notice?.text).not.toBe('esc again to edit last')
    await test.ctx.fiber.dispose()
  })

})

describe('TUI /attach', () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])

  it('saves a local PNG through ctx.attachments and sends it on the next prompt', async () => {
    const test = await mount()
    const dir = join(tmpdir(), `dsh-tui-attach-${Date.now()}`)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'photo.png')
    await writeFile(file, png)
    const saveImage = vi.fn(async () => ({
      attachmentId: 'att-1',
      mediaType: 'image/png',
      bytes: png.length,
      width: 1,
      height: 1,
      name: 'photo.png',
    }))
    test.ctx.provide('attachments', { saveImage } as never)
    test.controller.dispatch({ type: 'resize', width: 80, height: 24 })
    // cwd is /tmp; write under /tmp so resolve stays inside cwd
    const rel = file.startsWith('/tmp/') ? file.slice('/tmp/'.length) : file
    await test.controller.submit(`/attach ${rel}`)
    expect(saveImage).toHaveBeenCalled()
    expect(test.controller.snapshot().attachments).toEqual([
      {
        name: 'photo.png', mediaType: 'image/png', attachmentId: 'att-1',
        bytes: png.length, width: 1, height: 1,
      },
    ])
    const followup = vi.spyOn(test.agent, 'followup')
    await test.controller.submit('what is this')
    expect(test.controller.snapshot().attachments).toEqual([])
    const message = followup.mock.calls[0]?.[0] as { content: readonly { type: string }[] }
    expect(message.content.some(block => block.type === 'image')).toBe(true)
    expect(message.content.some(block => block.type === 'text')).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('inserts an @ mention when the file is not an image or the store is missing', async () => {
    const test = await mount()
    const dir = join(tmpdir(), `dsh-tui-attach-txt-${Date.now()}`)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'notes.txt')
    await writeFile(file, 'hello')
    const rel = file.startsWith('/tmp/') ? file.slice('/tmp/'.length) : file
    await test.controller.submit(`/attach ${rel}`)
    expect(test.controller.snapshot().input).toContain(`@${rel}`)
    expect(test.controller.snapshot().attachments).toEqual([])
    await test.controller.submit('/attach')
    expect(test.controller.snapshot().notice?.text).toContain('/attach')
    await test.ctx.fiber.dispose()
  })

  it('still shows a chip when saveImage rejects a minimal valid 1×1 PNG', async () => {
    const test = await mount()
    const tiny = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222,
      0, 0, 0, 12, 73, 68, 65, 84, 120, 218, 99, 96, 96, 96, 0, 0,
      0, 4, 0, 1, 200, 234, 235, 249, 0, 0, 0, 0, 73, 69, 78, 68,
      174, 66, 96, 130,
    ])
    expect(tiny.byteLength).toBe(69)
    const dir = join(tmpdir(), `dsh-tui-attach-tiny-${Date.now()}`)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'tui-test.png')
    await writeFile(file, tiny)
    const saveImage = vi.fn(async () => {
      throw new Error('Unsupported or malformed image data.')
    })
    test.ctx.provide('attachments', { saveImage } as never)
    const rel = file.startsWith('/tmp/') ? file.slice('/tmp/'.length) : file
    await test.controller.submit(`/attach ${rel}`)
    expect(saveImage).toHaveBeenCalled()
    expect(test.controller.snapshot().notice?.type).toBe('success')
    expect(test.controller.snapshot().attachments).toEqual([
      {
        name: 'tui-test.png', mediaType: 'image/png', attachmentId: 'local:tui-test.png:69',
        bytes: 69, width: 1, height: 1,
      },
    ])
    await test.controller.submit('/attach ../tui-test.png')
    expect(test.controller.snapshot().notice?.text).toBe('Path escapes the working directory.')
    await test.ctx.fiber.dispose()
  })

  it('attaches an existing absolute path outside cwd and still rejects relative ..', async () => {
    const test = await mount()
    const tiny = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222,
      0, 0, 0, 12, 73, 68, 65, 84, 120, 218, 99, 96, 96, 96, 0, 0,
      0, 4, 0, 1, 200, 234, 235, 249, 0, 0, 0, 0, 73, 69, 78, 68,
      174, 66, 96, 130,
    ])
    const dir = resolve(process.cwd(), '..', `dsh-tui-attach-abs-${Date.now()}`)
    expect(dir.startsWith('/tmp/')).toBe(false)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'tui-test.png')
    await writeFile(file, tiny)
    const saveImage = vi.fn(async () => {
      throw new Error('Unsupported or malformed image data.')
    })
    test.ctx.provide('attachments', { saveImage } as never)
    await test.controller.submit(`/attach ${file}`)
    expect(test.controller.snapshot().notice?.type).toBe('success')
    expect(test.controller.snapshot().notice?.text).toBe('image attached  tui-test.png')
    expect(test.controller.snapshot().attachments).toEqual([
      {
        name: 'tui-test.png', mediaType: 'image/png', attachmentId: 'local:tui-test.png:69',
        bytes: 69, width: 1, height: 1,
      },
    ])
    await test.controller.submit('/attach ../secret.png')
    expect(test.controller.snapshot().notice?.text).toBe('Path escapes the working directory.')
    await test.ctx.fiber.dispose()
  })

  it('executes /attach <path> on the first Enter while the palette is open', async () => {
    const test = await mount()
    const tiny = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222,
      0, 0, 0, 12, 73, 68, 65, 84, 120, 218, 99, 96, 96, 96, 0, 0,
      0, 4, 0, 1, 200, 234, 235, 249, 0, 0, 0, 0, 73, 69, 78, 68,
      174, 66, 96, 130,
    ])
    const dir = resolve(process.cwd(), '..', `dsh-tui-attach-enter-${Date.now()}`)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'tui-live-test.png')
    await writeFile(file, tiny)
    test.ctx.provide('attachments', { saveImage: async () => { throw new Error('skip') } } as never)
    const line = `/attach ${file}`
    test.controller.dispatch({ type: 'set-input', input: line, cursor: line.length })
    expect(test.controller.snapshot().overlay.kind).toBe('commands')
    expect(await test.controller.handleKey('enter')).toBe(true)
    expect(test.controller.snapshot().notice?.type).toBe('success')
    expect(test.controller.snapshot().notice?.text).toBe('image attached  tui-live-test.png')
    expect(test.controller.snapshot().attachments).toHaveLength(1)
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().overlay.kind).toBe('none')
    await test.ctx.fiber.dispose()
  })

  it('accepts an incomplete slash prefix then executes on the first Enter', async () => {
    const test = await mount()
    test.controller.dispatch({ type: 'set-input', input: '/att', cursor: 4 })
    expect(test.controller.snapshot().overlay.kind).toBe('commands')
    expect(await test.controller.handleKey('enter')).toBe(true)
    expect(test.controller.snapshot().notice?.text).toContain('/attach')
    expect(test.controller.snapshot().input).toBe('')
    expect(test.controller.snapshot().overlay.kind).toBe('none')
    await test.ctx.fiber.dispose()
  })

})

describe('TUI space vs expand', () => {
  it('does not consume space so the editor can type say hi and /attach /path', async () => {
    const test = await mount()
    test.controller.dispatch({ type: 'set-input', input: 'say', cursor: 3 })
    expect(await test.controller.handleKey(' ')).toBe(false)
    expect(test.controller.snapshot().input).toBe('say')
    expect(await test.controller.handleKey('ctrl+o')).toBe(true)
    expect(test.controller.snapshot().input).toBe('say')
    await test.ctx.fiber.dispose()
  })

  it('expands the newest tool card on ctrl+o, not space', async () => {
    const test = await mount()
    test.session.append('tool/call', { callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' })
    const tool = test.controller.transcript().find(item => item.kind === 'tool')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind === 'tool') expect(tool.expanded).toBe(false)
    expect(await test.controller.handleKey(' ')).toBe(false)
    const before = test.controller.snapshot().expansion.tools.size
    expect(await test.controller.handleKey('ctrl+o')).toBe(true)
    expect(test.controller.snapshot().expansion.tools.size).toBeGreaterThan(before)
    await test.ctx.fiber.dispose()
  })
})

describe('TUI letter k', () => {
  it('does not consume k or K so the editor can type /workspace/', async () => {
    const test = await mount()
    test.controller.dispatch({ type: 'set-input', input: '/wor', cursor: 4 })
    expect(test.controller.snapshot().overlay.kind).toBe('commands')
    expect(await test.controller.handleKey('k')).toBe(false)
    expect(chromeAction(test.controller.snapshot(), 'k')).toBeUndefined()
    expect(await test.controller.handleKey('K')).toBe(false)
    expect(chromeAction(test.controller.snapshot(), 'K')).toBeUndefined()
    expect(test.controller.snapshot().input).toBe('/wor')
    test.controller.dispatch({ type: 'set-input', input: '', cursor: 0 })
    expect(await test.controller.handleKey('k')).toBe(false)
    expect(chromeAction(test.controller.snapshot(), 'k')).toBeUndefined()
    await test.ctx.fiber.dispose()
  })
})

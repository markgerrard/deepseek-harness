/** TUI runner: create a session through official registries and stay interactive. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { apply, Config, internals } from '../src/index.ts'
import type { TuiController } from '../src/controller.ts'

const originalInternals = { ...internals }
afterEach(() => { Object.assign(internals, originalInternals) })

interface Script {
  afterPrompt?(session: Session, message: UserMessage): Promise<void> | void
}

/** Mount the real registries around a small scripted Agent factory. */
async function bench(script: Script = {}): Promise<{
  ctx: Context
  prompts: UserMessage[]
  run(config?: { resume?: string; prompt?: string }): Promise<{
    sessionId?: string
    screen: string
    err: string
  }>
}> {
  const ctx = new Context()
  const prompts: UserMessage[] = []
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      let idle = Promise.resolve()
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, {
        id: session.id,
        options: options.agentOptions ?? {},
        session,
        inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
        status: 'idle',
        ctx: agentCtx,
        cancel: () => {},
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: (message: UserMessage) => {
          prompts.push(message)
          agent.inbox.append('next-turn', message)
          idle = Promise.resolve().then(() => script.afterPrompt?.(session, message))
        },
        steer: () => {},
        inject: () => {},
        whenIdle: () => idle,
      } satisfies Partial<Agent>)
      await options.setup?.(agentCtx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  return {
    ctx,
    prompts,
    run: async (config = {}) => {
      let err = ''
      let controller: TuiController | undefined
      internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
      internals.stdout = { columns: 140, rows: 40 }
      internals.render = (element) => {
        controller = (element as { props: { controller: TuiController } }).props.controller
        return { unmount: () => {} }
      }
      ctx.provide('appExit', () => {})
      apply(ctx, config)
      for (let attempt = 0; attempt < 20 && (controller === undefined || controller.snapshot().sessionId === undefined); attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      const snapshot = controller?.snapshot()
      return {
        ...(snapshot?.sessionId === undefined ? {} : { sessionId: snapshot.sessionId }),
        screen: snapshot?.screen ?? '',
        err,
      }
    },
  }
}

describe('tui runner', () => {
  it('creates a session and stays interactive without exiting', async () => {
    const test = await bench()
    const result = await test.run()
    expect(result.sessionId).toMatch(/^session-/)
    expect(result.screen).toBe('landing')
    expect(result.err).toBe('')
    await test.ctx.fiber.dispose()
  })

  it('submits an opening prompt through the official followup path', async () => {
    const test = await bench()
    await test.run({ prompt: 'do the thing' })
    expect(test.prompts).toHaveLength(1)
    const text = test.prompts[0]?.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(text).toBe('do the thing')
    await test.ctx.fiber.dispose()
  })

  it('reports a direct Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    let code: number | undefined
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    internals.render = () => ({ unmount: () => {} })
    ctx.provide('appExit', (value: number) => { code = value })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', {} as never)
    ctx.provide('agents', { create: () => Promise.reject(new Error('factory exploded')) } as never)
    apply(ctx, {})
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(code).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('fails loud without the launcher-provided exit request', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, {}) }).toThrow('must provide ctx.appExit')
  })

  it('accepts an empty config', () => {
    expect(new Config({})).toEqual({})
    expect(new Config({ prompt: 'x' })).toEqual({ prompt: 'x' })
  })
})

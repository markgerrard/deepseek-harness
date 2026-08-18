/** Controller wires busy to agent/status, not the last session event. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, AgentStatus, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { TuiController } from '../src/controller.ts'
import { formatWorkingLine } from '../src/status.ts'

async function mount(): Promise<{
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

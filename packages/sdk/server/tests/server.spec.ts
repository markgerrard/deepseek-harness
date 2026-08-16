import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'

import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as agentCore from '@deepseek-ai/dsh-agent-spine-demo'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SubagentRuntime, { type SubagentResult, type SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent'
import type { JsonRpcTransportPeer } from '@deepseek-ai/dsh-sdk-protocol'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { HarnessSdkJsonRpcServer, type HarnessSdkJsonRpcServerOptions } from '../src/index.ts'

type ApprovalHandler = (
  request: ApprovalRequest,
  next: () => Promise<ApprovalOutcome>,
) => Promise<ApprovalOutcome>

class FakeTransport implements JsonRpcTransportPeer {
  notifications: { method: string; params?: Record<string, unknown> }[] = []
  requests: { method: string; params: object }[] = []
  requestImpl: (method: string, params: object, signal?: AbortSignal) => Promise<unknown> = async (method, params) => {
    throw new Error(`the SDK server should not call host JSON-RPC method ${method} with ${JSON.stringify(params)}`)
  }

  async request(method: string, params: object, signal?: AbortSignal): Promise<unknown> {
    this.requests.push({ method, params })
    return this.requestImpl(method, params, signal)
  }

  notify(method: string, params?: object): void {
    this.notifications.push(params === undefined ? { method } : { method, params: params as Record<string, unknown> })
  }
}

/** Drive the server's `approval/request` listener without a live model turn. */
async function approvalFixture(
  capabilities?: { approvals: boolean },
  options: HarnessSdkJsonRpcServerOptions = {},
) {
  const followup = vi.fn<Agent['followup']>()
  const agent = ({
    id: SessionId('main'),
    session: { id: SessionId('main') },
    followup,
  } satisfies Pick<Agent, 'id' | 'followup'> & { session: { id: ReturnType<typeof SessionId> } }) as unknown as Agent
  const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
  const approvalListeners: ApprovalHandler[] = []
  const ctx = {
    on: vi.fn((event: string, handler: ApprovalHandler) => {
      if (event === 'approval/request') approvalListeners.push(handler)
      return () => undefined
    }),
    agents: {
      create: vi.fn(async () => handle),
      get: (id: SessionId) => String(id) === 'main' ? agent : undefined,
    },
    get: () => ({ listProviders: () => [{ id: 'mock', name: 'Mock' }] }),
  } as unknown as Context
  const transport = new FakeTransport()
  const server = new HarnessSdkJsonRpcServer(ctx, transport, options)
  await server.initialize({
    cwd: '/tmp',
    provider: 'mock',
    model: 'model',
    ...capabilities === undefined ? {} : { clientCapabilities: capabilities },
  })
  await server.prompt({ sessionId: 'main', contentBlocks: [{ type: 'text', text: 'go' }] })
  const handler = approvalListeners[0]
  if (handler === undefined) throw new Error('server did not subscribe to approval/request')
  const next = vi.fn(() => Promise.resolve<ApprovalOutcome>('unavailable'))
  const request: ApprovalRequest = {
    agent,
    toolName: 'bash',
    callId: CallId('call-1'),
    reason: 'escalate sandbox to workspace-write: write a file',
    signal: new AbortController().signal,
  }
  return {
    server,
    transport,
    handler,
    next,
    agent,
    ask: () => handler(request, next),
  }
}

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  vi.unstubAllEnvs()
})

async function mockCompletionServer(): Promise<{ url: string; requests: unknown[]; headers: IncomingMessage['headers'][] }> {
  const requests: unknown[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      headers.push(request.headers)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":"done"}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, requests, headers }
}

async function makeHarness(storageDir: string) {
  const ctx = new Context()
  await ctx.plugin(agentCore, { workspaceContext: false })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(JsonlSessionPersistence, { root: storageDir })
  await new Promise(resolve => setTimeout(resolve, 50))
  return ctx
}

/** Create, prompt-to-idle, and dispose so only the JSONL log remains. */
async function persistPromptedSession(storageDir: string, sessionId: string, text: string): Promise<void> {
  const llmServer = await mockCompletionServer()
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
  vi.stubEnv('DEEPSEEK_BASE_URL', llmServer.url)
  const ctx = await makeHarness(storageDir)
  try {
    const transport = new FakeTransport()
    const server = new HarnessSdkJsonRpcServer(ctx, transport)
    await server.handleRequest('initialize', {
      cwd: storageDir,
      provider: 'deepseek-official',
      model: 'dsagent-model',
    })
    await server.handleRequest('session/prompt', {
      sessionId,
      contentBlocks: [{ type: 'text', text }],
    })
    await vi.waitFor(() => {
      expect(transport.notifications.findLast(n => n.method === 'session.status')).toEqual({
        method: 'session.status',
        params: { sessionId, status: 'idle' },
      })
    })
    await server.handleRequest('shutdown', undefined)
  } finally {
    await ctx.fiber.dispose()
  }
}

/** Walk a persistence root for session transcript files. */
async function findSessionLogs(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.startsWith('session.jsonl')) found.push(path)
    }
  }
  await walk(root)
  return found
}

/** Drive the owning service so test lifecycle events carry the real parent scope. */
async function settleSubagent(
  ctx: Context,
  parent: Agent,
  info: Omit<SubagentRunEndInfo, 'runId' | 'local'> & { localAgent: Agent | undefined },
  beforeSettle?: () => Promise<void>,
): Promise<void> {
  const result = Promise.withResolvers<SubagentResult>()
  const disposeProvider = ctx.subagents.registerProvider({
    name: info.provider,
    capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    async start() {
      return {
        id: info.id,
        localAgent: info.localAgent,
        result: result.promise,
        dispose: () => Promise.resolve(),
      }
    },
  })
  try {
    const run = await ctx.subagents.start(info.provider, {
      parent,
      prompt: [],
      signal: new AbortController().signal,
    })
    await beforeSettle?.()
    if (info.lastAssistantMessage === undefined) {
      result.reject(new Error('synthetic infrastructure failure'))
    } else {
      result.resolve({ output: info.lastAssistantMessage, stopReason: info.stopReason })
    }
    await run.result.then(() => undefined, () => undefined)
    await run.dispose()
  } finally {
    disposeProvider()
  }
}

describe('HarnessSdkJsonRpcServer', () => {
  it('creates a harness agent and calls the configured OpenAI-compatible endpoint', { timeout: 15_000 }, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-'))
    const llmServer = await mockCompletionServer()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    vi.stubEnv('DEEPSEEK_BASE_URL', llmServer.url)
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)

      const init = await server.handleRequest('initialize', {
        cwd: storageDir,
        provider: 'deepseek-official',
        model: 'dsagent-model',
        maxTokens: 321,
      }) as { serverInfo: { name: string } }
      expect(init.serverInfo.name).toBe('deepseek-harness-sdk-runtime')

      const receipt = await server.handleRequest('session/prompt', {
        sessionId: 'main',
        contentBlocks: [{ type: 'text', text: 'fix it' }],
      })
      expect((receipt as { messageId?: unknown }).messageId).toBeTypeOf('string')

      await vi.waitFor(() => { expect(llmServer.requests).toHaveLength(1) })
      const body = llmServer.requests[0] as { model: string; messages: { role: string }[]; max_tokens?: number }
      expect(body.model).toBe('dsagent-model')
      expect(body.max_tokens).toBe(321)
      expect(body.messages[0]?.role).toBe('system')
      expect(body.messages.at(-1)?.role).toBe('user')
      expect(llmServer.headers[0]?.authorization).toBe('Bearer test-key')
      expect(transport.notifications.some(n => n.method === 'session.event')).toBe(true)
      await vi.waitFor(() => {
        expect(transport.notifications.findLast(n => n.method === 'session.status')).toEqual({
          method: 'session.status',
          params: { sessionId: 'main', status: 'idle' },
        })
      })

      await server.handleRequest('session/prompt', {
        sessionId: 'main',
        contentBlocks: [{ type: 'text', text: 'again' }],
      })
      await vi.waitFor(() => { expect(llmServer.requests).toHaveLength(2) })

      const orphanHandle = await ctx.agents.create({
        sessionId: SessionId('orphan-session'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'deepseek-official', model: 'dsagent-model' },
      })
      orphanHandle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'outside the sdk session map' }], source: { kind: 'user' } }))
      await orphanHandle.agent.whenIdle()
      await orphanHandle.dispose()
      expect(llmServer.requests).toHaveLength(3)

      await server.handleRequest('shutdown', undefined)
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('queues overlapping prompts for one session without blocking other sessions', async () => {
    const mainFollowup = vi.fn<Agent['followup']>()
    const mainAgent = ({
      id: SessionId('main'),
      followup: mainFollowup,
    } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const otherFollowup = vi.fn<Agent['followup']>()
    const otherAgent = ({
      id: SessionId('other'),
      followup: otherFollowup,
    } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const mainHandle = { agent: mainAgent, dispose: vi.fn(() => Promise.resolve()) }
    const otherHandle = { agent: otherAgent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn(async (options: { sessionId: SessionId }) =>
      String(options.sessionId) === 'main' ? mainHandle : otherHandle)
    const liveAgents = new Map<string, Agent>([['main', mainAgent], ['other', otherAgent]])
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create, get: (id: SessionId) => liveAgents.get(String(id)) },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    const prompt = (sessionId: string, text: string) => server.prompt({
      sessionId,
      contentBlocks: [{ type: 'text', text }],
    })

    expect((await prompt('main', 'first')).messageId).toBeTypeOf('string')
    expect((await prompt('main', 'overlap')).messageId).toBeTypeOf('string')
    expect((await prompt('other', 'independent')).messageId).toBeTypeOf('string')

    expect(mainFollowup).toHaveBeenCalledTimes(2)
    expect(otherFollowup).toHaveBeenCalledOnce()
    await server.shutdown()
    expect(mainHandle.dispose).toHaveBeenCalledOnce()
    expect(otherHandle.dispose).toHaveBeenCalledOnce()
  })

  it('cancels only the addressed live session and no-ops unknown ids', async () => {
    const mainCancel = vi.fn<Agent['cancel']>()
    const otherCancel = vi.fn<Agent['cancel']>()
    const mainAgent = ({
      id: SessionId('main'),
      followup: vi.fn(),
      cancel: mainCancel,
    } satisfies Pick<Agent, 'id' | 'followup' | 'cancel'>) as unknown as Agent
    const otherAgent = ({
      id: SessionId('other'),
      followup: vi.fn(),
      cancel: otherCancel,
    } satisfies Pick<Agent, 'id' | 'followup' | 'cancel'>) as unknown as Agent
    const mainHandle = { agent: mainAgent, dispose: vi.fn(() => Promise.resolve()) }
    const otherHandle = { agent: otherAgent, dispose: vi.fn(() => Promise.resolve()) }
    const liveAgents = new Map<string, Agent>([['main', mainAgent], ['other', otherAgent]])
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create: vi.fn(async (options: { sessionId: SessionId }) =>
          String(options.sessionId) === 'main' ? mainHandle : otherHandle),
        get: (id: SessionId) => liveAgents.get(String(id)),
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.prompt({ sessionId: 'main', contentBlocks: [{ type: 'text', text: 'go' }] })
    await server.prompt({ sessionId: 'other', contentBlocks: [{ type: 'text', text: 'go' }] })

    await expect(server.handleRequest('session/cancel', { sessionId: 'missing' })).resolves.toEqual({})
    expect(mainCancel).not.toHaveBeenCalled()
    expect(otherCancel).not.toHaveBeenCalled()

    await expect(server.handleRequest('session/cancel', { sessionId: 'main' })).resolves.toEqual({})
    expect(mainCancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' })
    expect(otherCancel).not.toHaveBeenCalled()

    await server.shutdown()
  })

  it('cancels a session whose lazy creation is still in flight', async () => {
    let resolveCreate: ((handle: AgentHandle) => void) | undefined
    const createGate = new Promise<AgentHandle>((resolve) => { resolveCreate = resolve })
    const cancel = vi.fn<Agent['cancel']>()
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('s1'),
      followup,
      cancel,
    } satisfies Pick<Agent, 'id' | 'followup' | 'cancel'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn(() => createGate)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create,
        get: (id: SessionId) => String(id) === 's1' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const prompt = server.handleRequest('session/prompt', {
      sessionId: 's1',
      contentBlocks: [{ type: 'text', text: 'go' }],
    })
    expect(create).toHaveBeenCalledOnce()

    const cancelled = server.handleRequest('session/cancel', { sessionId: 's1' })
    resolveCreate?.(handle)

    await expect(cancelled).resolves.toEqual({})
    await expect(prompt).resolves.toMatchObject({ messageId: expect.any(String) as unknown })
    expect(followup).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' })
    expect(cancel.mock.invocationCallOrder.at(-1))
      .toBeGreaterThan(followup.mock.invocationCallOrder[0]!)

    await server.shutdown()
  })

  it('does not keep a pending cancel after lazy creation fails', async () => {
    let rejectCreate: ((error: Error) => void) | undefined
    const createGate = new Promise<AgentHandle>((_, reject) => { rejectCreate = reject })
    const cancel = vi.fn<Agent['cancel']>()
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('s1'),
      followup,
      cancel,
    } satisfies Pick<Agent, 'id' | 'followup' | 'cancel'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn<() => Promise<AgentHandle>>()
      .mockReturnValueOnce(createGate)
      .mockResolvedValueOnce(handle)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create,
        get: (id: SessionId) => String(id) === 's1' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const firstPrompt = server.handleRequest('session/prompt', {
      sessionId: 's1',
      contentBlocks: [{ type: 'text', text: 'go' }],
    })
    const cancelled = server.handleRequest('session/cancel', { sessionId: 's1' })
    rejectCreate?.(new Error('creation failed'))
    await expect(firstPrompt).rejects.toThrow('creation failed')
    await expect(cancelled).resolves.toEqual({})

    await expect(server.handleRequest('session/prompt', {
      sessionId: 's1',
      contentBlocks: [{ type: 'text', text: 'retry' }],
    })).resolves.toMatchObject({ messageId: expect.any(String) as unknown })
    expect(followup).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()

    await server.shutdown()
  })

  it('resumes through ctx.agents.resume and then accepts a prompt', async () => {
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('main'),
      followup,
    } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const resume = vi.fn(async () => handle)
    const create = vi.fn(async () => {
      throw new Error('session/resume must not call agents.create')
    })
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create,
        resume,
        get: (id: SessionId) => String(id) === 'main' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    await expect(server.handleRequest('session/resume', { sessionId: 'main' })).resolves.toEqual({})
    expect(resume).toHaveBeenCalledExactlyOnceWith({
      resumeSessionId: SessionId('main'),
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
    })
    expect(create).not.toHaveBeenCalled()

    expect((await server.prompt({
      sessionId: 'main',
      contentBlocks: [{ type: 'text', text: 'go' }],
    })).messageId).toBeTypeOf('string')
    expect(create).not.toHaveBeenCalled()
    expect(followup).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('resume of an already-live session does not reload', async () => {
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('main'),
      followup,
    } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const resume = vi.fn(async () => {
      throw new Error('already-live resume must not call agents.resume')
    })
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create: vi.fn(async () => handle),
        resume,
        get: (id: SessionId) => String(id) === 'main' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    await server.prompt({ sessionId: 'main', contentBlocks: [{ type: 'text', text: 'go' }] })

    await expect(server.handleRequest('session/resume', { sessionId: 'main' })).resolves.toEqual({})
    expect(resume).not.toHaveBeenCalled()
    await server.shutdown()
  })

  it('resumes a persisted session and then accepts a prompt', { timeout: 15_000 }, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-resume-'))
    try {
      await persistPromptedSession(storageDir, 'main', 'remember zebra')
      const llmServer = await mockCompletionServer()
      vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
      vi.stubEnv('DEEPSEEK_BASE_URL', llmServer.url)
      const ctx = await makeHarness(storageDir)
      try {
        const transport = new FakeTransport()
        const server = new HarnessSdkJsonRpcServer(ctx, transport)
        await server.handleRequest('initialize', {
          cwd: storageDir,
          provider: 'deepseek-official',
          model: 'dsagent-model',
        })
        await expect(server.handleRequest('session/resume', { sessionId: 'main' })).resolves.toEqual({})
        const resumed = ctx.agents.get(SessionId('main'))
        expect(JSON.stringify(resumed?.session.events)).toContain('remember zebra')
        const receipt = await server.handleRequest('session/prompt', {
          sessionId: 'main',
          contentBlocks: [{ type: 'text', text: 'what was the word?' }],
        })
        expect((receipt as { messageId?: unknown }).messageId).toBeTypeOf('string')
        await vi.waitFor(() => { expect(llmServer.requests).toHaveLength(1) })
        await server.handleRequest('shutdown', undefined)
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('prompt of a persisted unknown id still lazily creates and collides', { timeout: 15_000 }, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-collide-'))
    try {
      await persistPromptedSession(storageDir, 'main', 'remember zebra')
      vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
      vi.stubEnv('DEEPSEEK_BASE_URL', (await mockCompletionServer()).url)
      const ctx = await makeHarness(storageDir)
      try {
        const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
        await server.handleRequest('initialize', {
          cwd: storageDir,
          provider: 'deepseek-official',
          model: 'dsagent-model',
        })
        const receipt = await server.handleRequest('session/prompt', {
          sessionId: 'main',
          contentBlocks: [{ type: 'text', text: 'again' }],
        })
        expect((receipt as { messageId?: unknown }).messageId).toBeTypeOf('string')
        const created = ctx.agents.get(SessionId('main'))
        if (created === undefined) throw new Error('lazy create did not publish an agent')
        expect(JSON.stringify(created.session.events)).not.toContain('remember zebra')
        await expect(ctx.sessions.flush(created.session)).rejects.toThrow(/id collision/)
        await server.handleRequest('shutdown', undefined)
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('resume rejects when session persistence is not configured', async () => {
    const ctx = new Context()
    await ctx.plugin(agentCore, { workspaceContext: false })
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
      await expect(server.handleRequest('session/resume', { sessionId: 'main' }))
        .rejects.toThrow(/session persistence is not configured/)
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('resume rejects when the id has no persisted log', { timeout: 15_000 }, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-resume-miss-'))
    const ctx = await makeHarness(storageDir)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
      await expect(server.handleRequest('session/resume', { sessionId: 'missing' }))
        .rejects.toThrow(/not found/)
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('resume rejects a corrupt persisted log', { timeout: 15_000 }, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-resume-corrupt-'))
    try {
      await persistPromptedSession(storageDir, 'main', 'remember zebra')
      const logs = await findSessionLogs(storageDir)
      expect(logs.length).toBeGreaterThan(0)
      await Promise.all(logs.map(path => writeFile(path, 'not-a-valid-session-log')))
      const ctx = await makeHarness(storageDir)
      try {
        const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
        await expect(server.handleRequest('session/resume', { sessionId: 'main' }))
          .rejects.toThrow()
        await server.shutdown()
      } finally {
        await ctx.fiber.dispose()
      }
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not send a server-to-client request unless the client advertised approvals', async () => {
    const { server, transport, ask, next } = await approvalFixture()

    await expect(ask()).resolves.toBe('unavailable')
    expect(next).toHaveBeenCalledOnce()
    expect(transport.requests).toEqual([])

    await server.shutdown()
  })

  it('relays an advertised approval and applies the closed outcomes', async () => {
    const { server, transport, ask, next } = await approvalFixture({ approvals: true })
    transport.requestImpl = async () => ({ outcome: 'allowed-once' })

    await expect(ask()).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
    expect(transport.requests).toEqual([{
      method: 'session/request_permission',
      params: {
        sessionId: 'main',
        toolName: 'bash',
        callId: 'call-1',
        reason: 'escalate sandbox to workspace-write: write a file',
      },
    }])

    transport.requestImpl = async () => ({ outcome: 'rejected' })
    await expect(ask()).resolves.toBe('rejected')
    transport.requestImpl = async () => ({ outcome: 'cancelled' })
    await expect(ask()).resolves.toBe('cancelled')
    transport.requestImpl = async () => ({ outcome: 'unavailable' })
    await expect(ask()).resolves.toBe('unavailable')

    await server.shutdown()
  })

  it('does not wait unbounded when an advertising client never answers an ask that has no signal', async () => {
    const { server, transport, handler, next, agent } = await approvalFixture({ approvals: true })
    transport.requestImpl = () => new Promise(() => {})

    await expect(handler({ agent, toolName: 'bash' }, next)).resolves.toBe('unavailable')
    expect(next).toHaveBeenCalledOnce()
    expect(transport.requests).toEqual([])

    await server.shutdown()
  })

  it('times out a silent advertising client when approvalRequestTimeoutMs elapses', async () => {
    const { server, transport, ask, next } = await approvalFixture(
      { approvals: true },
      { approvalRequestTimeoutMs: 20 },
    )
    transport.requestImpl = (_method, _params, signal) => new Promise((_resolve, reject) => {
      if (signal === undefined) throw new Error('relay must pass a bound signal')
      signal.addEventListener('abort', () => { reject(new Error('approval request timed out')) }, { once: true })
    })

    await expect(ask()).resolves.toBe('unavailable')
    expect(next).not.toHaveBeenCalled()
    expect(transport.requests).toHaveLength(1)

    await server.shutdown()
  })

  it('still applies a timely answer when approvalRequestTimeoutMs is configured', async () => {
    const { server, transport, ask, next } = await approvalFixture(
      { approvals: true },
      { approvalRequestTimeoutMs: 5_000 },
    )
    transport.requestImpl = async () => ({ outcome: 'allowed-once' })

    await expect(ask()).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()

    await server.shutdown()
  })

  it('bounds a silent ask that has no signal when approvalRequestTimeoutMs is set', async () => {
    const { server, transport, handler, next, agent } = await approvalFixture(
      { approvals: true },
      { approvalRequestTimeoutMs: 20 },
    )
    transport.requestImpl = (_method, _params, signal) => new Promise((_resolve, reject) => {
      if (signal === undefined) throw new Error('relay must pass a bound signal')
      signal.addEventListener('abort', () => { reject(new Error('approval request timed out')) }, { once: true })
    })

    await expect(handler({ agent, toolName: 'bash' }, next)).resolves.toBe('unavailable')
    expect(next).not.toHaveBeenCalled()
    expect(transport.requests).toHaveLength(1)

    await server.shutdown()
  })

  it('fails closed when an advertising client goes away or answers with garbage', async () => {
    const { server, transport, ask, next } = await approvalFixture({ approvals: true })

    transport.requestImpl = async () => { throw new Error('JSON-RPC input closed') }
    await expect(ask()).resolves.toBe('unavailable')
    expect(next).not.toHaveBeenCalled()

    transport.requestImpl = async () => ({ outcome: 'please-grant-forever' })
    await expect(ask()).resolves.toBe('rejected')
    transport.requestImpl = async () => 'allowed-once'
    await expect(ask()).resolves.toBe('rejected')
    transport.requestImpl = async () => ({})
    await expect(ask()).resolves.toBe('rejected')

    await server.shutdown()
  })

  it('delegates a same-id foreign agent and an unknown session', async () => {
    const { server, transport, handler, next, agent } = await approvalFixture({ approvals: true })
    const foreign = { session: { id: agent.session.id } } as unknown as Agent

    await expect(handler({ agent: foreign, toolName: 'bash' }, next)).resolves.toBe('unavailable')
    await expect(handler({
      agent: { session: { id: SessionId('other') } } as unknown as Agent,
      toolName: 'bash',
    }, next)).resolves.toBe('unavailable')
    expect(transport.requests).toEqual([])
    expect(next).toHaveBeenCalledTimes(2)

    await server.shutdown()
  })

  it('rejects a prompt for a session whose agent was disposed outside the server', async () => {
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('zombie'),
      followup,
      whenIdle: vi.fn(() => Promise.resolve()),
    } satisfies Pick<Agent, 'id' | 'followup' | 'whenIdle'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    // The registry drops the agent after creation, modelling an agent-loop-only
    // reload that leaves the server's SessionRecord pointing at a detached agent.
    let live = true
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create: vi.fn(async () => handle),
        get: (id: SessionId) => (live && String(id) === 'zombie' ? agent : undefined),
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    const prompt = (text: string) => server.prompt({
      sessionId: 'zombie',
      contentBlocks: [{ type: 'text', text }],
    })

    expect((await prompt('while live')).messageId).toBeTypeOf('string')
    live = false
    await expect(prompt('after detach')).rejects.toThrow('session agent was disposed outside the server: zombie')
    // The detached agent was never driven by the rejected prompt.
    expect(followup).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('forwards whole-agent status without attributing a turn outcome', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const transport = new FakeTransport()
    const server = new HarnessSdkJsonRpcServer(ctx, transport)
    const session = ctx.sessions.create(SessionId('message-outcome'))
    const agent = ({
      id: SessionId('message-outcome'),
      session,
    } satisfies Pick<Agent, 'id' | 'session'>) as Agent

    ctx.emit('agent/status', { agent, status: 'running' })
    ctx.emit('agent/status', { agent, status: 'idle' })

    expect(transport.notifications.filter(notification => notification.method === 'session.status'))
      .toEqual([
        { method: 'session.status', params: { sessionId: 'message-outcome', status: 'running' } },
        { method: 'session.status', params: { sessionId: 'message-outcome', status: 'idle' } },
      ])
    await server.shutdown()
    await ctx.fiber.dispose()
  })

  it('notifies the host when a child session is created with parent lineage', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)

      ctx.sessions.create(SessionId('root-session'), {
        meta: { cwd: storageDir },
      })
      ctx.sessions.create(SessionId('child-session'), {
        meta: { cwd: storageDir, parentSession: SessionId('main') },
      })

      expect(transport.notifications).toContainEqual({
        method: 'subagent.started',
        params: {
          parentSessionId: 'main',
          childSessionId: 'child-session',
        },
      })

      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('creates an SDK session without an optional system prompt', { timeout: 15_000 }, async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-no-system-'))
    const llmServer = await mockCompletionServer()
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    vi.stubEnv('DEEPSEEK_BASE_URL', llmServer.url)
    const ctx = await makeHarness(storageDir)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

      await server.initialize({ cwd: storageDir, provider: 'deepseek-official', model: 'plain-model' })
      await server.prompt({
        sessionId: 'plain',
        contentBlocks: [{ type: 'text', text: 'hello' }],
      })

      await vi.waitFor(() => { expect(llmServer.requests).toHaveLength(1) })
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('notifies the host when a subagent run settles', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-end-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)

      const parentHandle = await ctx.agents.create({
        sessionId: SessionId('main'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
      })
      // A custom in-process provider may own its child at the provider/root
      // scope while preserving durable parent lineage.
      const handle = await ctx.agents.create({
        sessionId: SessionId('child-session'),
        meta: { cwd: storageDir, parentSession: SessionId('main') },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
      })
      expect(ctx.agents.roots()).toContain(handle.agent)
      const parentlessHandle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('parentless-child-session'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'spawn',
        id: SessionId('child-session'),
        localAgent: handle.agent,
        stopReason: 'completed',
        lastAssistantMessage: [{ type: 'text', text: 'child done' }],
      }, () => handle.dispose())
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'spawn',
        id: SessionId('parentless-child-session'),
        localAgent: parentlessHandle.agent,
        stopReason: 'error',
      }, () => parentlessHandle.dispose())

      expect(transport.notifications).toContainEqual({
        method: 'subagent.finished',
        params: {
          provider: 'spawn',
          agentId: 'child-session',
          parentSessionId: 'main',
          childSessionId: 'child-session',
          status: 'ok',
          stopReason: 'completed',
          lastAssistantMessage: [{ type: 'text', text: 'child done' }],
        },
      })
      expect(transport.notifications).toContainEqual({
        method: 'subagent.finished',
        params: {
          provider: 'spawn',
          agentId: 'parentless-child-session',
          parentSessionId: 'main',
          childSessionId: 'parentless-child-session',
          status: 'error',
          stopReason: 'error',
        },
      })

      await parentHandle.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('ignores a remote run id that collides with a local child of the same parent', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-remote-collision-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const parentHandle = await ctx.agents.create({
        sessionId: SessionId('collision-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      const collidingChild = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('remote-run-id'),
        meta: { cwd: storageDir, parentSession: SessionId('collision-parent') },
        agentOptions: { model: 'deepseek-official' },
      })

      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'remote',
        id: SessionId('remote-run-id'),
        localAgent: undefined,
        stopReason: 'completed',
        lastAssistantMessage: [],
      })

      expect(transport.notifications.some(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.agentId === 'remote-run-id',
      )).toBe(false)

      await collidingChild.dispose()
      await parentHandle.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('retains locality across continuation runs on one live child', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-continuation-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const parentHandle = await ctx.agents.create({
        sessionId: SessionId('continuation-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      const childHandle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('continuation-child'),
        meta: { cwd: storageDir, parentSession: SessionId('continuation-parent') },
        agentOptions: { model: 'deepseek-official' },
      })

      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'continuation',
        id: SessionId('continuation-child'),
        localAgent: childHandle.agent,
        stopReason: 'completed',
        lastAssistantMessage: [{ type: 'text', text: 'first' }],
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'continuation',
        id: SessionId('continuation-child'),
        localAgent: childHandle.agent,
        stopReason: 'completed',
        lastAssistantMessage: [{ type: 'text', text: 'second' }],
      }, () => childHandle.dispose())

      expect(transport.notifications.filter(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.childSessionId === 'continuation-child',
      )).toHaveLength(2)

      await parentHandle.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('correlates reused local ids by parent scope when runs settle out of order', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-reuse-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const oldParent = await ctx.agents.create({
        sessionId: SessionId('old-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      const oldChild = await oldParent.agent.ctx.agents.create({
        sessionId: SessionId('reused-child'),
        meta: { cwd: storageDir, parentSession: SessionId('old-parent') },
        agentOptions: { model: 'deepseek-official' },
      })
      const first = Promise.withResolvers<SubagentResult>()
      const sameLifetime = Promise.withResolvers<SubagentResult>()
      const replacement = Promise.withResolvers<SubagentResult>()
      const results = [first.promise, sameLifetime.promise, replacement.promise]
      let starts = 0
      let currentLocalAgent = oldChild.agent
      const disposeProvider = ctx.subagents.registerProvider({
        name: 'reused',
        capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start() {
          const result = results[starts]
          starts += 1
          if (result === undefined) throw new Error('unexpected fourth reused-id run')
          return Promise.resolve({ id: SessionId('reused-child'), localAgent: currentLocalAgent, result, dispose: () => Promise.resolve() })
        },
      })

      const firstRun = await ctx.subagents.start('reused', {
        parent: oldParent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      const sameLifetimeRun = await ctx.subagents.start('reused', {
        parent: oldParent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      sameLifetime.resolve({ output: [{ type: 'text', text: 'same lifetime' }], stopReason: 'completed' })
      await sameLifetimeRun.result
      await oldChild.dispose()
      const newParent = await ctx.agents.create({
        sessionId: SessionId('new-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      const newChild = await newParent.agent.ctx.agents.create({
        sessionId: SessionId('reused-child'),
        meta: { cwd: storageDir, parentSession: SessionId('new-parent') },
        agentOptions: { model: 'deepseek-official' },
      })
      currentLocalAgent = newChild.agent
      const secondRun = await ctx.subagents.start('reused', {
        parent: newParent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })

      replacement.resolve({ output: [{ type: 'text', text: 'new lifetime' }], stopReason: 'completed' })
      await secondRun.result
      first.resolve({ output: [{ type: 'text', text: 'old lifetime' }], stopReason: 'completed' })
      await firstRun.result
      await Promise.resolve()

      const finished = transport.notifications.filter(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.childSessionId === 'reused-child',
      )
      expect(finished.map(notification => notification.params?.lastAssistantMessage)).toEqual([
        [{ type: 'text', text: 'same lifetime' }],
        [{ type: 'text', text: 'new lifetime' }],
        [{ type: 'text', text: 'old lifetime' }],
      ])
      expect(finished.map(notification => notification.params?.parentSessionId)).toEqual([
        'old-parent',
        'new-parent',
        'old-parent',
      ])

      await firstRun.dispose()
      await sameLifetimeRun.dispose()
      await secondRun.dispose()
      disposeProvider()
      await newChild.dispose()
      await oldParent.dispose()
      await newParent.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('keeps locality bound to the accepted run across provider re-registration', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-provider-reuse-'))
    const ctx = await makeHarness(storageDir)
    try {
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport)
      const parent = await ctx.agents.create({
        sessionId: SessionId('provider-reuse-parent'),
        meta: { cwd: storageDir },
        agentOptions: { model: 'deepseek-official' },
      })
      const child = await parent.agent.ctx.agents.create({
        sessionId: SessionId('provider-reuse-child'),
        meta: { cwd: storageDir, parentSession: SessionId('provider-reuse-parent') },
        agentOptions: { model: 'deepseek-official' },
      })
      const localResult = Promise.withResolvers<SubagentResult>()
      const remoteResult = Promise.withResolvers<SubagentResult>()
      const unregisterLocal = ctx.subagents.registerProvider({
        name: 'reused-provider',
        capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start: () => Promise.resolve({
          id: SessionId('provider-reuse-child'),
          localAgent: child.agent,
          result: localResult.promise,
          dispose: () => Promise.resolve(),
        }),
      })
      const localRun = await ctx.subagents.start('reused-provider', {
        parent: parent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      unregisterLocal()

      const unregisterRemote = ctx.subagents.registerProvider({
        name: 'reused-provider',
        capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: false,
        start: () => Promise.resolve({
          id: SessionId('provider-reuse-child'),
          localAgent: undefined,
          result: remoteResult.promise,
          dispose: () => Promise.resolve(),
        }),
      })
      const remoteRun = await ctx.subagents.start('reused-provider', {
        parent: parent.agent,
        prompt: [],
        signal: new AbortController().signal,
      })

      remoteResult.resolve({ output: [{ type: 'text', text: 'remote' }], stopReason: 'completed' })
      await remoteRun.result
      await Promise.resolve()
      expect(transport.notifications.some(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.lastAssistantMessage !== undefined,
      )).toBe(false)

      await child.dispose()
      localResult.resolve({ output: [{ type: 'text', text: 'local' }], stopReason: 'completed' })
      await localRun.result
      await Promise.resolve()
      expect(transport.notifications.filter(notification =>
        notification.method === 'subagent.finished'
        && notification.params?.childSessionId === 'provider-reuse-child',
      )).toEqual([{
        method: 'subagent.finished',
        params: {
          provider: 'reused-provider',
          agentId: 'provider-reuse-child',
          parentSessionId: 'provider-reuse-parent',
          childSessionId: 'provider-reuse-child',
          status: 'ok',
          stopReason: 'completed',
          lastAssistantMessage: [{ type: 'text', text: 'local' }],
        },
      }])

      await localRun.dispose()
      await remoteRun.dispose()
      unregisterRemote()
      await parent.dispose()
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('uses the recorded local flag when start was missed and ignores remote runs', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-subagent-fallback-'))
    const ctx = await makeHarness(storageDir)
    let parentHandle: AgentHandle | undefined
    let handle: AgentHandle | undefined
    let failedHandle: AgentHandle | undefined
    try {
      parentHandle = await ctx.agents.create({
        sessionId: SessionId('fallback-parent'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
      })
      handle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('fallback-child-session'),
        meta: { cwd: storageDir, parentSession: SessionId('fallback-parent') },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
      })
      const fallbackChild = handle.agent
      failedHandle = await parentHandle.agent.ctx.agents.create({
        sessionId: SessionId('failed-child-session'),
        meta: { cwd: storageDir },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-official' },
      })
      const missedStartResult = Promise.withResolvers<SubagentResult>()
      const disposeMissedStartProvider = ctx.subagents.registerProvider({
        name: 'fork',
        capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        inheritsParentContext: true,
        start: () => Promise.resolve({
          id: SessionId('fallback-child-session'),
          localAgent: fallbackChild,
          result: missedStartResult.promise,
          dispose: () => Promise.resolve(),
        }),
      })
      // Start before the server subscribes. The terminal payload still carries
      // this run's exact local child without reconstructing it from ids.
      const missedStartRun = await ctx.subagents.start('fork', {
        parent: parentHandle.agent,
        prompt: [],
        signal: new AbortController().signal,
      })
      const transport = new FakeTransport()
      const server = new HarnessSdkJsonRpcServer(ctx, transport, { maxTokensAsSuccess: true })

      missedStartResult.resolve({ output: [], stopReason: 'max-tokens' })
      await missedStartRun.result
      await Promise.resolve()
      await missedStartRun.dispose()
      disposeMissedStartProvider()
      // The server also missed this agent's creation but sees the exact child
      // on the run lifecycle payload.
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'fork-live-fallback',
        id: SessionId('fallback-child-session'),
        localAgent: fallbackChild,
        stopReason: 'completed',
        lastAssistantMessage: [],
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'fork',
        id: SessionId('failed-child-session'),
        localAgent: failedHandle.agent,
        stopReason: 'error',
      })
      await settleSubagent(ctx, parentHandle.agent, {
        provider: 'fork',
        id: SessionId('missing-child-agent'),
        localAgent: undefined,
        stopReason: 'error',
      })

      // A result without output omits lastAssistantMessage from the wire; it
      // never sends `[]`.
      expect(transport.notifications).toContainEqual({
        method: 'subagent.finished',
        params: {
          provider: 'fork',
          agentId: 'fallback-child-session',
          parentSessionId: 'fallback-parent',
          childSessionId: 'fallback-child-session',
          status: 'ok',
          stopReason: 'max-tokens',
        },
      })
      expect(transport.notifications).toContainEqual({
        method: 'subagent.finished',
        params: {
          provider: 'fork',
          agentId: 'failed-child-session',
          parentSessionId: 'fallback-parent',
          childSessionId: 'failed-child-session',
          status: 'error',
          stopReason: 'error',
        },
      })
      expect(transport.notifications.some(n =>
        n.method === 'subagent.finished'
        && n.params?.agentId === 'missing-child-agent',
      )).toBe(false)

      await server.shutdown()
    } finally {
      await handle?.dispose()
      await failedHandle?.dispose()
      await parentHandle?.dispose()
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not re-register an LLM adapter whose provider already has an owner', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-existing-llm-'))
    const ctx = await makeHarness(storageDir)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    await ctx.plugin(LlmDeepSeek)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
      const inspect = server as unknown as { hasAdapterFor(provider: string): boolean }

      expect(inspect.hasAdapterFor('deepseek-official')).toBe(true)
      expect(inspect.hasAdapterFor('missing-provider')).toBe(false)
      await server.initialize({ cwd: storageDir, provider: 'deepseek-official', model: 'preinstalled-model' })

      expect(ctx.get('llm')?.listProviders().filter(provider => provider.id === 'deepseek-official')).toEqual([{ id: 'deepseek-official', name: 'DeepSeek' }])
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('rejects a missing non-DeepSeek provider when an LLM service already exists', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-new-llm-'))
    const ctx = await makeHarness(storageDir)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    await ctx.plugin(LlmDeepSeek)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

      await expect(server.initialize({ cwd: storageDir, provider: 'private', model: 'new-model' }))
        .rejects.toThrow('no adapter registered for provider "private"')

      expect(ctx.get('llm')?.listProviders()).toEqual([{ id: 'deepseek-official', name: 'DeepSeek' }])
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid initialize maxTokens %s at the wire boundary',
    async (maxTokens) => {
      const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-invalid-max-tokens-'))
      const ctx = await makeHarness(storageDir)
      try {
        const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
        await expect(server.initialize({
          cwd: storageDir,
          provider: 'deepseek-official',
          model: 'model',
          maxTokens,
        })).rejects.toThrow('initialize maxTokens must be a positive safe integer')
        await server.shutdown()
      } finally {
        await ctx.fiber.dispose()
        await rm(storageDir, { recursive: true, force: true })
      }
    },
  )

  it('reports no adapter when the LLM service is absent', async () => {
    const ctx = new Context()
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
        hasAdapterFor(model: string): boolean
        shutdown(): Promise<Record<string, never>>
      }

      expect(server.hasAdapterFor('missing-model')).toBe(false)
      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects unknown JSON-RPC runtime methods', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'dsh-jsonrpc-unknown-'))
    const ctx = await makeHarness(storageDir)
    try {
      const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

      await expect(server.handleRequest('does/not/exist', {}))
        .rejects
        .toThrow('unknown DeepSeek Harness SDK runtime method: does/not/exist')

      await server.shutdown()
    } finally {
      await ctx.fiber.dispose()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('coalesces concurrent session creation and retries a failed creation', async () => {
    let resolveShared: ((handle: AgentHandle) => void) | undefined
    const sharedCreation = new Promise<AgentHandle>((resolve) => { resolveShared = resolve })
    const sharedHandle = { agent: {} as Agent, dispose: vi.fn(() => Promise.resolve()) }
    const retryHandle = { agent: {} as Agent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn<(options: unknown) => Promise<AgentHandle>>()
      .mockReturnValueOnce(sharedCreation)
      .mockRejectedValueOnce(new Error('creation failed'))
      .mockResolvedValueOnce(retryHandle)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create, get: () => undefined },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
      getOrCreateSession(sessionId: string): Promise<{ handle: AgentHandle }>
      shutdown(): Promise<Record<string, never>>
    }

    const first = server.getOrCreateSession('shared')
    const second = server.getOrCreateSession('shared')
    expect(create).toHaveBeenCalledTimes(1)
    resolveShared?.(sharedHandle)
    const [firstRecord, secondRecord] = await Promise.all([first, second])
    expect(firstRecord).toBe(secondRecord)

    await expect(server.getOrCreateSession('retry')).rejects.toThrow('creation failed')
    await expect(server.getOrCreateSession('retry')).resolves.toMatchObject({ handle: retryHandle })
    expect(create).toHaveBeenCalledTimes(3)

    await server.shutdown()
    expect(sharedHandle.dispose).toHaveBeenCalledOnce()
    expect(retryHandle.dispose).toHaveBeenCalledOnce()
    await expect(server.getOrCreateSession('after-shutdown')).rejects.toThrow('SDK server is shutting down')
  })

  it('shutdown waits out an in-flight session load', async () => {
    let resolveCreate: ((handle: AgentHandle) => void) | undefined
    const createGate = new Promise<AgentHandle>((resolve) => { resolveCreate = resolve })
    const dispose = vi.fn(() => Promise.resolve())
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('s1'),
      followup,
    } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const handle = { agent, dispose }
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create: vi.fn(() => createGate),
        get: (id: SessionId) => String(id) === 's1' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
    const prompted = server.handleRequest('session/prompt', {
      sessionId: 's1',
      contentBlocks: [{ type: 'text', text: 'go' }],
    })
    const down = server.shutdown()
    resolveCreate?.(handle)
    await expect(down).resolves.toEqual({})
    expect(dispose).toHaveBeenCalledOnce()
    await prompted.catch(() => undefined)
  })

  it('does not let resume join an in-flight create', async () => {
    let resolveCreate: ((handle: AgentHandle) => void) | undefined
    const createGate = new Promise<AgentHandle>((resolve) => { resolveCreate = resolve })
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('s1'),
      followup,
    } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn(() => createGate)
    const resume = vi.fn(async () => {
      throw new Error('session/resume must not join an in-flight create')
    })
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create,
        resume,
        get: (id: SessionId) => String(id) === 's1' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const prompted = server.handleRequest('session/prompt', {
      sessionId: 's1',
      contentBlocks: [{ type: 'text', text: 'go' }],
    })
    expect(create).toHaveBeenCalledOnce()
    const resumed = server.handleRequest('session/resume', { sessionId: 's1' })
    resolveCreate?.(handle)

    await expect(resumed).rejects.toThrow(/already being created/)
    await expect(prompted).resolves.toMatchObject({ messageId: expect.any(String) as unknown })
    expect(resume).not.toHaveBeenCalled()
    expect(followup).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('does not let prompt inherit an in-flight resume failure', async () => {
    let rejectResume: ((error: Error) => void) | undefined
    const resumeGate = new Promise<AgentHandle>((_, reject) => { rejectResume = reject })
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('s2'),
      followup,
    } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn(async () => handle)
    const resume = vi.fn(() => resumeGate)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create,
        resume,
        get: (id: SessionId) => String(id) === 's2' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const resumed = server.handleRequest('session/resume', { sessionId: 's2' })
    expect(resume).toHaveBeenCalledOnce()
    const prompted = server.handleRequest('session/prompt', {
      sessionId: 's2',
      contentBlocks: [{ type: 'text', text: 'go' }],
    })
    rejectResume?.(new Error('no persisted log'))

    await expect(resumed).rejects.toThrow('no persisted log')
    await expect(prompted).resolves.toMatchObject({ messageId: expect.any(String) as unknown })
    expect(create).toHaveBeenCalledOnce()
    expect(followup).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('lets prompt join a successful in-flight resume', async () => {
    let resolveResume: ((handle: AgentHandle) => void) | undefined
    const resumeGate = new Promise<AgentHandle>((resolve) => { resolveResume = resolve })
    const followup = vi.fn<Agent['followup']>()
    const agent = ({
      id: SessionId('s2'),
      followup,
    } satisfies Pick<Agent, 'id' | 'followup'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn(async () => {
      throw new Error('prompt must inherit a successful in-flight resume')
    })
    const resume = vi.fn(() => resumeGate)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create,
        resume,
        get: (id: SessionId) => String(id) === 's2' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const resumed = server.handleRequest('session/resume', { sessionId: 's2' })
    const prompted = server.handleRequest('session/prompt', {
      sessionId: 's2',
      contentBlocks: [{ type: 'text', text: 'go' }],
    })
    resolveResume?.(handle)

    await expect(resumed).resolves.toEqual({})
    await expect(prompted).resolves.toMatchObject({ messageId: expect.any(String) as unknown })
    expect(create).not.toHaveBeenCalled()
    expect(followup).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('cancels only after every prompt that joined one in-flight create has enqueued', async () => {
    let resolveCreate: ((handle: AgentHandle) => void) | undefined
    const createGate = new Promise<AgentHandle>((resolve) => { resolveCreate = resolve })
    const followup = vi.fn<Agent['followup']>()
    const cancel = vi.fn<Agent['cancel']>()
    const agent = ({
      id: SessionId('s6'),
      followup,
      cancel,
    } satisfies Pick<Agent, 'id' | 'followup' | 'cancel'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn(() => createGate)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create, get: (id: SessionId) => String(id) === 's6' ? agent : undefined },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const first = server.handleRequest('session/prompt', {
      sessionId: 's6',
      contentBlocks: [{ type: 'text', text: 'one' }],
    })
    const second = server.handleRequest('session/prompt', {
      sessionId: 's6',
      contentBlocks: [{ type: 'text', text: 'two' }],
    })
    const cancelled = server.handleRequest('session/cancel', { sessionId: 's6' })
    resolveCreate?.(handle)

    await expect(cancelled).resolves.toEqual({})
    await expect(first).resolves.toMatchObject({ messageId: expect.any(String) as unknown })
    await expect(second).resolves.toMatchObject({ messageId: expect.any(String) as unknown })
    expect(create).toHaveBeenCalledOnce()
    expect(followup).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' })
    expect(cancel.mock.invocationCallOrder[0]!)
      .toBeGreaterThan(followup.mock.invocationCallOrder[1]!)
    await server.shutdown()
  })

  it('cancels only after every prompt that joined a failing resume has enqueued', async () => {
    let rejectResume: ((error: Error) => void) | undefined
    const resumeGate = new Promise<AgentHandle>((_, reject) => { rejectResume = reject })
    const followup = vi.fn<Agent['followup']>()
    const cancel = vi.fn<Agent['cancel']>()
    const agent = ({
      id: SessionId('s7'),
      followup,
      cancel,
    } satisfies Pick<Agent, 'id' | 'followup' | 'cancel'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn(async () => handle)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create,
        resume: vi.fn(() => resumeGate),
        get: (id: SessionId) => String(id) === 's7' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const resumed = server.handleRequest('session/resume', { sessionId: 's7' })
    const first = server.handleRequest('session/prompt', {
      sessionId: 's7',
      contentBlocks: [{ type: 'text', text: 'one' }],
    })
    const second = server.handleRequest('session/prompt', {
      sessionId: 's7',
      contentBlocks: [{ type: 'text', text: 'two' }],
    })
    const cancelled = server.handleRequest('session/cancel', { sessionId: 's7' })
    rejectResume?.(new Error('no persisted log'))

    await expect(resumed).rejects.toThrow('no persisted log')
    await expect(cancelled).resolves.toEqual({})
    await expect(first).resolves.toMatchObject({ messageId: expect.any(String) as unknown })
    await expect(second).resolves.toMatchObject({ messageId: expect.any(String) as unknown })
    expect(create).toHaveBeenCalledOnce()
    expect(followup).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' })
    expect(cancel.mock.invocationCallOrder[0]!)
      .toBeGreaterThan(followup.mock.invocationCallOrder[1]!)
    await server.shutdown()
  })

  it('lets a second resume join the in-flight resume for the same id', async () => {
    let resolveResume: ((handle: AgentHandle) => void) | undefined
    const resumeGate = new Promise<AgentHandle>((resolve) => { resolveResume = resolve })
    const agent = ({ id: SessionId('s5') } satisfies Pick<Agent, 'id'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const resume = vi.fn(() => resumeGate)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), resume, get: () => undefined },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const first = server.handleRequest('session/resume', { sessionId: 's5' })
    const second = server.handleRequest('session/resume', { sessionId: 's5' })
    resolveResume?.(handle)

    await expect(first).resolves.toEqual({})
    await expect(second).resolves.toEqual({})
    expect(resume).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('passes the configured maxTokens to a resumed agent', async () => {
    const agent = ({ id: SessionId('main') } satisfies Pick<Agent, 'id'>) as unknown as Agent
    const resume = vi.fn(async () => ({ agent, dispose: () => Promise.resolve() }))
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), resume, get: () => undefined },
      get: () => ({ listProviders: () => [{ id: 'mock', name: 'Mock' }] }),
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    await server.initialize({ cwd: '/tmp', provider: 'mock', model: 'model', maxTokens: 321 })
    await server.handleRequest('session/resume', { sessionId: 'main' })

    expect(resume).toHaveBeenCalledWith(expect.objectContaining({
      agentOptions: { provider: 'mock', model: 'model', maxTokens: 321 },
    }))
    await server.shutdown()
  })

  it('cancels the lazy create a prompt starts after the resume it was waiting on fails', async () => {
    let rejectResume: ((error: Error) => void) | undefined
    const resumeGate = new Promise<AgentHandle>((_, reject) => { rejectResume = reject })
    const followup = vi.fn<Agent['followup']>()
    const cancel = vi.fn<Agent['cancel']>()
    const agent = ({
      id: SessionId('s3'),
      followup,
      cancel,
    } satisfies Pick<Agent, 'id' | 'followup' | 'cancel'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const create = vi.fn(async () => handle)
    const resume = vi.fn(() => resumeGate)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create,
        resume,
        get: (id: SessionId) => String(id) === 's3' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const resumed = server.handleRequest('session/resume', { sessionId: 's3' })
    const prompted = server.handleRequest('session/prompt', {
      sessionId: 's3',
      contentBlocks: [{ type: 'text', text: 'go' }],
    })
    const cancelled = server.handleRequest('session/cancel', { sessionId: 's3' })
    rejectResume?.(new Error('no persisted log'))

    await expect(resumed).rejects.toThrow('no persisted log')
    await expect(cancelled).resolves.toEqual({})
    await expect(prompted).resolves.toMatchObject({ messageId: expect.any(String) as unknown })
    expect(create).toHaveBeenCalledOnce()
    expect(followup).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('does not carry a cancel of a resumed session into the next prompt', async () => {
    let resolveResume: ((handle: AgentHandle) => void) | undefined
    const resumeGate = new Promise<AgentHandle>((resolve) => { resolveResume = resolve })
    const followup = vi.fn<Agent['followup']>()
    const cancel = vi.fn<Agent['cancel']>()
    const agent = ({
      id: SessionId('s4'),
      followup,
      cancel,
    } satisfies Pick<Agent, 'id' | 'followup' | 'cancel'>) as unknown as Agent
    const handle = { agent, dispose: vi.fn(() => Promise.resolve()) }
    const resume = vi.fn(() => resumeGate)
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: {
        create: vi.fn(async () => { throw new Error('the resumed session must be reused') }),
        resume,
        get: (id: SessionId) => String(id) === 's4' ? agent : undefined,
      },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    const resumed = server.handleRequest('session/resume', { sessionId: 's4' })
    const cancelled = server.handleRequest('session/cancel', { sessionId: 's4' })
    resolveResume?.(handle)
    await expect(resumed).resolves.toEqual({})
    await expect(cancelled).resolves.toEqual({})
    expect(cancel).toHaveBeenCalledOnce()

    await expect(server.handleRequest('session/prompt', {
      sessionId: 's4',
      contentBlocks: [{ type: 'text', text: 'go' }],
    })).resolves.toMatchObject({ messageId: expect.any(String) as unknown })

    expect(followup).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    await server.shutdown()
  })

  it('resolves a relative cwd before creating the session', async () => {
    const create = vi.fn<(options: unknown) => Promise<AgentHandle>>()
      .mockResolvedValue({ agent: {} as Agent, dispose: () => Promise.resolve() })
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create, get: () => undefined },
      get: () => ({ listProviders: () => [{ id: 'mock', name: 'Mock' }] }),
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
      initialize(params: { cwd: string; provider: string; model: string; maxTokens?: number }): Promise<unknown>
      getOrCreateSession(sessionId: string): Promise<unknown>
      shutdown(): Promise<Record<string, never>>
    }

    await server.initialize({ cwd: '.', provider: 'mock', model: 'model', maxTokens: 123 })
    await server.getOrCreateSession('relative')

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'mock', model: 'model', maxTokens: 123 },
    }))
    await server.shutdown()
  })

  it('settles every teardown and aggregates multiple failures', async () => {
    const firstDispose = vi.fn(() => { throw new Error('first teardown failed') })
    const secondDispose = vi.fn(() => Promise.reject(new Error('second teardown failed')))
    const ctx = {
      on: vi.fn(() => () => undefined),
      agents: { create: vi.fn(), get: () => undefined },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport()) as unknown as {
      sessions: Map<string, { handle: AgentHandle; lastTurnEnd: undefined; activePrompt: boolean }>
      shutdown(): Promise<Record<string, never>>
    }
    server.sessions.set('first', { handle: { agent: {} as Agent, dispose: firstDispose }, lastTurnEnd: undefined, activePrompt: false })
    server.sessions.set('second', { handle: { agent: {} as Agent, dispose: secondDispose }, lastTurnEnd: undefined, activePrompt: false })

    await expect(server.shutdown()).rejects.toThrow('SDK server teardown failed')
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(secondDispose).toHaveBeenCalledOnce()
  })

  it('continues teardown after a subscription disposer fails', async () => {
    let subscription = 0
    const listenerFailure = new Error('listener teardown failed')
    const on = vi.fn(() => {
      subscription += 1
      return subscription === 1 ? () => { throw listenerFailure } : () => undefined
    })
    const ctx = {
      on,
      agents: { create: vi.fn(), get: () => undefined },
      get: () => undefined,
    } as unknown as Context
    const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())

    await expect(server.shutdown()).rejects.toBe(listenerFailure)
    expect(on).toHaveBeenCalledTimes(5)
  })
})

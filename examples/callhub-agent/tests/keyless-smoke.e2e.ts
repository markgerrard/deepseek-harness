import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const binScript = fileURLToPath(new URL('../../../packages/examples/jsonrpc-demo/src/bin.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../cordis.yml', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function waitForLine(
  lines: string[],
  predicate: (value: Record<string, unknown>) => boolean,
  stderr: () => string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000
    const poll = (): void => {
      while (lines.length > 0) {
        const line = lines.shift()!
        if (!line.trim()) continue
        try {
          const value = JSON.parse(line) as Record<string, unknown>
          if (predicate(value)) {
            resolve(value)
            return
          }
        } catch {
          reject(new Error(`non-JSON stdout from JSON-RPC agent runtime: ${line}`))
          return
        }
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for JSON-RPC response; stderr=${stderr()}`))
        return
      }
      setTimeout(poll, 10)
    }
    poll()
  })
}

/** Minimal MCP Streamable-HTTP stub: initialize / initialized / tools/list,
 * one fake callhub tool, recording every Authorization header it sees. */
function startMcpStub(): Promise<{ port: number; authHeaders: string[]; close: () => Promise<void> }> {
  const authHeaders: string[] = []
  const server = createServer((request, response) => {
    authHeaders.push(String(request.headers.authorization ?? ''))
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const rpc = body ? JSON.parse(body) as { id?: number | string; method?: string } : {}
      const reply = (result: unknown): void => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
      }
      switch (rpc.method) {
        case 'initialize':
          reply({
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'callhub-stub', version: '0.0.0' },
          })
          return
        case 'tools/list':
          reply({
            tools: [{
              name: 'callhub_sql',
              description: 'stub',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            }, {
              name: 'callhub_transcripts',
              description: 'stub',
              inputSchema: { type: 'object', properties: { recording_ids: { type: 'array' } } },
            }],
          })
          return
        default:
          // Notifications (e.g. notifications/initialized) get a 202 per spec.
          response.writeHead(202)
          response.end()
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('mcp stub did not bind')
      resolve({
        port: address.port,
        authHeaders,
        close: () => new Promise<void>(done => server.close(() => { done() })),
      })
    })
  })
}

describe('callhub-agent keyless smoke', () => {
  it('boots the real leaf, sends the env bearer to MCP, and exposes NO write tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-callhub-agent-smoke-'))
    const mcp = await startMcpStub()
    const modelRequests: Record<string, unknown>[] = []
    const modelServer = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        modelRequests.push(JSON.parse(body) as Record<string, unknown>)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n')
        response.write('data: {"choices":[{"delta":{"content":"done"}}]}\n\n')
        response.write('data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n')
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve))
    const address = modelServer.address()
    if (address === null || typeof address === 'string') throw new Error('model server did not bind a TCP port')
    const child = execa(process.execPath, [
      '--import',
      'tsx',
      binScript,
      configPath,
    ], {
      cwd: repoRoot,
      env: {
        DEEPSEEK_API_KEY: 'keyless-smoke-no-call',
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
        DSH_CWD: root,
        DSH_SESSION_ROOT: join(root, '.sessions'),
        DSH_CALLHUB_MCP_URL: `http://127.0.0.1:${mcp.port}/mcp`,
        DSH_CALLHUB_MCP_AUTH: 'Bearer smoke-bearer-sentinel',
      },
      timeout: 35_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    const lines: string[] = []
    let stdoutBuffer = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const parts = stdoutBuffer.split('\n')
      stdoutBuffer = parts.pop() ?? ''
      lines.push(...parts)
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    const promptAndSettle = async (id: number, text: string): Promise<void> => {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'session/prompt',
        params: { sessionId: 'main', contentBlocks: [{ type: 'text', text }] },
      })}\n`)
      await waitForLine(lines, value => value.id === id, () => stderr)
      const requestsBefore = modelRequests.length
      await waitForLine(lines, (value) => {
        if (value.method !== 'session.event') return false
        const params = value.params as Record<string, unknown> | undefined
        const event = params?.event as Record<string, unknown> | undefined
        return params?.sessionId === 'main' && event?.type === 'turn/end'
          && modelRequests.length > requestsBefore
      }, () => stderr)
    }

    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { cwd: root, provider: 'deepseek-official', model: 'deepseek-v4-pro', maxTokens: 1234 },
      })}\n`)
      const initialized = await waitForLine(lines, value => value.id === 1, () => stderr)
      expect(initialized).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } },
      })

      // FIRST-TURN NEGATIVE CONTROL (r1 panel, convergent P1): the leaf lists
      // mcp-callhub BEFORE sdk-jsonrpc-server, and cordis activates entries in
      // order with mcp-client blocking activation on its initial tool sync —
      // so the VERY FIRST model request must already carry the callhub tool.
      // If this ever races again, this assertion is the tripwire.
      await promptAndSettle(2, 'inspect tools')

      // The bearer must have reached the stub from CHILD PROCESS ENV.
      expect(mcp.authHeaders.length).toBeGreaterThan(0)
      expect(mcp.authHeaders.every(header => header === 'Bearer smoke-bearer-sentinel')).toBe(true)

      // Model-visible tool surface: EXACT allowlist equality, so any tool
      // added to this composition must be acknowledged here. No execution
      // surface exists (no bash/terminal/fs/editor) -- the r1 panel P0: a
      // shell under a read-only FS can still read same-uid credentials and
      // exfiltrate over the network.
      const tools = (modelRequests[0]?.tools as { function?: { name?: string } }[]).map(
        tool => tool.function?.name ?? '',
      )
      expect(tools.sort()).toEqual([
        'mcp__callhub__callhub_sql',
        'mcp__callhub__callhub_transcripts',
        'skill',
      ])

      // The skill catalog must be discovered from the leaf's customSkillDirs
      // and published to the model: a composition that boots without its
      // catalog silently loses the encoded review workflows.
      expect(JSON.stringify(modelRequests[0]?.messages ?? [])).toContain('agent-review')

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'shutdown' })}\n`)
      await waitForLine(lines, value => value.id === 4, () => stderr)
      const exit = await child
      expect(exit.exitCode, `signal=${String(exit.signal)}; stderr=${stderr}`).toBe(0)
    } finally {
      // No-op after exit; reject: false settles on every outcome, so cleanup never races teardown.
      child.kill('SIGKILL')
      await child
      await new Promise<void>(resolve => modelServer.close(() => { resolve() }))
      await mcp.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 40_000)
})

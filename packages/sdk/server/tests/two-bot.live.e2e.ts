/**
 * Live two-bot e2e gate: validates concurrent multi-session execution with
 * distinct presets, personas, and Cline Pass DeepSeek V4 models using the
 * macOS composition.
 *
 * Real-API suite: self-skips without CLINE_API_KEY (env or ~/.dsh/.credentials.yaml).
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessClient, type ContentBlock, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/lib/bin.js')
const typertRegistryJs = join(repoRoot, 'packages/typert/registry/lib/index.js')
const apiGatewayJs = join(repoRoot, 'packages/api/gateway/lib/index.js')

const PROVIDER = 'cline-pass'
const MODEL_FLASH = 'cline-pass/deepseek-v4-flash'
const MODEL_PRO = 'cline-pass/deepseek-v4-pro'

function clineApiKey(): string | undefined {
  const fromEnv = process.env.CLINE_API_KEY
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim()
  try {
    const text = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    for (const line of text.split('\n')) {
      const match = /^CLINE_API_KEY:\s*(.*)$/.exec(line)
      if (match?.[1] === undefined) continue
      const value = match[1].trim().replace(/^['"]|['"]$/g, '')
      if (value !== '') return value
    }
  } catch {
    // absent or unreadable credentials file
  }
  return undefined
}

const clineKey = clineApiKey()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInboxReceipt(value: unknown, messageId: string): boolean {
  if (!isRecord(value) || value['type'] !== 'agent/inbox/spliced' || !isRecord(value['data'])) return false
  const inserted = value['data']['inserted']
  return Array.isArray(inserted) && inserted.some(message => isRecord(message) && message['id'] === messageId)
}

function turnEndError(events: SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'turn/end' || !isRecord(event.data) || !isRecord(event.data['reason'])) continue
    const reason = event.data['reason']
    if (reason['kind'] !== 'error') return undefined
    const error = reason['error']
    if (isRecord(error) && typeof error['message'] === 'string') return error['message']
    return JSON.stringify(reason)
  }
  return undefined
}

function extractAssistantText(events: SessionEvent[]): string {
  const texts: string[] = []
  for (const event of events) {
    if (event.type === 'assistant/message' && isRecord(event.data) && isRecord(event.data['message'])) {
      const content = (event.data['message'] as { content?: unknown }).content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
            texts.push(block['text'])
          }
        }
      }
    }
  }
  return texts.join('')
}

function requestHeaderSnapshot(events: SessionEvent[]): {
  model?: string
  provider?: string
  system?: string
} | undefined {
  const event = events.find(entry => entry.type === 'request/header')
  if (event === undefined || !isRecord(event.data) || !isRecord(event.data['header'])) return undefined
  const header = event.data['header']
  const config = isRecord(header['config']) ? header['config'] : undefined
  return {
    ...typeof config?.['model'] === 'string' ? { model: config['model'] } : {},
    ...typeof config?.['provider'] === 'string' ? { provider: config['provider'] } : {},
    ...typeof header['system'] === 'string' ? { system: header['system'] } : {},
  }
}

describe.skipIf(clineKey === undefined || !existsSync(dshBin))('two-bot live e2e gate (Cline Pass)', () => {
  let client: HarnessClient | undefined
  const cleanups: (() => Promise<void>)[] = []

  afterEach(async () => {
    if (client !== undefined) {
      await client.close()
      client = undefined
    }
    for (const cleanup of cleanups.splice(0)) {
      await cleanup()
    }
  })

  it('runs two distinct bots with independent personas, presets, and models', async () => {
    if (!existsSync(dshBin)) {
      throw new Error(`macos e2e needs the built CLI at ${dshBin}`)
    }
    // Client-face packages (typert-registry, api-gateway, …) only emit
    // lib/index.js during `pnpm run build:lib:client`. Host typecheck does
    // not; without those files the macos profile dies on ESM import.
    for (const file of [typertRegistryJs, apiGatewayJs]) {
      if (!existsSync(file)) {
        throw new Error(`macos e2e needs ${file}; run pnpm run build:lib first`)
      }
    }

    const homeDir = await mkdtemp(join(tmpdir(), 'dsh-two-bot-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-two-bot-ws-'))
    cleanups.push(() => rm(homeDir, { recursive: true, force: true }))
    cleanups.push(() => rm(workspace, { recursive: true, force: true }))
    const runId = randomUUID().slice(0, 8)
    const botA = `e2e-a-${runId}`
    const botB = `e2e-b-${runId}`
    const sessionA = `s-a-${runId}`
    const sessionB = `s-b-${runId}`

    client = new HarnessClient({
      command: process.execPath,
      args: [dshBin, '--profile', 'macos'],
      cwd: repoRoot,
      env: {
        ...process.env,
        DSH_HOME: homeDir,
        DSH_TELEMETRY_DISABLED: '1',
        CLINE_API_KEY: clineKey,
      },
      requestTimeoutMs: 120_000,
    })

    client.onRequest(async () => {
      return { outcome: 'rejected' }
    })

    client.start()

    await client.initialize({
      cwd: workspace,
      provider: PROVIDER,
      model: MODEL_FLASH,
      clientCapabilities: { approvals: true },
    })

    await client.copyPreset('code', botA)
    await client.copyPreset('code', botB)

    await client.setPersona(
      botA,
      'You are TOKEN-A. Working dir {{cwd}}. Model {{model}}. When asked for your job token, reply with exactly TOKEN-A and do not use tools.',
    )
    await client.setPersona(
      botB,
      'You are TOKEN-B. Working dir {{cwd}}. Model {{model}}. When asked for your job token, reply with exactly TOKEN-B and do not use tools.',
    )

    const subscription = client.subscribe()

    const allNotifications: HarnessNotification[] = []
    const eventsA: SessionEvent[] = []
    const eventsB: SessionEvent[] = []

    const textBlocks: ContentBlock[] = [{
      type: 'text',
      text: 'Do not use tools. Reply with exactly your job token from the system prompt (TOKEN-A or TOKEN-B) and nothing else.',
    }]

    // Cline Pass overlay models do not advertise reasoningEfforts; sending
    // `off`/`high` fails the turn with UNSUPPORTED_REASONING_EFFORT.
    const messageIdA = await client.prompt(sessionA, textBlocks, {
      agentPreset: botA,
      provider: PROVIDER,
      model: MODEL_FLASH,
    })

    const messageIdB = await client.prompt(sessionB, textBlocks, {
      agentPreset: botB,
      provider: PROVIDER,
      model: MODEL_PRO,
    })

    let receivedA = false
    let receivedB = false
    let idleA = false
    let idleB = false

    const deadline = Date.now() + 180_000
    try {
      while (!idleA || !idleB) {
        if (Date.now() > deadline) {
          throw new Error(
            `Timeout waiting for ${sessionA} and ${sessionB} to become idle (idleA=${String(idleA)}, idleB=${String(idleB)})`,
          )
        }
        const notification = await subscription.next()
        allNotifications.push(notification)

        if (notification.method === 'session.event') {
          const sid = notification.params['sessionId']
          const event = notification.params['event'] as SessionEvent
          if (sid === sessionA) {
            eventsA.push(event)
            if (!receivedA && isInboxReceipt(event, messageIdA)) {
              receivedA = true
            }
          } else if (sid === sessionB) {
            eventsB.push(event)
            if (!receivedB && isInboxReceipt(event, messageIdB)) {
              receivedB = true
            }
          }
        } else if (notification.method === 'session.status') {
          const sid = notification.params['sessionId']
          const status = notification.params['status']
          if (sid === sessionA && receivedA && status === 'idle') {
            idleA = true
          }
          if (sid === sessionB && receivedB && status === 'idle') {
            idleB = true
          }
        }
      }
    } finally {
      subscription.close()
    }

    // Fail if either session's events mix the other's sessionId as its own
    for (const notification of allNotifications) {
      if (notification.method === 'session.event') {
        const sid = notification.params['sessionId']
        const event = notification.params['event'] as SessionEvent
        if (sid === sessionA) {
          expect(notification.params['sessionId']).toBe(sessionA)
          if (isRecord(event.data) && 'sessionId' in event.data) {
            expect(event.data['sessionId']).not.toBe(sessionB)
          }
        } else if (sid === sessionB) {
          expect(notification.params['sessionId']).toBe(sessionB)
          if (isRecord(event.data) && 'sessionId' in event.data) {
            expect(event.data['sessionId']).not.toBe(sessionA)
          }
        }
      }
    }

    const textA = extractAssistantText(eventsA)
    const textB = extractAssistantText(eventsB)
    const headerA = requestHeaderSnapshot(eventsA)
    const headerB = requestHeaderSnapshot(eventsB)

    const summary = {
      gate: 'two-bot-live-e2e',
      sessionA,
      sessionB,
      botA,
      botB,
      excerptA: textA.slice(0, 400),
      excerptB: textB.slice(0, 400),
      modelA: headerA?.model,
      modelB: headerB?.model,
    }
    // Artefact fields for apps/macos/docs/e2e-run.txt — no credentials.
    console.log(JSON.stringify(summary))

    if (!eventsA.some(event => event.type === 'turn/start') || !eventsB.some(event => event.type === 'turn/start')) {
      throw new Error(`sessions went idle without a model turn: ${JSON.stringify(summary)}`)
    }
    const errorA = turnEndError(eventsA)
    const errorB = turnEndError(eventsB)
    if (errorA !== undefined || errorB !== undefined) {
      throw new Error(`model turn failed: A=${errorA ?? 'ok'} B=${errorB ?? 'ok'}`)
    }

    const tokenMatchA = textA.includes('TOKEN-A') && !textA.includes('TOKEN-B')
    const tokenMatchB = textB.includes('TOKEN-B') && !textB.includes('TOKEN-A')

    if (tokenMatchA && tokenMatchB) {
      expect(textA).toContain('TOKEN-A')
      expect(textA).not.toContain('TOKEN-B')
      expect(textB).toContain('TOKEN-B')
      expect(textB).not.toContain('TOKEN-A')
    } else {
      expect(headerA).toBeDefined()
      expect(headerB).toBeDefined()
      expect(headerA?.model).toBe(MODEL_FLASH)
      expect(headerB?.model).toBe(MODEL_PRO)
      expect(headerA?.system).toBeDefined()
      expect(headerB?.system).toBeDefined()
      expect(headerA?.system).toContain('TOKEN-A')
      expect(headerA?.system).not.toContain('TOKEN-B')
      expect(headerB?.system).toContain('TOKEN-B')
      expect(headerB?.system).not.toContain('TOKEN-A')
    }
  }, 240_000)
})

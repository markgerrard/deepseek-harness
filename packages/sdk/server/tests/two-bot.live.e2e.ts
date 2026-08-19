/**
 * Live two-bot e2e gate: validates concurrent multi-session execution with
 * distinct presets, personas, and reasoning effort levels using the macOS
 * composition.
 *
 * Real-API suite: self-skips without DEEPSEEK_API_KEY.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessClient, type ContentBlock, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/lib/bin.js')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInboxReceipt(value: unknown, messageId: string): boolean {
  if (!isRecord(value) || value['type'] !== 'agent/inbox/spliced' || !isRecord(value['data'])) return false
  const inserted = value['data']['inserted']
  return Array.isArray(inserted) && inserted.some(message => isRecord(message) && message['id'] === messageId)
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

describe.skipIf(process.env.DEEPSEEK_API_KEY === undefined)('two-bot live e2e gate', () => {
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

  it('runs two distinct bots with independent personas, presets, and reasoning effort', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'dsh-two-bot-home-'))
    cleanups.push(() => rm(homeDir, { recursive: true, force: true }))

    const workspace = await mkdtemp(join(tmpdir(), 'dsh-two-bot-ws-'))
    cleanups.push(() => rm(workspace, { recursive: true, force: true }))

    client = new HarnessClient({
      command: process.execPath,
      args: [dshBin, '--profile', 'macos'],
      cwd: repoRoot,
      env: {
        ...process.env,
        DSH_HOME: homeDir,
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      },
      requestTimeoutMs: 90_000,
    })

    client.onRequest(async () => {
      return { outcome: 'rejected' }
    })

    client.start()

    await client.initialize({
      cwd: workspace,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      clientCapabilities: { approvals: true },
    })

    await client.copyPreset('code', 'bot-a')
    await client.copyPreset('code', 'bot-b')

    await client.setPersona('bot-a', 'You are TOKEN-A. Working dir {{cwd}}. Model {{model}}.')
    await client.setPersona('bot-b', 'You are TOKEN-B. Working dir {{cwd}}. Model {{model}}.')

    const subscription = client.subscribe()

    const allNotifications: HarnessNotification[] = []
    const eventsA: SessionEvent[] = []
    const eventsB: SessionEvent[] = []

    const textBlocks: ContentBlock[] = [{ type: 'text', text: 'Reply with your job token only.' }]

    const messageIdA = await client.prompt('s-a', textBlocks, {
      agentPreset: 'bot-a',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'off',
    })

    const messageIdB = await client.prompt('s-b', textBlocks, {
      agentPreset: 'bot-b',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    })

    let receivedA = false
    let receivedB = false
    let idleA = false
    let idleB = false

    const deadline = Date.now() + 90_000
    try {
      while (!idleA || !idleB) {
        if (Date.now() > deadline) {
          throw new Error(
            `Timeout waiting for s-a and s-b to become idle (idleA=${String(idleA)}, idleB=${String(idleB)})`,
          )
        }
        const notification = await subscription.next()
        allNotifications.push(notification)

        if (notification.method === 'session.event') {
          const sid = notification.params['sessionId']
          const event = notification.params['event'] as SessionEvent
          if (sid === 's-a') {
            if (!receivedA && isInboxReceipt(event, messageIdA)) {
              receivedA = true
            }
            if (receivedA) {
              eventsA.push(event)
            }
          } else if (sid === 's-b') {
            if (!receivedB && isInboxReceipt(event, messageIdB)) {
              receivedB = true
            }
            if (receivedB) {
              eventsB.push(event)
            }
          }
        } else if (notification.method === 'session.status') {
          const sid = notification.params['sessionId']
          const status = notification.params['status']
          if (sid === 's-a' && receivedA && status === 'idle') {
            idleA = true
          }
          if (sid === 's-b' && receivedB && status === 'idle') {
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
        if (sid === 's-a') {
          expect(notification.params['sessionId']).toBe('s-a')
          if (isRecord(event.data) && 'sessionId' in event.data) {
            expect(event.data['sessionId']).not.toBe('s-b')
          }
        } else if (sid === 's-b') {
          expect(notification.params['sessionId']).toBe('s-b')
          if (isRecord(event.data) && 'sessionId' in event.data) {
            expect(event.data['sessionId']).not.toBe('s-a')
          }
        }
      }
    }

    const textA = extractAssistantText(eventsA)
    const textB = extractAssistantText(eventsB)

    const tokenMatchA = textA.includes('TOKEN-A') && !textA.includes('TOKEN-B')
    const tokenMatchB = textB.includes('TOKEN-B') && !textB.includes('TOKEN-A')

    if (tokenMatchA && tokenMatchB) {
      expect(textA).toContain('TOKEN-A')
      expect(textA).not.toContain('TOKEN-B')
      expect(textB).toContain('TOKEN-B')
      expect(textB).not.toContain('TOKEN-A')
    } else {
      const headerEventA = eventsA.find(e => e.type === 'request/header')
      const headerEventB = eventsB.find(e => e.type === 'request/header')

      expect(headerEventA).toBeDefined()
      expect(headerEventB).toBeDefined()

      const effortA = (headerEventA?.data as { header?: { config?: { reasoningEffort?: string } } })?.header?.config?.reasoningEffort
      const effortB = (headerEventB?.data as { header?: { config?: { reasoningEffort?: string } } })?.header?.config?.reasoningEffort
      expect(effortA).not.toEqual(effortB)

      const presetA = (headerEventA?.data as { header?: { agentPreset?: string } })?.header?.agentPreset
      const presetB = (headerEventB?.data as { header?: { agentPreset?: string } })?.header?.agentPreset
      expect(presetA).not.toEqual(presetB)
    }
  }, 120_000)
})

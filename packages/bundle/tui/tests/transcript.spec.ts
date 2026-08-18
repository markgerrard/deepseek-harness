import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  foldRequestModel,
  foldSessionTitle,
  projectTranscript,
  textOf,
  toggleId,
} from '../src/transcript.ts'

const event = (type: string, seq: number, data: unknown): SessionEvent =>
  ({ type, seq, data } as SessionEvent)

describe('Crush transcript projection', () => {
  it('joins text blocks and folds the last title and model', () => {
    expect(textOf([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab')
    expect(foldSessionTitle([
      event('session/title', 1, { title: 'first' }),
      event('session/title', 2, { title: 'last' }),
    ])).toBe('last')
    expect(foldRequestModel([
      event('request/header', 1, { header: { config: { provider: 'p', model: 'm' } } }),
    ])).toEqual({ provider: 'p', model: 'm' })
  })

  it('keeps human user rows and omits plugin sources', () => {
    const items = projectTranscript([
      event('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }),
      event('user/message', 2, { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'hidden' }] }),
    ])
    expect(items).toEqual([
      { kind: 'user', id: 'user:1', seq: 1, text: 'hello' },
    ])
  })

  it('folds streaming chunks until the assistant message lands', () => {
    const streaming = projectTranscript([
      event('assistant/chunk', 1, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hel' } }),
      event('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 1, text: 'hmm' } }),
    ])
    expect(streaming.map(item => item.kind)).toEqual(['reasoning', 'assistant'])
    const landed = projectTranscript([
      event('assistant/chunk', 1, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hel' } }),
      event('assistant/message', 2, {
        message: { content: [{ type: 'text', text: 'Hello' }] },
      }),
    ])
    expect(landed).toEqual([
      { kind: 'assistant', id: 'asst:2', seq: 2, text: 'Hello', streaming: false },
    ])
  })

  it('updates tool cards from call to result and honors expansion', () => {
    const items = projectTranscript([
      event('tool/call', 1, { callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }),
      event('tool/result', 2, {
        message: {
          source: { kind: 'tool', callId: 'c1' },
          content: [{ type: 'text', text: 'ok' }],
        },
        meta: { oldText: 'a', newText: 'b' },
      }),
    ], { tools: new Set(['tool:c1']), reasoning: new Set() })
    expect(items[0]).toMatchObject({
      kind: 'tool', callId: 'c1', name: 'bash', status: 'success', expanded: true, result: 'ok',
    })
  })

  it('toggles expansion ids immutably', () => {
    const added = toggleId(new Set(), 'x')
    expect(added.has('x')).toBe(true)
    expect(toggleId(added, 'x').has('x')).toBe(false)
  })
})

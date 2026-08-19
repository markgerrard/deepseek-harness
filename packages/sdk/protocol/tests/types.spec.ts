import { describe, expect, it } from 'vitest'
import type { HarnessSdkRequestMap, SessionPromptParams } from '../src/index.ts'

describe('SDK protocol preset and per-session model fields', () => {
  it('names the new request methods on the request map', () => {
    const methods: (keyof HarnessSdkRequestMap)[] = [
      'presets/list', 'presets/copy', 'presets/setPersona', 'session/setModel',
    ]
    expect(methods).toHaveLength(4)
  })

  it('accepts optional create fields on session/prompt', () => {
    const params: SessionPromptParams = {
      sessionId: 's1',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      agentPreset: 'bot-a',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    }
    expect(params.agentPreset).toBe('bot-a')
    expect(params.reasoningEffort).toBe('high')
  })
})

import { describe, expect, it } from 'vitest'
import { insertTurnClocks, renderCard, renderDiff, renderTranscript, summarizeArgs, toneColor, toolMarkTone } from '../src/cards.ts'
import { COLORS, ICONS } from '../src/theme.ts'

describe('Claude Code-like cards', () => {
  it('summarizes JSON args and falls back to a snippet', () => {
    expect(summarizeArgs('{"path":"/tmp/a.ts"}', 20)).toBe('/tmp/a.ts')
    expect(summarizeArgs('not-json-args', 8)).toBe('not-jso…')
    expect(summarizeArgs('{}', 20)).toBe('')
  })

  it('renders a simple old/new diff from tool meta', () => {
    expect(renderDiff({ oldText: 'a\nb', newText: 'a\nc' }, 20)).toContain('- b')
    expect(renderDiff({ diff: '--- a\n+++ b' }, 20)).toContain('+++ b')
    expect(renderDiff({}, 20)).toBeUndefined()
  })

  it('renders user, assistant, reasoning, and tool cards', () => {
    expect(renderCard({ kind: 'user', id: 'u', seq: 1, text: 'hi' }, 40).text).toContain(`${ICONS.user} hi`)
    expect(ICONS.user).toBe('›')
    expect(renderCard({ kind: 'assistant', id: 'a', seq: 2, text: 'ok', streaming: true }, 40).text).toContain(`${ICONS.assistant} ok`)
    expect(renderCard({ kind: 'assistant', id: 'a', seq: 2, text: 'ok', streaming: true }, 40).text).toContain(ICONS.spinner)
    expect(ICONS.assistant).toBe('●')
    expect(renderCard({
      kind: 'reasoning', id: 'r', seq: 3, text: 'think', streaming: false, expanded: false,
    }, 40).text).toContain('space to expand')
    const tool = renderCard({
      kind: 'tool', id: 't', seq: 4, callId: 'c', name: 'bash', args: '{"cmd":"ls"}',
      status: 'success', expanded: true, result: 'ok',
    }, 40)
    expect(tool.text).toContain('Bash command')
    expect(tool.text).toContain(ICONS.toolSuccess)
    expect(tool.text).toContain('ls')
    expect(renderTranscript([], 40)).toBe('')
  })

  it('wraps long assistant and user text instead of ellipsizing', () => {
    const long = 'word '.repeat(16).trim()
    const assistant = renderCard({ kind: 'assistant', id: 'a', seq: 1, text: long, streaming: false }, 20)
    expect(assistant.text).not.toContain('…')
    expect(assistant.text).toContain('word')
    expect(assistant.text.split('\n').length).toBeGreaterThan(1)
    const user = renderCard({ kind: 'user', id: 'u', seq: 2, text: long }, 20)
    expect(user.text.startsWith(`${ICONS.user} `)).toBe(true)
    expect(user.text).not.toContain('…')
  })

  it('interleaves finished clocks after completed turns and skips the in-flight turn', () => {
    const user1 = { kind: 'user' as const, id: 'u1', seq: 1, text: 'one' }
    const asst1 = { kind: 'assistant' as const, id: 'a1', seq: 2, text: 'ok', streaming: false }
    const user2 = { kind: 'user' as const, id: 'u2', seq: 3, text: 'two' }
    const asst2 = { kind: 'assistant' as const, id: 'a2', seq: 4, text: 'ok', streaming: false }
    const clocks = [
      { id: 'clock:0', ms: 2000, verb: 'Baked' },
      { id: 'clock:1', ms: 3000, verb: 'Sautéed' },
    ]
    const idle = insertTurnClocks([user1, asst1, user2, asst2], clocks, false)
    expect(idle.map(row => row.type === 'clock' ? row.clock.verb : row.item.id)).toEqual([
      'u1', 'a1', 'Baked', 'u2', 'a2', 'Sautéed',
    ])
    const busy = insertTurnClocks([user1, asst1, user2, asst2], [clocks[0]!], true)
    expect(busy.map(row => row.type === 'clock' ? row.clock.verb : row.item.id)).toEqual([
      'u1', 'a1', 'Baked', 'u2', 'a2',
    ])
  })

  it('colors user marks terracotta, tool titles lavender, and status marks', () => {
    const user = renderCard({ kind: 'user', id: 'u', seq: 1, text: 'hi' }, 40)
    expect(user.segments[0]?.tone).toBe('user')
    expect(toneColor('user')).toBe(COLORS.brand)
    const tool = renderCard({
      kind: 'tool', id: 't', seq: 4, callId: 'c', name: 'bash', args: '{"cmd":"ls"}',
      status: 'success', expanded: false,
    }, 40)
    expect(tool.segments.some(segment => segment.tone === 'tool' && segment.text.includes('Bash'))).toBe(true)
    expect(toolMarkTone('success')).toBe('success')
    expect(toneColor('success')).toBe(COLORS.success)
    expect(toneColor('error')).toBe(COLORS.error)
    expect(toneColor('tool')).toBe(COLORS.tool)
    expect(toneColor('brand')).toBe(COLORS.brand)
    const thinking = renderCard({
      kind: 'reasoning', id: 'r', seq: 3, text: 'think', streaming: false, expanded: false,
    }, 40)
    expect(thinking.segments[0]?.tone).toBe('brand')
    expect(thinking.segments.some(segment => segment.tone === 'thinking')).toBe(true)
  })
})

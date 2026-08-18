import { describe, expect, it } from 'vitest'
import { cardWrapWidth, estimateCardHeight, insertTurnClocks, pinTranscriptToBottom, renderCard, renderDiff, renderTranscript, summarizeArgs, toneColor, toolMarkTone } from '../src/cards.ts'
import { wrapText } from '../src/status.ts'
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

describe('pinTranscriptToBottom', () => {
  const user = (id: string, text: string) => ({ kind: 'user' as const, id, seq: 1, text })
  const assistant = (id: string, text: string) => ({
    kind: 'assistant' as const, id, seq: 2, text, streaming: false,
  })

  it('keeps the last card and drops the first when cards are taller than the viewport', () => {
    const rows = [
      { type: 'item' as const, item: user('u0', 'oldest prompt') },
      { type: 'item' as const, item: assistant('a0', 'oldest reply') },
      { type: 'item' as const, item: user('u1', 'newest prompt') },
      { type: 'item' as const, item: assistant('a1', 'newest reply that must stay visible') },
    ]
    const pin = pinTranscriptToBottom(rows, 40, 1)
    const ids = pin.rows.map(row => row.type === 'item' ? row.item.id : row.clock.id)
    expect(pin.taller).toBe(true)
    expect(ids[ids.length - 1]).toBe('a1')
    expect(ids).not.toContain('u0')
    expect(ids).toContain('a1')
  })

  it('keeps every card when the transcript fits', () => {
    const rows = [
      { type: 'item' as const, item: user('u1', 'hi') },
      { type: 'item' as const, item: assistant('a1', 'ok') },
    ]
    const pin = pinTranscriptToBottom(rows, 40, 20)
    expect(pin.taller).toBe(false)
    expect(pin.rows).toHaveLength(2)
    expect(pin.rows[0]?.type === 'item' && pin.rows[0].item.id).toBe('u1')
    expect(pin.rows[1]?.type === 'item' && pin.rows[1].item.id).toBe('a1')
  })

  it('pin-slices a card taller than the viewport so painted height fits and only the top is clipped', () => {
    const long = 'word '.repeat(80).trim()
    const rows = [
      { type: 'item' as const, item: user('u0', 'old') },
      { type: 'item' as const, item: assistant('a1', long) },
    ]
    const width = 20
    const viewport = 3
    const pin = pinTranscriptToBottom(rows, width, viewport)
    const ids = pin.rows.map(row => row.type === 'item' ? row.item.id : row.clock.id)
    expect(pin.taller).toBe(true)
    expect(ids).toEqual(['a1'])
    expect(pin.visibleHeight).toBeLessThanOrEqual(viewport)
    expect(pin.visibleHeight).toBe(viewport)
    expect(pin.skipLeadingLines).toBeGreaterThan(0)
    const first = pin.rows[0]
    if (first === undefined || first.type !== 'item') throw new Error('expected pinned item')
    const rendered = renderCard(first.item, width)
    const visible = rendered.lines.slice(pin.skipLeadingLines)
    expect(visible).toHaveLength(pin.visibleHeight)
    expect(visible[visible.length - 1]).toEqual(rendered.lines[rendered.lines.length - 1])
    expect(visible[0]).not.toEqual(rendered.lines[0])
  })
})

describe('pre-wrap width matches estimateCardHeight', () => {
  it('wraps a known string to N lines at width W and estimateCardHeight equals N', () => {
    const width = cardWrapWidth(10)
    const body = 'x'.repeat(30)
    const item = { kind: 'assistant' as const, id: 'a', seq: 1, text: body, streaming: false }
    const wrapped = wrapText(`${ICONS.assistant} ${body}`, width)
    const n = wrapped.split('\n').length
    expect(n).toBe(4)
    expect(estimateCardHeight(item, width)).toBe(n)
    const rendered = renderCard(item, width)
    expect(rendered.lines).toHaveLength(n)
    for (const line of rendered.lines) {
      const cells = line.segments.map(segment => segment.text).join('').length
      expect(cells).toBeLessThanOrEqual(width)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { renderCard, renderDiff, renderTranscript, summarizeArgs } from '../src/cards.ts'
import { ICONS } from '../src/theme.ts'

describe('Crush cards', () => {
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
    expect(renderCard({ kind: 'user', id: 'u', seq: 1, text: 'hi' }, 40).text).toContain(ICONS.borderThick)
    expect(renderCard({ kind: 'assistant', id: 'a', seq: 2, text: 'ok', streaming: true }, 40).text).toContain(ICONS.spinner)
    expect(renderCard({
      kind: 'reasoning', id: 'r', seq: 3, text: 'think', streaming: false, expanded: false,
    }, 40).text).toContain('space to expand')
    const tool = renderCard({
      kind: 'tool', id: 't', seq: 4, callId: 'c', name: 'bash', args: '{"cmd":"ls"}',
      status: 'success', expanded: true, result: 'ok',
    }, 40)
    expect(tool.text).toContain('bash')
    expect(renderTranscript([], 40)).toBe('')
  })
})

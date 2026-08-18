import { describe, expect, it } from 'vitest'
import { editorHeight, isCompact, layoutAreas } from '../src/layout.ts'
import { TRANSCRIPT_PROMPT_GAP } from '../src/theme.ts'

describe('Claude Code-like layout helpers', () => {
  it('still reports leftover compact breakpoints without using a sidebar', () => {
    expect(isCompact(119, 40)).toBe(true)
    expect(isCompact(140, 29)).toBe(true)
    expect(isCompact(120, 30)).toBe(false)
  })

  it('clamps the editor band between 3 and 15 rows', () => {
    expect(editorHeight(1)).toBe(3)
    expect(editorHeight(8)).toBe(8)
    expect(editorHeight(20)).toBe(15)
  })

  it('is always a single column: no sidebar, no Crush header band', () => {
    const full = layoutAreas(140, 40, 3)
    expect(full.sidebar).toBeUndefined()
    expect(full.main.x).toBe(0)
    expect(full.header.height).toBe(0)
    expect(full.main.width).toBe(140)
    const compact = layoutAreas(80, 24, 3)
    expect(compact.sidebar).toBeUndefined()
    expect(compact.main.x).toBe(0)
    expect(compact.header.height).toBe(0)
    expect(compact.editor.y).toBe(compact.main.y + compact.main.height + TRANSCRIPT_PROMPT_GAP)
    expect(compact.editor.y + compact.editor.height + compact.status.height).toBe(24)
    expect(full.editor.y).toBe(full.main.y + full.main.height + TRANSCRIPT_PROMPT_GAP)
    expect(TRANSCRIPT_PROMPT_GAP).toBeGreaterThanOrEqual(1)
    expect(TRANSCRIPT_PROMPT_GAP).toBeLessThanOrEqual(2)
  })
})

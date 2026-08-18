import { describe, expect, it } from 'vitest'
import { editorHeight, isCompact, layoutAreas } from '../src/layout.ts'

describe('Crush layout helpers', () => {
  it('hides the sidebar below the 120x30 breakpoints', () => {
    expect(isCompact(119, 40)).toBe(true)
    expect(isCompact(140, 29)).toBe(true)
    expect(isCompact(120, 30)).toBe(false)
  })

  it('clamps the editor band between 3 and 15 rows', () => {
    expect(editorHeight(1)).toBe(3)
    expect(editorHeight(8)).toBe(8)
    expect(editorHeight(20)).toBe(15)
  })

  it('places sidebar then main in full layout and omits it when compact', () => {
    const full = layoutAreas(140, 40, 3)
    expect(full.compact).toBe(false)
    expect(full.sidebar?.width).toBe(30)
    expect(full.main.x).toBe(30)
    expect(full.header.height).toBe(2)
    const compact = layoutAreas(80, 24, 3)
    expect(compact.compact).toBe(true)
    expect(compact.sidebar).toBeUndefined()
    expect(compact.main.x).toBe(0)
    expect(compact.header.height).toBe(1)
  })
})

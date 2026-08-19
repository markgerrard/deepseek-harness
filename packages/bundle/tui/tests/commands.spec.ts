import { describe, expect, it } from 'vitest'
import { CHROME_COMMANDS, filterPalette, isPaletteOpen, mergePalette, routeLine } from '../src/commands.ts'

describe('Claude Code-like command palette', () => {
  it('merges chrome first and skips colliding DSH names', () => {
    const merged = mergePalette([
      { name: 'help', description: 'ignored' },
      { name: 'compact', description: 'Compact the session' },
    ])
    expect(merged[0]?.name).toBe('help')
    expect(merged.filter(item => item.name === 'help')).toHaveLength(1)
    expect(merged.some(item => item.id === 'dsh:compact')).toBe(false)
    expect(merged.some(item => item.name === 'clear')).toBe(true)
    expect(merged.some(item => item.name === 'compact' && item.id === 'chrome:compact')).toBe(true)
    expect(merged.some(item => item.name === 'cost')).toBe(true)
    expect(merged.some(item => item.name === 'agents')).toBe(true)
    expect(merged.some(item => item.name === 'attach' && item.id === 'chrome:attach')).toBe(true)
  })

  it('filters by slash-stripped name or description', () => {
    expect(filterPalette(CHROME_COMMANDS, '/mod').map(item => item.name)).toEqual(['model'])
    expect(filterPalette(CHROME_COMMANDS, 'QUIT').map(item => item.name)).toEqual(['quit'])
  })

  it('routes empty, slash, and prompt lines', () => {
    expect(routeLine('   ')).toEqual({ kind: 'empty' })
    expect(routeLine('/help')).toMatchObject({ kind: 'command', name: 'help' })
    expect(routeLine('hello')).toEqual({ kind: 'prompt', text: 'hello' })
    expect(routeLine('!ls -la')).toEqual({ kind: 'shell', command: 'ls -la' })
    expect(routeLine('!')).toEqual({ kind: 'empty' })
    expect(isPaletteOpen('/he')).toBe(true)
    expect(isPaletteOpen('/he\nlo')).toBe(false)
  })
})

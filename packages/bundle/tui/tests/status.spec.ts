import { describe, expect, it } from 'vitest'
import { formatCount, formatHelpLine, formatModelLine, formatOccupancy, formatStatusLine, prettyPath } from '../src/status.ts'
import { ICONS } from '../src/theme.ts'

describe('Crush status helpers', () => {
  it('formats occupancy as a percent when the window is known', () => {
    expect(formatOccupancy(64, 128)).toBe('50%')
    expect(formatOccupancy(1200, undefined)).toBe('1.2k')
    expect(formatOccupancy(undefined, 128)).toBeUndefined()
  })

  it('compacts large counts', () => {
    expect(formatCount(42)).toBe('42')
    expect(formatCount(1200)).toBe('1.2k')
    expect(formatCount(12_000)).toBe('12k')
  })

  it('builds the model line and collapses $HOME', () => {
    expect(formatModelLine({
      provider: 'deepseek', model: 'v4', cwd: '/tmp', busy: false, compact: false,
    })).toBe(`${ICONS.model} deepseek / v4`)
    expect(prettyPath('/home/mark/src', '/home/mark')).toBe('~/src')
    expect(prettyPath('/tmp', '/home/mark')).toBe('/tmp')
  })

  it('prefers a notice over the help line', () => {
    const help = formatHelpLine(false)
    expect(help).toContain('ctrl+p')
    expect(formatStatusLine({
      provider: 'p', model: 'm', cwd: '/', busy: false, compact: true,
      notice: { type: 'error', text: 'failed' },
    }, 40)).toContain('failed')
  })
})

import { describe, expect, it } from 'vitest'
import {
  COOKING_VERBS,
  cookingVerb,
  formatCount,
  formatDoneLine,
  formatHelpLine,
  formatModelLine,
  formatOccupancy,
  formatStatusLine,
  formatTurnDuration,
  formatWorkingLine,
  prettyPath,
  wrapText,
} from '../src/status.ts'
import { ICONS } from '../src/theme.ts'

describe('Claude Code-like status helpers', () => {
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
    })).toBe('deepseek / v4')
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
    expect(formatStatusLine({
      provider: 'p', model: 'm', cwd: '/tmp', busy: false, compact: true,
    }, 80)).toContain('? for shortcuts')
  })

  it('keeps the footer as shortcuts while busy and never invents a bypass line', () => {
    const line = formatStatusLine({
      provider: 'p', model: 'm', cwd: '/tmp', busy: true, compact: true,
    }, 80)
    expect(line).toContain('? for shortcuts')
    expect(line).not.toContain('Working')
    expect(line).not.toContain('bypass')
  })

  it('formats turn durations as seconds, minutes, then hours', () => {
    expect(formatTurnDuration(0)).toBe('0s')
    expect(formatTurnDuration(999)).toBe('0s')
    expect(formatTurnDuration(12_000)).toBe('12s')
    expect(formatTurnDuration(70_000)).toBe('1m 10s')
    expect(formatTurnDuration(3_730_000)).toBe('1h 2m 10s')
  })

  it('formats the live working line and optional real token count', () => {
    expect(formatWorkingLine(1000)).toBe('* Working... (1s)')
    expect(formatWorkingLine(70_000)).toBe('* Working... (1m 10s)')
    expect(formatWorkingLine(1000, 3)).toBe('* Working... (1s · ↓ 3 tokens)')
    expect(formatWorkingLine(1000, 0)).toBe('* Working... (1s)')
    expect(formatWorkingLine(1000)).not.toContain('Clauding')
  })

  it('formats finished clocks with a culinary verb and the six-pointed asterisk', () => {
    expect(formatDoneLine(2000, 'Baked')).toBe(`${ICONS.clock} Baked for 2s`)
    expect(formatDoneLine(3000, 'Sautéed')).toBe(`${ICONS.clock} Sautéed for 3s`)
    expect(formatDoneLine(70_000, 'Crunched')).toBe(`${ICONS.clock} Crunched for 1m 10s`)
    expect(ICONS.clock).toBe('✱')
    expect(cookingVerb(0)).toBe('Baked')
    expect(cookingVerb(1)).toBe('Sautéed')
    expect(COOKING_VERBS).toContain('Simmered')
  })

  it('soft-wraps long lines instead of ellipsizing', () => {
    const wrapped = wrapText('alpha beta gamma delta', 10)
    expect(wrapped).toBe('alpha beta\ngamma\ndelta')
    expect(wrapped).not.toContain('…')
    expect(wrapText('abcdefghijXYZ', 10)).toBe('abcdefghij\nXYZ')
    expect(wrapText('short', 10)).toBe('short')
  })
})

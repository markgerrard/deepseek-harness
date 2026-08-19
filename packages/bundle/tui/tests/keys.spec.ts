import { describe, expect, it } from 'vitest'
import { KEYS, inkKeyName, matches } from '../src/keys.ts'

describe('inkKeyName', () => {
  it('maps Ink 5 shift+tab and page flags, not bare tab', () => {
    expect(inkKeyName('', { tab: true, shift: true })).toBe('shift+tab')
    expect(inkKeyName('', { tab: true })).toBe('tab')
    expect(inkKeyName('', { pageUp: true })).toBe('pageup')
    expect(inkKeyName('', { pageDown: true })).toBe('pagedown')
    expect(inkKeyName('', { pageup: true })).toBe('pageup')
    expect(inkKeyName('', { pagedown: true })).toBe('pagedown')
    expect(inkKeyName('', { upArrow: true, shift: true })).toBe('shift+up')
    expect(inkKeyName('', { downArrow: true, shift: true })).toBe('shift+down')
    expect(inkKeyName('', { upArrow: true })).toBe('up')
    expect(inkKeyName(String.fromCharCode(27) + '[Z', {})).toBe('shift+tab')
    expect(inkKeyName(String.fromCharCode(27) + '[5~', {})).toBe('pageup')
    expect(inkKeyName(String.fromCharCode(27) + '[6~', {})).toBe('pagedown')
  })

  it('maps Ink 5 Backspace reports to backspace, CSI [3~ to delete', () => {
    expect(inkKeyName('', { backspace: true })).toBe('backspace')
    expect(inkKeyName('', { delete: true })).toBe('backspace')
    expect(inkKeyName('\x7f', {})).toBe('backspace')
    expect(inkKeyName('\x7f', { delete: true })).toBe('backspace')
    expect(inkKeyName('\b', {})).toBe('backspace')
    expect(inkKeyName('\b', { backspace: true })).toBe('backspace')
    expect(inkKeyName(String.fromCharCode(27) + '[3~', {})).toBe('delete')
    expect(inkKeyName(String.fromCharCode(27) + '[3~', { delete: true })).toBe('delete')
    expect(inkKeyName(String.fromCharCode(27) + '[3;2~', {})).toBe('delete')
    expect(inkKeyName('h', { ctrl: true })).toBe('ctrl+h')
    expect(inkKeyName('d', { ctrl: true })).toBe('ctrl+d')
    expect(inkKeyName('k', { ctrl: true })).toBe('ctrl+k')
  })

  it('matches page aliases including shift+up / shift+down', () => {
    expect(matches(KEYS.pageUp, 'pageup')).toBe(true)
    expect(matches(KEYS.pageUp, 'shift+up')).toBe(true)
    expect(matches(KEYS.pageUp, 'pageUp')).toBe(true)
    expect(matches(KEYS.pageDown, 'pagedown')).toBe(true)
    expect(matches(KEYS.pageDown, 'shift+down')).toBe(true)
    expect(matches(KEYS.permission, 'shift+tab')).toBe(true)
  })
})

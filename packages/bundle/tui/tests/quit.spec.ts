import { describe, expect, it } from 'vitest'
import { formatQuitButtons, renderQuitDialog } from '../src/chrome.ts'
import { chromeAction, initialState, reduce, resolveQuitKey } from '../src/state.ts'

const seed = {
  width: 140,
  height: 40,
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  cwd: '/tmp',
}

describe('Claude Code-like quit-twice', () => {
  it('opens on the first ctrl+c and exits on the second', () => {
    expect(resolveQuitKey('none', true, 'ctrl+c')).toEqual({ type: 'open' })
    expect(resolveQuitKey('quit', true, 'ctrl+c')).toEqual({ type: 'exit' })
    expect(resolveQuitKey('quit', false, 'ctrl+c')).toEqual({ type: 'exit' })
    expect(resolveQuitKey('models', true, 'ctrl+c')).toEqual({ type: 'open' })
  })

  it('treats y as quit and n / esc as dismiss', () => {
    expect(resolveQuitKey('quit', true, 'y')).toEqual({ type: 'exit' })
    expect(resolveQuitKey('quit', true, 'Y')).toEqual({ type: 'exit' })
    expect(resolveQuitKey('quit', false, 'n')).toEqual({ type: 'dismiss' })
    expect(resolveQuitKey('quit', false, 'N')).toEqual({ type: 'dismiss' })
    expect(resolveQuitKey('quit', false, 'escape')).toEqual({ type: 'dismiss' })
    expect(resolveQuitKey('quit', false, 'esc')).toEqual({ type: 'dismiss' })
  })

  it('toggles Yes/No with left/right/tab and confirms the selected option', () => {
    expect(resolveQuitKey('quit', true, 'left')).toEqual({ type: 'toggle' })
    expect(resolveQuitKey('quit', true, 'right')).toEqual({ type: 'toggle' })
    expect(resolveQuitKey('quit', true, 'tab')).toEqual({ type: 'toggle' })
    expect(resolveQuitKey('quit', true, 'enter')).toEqual({ type: 'dismiss' })
    expect(resolveQuitKey('quit', true, ' ')).toEqual({ type: 'dismiss' })
    expect(resolveQuitKey('quit', false, 'enter')).toEqual({ type: 'exit' })
    expect(resolveQuitKey('quit', false, ' ')).toEqual({ type: 'exit' })
    expect(resolveQuitKey('none', true, 'y')).toEqual({ type: 'ignore' })
  })

  it('defaults to No and paints numbered Yes/No options', () => {
    const opened = reduce(initialState(seed), {
      type: 'open-overlay',
      overlay: { kind: 'quit', selectedNope: true },
    })
    expect(opened.overlay).toEqual({ kind: 'quit', selectedNope: true })
    const toggled = reduce(opened, { type: 'toggle-quit' })
    expect(toggled.overlay).toEqual({ kind: 'quit', selectedNope: false })
    expect(formatQuitButtons(true)).toContain('❯ 2. No')
    expect(formatQuitButtons(true)).not.toContain('❯ 1. Yes')
    expect(formatQuitButtons(false)).toContain('❯ 1. Yes')
    const dialog = renderQuitDialog(60, true)
    expect(dialog).toContain('Do you want to quit?')
    expect(dialog).toContain('Ctrl-C twice')
    expect(dialog).not.toContain('╭')
    expect(dialog).not.toContain('Yep')
    expect(dialog).not.toContain('Nope')
    expect(chromeAction(opened, 'ctrl+c')).toBeUndefined()
  })
})

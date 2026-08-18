import { describe, expect, it } from 'vitest'
import { applyPromptKey, insertAtCursor, promptPaint, splitAtCursor } from '../src/prompt.ts'
import { chromeAction, initialState, reduce } from '../src/state.ts'
import { ICONS } from '../src/theme.ts'

const seed = {
  width: 140,
  height: 40,
  provider: 'deepseek',
  model: 'v4',
  cwd: '/tmp',
}

function typed(input: string, cursor: number) {
  return reduce(initialState(seed), { type: 'set-input', input, cursor })
}

describe('applyPromptKey readline shortcuts', () => {
  it('moves the cursor to the start and end', () => {
    expect(applyPromptKey('hello', 5, 'ctrl+a')).toEqual({ input: 'hello', cursor: 0 })
    expect(applyPromptKey('hello', 0, 'ctrl+e')).toEqual({ input: 'hello', cursor: 5 })
  })

  it('moves the cursor one character with ctrl+b / ctrl+f', () => {
    expect(applyPromptKey('hello', 3, 'ctrl+b')).toEqual({ input: 'hello', cursor: 2 })
    expect(applyPromptKey('hello', 3, 'ctrl+f')).toEqual({ input: 'hello', cursor: 4 })
    expect(applyPromptKey('hello', 0, 'ctrl+b')).toEqual({ input: 'hello', cursor: 0 })
    expect(applyPromptKey('hello', 5, 'ctrl+f')).toEqual({ input: 'hello', cursor: 5 })
    expect(applyPromptKey('hello', 3, 'left')).toEqual({ input: 'hello', cursor: 2 })
    expect(applyPromptKey('hello', 3, 'right')).toEqual({ input: 'hello', cursor: 4 })
  })

  it('kills from the cursor to the end with ctrl+k', () => {
    expect(applyPromptKey('hello', 2, 'ctrl+k')).toEqual({ input: 'he', cursor: 2, kill: 'llo' })
    expect(applyPromptKey('hello', 5, 'ctrl+k')).toEqual({ input: 'hello', cursor: 5 })
  })

  it('kills from the start to the cursor with ctrl+u, or the whole line at the end', () => {
    expect(applyPromptKey('hello', 2, 'ctrl+u')).toEqual({ input: 'llo', cursor: 0, kill: 'he' })
    expect(applyPromptKey('hello', 5, 'ctrl+u')).toEqual({ input: '', cursor: 0, kill: 'hello' })
    expect(applyPromptKey('hello', 0, 'ctrl+u')).toEqual({ input: 'hello', cursor: 0 })
  })

  it('kills the previous word with ctrl+w', () => {
    expect(applyPromptKey('hello world', 11, 'ctrl+w')).toEqual({
      input: 'hello ', cursor: 6, kill: 'world',
    })
    expect(applyPromptKey('hello world', 6, 'ctrl+w')).toEqual({
      input: 'world', cursor: 0, kill: 'hello ',
    })
    expect(applyPromptKey('hello', 0, 'ctrl+w')).toEqual({ input: 'hello', cursor: 0 })
  })

  it('yanks the last kill with ctrl+y', () => {
    expect(applyPromptKey('he', 2, 'ctrl+y', 'llo')).toEqual({ input: 'hello', cursor: 5 })
    expect(applyPromptKey('hello', 2, 'ctrl+y', 'XX')).toEqual({ input: 'heXXllo', cursor: 4 })
    expect(applyPromptKey('hello', 2, 'ctrl+y')).toEqual({ input: 'hello', cursor: 2 })
    expect(applyPromptKey('hello', 2, 'ctrl+y', '')).toEqual({ input: 'hello', cursor: 2 })
  })

  it('deletes the character at the cursor with ctrl+d and does not quit when empty', () => {
    expect(applyPromptKey('hello', 1, 'ctrl+d')).toEqual({ input: 'hllo', cursor: 1 })
    expect(applyPromptKey('hello', 5, 'ctrl+d')).toEqual({ input: 'hello', cursor: 5 })
    expect(applyPromptKey('', 0, 'ctrl+d')).toEqual({ input: '', cursor: 0 })
    expect(applyPromptKey('hello', 1, 'delete')).toEqual({ input: 'hllo', cursor: 1 })
  })

  it('backspaces with ctrl+h', () => {
    expect(applyPromptKey('hello', 2, 'ctrl+h')).toEqual({ input: 'hllo', cursor: 1 })
    expect(applyPromptKey('hello', 0, 'ctrl+h')).toEqual({ input: 'hello', cursor: 0 })
    expect(applyPromptKey('hello', 2, 'backspace')).toEqual({ input: 'hllo', cursor: 1 })
  })

  it('inserts a newline at the cursor with ctrl+j', () => {
    expect(applyPromptKey('hello', 2, 'ctrl+j')).toEqual({ input: 'he\nllo', cursor: 3 })
  })

  it('does not steal reserved chrome keys', () => {
    for (const key of ['ctrl+c', 'ctrl+n', 'ctrl+l', 'ctrl+p', 'ctrl+s', 'ctrl+g']) {
      expect(applyPromptKey('hello', 5, key)).toBeUndefined()
    }
  })
})

describe('insertAtCursor and splitAtCursor', () => {
  it('inserts at the caret, not the end', () => {
    expect(insertAtCursor('hllo', 1, 'e')).toEqual({ input: 'hello', cursor: 2 })
    expect(insertAtCursor('hello', 5, '!')).toEqual({ input: 'hello!', cursor: 6 })
    expect(insertAtCursor('hello', 0, 'x')).toEqual({ input: 'xhello', cursor: 1 })
  })

  it('paints the block cursor at the caret index', () => {
    expect(splitAtCursor('hello', 0)).toEqual({ before: '', after: 'hello' })
    expect(splitAtCursor('hello', 2)).toEqual({ before: 'he', after: 'llo' })
    expect(splitAtCursor('hello', 5)).toEqual({ before: 'hello', after: '' })
    expect(promptPaint('hello', 0)).toEqual({ before: '', cursor: ICONS.cursor, after: 'hello' })
    expect(promptPaint('hello', 2)).toEqual({ before: 'he', cursor: ICONS.cursor, after: 'llo' })
    expect(promptPaint('hello', 5)).toEqual({ before: 'hello', cursor: ICONS.cursor, after: '' })
    expect(ICONS.cursor).toBe('█')
  })
})

describe('chromeAction prompt keys', () => {
  it('wires ctrl shortcuts through set-input when no dialog is open', () => {
    const state = typed('hello', 5)
    expect(chromeAction(state, 'ctrl+a')).toEqual({ type: 'set-input', input: 'hello', cursor: 0 })
    expect(chromeAction(state, 'ctrl+b')).toEqual({ type: 'set-input', input: 'hello', cursor: 4 })
    expect(chromeAction(state, 'ctrl+k')).toEqual({ type: 'set-input', input: 'hello', cursor: 5 })
    const mid = typed('hello', 2)
    expect(chromeAction(mid, 'ctrl+k')).toEqual({ type: 'set-input', input: 'he', cursor: 2, kill: 'llo' })
    const killed = reduce(mid, { type: 'set-input', input: 'he', cursor: 2, kill: 'llo' })
    expect(killed.kill).toBe('llo')
    expect(chromeAction(killed, 'ctrl+y')).toEqual({ type: 'set-input', input: 'hello', cursor: 5 })
    expect(chromeAction(typed('hello world', 11), 'ctrl+w')).toEqual({
      type: 'set-input', input: 'hello ', cursor: 6, kill: 'world',
    })
    expect(chromeAction(typed('hello', 5), 'ctrl+u')).toEqual({
      type: 'set-input', input: '', cursor: 0, kill: 'hello',
    })
    expect(chromeAction(typed('hello', 1), 'ctrl+d')).toEqual({ type: 'set-input', input: 'hllo', cursor: 1 })
    expect(chromeAction(typed('hello', 2), 'ctrl+h')).toEqual({ type: 'set-input', input: 'hllo', cursor: 1 })
    expect(chromeAction(typed('', 0), 'ctrl+d')).toEqual({ type: 'set-input', input: '', cursor: 0 })
  })

  it('leaves reserved chrome keys and dialogs alone', () => {
    const state = typed('hello', 5)
    expect(chromeAction(state, 'ctrl+c')).toBeUndefined()
    expect(chromeAction(state, 'ctrl+g')).toEqual({ type: 'open-overlay', overlay: { kind: 'help' } })
    expect(chromeAction(state, 'ctrl+p')).toEqual({
      type: 'open-overlay', overlay: { kind: 'commands', query: 'hello', selected: 0 },
    })
    expect(chromeAction(state, 'ctrl+l')).toEqual({ type: 'open-overlay', overlay: { kind: 'models', selected: 0 } })
    expect(chromeAction(state, 'ctrl+s')).toEqual({ type: 'open-overlay', overlay: { kind: 'sessions', selected: 0 } })
    expect(chromeAction(state, 'ctrl+n')).toBeUndefined()
    const help = reduce(state, { type: 'open-overlay', overlay: { kind: 'help' } })
    expect(chromeAction(help, 'ctrl+a')).toBeUndefined()
    expect(chromeAction(help, 'ctrl+k')).toBeUndefined()
    const models = reduce(state, { type: 'open-overlay', overlay: { kind: 'models', selected: 0 } })
    expect(chromeAction(models, 'ctrl+e')).toBeUndefined()
  })
})

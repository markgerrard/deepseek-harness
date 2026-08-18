import { describe, expect, it } from 'vitest'
import { chromeAction, initialState, moveSelection, reduce } from '../src/state.ts'

const seed = {
  width: 140,
  height: 40,
  provider: 'deepseek',
  model: 'v4',
  cwd: '/tmp',
}

describe('Crush UI reducer', () => {
  it('opens the command palette when the editor starts with /', () => {
    const opened = reduce(initialState(seed), { type: 'set-input', input: '/he', cursor: 3 })
    expect(opened.overlay).toEqual({ kind: 'commands', query: '/he', selected: 0 })
    const closed = reduce(opened, { type: 'clear-input' })
    expect(closed.overlay).toEqual({ kind: 'none' })
  })

  it('moves overlay selection and clamps at the ends', () => {
    expect(moveSelection(0, 3, -1)).toBe(0)
    expect(moveSelection(2, 3, 1)).toBe(2)
    expect(moveSelection(0, 0, 1)).toBe(0)
    const models = reduce(initialState(seed), {
      type: 'set-models',
      models: [
        { provider: 'p', id: 'a', name: 'A' },
        { provider: 'p', id: 'b', name: 'B' },
      ],
    })
    const opened = reduce(models, { type: 'open-overlay', overlay: { kind: 'models', selected: 0 } })
    const moved = reduce(opened, { type: 'move-overlay', delta: 1 })
    expect(moved.overlay).toEqual({ kind: 'models', selected: 1 })
  })

  it('moves the command palette using paletteLength', () => {
    const seeded = reduce(initialState(seed), { type: 'set-palette-length', paletteLength: 4 })
    const opened = reduce(seeded, { type: 'open-overlay', overlay: { kind: 'commands', query: '/', selected: 0 } })
    expect(reduce(opened, { type: 'move-overlay', delta: 1 }).overlay).toMatchObject({ kind: 'commands', selected: 1 })
  })

  it('maps Crush chrome keys without performing I/O', () => {
    const state = initialState(seed)
    expect(chromeAction(state, 'ctrl+g')).toEqual({ type: 'open-overlay', overlay: { kind: 'help' } })
    expect(chromeAction(state, 'ctrl+p')).toEqual({ type: 'open-overlay', overlay: { kind: 'commands', query: '', selected: 0 } })
    expect(chromeAction(state, 'tab')).toEqual({ type: 'set-focus', focus: 'chat' })
    const help = reduce(state, { type: 'open-overlay', overlay: { kind: 'help' } })
    expect(chromeAction(help, 'escape')).toEqual({ type: 'close-overlay' })
  })
})

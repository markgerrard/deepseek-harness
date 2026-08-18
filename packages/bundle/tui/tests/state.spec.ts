import { describe, expect, it } from 'vitest'
import { chromeAction, initialState, moveSelection, reduce } from '../src/state.ts'

const seed = {
  width: 140,
  height: 40,
  provider: 'deepseek',
  model: 'v4',
  cwd: '/tmp',
}

describe('Claude Code-like UI reducer', () => {
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

  it('maps chrome keys without performing I/O', () => {
    const state = initialState(seed)
    expect(chromeAction(state, 'ctrl+g')).toEqual({ type: 'open-overlay', overlay: { kind: 'help' } })
    expect(chromeAction(state, 'ctrl+p')).toEqual({ type: 'open-overlay', overlay: { kind: 'commands', query: '', selected: 0 } })
    expect(chromeAction(state, 'tab')).toEqual({ type: 'set-focus', focus: 'chat' })
    const help = reduce(state, { type: 'open-overlay', overlay: { kind: 'help' } })
    expect(chromeAction(help, 'escape')).toEqual({ type: 'close-overlay' })
  })

  it('stores a connect key on the overlay and does not force chat back to landing', () => {
    const opened = reduce(initialState(seed), {
      type: 'open-overlay',
      overlay: { kind: 'connect-key', providerId: 'opencode-go', value: '' },
    })
    const typed = reduce(opened, { type: 'set-connect-key', value: 'sk-test' })
    expect(typed.overlay).toEqual({ kind: 'connect-key', providerId: 'opencode-go', value: 'sk-test' })
    const chatting = reduce(typed, { type: 'set-screen', screen: 'chat' })
    const cleared = reduce(chatting, { type: 'set-guidance' })
    expect(cleared.screen).toBe('chat')
    expect(cleared.guidance).toBeUndefined()
    expect(chromeAction(typed, 'up')).toBeUndefined()
  })

  it('tracks turn duration on set-busy and freezes it when the turn ends', () => {
    const t0 = 1_000_000
    const started = reduce(initialState(seed), { type: 'set-busy', busy: true, at: t0 })
    expect(started.busy).toBe(true)
    expect(started.turnStartedAt).toBe(t0)
    expect(started.lastTurnMs).toBeUndefined()
    expect(started.turnClocks).toEqual([])

    const stillBusy = reduce(started, { type: 'set-busy', busy: true, at: t0 + 999 })
    expect(stillBusy.turnStartedAt).toBe(t0)

    const ended = reduce(started, { type: 'set-busy', busy: false, at: t0 + 3000 })
    expect(ended.busy).toBe(false)
    expect(ended.turnStartedAt).toBeUndefined()
    expect(ended.lastTurnMs).toBe(3000)
    expect(ended.turnClocks).toEqual([{ id: 'clock:0:1003000', ms: 3000, verb: 'Baked' }])

    const next = reduce(ended, { type: 'set-busy', busy: true, at: t0 + 5000 })
    expect(next.turnStartedAt).toBe(t0 + 5000)
    expect(next.lastTurnMs).toBeUndefined()
    expect(next.turnClocks).toHaveLength(1)

    const ended2 = reduce(next, { type: 'set-busy', busy: false, at: t0 + 75_000 })
    expect(ended2.lastTurnMs).toBe(70_000)
    expect(ended2.turnClocks.map(clock => clock.verb)).toEqual(['Baked', 'Sautéed'])
    expect(ended2.turnClocks[1]?.ms).toBe(70_000)
  })

  it('snapshots usedTokens as the turn token base when becoming busy', () => {
    const seeded = reduce(initialState(seed), { type: 'set-tokens', usedTokens: 10 })
    const busy = reduce(seeded, { type: 'set-busy', busy: true, at: 1 })
    expect(busy.turnTokenBase).toBe(10)
    const idle = reduce(busy, { type: 'set-busy', busy: false, at: 2000 })
    expect(idle.turnTokenBase).toBeUndefined()
  })
})

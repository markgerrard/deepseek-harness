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
    expect(chromeAction(state, 'shift+tab')).toBeUndefined()
    expect(chromeAction(state, 'ctrl+t')).toBeUndefined()
    expect(chromeAction(state, 'shift+t')).toBeUndefined()
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

  it('stores the visible next-turn queue and next-step steer rows', () => {
    expect(initialState(seed).queued).toEqual([])
    expect(initialState(seed).steering).toEqual([])
    const queued = reduce(initialState(seed), {
      type: 'set-queued',
      queued: [{ id: 'm1', text: 'look at tests' }],
      steering: [{ id: 's1', text: 'stop rewriting' }],
    })
    expect(queued.queued).toEqual([{ id: 'm1', text: 'look at tests' }])
    expect(queued.steering).toEqual([{ id: 's1', text: 'stop rewriting' }])
    expect(reduce(queued, { type: 'set-queued', queued: [] }).steering).toEqual([{ id: 's1', text: 'stop rewriting' }])
    const cleared = reduce(queued, { type: 'set-queued', queued: [], steering: [] })
    expect(cleared.queued).toEqual([])
    expect(cleared.steering).toEqual([])
  })
})

describe('suggested next prompt', () => {
  it('lets Tab accept a ghost when the editor is empty', () => {
    const suggested = reduce(initialState(seed), { type: 'set-suggestion', suggestion: 'Add unit tests next' })
    expect(suggested.suggestion).toBe('Add unit tests next')
    expect(chromeAction(suggested, 'tab')).toEqual({
      type: 'set-input', input: 'Add unit tests next', cursor: 'Add unit tests next'.length,
    })
    const accepted = reduce(suggested, { type: 'set-input', input: 'Add unit tests next', cursor: 20 })
    expect(accepted.input).toBe('Add unit tests next')
    expect(accepted.suggestion).toBeUndefined()
  })

  it('does not insert the ghost when the user types', () => {
    const suggested = reduce(initialState(seed), { type: 'set-suggestion', suggestion: 'Add unit tests next' })
    const typed = reduce(suggested, { type: 'set-input', input: 'h', cursor: 1 })
    expect(typed.input).toBe('h')
    expect(typed.suggestion).toBeUndefined()
  })

  it('keeps existing Tab focus behavior when the editor is not empty', () => {
    const typed = reduce(initialState(seed), { type: 'set-input', input: 'hello', cursor: 5 })
    const withGhost = reduce(typed, { type: 'set-suggestion', suggestion: 'Add unit tests next' })
    expect(chromeAction(withGhost, 'tab')).toEqual({ type: 'set-focus', focus: 'chat' })
  })

  it('clears the ghost on submit, clear, escape, and a new turn', () => {
    const suggested = reduce(initialState(seed), { type: 'set-suggestion', suggestion: 'Add unit tests next' })
    expect(reduce(suggested, { type: 'clear-input' }).suggestion).toBeUndefined()
    expect(chromeAction(suggested, 'escape')).toEqual({ type: 'set-suggestion' })
    expect(reduce(suggested, { type: 'set-suggestion' }).suggestion).toBeUndefined()
    const busy = reduce(suggested, { type: 'set-busy', busy: true, at: 1 })
    expect(busy.suggestion).toBeUndefined()
    expect(busy.busy).toBe(true)
  })
})

describe('visual clear and cost overlay', () => {
  it('folds a local transcript clear back to landing without wiping history', () => {
    const chatting = reduce(initialState(seed), { type: 'set-screen', screen: 'chat' })
    const clocked = reduce(chatting, { type: 'set-busy', busy: true, at: 1 })
    const idle = reduce(clocked, { type: 'set-busy', busy: false, at: 2000 })
    const cleared = reduce(idle, { type: 'clear-transcript', seq: 9 })
    expect(cleared.screen).toBe('landing')
    expect(cleared.clearedSeq).toBe(9)
    expect(cleared.turnClocks).toEqual([])
    expect(cleared.history).toEqual(idle.history)
  })
})

describe('workflow expansion and agents overlay', () => {
  it('toggles workflow expansion separately from tools', () => {
    const idle = initialState(seed)
    const opened = reduce(idle, { type: 'toggle-expand', id: 'workflow:run-1', target: 'workflows' })
    expect(opened.expansion.workflows.has('workflow:run-1')).toBe(true)
    expect(opened.expansion.tools.size).toBe(0)
    const closed = reduce(opened, { type: 'toggle-expand', id: 'workflow:run-1', target: 'workflows' })
    expect(closed.expansion.workflows.has('workflow:run-1')).toBe(false)
  })

  it('moves the agents overlay using listed children', () => {
    const seeded = reduce(initialState(seed), {
      type: 'set-agents',
      agents: [
        { id: 'a', name: 'researcher', mode: 'continuable', status: 'running' },
        { id: 'b', name: 'writer', mode: 'one-shot', status: 'ready' },
      ],
    })
    const opened = reduce(seeded, { type: 'open-overlay', overlay: { kind: 'agents', selected: 0 } })
    expect(reduce(opened, { type: 'move-overlay', delta: 1 }).overlay).toEqual({ kind: 'agents', selected: 1 })
  })
})

describe('shell cards and @path overlay', () => {
  it('appends a local command card and clears it with the transcript', () => {
    const added = reduce(initialState(seed), { type: 'append-local', text: '! ls\nexit 0' })
    expect(added.localCards).toHaveLength(1)
    expect(added.screen).toBe('chat')
    const cleared = reduce(added, { type: 'clear-transcript', seq: 0 })
    expect(cleared.localCards).toEqual([])
  })

  it('accepts an @path completion from the files overlay', () => {
    const listed = reduce(initialState(seed), {
      type: 'set-files',
      files: [{ path: 'src/', dir: true }],
    })
    const typed = reduce(listed, { type: 'set-input', input: 'see @s', cursor: 6 })
    const opened = reduce(typed, { type: 'open-overlay', overlay: { kind: 'files', selected: 0 } })
    const accepted = reduce(opened, { type: 'accept-file' })
    expect(accepted.input).toBe('see @src/')
    expect(accepted.overlay).toEqual({ kind: 'files', selected: 0 })
  })
})

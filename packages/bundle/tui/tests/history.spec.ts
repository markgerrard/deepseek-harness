import { describe, expect, it } from 'vitest'
import {
  filterHistory,
  isOnFirstLine,
  isOnLastLine,
  pushHistory,
  recallHistory,
  reverseSearchHistory,
} from '../src/history.ts'
import { chromeAction, initialState, reduce } from '../src/state.ts'

const seed = {
  width: 140,
  height: 40,
  provider: 'deepseek',
  model: 'v4',
  cwd: '/tmp',
}

describe('prompt history helpers', () => {
  it('detects first and last editor lines', () => {
    expect(isOnFirstLine('', 0)).toBe(true)
    expect(isOnFirstLine('hello', 5)).toBe(true)
    expect(isOnFirstLine('hello\nworld', 5)).toBe(true)
    expect(isOnFirstLine('hello\nworld', 6)).toBe(false)
    expect(isOnLastLine('hello\nworld', 6)).toBe(true)
    expect(isOnLastLine('hello\nworld', 3)).toBe(false)
  })

  it('skips empty and duplicate submitted prompts', () => {
    expect(pushHistory([], '  ')).toEqual([])
    expect(pushHistory([], 'look at tests')).toEqual(['look at tests'])
    expect(pushHistory(['look at tests'], 'look at tests')).toEqual(['look at tests'])
    expect(pushHistory(['look at tests'], 'use the other file')).toEqual([
      'look at tests',
      'use the other file',
    ])
  })

  it('filters newest-first for reverse search', () => {
    expect(filterHistory(['a', 'ab', 'c'], 'a')).toEqual(['ab', 'a'])
    expect(filterHistory(['one', 'two'], '')).toEqual(['two', 'one'])
  })

  it('recalls older then restores the draft', () => {
    const older = recallHistory({ history: ['first', 'second'] }, 'draft', -1)
    expect(older).toMatchObject({ input: 'second', historyIndex: 1, historyDraft: 'draft' })
    const oldest = recallHistory({
      history: ['first', 'second'],
      historyIndex: 1,
      historyDraft: 'draft',
    }, 'second', -1)
    expect(oldest).toMatchObject({ input: 'first', historyIndex: 0 })
    const restored = recallHistory({
      history: ['first', 'second'],
      historyIndex: 1,
      historyDraft: 'draft',
    }, 'second', 1)
    expect(restored).toEqual({ input: 'draft', cursor: 5 })
  })

  it('reverse-searches older matches for the current needle', () => {
    const first = reverseSearchHistory({ history: ['look at tests', 'ship it'] }, 'te')
    expect(first).toMatchObject({ input: 'look at tests', historyIndex: 0, historyQuery: 'te' })
    const again = reverseSearchHistory({
      history: ['look at tests', 'other tests', 'ship it'],
      historyIndex: 1,
      historyDraft: 'te',
      historyQuery: 'te',
    }, 'other tests')
    expect(again).toMatchObject({ input: 'look at tests', historyIndex: 0 })
  })
})

describe('prompt history reducer', () => {
  it('stores submitted prompts and recalls them with Up/Down', () => {
    const stored = reduce(initialState(seed), { type: 'push-history', text: 'look at tests' })
    expect(stored.history).toEqual(['look at tests'])
    const recalled = reduce(stored, { type: 'recall-history', delta: -1 })
    expect(recalled.input).toBe('look at tests')
    expect(recalled.historyIndex).toBe(0)
    const restored = reduce(recalled, { type: 'recall-history', delta: 1 })
    expect(restored.input).toBe('')
    expect(restored.historyIndex).toBeUndefined()
  })

  it('lets Right accept a ghost when the editor is empty', () => {
    const suggested = reduce(initialState(seed), { type: 'set-suggestion', suggestion: 'Add unit tests next' })
    expect(chromeAction(suggested, 'right')).toEqual({
      type: 'set-input', input: 'Add unit tests next', cursor: 'Add unit tests next'.length,
    })
    expect(chromeAction(suggested, 'ctrl+f')).toEqual({
      type: 'set-input', input: 'Add unit tests next', cursor: 'Add unit tests next'.length,
    })
    const typed = reduce(initialState(seed), { type: 'set-input', input: 'h', cursor: 1 })
    const withGhost = reduce(typed, { type: 'set-suggestion', suggestion: 'Add unit tests next' })
    expect(chromeAction(withGhost, 'right')).toEqual({ type: 'set-input', input: 'h', cursor: 1 })
  })
})

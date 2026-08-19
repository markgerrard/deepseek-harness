import { describe, expect, it } from 'vitest'
import { applyAtCompletion, filterFileRows, parseAtToken, splitAtQuery } from '../src/files.ts'

describe('cwd @path tokens', () => {
  it('finds the @token at the caret and ignores earlier words', () => {
    expect(parseAtToken('see @src/app', 12)).toEqual({ start: 4, end: 12, query: 'src/app' })
    expect(parseAtToken('see @src/app please', 12)).toEqual({ start: 4, end: 12, query: 'src/app' })
    expect(parseAtToken('hello', 5)).toBeUndefined()
    expect(parseAtToken('email@x.com', 11)).toBeUndefined()
  })

  it('splits the query and filters listed rows', () => {
    expect(splitAtQuery('src/ap')).toEqual({ dir: 'src/', base: 'ap' })
    const rows = [
      { path: 'src/app.ts', dir: false },
      { path: 'src/api/', dir: true },
      { path: 'readme.md', dir: false },
    ]
    expect(filterFileRows(rows, 'src/ap').map(row => row.path)).toEqual(['src/app.ts', 'src/api/'])
  })

  it('replaces the token with the completed path', () => {
    expect(applyAtCompletion('look @sr', 8, 'src/')).toEqual({ input: 'look @src/', cursor: 10 })
    expect(applyAtCompletion('@a and more', 2, 'app.ts')).toEqual({ input: '@app.ts and more', cursor: 7 })
  })
})

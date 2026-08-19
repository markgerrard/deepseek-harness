import { describe, expect, it } from 'vitest'
import { REWIND_ARM_MS, REWIND_HINT, rewindArmed, rewindReady } from '../src/rewind.ts'

describe('Esc Esc rewind arm', () => {
  it('is live only inside the 2000ms window', () => {
    expect(rewindArmed(undefined, 1000)).toBe(false)
    expect(rewindArmed(1000, 1000)).toBe(true)
    expect(rewindArmed(1000, 3000)).toBe(true)
    expect(rewindArmed(1000, 3001)).toBe(false)
    expect(rewindArmed(1000, 999)).toBe(false)
    expect(REWIND_ARM_MS).toBe(2000)
  })

  it('stays ready 1500ms later and while the esc-again notice is up', () => {
    expect(rewindReady(1000, 2500, undefined)).toBe(true)
    expect(rewindReady(1000, 3001, undefined)).toBe(false)
    expect(rewindReady(1000, 4000, REWIND_HINT)).toBe(true)
    expect(rewindReady(undefined, 4000, REWIND_HINT)).toBe(true)
    expect(rewindReady(undefined, 4000, undefined)).toBe(false)
  })
})

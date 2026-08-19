import { describe, expect, it } from 'vitest'
import { REWIND_ARM_MS, rewindArmed } from '../src/rewind.ts'

describe('Esc Esc rewind arm', () => {
  it('is live only inside the 800ms window', () => {
    expect(rewindArmed(undefined, 1000)).toBe(false)
    expect(rewindArmed(1000, 1000)).toBe(true)
    expect(rewindArmed(1000, 1800)).toBe(true)
    expect(rewindArmed(1000, 1801)).toBe(false)
    expect(rewindArmed(1000, 999)).toBe(false)
    expect(REWIND_ARM_MS).toBe(800)
  })
})

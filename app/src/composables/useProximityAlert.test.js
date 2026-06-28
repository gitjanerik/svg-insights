import { describe, it, expect } from 'vitest'
import { shouldFire } from './useProximityAlert.js'

describe('shouldFire', () => {
  it('er sann når distansen er innenfor radius', () => {
    expect(shouldFire(8, 10)).toBe(true)
    expect(shouldFire(10, 10)).toBe(true)
    expect(shouldFire(0, 10)).toBe(true)
  })

  it('er usann når distansen er over radius', () => {
    expect(shouldFire(11, 10)).toBe(false)
    expect(shouldFire(60, 50)).toBe(false)
  })

  it('er aldri sann uten GPS-fix', () => {
    expect(shouldFire(null, 10)).toBe(false)
    expect(shouldFire(undefined, 10)).toBe(false)
    expect(shouldFire(NaN, 10)).toBe(false)
  })
})

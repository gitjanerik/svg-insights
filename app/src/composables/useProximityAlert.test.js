import { describe, it, expect } from 'vitest'
import { shouldFire } from './useProximityAlert.js'

describe('shouldFire', () => {
  it('fyrer når distansen er innenfor radius', () => {
    expect(shouldFire(8, 10, 0, 1)).toBe(true)
    expect(shouldFire(10, 10, 0, 1)).toBe(true)
  })

  it('fyrer ikke når distansen er over radius', () => {
    expect(shouldFire(11, 10, 0, 1)).toBe(false)
    expect(shouldFire(60, 50, 0, 3)).toBe(false)
  })

  it('respekterer budsjettet — én gang stopper etter første fyring', () => {
    expect(shouldFire(5, 10, 1, 1)).toBe(false)
  })

  it('gjenta fyrer opp til 3 ganger så stopp', () => {
    expect(shouldFire(5, 10, 0, 3)).toBe(true)
    expect(shouldFire(5, 10, 2, 3)).toBe(true)
    expect(shouldFire(5, 10, 3, 3)).toBe(false)
  })

  it('fyrer aldri uten GPS-fix', () => {
    expect(shouldFire(null, 10, 0, 3)).toBe(false)
    expect(shouldFire(NaN, 10, 0, 3)).toBe(false)
  })
})

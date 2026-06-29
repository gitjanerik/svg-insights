import { describe, it, expect } from 'vitest'
import { labelScore } from './mapBuilder.js'

describe('labelScore — klasse-rekkefølge + egenverdi', () => {
  it('topp scorer høyt og øker med høyde', () => {
    const low = labelScore('peak', { ele: 200 })
    const high = labelScore('peak', { ele: 1500 })
    expect(high).toBeGreaterThan(low)
    expect(high).toBeLessThanOrEqual(100)
  })

  it('stor innsjø > liten innsjø', () => {
    const small = labelScore('vann-navn', { areaM2: 2000 })
    const big = labelScore('vann-navn', { areaM2: 5_000_000 })
    expect(big).toBeGreaterThan(small)
  })

  it('elv (304) scorer høyere enn bekk (305)', () => {
    expect(labelScore('vann-navn', { isStream: false }))
      .toBeGreaterThan(labelScore('vann-navn', { isStream: true }))
  })

  it('stedsnavn-rank: major > mid > minor', () => {
    const major = labelScore('stedsnavn', { rank: 'major' })
    const mid = labelScore('stedsnavn', { rank: 'mid' })
    const minor = labelScore('stedsnavn', { rank: 'minor' })
    expect(major).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(minor)
  })

  it('hytte er lavest, topp blant de høyeste', () => {
    expect(labelScore('hytte-navn')).toBeLessThan(labelScore('stedsnavn', { rank: 'minor' }))
    expect(labelScore('peak', { ele: 1000 })).toBeGreaterThan(labelScore('hytte-navn'))
  })

  it('alltid 0–100 heltall', () => {
    for (const s of [labelScore('peak', { ele: 9999 }), labelScore('hytte-navn'), labelScore('vann-navn', { areaM2: 1e9 })]) {
      expect(Number.isInteger(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
    }
  })
})

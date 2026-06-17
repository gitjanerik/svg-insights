import { describe, it, expect } from 'vitest'
import { parsePathSubpaths, polylineToPath, polylineLength } from './pathUtils.js'

describe('parsePathSubpaths', () => {
  it('parser en enkel M/L-streng', () => {
    const subs = parsePathSubpaths('M0,0L100,0L100,100')
    expect(subs).toHaveLength(1)
    expect(subs[0]).toEqual([[0, 0], [100, 0], [100, 100]])
  })

  it('splitter flere subpaths på M', () => {
    const subs = parsePathSubpaths('M0,0L10,0M50,50L60,60L70,50')
    expect(subs).toHaveLength(2)
    expect(subs[0]).toEqual([[0, 0], [10, 0]])
    expect(subs[1]).toEqual([[50, 50], [60, 60], [70, 50]])
  })

  it('tolker ekstra par etter M som implisitt L', () => {
    const subs = parsePathSubpaths('M0,0 100,0 100,100')
    expect(subs[0]).toEqual([[0, 0], [100, 0], [100, 100]])
  })

  it('ignorerer Z og håndterer desimaler/negative tall', () => {
    const subs = parsePathSubpaths('M-1.5,2.25L3,-4Z')
    expect(subs).toHaveLength(1)
    expect(subs[0]).toEqual([[-1.5, 2.25], [3, -4]])
  })

  it('er invers av polylineToPath', () => {
    const pts = [[0, 0], [12.3, 45.6], [78.9, 1.2]]
    const subs = parsePathSubpaths(polylineToPath(pts))
    expect(subs[0]).toEqual(pts)
  })

  it('returnerer tomt array for tom/ugyldig input', () => {
    expect(parsePathSubpaths('')).toEqual([])
    expect(parsePathSubpaths(null)).toEqual([])
    expect(parsePathSubpaths(undefined)).toEqual([])
  })
})

describe('polylineLength (sanity)', () => {
  it('summerer segment-lengder', () => {
    expect(polylineLength([[0, 0], [3, 4]])).toBeCloseTo(5, 6)
    expect(polylineLength([[0, 0], [3, 4], [3, 4]])).toBeCloseTo(5, 6)
  })
})

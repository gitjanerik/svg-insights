import { describe, it, expect } from 'vitest'
import { parsePathSubpaths, polylineToPath, polylineLength, distPointToSegment, isPointNearPolylines } from './pathUtils.js'

describe('distPointToSegment', () => {
  it('måler perpendikulær avstand til segmentet', () => {
    expect(distPointToSegment(0, 5, -10, 0, 10, 0)).toBeCloseTo(5)
  })
  it('klamper til endepunkt når projeksjonen faller utenfor segmentet', () => {
    expect(distPointToSegment(20, 0, -10, 0, 10, 0)).toBeCloseTo(10)
    expect(distPointToSegment(-20, 0, -10, 0, 10, 0)).toBeCloseTo(10)
  })
  it('degenerert segment (a==b) gir avstand til punktet', () => {
    expect(distPointToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5)
  })
})

describe('isPointNearPolylines — sti-nærhets-kvalifisering', () => {
  const sti = [[{ x: 0, y: 0 }, { x: 100, y: 0 }]]
  it('true når punktet er innenfor maxDist av en polylinje', () => {
    expect(isPointNearPolylines({ x: 50, y: 25 }, sti, 30)).toBe(true)
    expect(isPointNearPolylines({ x: 50, y: 30 }, sti, 30)).toBe(true)
  })
  it('false når punktet er lenger unna enn maxDist', () => {
    expect(isPointNearPolylines({ x: 50, y: 31 }, sti, 30)).toBe(false)
    expect(isPointNearPolylines({ x: 50, y: 200 }, sti, 30)).toBe(false)
  })
  it('false uten polylinjer, og hopper over for korte linjer', () => {
    expect(isPointNearPolylines({ x: 0, y: 0 }, [], 30)).toBe(false)
    expect(isPointNearPolylines({ x: 0, y: 0 }, [[{ x: 0, y: 0 }]], 30)).toBe(false)
  })
  it('finner nærmeste blant flere polylinjer (early-out)', () => {
    const lines = [
      [{ x: 0, y: 500 }, { x: 100, y: 500 }],
      [{ x: 0, y: 10 }, { x: 100, y: 10 }],
    ]
    expect(isPointNearPolylines({ x: 50, y: 0 }, lines, 30)).toBe(true)
  })
})

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

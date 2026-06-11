import { describe, it, expect } from 'vitest'
import { CELL_M, bboxOfPoints, unionBbox, cellKeyFor, bboxAttr } from './spatialBucket.js'

describe('bboxOfPoints', () => {
  it('finner AABB for punktliste', () => {
    expect(bboxOfPoints([[10, 20], [5, 40], [30, 15]]))
      .toEqual({ minX: 5, minY: 15, maxX: 30, maxY: 40 })
  })
  it('null for tom/manglende input', () => {
    expect(bboxOfPoints([])).toBeNull()
    expect(bboxOfPoints(null)).toBeNull()
  })
})

describe('unionBbox', () => {
  const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
  const b = { minX: 5, minY: -5, maxX: 20, maxY: 8 }
  it('union dekker begge', () => {
    expect(unionBbox(a, b)).toEqual({ minX: 0, minY: -5, maxX: 20, maxY: 10 })
  })
  it('tåler null på hver side (akkumulator-start)', () => {
    expect(unionBbox(null, a)).toEqual(a)
    expect(unionBbox(a, null)).toEqual(a)
    expect(unionBbox(null, null)).toBeNull()
  })
})

describe('cellKeyFor', () => {
  it('bbox-senter avgjør cellen', () => {
    // senter (512, 512) → celle 0:0; senter (1536, 512) → 1:0
    expect(cellKeyFor({ minX: 0, minY: 0, maxX: 1024, maxY: 1024 })).toBe('0:0')
    expect(cellKeyFor({ minX: 1024, minY: 0, maxX: 2048, maxY: 1024 })).toBe('1:0')
  })
  it('stabil på celle-grensen (floor-semantikk)', () => {
    // senter nøyaktig på grensen CELL_M → havner i celle 1 (floor(1.0))
    expect(cellKeyFor({ minX: CELL_M, minY: CELL_M, maxX: CELL_M, maxY: CELL_M })).toBe('1:1')
    // bittelitt under grensen → celle 0
    expect(cellKeyFor({ minX: CELL_M - 0.2, minY: 0, maxX: CELL_M - 0.2, maxY: 0 })).toBe('0:0')
  })
  it('stor feature (kart-kryssende) får én celle fra senteret sitt', () => {
    expect(cellKeyFor({ minX: 0, minY: 0, maxX: 5000, maxY: 5000 })).toBe('2:2')
  })
  it('negativt rom (utenfor kart-origo) gir negative celler', () => {
    expect(cellKeyFor({ minX: -2000, minY: -100, maxX: -1800, maxY: -50 })).toBe('-2:-1')
  })
})

describe('bboxAttr', () => {
  const fmt = (n) => Number(n.toFixed(1))
  it('formaterer med kallerens fmt (0.1 m som mapBuilder)', () => {
    expect(bboxAttr({ minX: 1.23, minY: 4.56, maxX: 7.89, maxY: 10 }, fmt))
      .toBe(' data-bbox="1.2,4.6,7.9,10"')
  })
  it('tom streng for null/ikke-finite', () => {
    expect(bboxAttr(null, fmt)).toBe('')
    expect(bboxAttr({ minX: NaN, minY: 0, maxX: 1, maxY: 1 }, fmt)).toBe('')
  })
})

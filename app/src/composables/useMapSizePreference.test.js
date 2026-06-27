import { describe, it, expect } from 'vitest'
import { defaultMapDims, equidistanceForWidthKm, DEFAULT_MAP_WIDTH_KM, MAP_SIZE_OPTIONS } from './useMapSizePreference.js'

describe('defaultMapDims — Standard-kartet er et fast 10 km kvadrat', () => {
  it('er 10 km bredt (ikke skjerm-skalert)', () => {
    expect(DEFAULT_MAP_WIDTH_KM).toBe(10)
    const d = defaultMapDims()
    expect(d.halfKm).toBe(5)        // 10 km bredde
    expect(2 * d.halfKm).toBe(10)
  })
  it('er et kvadrat (aspect = 1), uavhengig av skjermformat', () => {
    expect(defaultMapDims().aspect).toBe(1)
  })
})

describe('MAP_SIZE_OPTIONS — kun mindre-enn-Standard valg, ingen store kart', () => {
  it('topper ut på ≤ 10 km (de gamle 12–20 km er fjernet)', () => {
    expect(Math.max(...MAP_SIZE_OPTIONS)).toBeLessThanOrEqual(10)
    expect(MAP_SIZE_OPTIONS).not.toContain(20)
  })
})

describe('equidistanceForWidthKm', () => {
  it('Standard (null) holder 20 m', () => {
    expect(equidistanceForWidthKm(null)).toBe(20)
  })
  it('de mindre valgene (4/6/8 km) holder 20 m', () => {
    for (const km of MAP_SIZE_OPTIONS) expect(equidistanceForWidthKm(km)).toBe(20)
  })
  it('trapper fortsatt opp for større bredder (andre kilder)', () => {
    expect(equidistanceForWidthKm(10)).toBe(25)
    expect(equidistanceForWidthKm(14)).toBe(50)
  })
})

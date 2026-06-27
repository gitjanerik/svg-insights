import { describe, it, expect } from 'vitest'
import { defaultMapDims, equidistanceForWidthKm, DEFAULT_MAP_WIDTH_KM } from './useMapSizePreference.js'

describe('defaultMapDims — Standard-kartet er et fast 4 km kvadrat', () => {
  it('er 4 km bredt (ikke skjerm-skalert)', () => {
    expect(DEFAULT_MAP_WIDTH_KM).toBe(4)
    const d = defaultMapDims()
    expect(d.halfKm).toBe(2)        // 4 km bredde
    expect(2 * d.halfKm).toBe(4)
  })
  it('er et kvadrat (aspect = 1), uavhengig av skjermformat', () => {
    expect(defaultMapDims().aspect).toBe(1)
  })
})

describe('equidistanceForWidthKm', () => {
  it('Standard (null/4 km) holder 20 m', () => {
    expect(equidistanceForWidthKm(null)).toBe(20)
    expect(equidistanceForWidthKm(DEFAULT_MAP_WIDTH_KM)).toBe(20)
  })
  it('trapper opp på store kart', () => {
    expect(equidistanceForWidthKm(10)).toBe(25)
    expect(equidistanceForWidthKm(14)).toBe(50)
  })
})

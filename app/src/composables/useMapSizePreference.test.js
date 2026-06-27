import { describe, it, expect } from 'vitest'
import { defaultMapDims, equidistanceForWidthKm, DEFAULT_MAP_WIDTH_KM, MAP_SIZE_MIN_KM, MAP_SIZE_MAX_KM } from './useMapSizePreference.js'

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

describe('slider-grenser', () => {
  it('1–12 km', () => {
    expect(MAP_SIZE_MIN_KM).toBe(1)
    expect(MAP_SIZE_MAX_KM).toBe(12)
  })
})

describe('equidistanceForWidthKm — fineste tillatte (samme gulv som «Flere valg»)', () => {
  it('Standard (null → 10 km) → 20 m', () => {
    expect(equidistanceForWidthKm(null)).toBe(20)
    expect(equidistanceForWidthKm(DEFAULT_MAP_WIDTH_KM)).toBe(20)
  })
  it('< 4 km → 5 m', () => {
    expect(equidistanceForWidthKm(1)).toBe(5)
    expect(equidistanceForWidthKm(3)).toBe(5)
  })
  it('4–6 km → 10 m', () => {
    expect(equidistanceForWidthKm(4)).toBe(10)
    expect(equidistanceForWidthKm(5)).toBe(10)
  })
  it('≥ 6 km → 20 m (også store kart)', () => {
    expect(equidistanceForWidthKm(6)).toBe(20)
    expect(equidistanceForWidthKm(14)).toBe(20)
    expect(equidistanceForWidthKm(20)).toBe(20)
  })
})

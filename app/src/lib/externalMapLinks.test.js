import { describe, it, expect } from 'vitest'
import {
  gmapsUrl, streetViewUrl, buildVegkartUrl,
  VEGKART_ZOOM_MIN, VEGKART_ZOOM_MAX, VEGKART_DEFAULT_ZOOM,
} from './externalMapLinks.js'
import { wgs84ToUtm33 } from './utm.js'

describe('gmapsUrl / streetViewUrl', () => {
  it('punkt-lenker med 6 desimaler (samme som turkartets ark)', () => {
    expect(gmapsUrl(59.9127, 10.7461)).toBe('https://www.google.com/maps?q=59.912700,10.746100')
    expect(streetViewUrl(59.9127, 10.7461))
      .toBe('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=59.912700,10.746100')
  })
})

describe('wgs84ToUtm33', () => {
  it('sentralmeridianen (15°Ø) gir easting 500000', () => {
    const { e, n } = wgs84ToUtm33(60, 15)
    expect(e).toBeCloseTo(500000, 0)
    // Meridianbue-northing ved 60°N × k0 ≈ 6 651 411 m (kjent verdi).
    expect(n).toBeGreaterThan(6.64e6)
    expect(n).toBeLessThan(6.66e6)
  })
  it('Oslo ligger øst for sone 32-verdiene (sone 33 har lavere easting)', () => {
    const { e, n } = wgs84ToUtm33(59.9127, 10.7461)
    // Oslo i UTM 33: E ≈ 262 000, N ≈ 6 650 000.
    expect(e).toBeGreaterThan(200000)
    expect(e).toBeLessThan(320000)
    expect(n).toBeGreaterThan(6.6e6)
    expect(n).toBeLessThan(6.7e6)
  })
})

describe('buildVegkartUrl', () => {
  it('bygger hash med hele UTM 33-meter og zoom', () => {
    const url = buildVegkartUrl({ lat: 60, lon: 15, zoom: 14 })
    const { e, n } = wgs84ToUtm33(60, 15)
    expect(url).toBe(`https://vegkart.atlas.vegvesen.no/#kartlag:geodata/@${Math.round(e)},${Math.round(n)},14`)
  })
  it('runder zoom til heltall og clamper', () => {
    expect(buildVegkartUrl({ lat: 60, lon: 10, zoom: 12.6 })).toMatch(/,13$/)
    expect(buildVegkartUrl({ lat: 60, lon: 10, zoom: 1 })).toMatch(new RegExp(`,${VEGKART_ZOOM_MIN}$`))
    expect(buildVegkartUrl({ lat: 60, lon: 10, zoom: 99 })).toMatch(new RegExp(`,${VEGKART_ZOOM_MAX}$`))
  })
  it('default-zoom brukes når zoom utelates', () => {
    expect(buildVegkartUrl({ lat: 60, lon: 10 })).toMatch(new RegExp(`,${VEGKART_DEFAULT_ZOOM}$`))
  })
  it('ugyldige punkter → null', () => {
    expect(buildVegkartUrl({ lat: NaN, lon: 10 })).toBe(null)
    expect(buildVegkartUrl({ lat: 60, lon: Infinity })).toBe(null)
    expect(buildVegkartUrl({ lat: 91, lon: 10 })).toBe(null)
  })
})

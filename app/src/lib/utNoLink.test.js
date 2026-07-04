import { describe, it, expect } from 'vitest'
import {
  buildUtNoUrl, utNoZoomForMPerPx,
  UTNO_ZOOM_MIN, UTNO_ZOOM_MAX, UTNO_DEFAULT_ZOOM,
} from './utNoLink.js'

describe('buildUtNoUrl', () => {
  it('bygger hash-URL på formen #zoom/lat/lon med 5 desimaler', () => {
    expect(buildUtNoUrl({ lat: 59.912345678, lon: 10.7512345, zoom: 13 }))
      .toBe('https://ut.no/kart#13/59.91235/10.75123')
  })
  it('runder zoom til heltall og clamper til UT.no sitt spenn', () => {
    expect(buildUtNoUrl({ lat: 60, lon: 10, zoom: 12.6 })).toContain('#13/')
    expect(buildUtNoUrl({ lat: 60, lon: 10, zoom: 1 })).toContain(`#${UTNO_ZOOM_MIN}/`)
    expect(buildUtNoUrl({ lat: 60, lon: 10, zoom: 99 })).toContain(`#${UTNO_ZOOM_MAX}/`)
  })
  it('default-zoom brukes når zoom utelates', () => {
    expect(buildUtNoUrl({ lat: 60, lon: 10 })).toContain(`#${UTNO_DEFAULT_ZOOM}/`)
  })
  it('ugyldige punkter → null', () => {
    expect(buildUtNoUrl({ lat: NaN, lon: 10, zoom: 12 })).toBe(null)
    expect(buildUtNoUrl({ lat: 60, lon: Infinity, zoom: 12 })).toBe(null)
    expect(buildUtNoUrl({ lat: 91, lon: 10, zoom: 12 })).toBe(null)
    expect(buildUtNoUrl({ lat: 60, lon: 181, zoom: 12 })).toBe(null)
  })
})

describe('utNoZoomForMPerPx', () => {
  it('matcher web-Mercator-oppløsningen ved breddegraden', () => {
    // Ved 60°N er m/px ved zoom z: 156543.03392*cos(60°)/2^z ≈ 78271.5/2^z.
    // z14 → ≈ 4.78 m/px.
    expect(utNoZoomForMPerPx(78271.5 / 2 ** 14, 60)).toBe(14)
    expect(utNoZoomForMPerPx(78271.5 / 2 ** 11, 60)).toBe(11)
  })
  it('clamper til UT.no sitt spenn', () => {
    expect(utNoZoomForMPerPx(0.001, 60)).toBe(UTNO_ZOOM_MAX)
    expect(utNoZoomForMPerPx(1e9, 60)).toBe(UTNO_ZOOM_MIN)
  })
  it('ugyldig oppløsning → default', () => {
    expect(utNoZoomForMPerPx(0, 60)).toBe(UTNO_DEFAULT_ZOOM)
    expect(utNoZoomForMPerPx(NaN, 60)).toBe(UTNO_DEFAULT_ZOOM)
    expect(utNoZoomForMPerPx(5, NaN)).toBe(UTNO_DEFAULT_ZOOM)
  })
})

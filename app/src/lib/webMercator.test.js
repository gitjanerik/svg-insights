import { describe, it, expect } from 'vitest'
import {
  TILE_SIZE, lonLatToWorldPx, worldPxToLonLat,
  lonLatToScreenPx, screenPxToLonLat, viewBbox, bboxAreaKm2,
} from './webMercator.js'

const OSLO = { lat: 59.9139, lon: 10.7522 }

describe('webMercator', () => {
  it('Oslo lander i samme tile som tileBackground.js sin egen formel', () => {
    const { x, y } = lonLatToWorldPx(OSLO.lon, OSLO.lat, 10)
    // Referanse beregnet med standard slippy-map-formel (OSM-wiki):
    // x = (lon+180)/360·2^z = 542.58…, y = (1−ln(tan+sec)/π)/2·2^z = 297.87…
    expect(Math.floor(x / TILE_SIZE)).toBe(542)
    expect(Math.floor(y / TILE_SIZE)).toBe(297)
    expect(x / TILE_SIZE).toBeCloseTo(542.58, 1)
    expect(y / TILE_SIZE).toBeCloseTo(297.87, 1)
  })

  it('roundtrip world-px ↔ lonlat er tapsfri (< 1e-9°)', () => {
    for (const [lon, lat] of [[10.75, 59.91], [5.32, 60.39], [25.78, 71.17], [-0.1, 51.5]]) {
      const p = lonLatToWorldPx(lon, lat, 12)
      const back = worldPxToLonLat(p.x, p.y, 12)
      expect(Math.abs(back.lon - lon)).toBeLessThan(1e-9)
      expect(Math.abs(back.lat - lat)).toBeLessThan(1e-9)
    }
  })

  it('nord gir lavere world-y enn sør', () => {
    const tromso = lonLatToWorldPx(18.95, 69.65, 8)
    const oslo = lonLatToWorldPx(OSLO.lon, OSLO.lat, 8)
    expect(tromso.y).toBeLessThan(oslo.y)
  })

  it('view-senteret mapper til skjermsenteret og tilbake', () => {
    const view = { centerLat: OSLO.lat, centerLon: OSLO.lon, zoom: 11, wPx: 400, hPx: 800 }
    const px = lonLatToScreenPx(OSLO.lon, OSLO.lat, view)
    expect(px.x).toBeCloseTo(200, 6)
    expect(px.y).toBeCloseTo(400, 6)
    const back = screenPxToLonLat(200, 400, view)
    expect(back.lon).toBeCloseTo(OSLO.lon, 9)
    expect(back.lat).toBeCloseTo(OSLO.lat, 9)
  })

  it('viewBbox omslutter senteret og padder symmetrisk', () => {
    const view = { centerLat: OSLO.lat, centerLon: OSLO.lon, zoom: 11, wPx: 400, hPx: 800 }
    const b1 = viewBbox(view)
    expect(b1.south).toBeLessThan(OSLO.lat)
    expect(b1.north).toBeGreaterThan(OSLO.lat)
    expect(b1.west).toBeLessThan(OSLO.lon)
    expect(b1.east).toBeGreaterThan(OSLO.lon)
    const b2 = viewBbox(view, 1.5)
    expect(b2.north - b2.south).toBeGreaterThan(b1.north - b1.south)
    expect((b2.east + b2.west) / 2).toBeCloseTo((b1.east + b1.west) / 2, 6)
  })

  it('bboxAreaKm2 gir riktig størrelsesorden (1°×1° ved 60°N ≈ 6200 km²)', () => {
    const a = bboxAreaKm2({ south: 59.5, west: 10, north: 60.5, east: 11 })
    expect(a).toBeGreaterThan(5500)
    expect(a).toBeLessThan(7000)
  })
})

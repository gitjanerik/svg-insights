import { describe, it, expect } from 'vitest'
import { wgs84ToUtm32, utm32ToWgs84, utm32BboxFromWgs84 } from './utm.js'

// v10.1.x: et kart som er kvadratisk i bakke-avstand skal rendres ~kvadratisk i
// UTM-meter-rom. Den gamle SW+NE-diagonal-utledningen undervurderte øst-vest pga.
// meridiankonvergens og ga portrett-kart (verre vekk fra sentralmeridianen).
// utm32BboxFromWgs84 bruker alle fire hjørner og fikser dette.

function bboxFromCenter(lat, lon, halfKm) {
  const dLat = halfKm / 111
  const dLon = halfKm / (111 * Math.cos(lat * Math.PI / 180))
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon }
}

// Gammel 2-hjørners utledning (for å vise at den var skjev).
function twoCorner(bbox) {
  const sw = wgs84ToUtm32(bbox.south, bbox.west)
  const ne = wgs84ToUtm32(bbox.north, bbox.east)
  return {
    widthM: Math.abs(ne.e - sw.e),
    heightM: Math.abs(ne.n - sw.n),
  }
}

describe('utm32BboxFromWgs84 — kvadratisk kart', () => {
  // Spredt i sone 32: nær CM (9°E), langt øst (Tromsø), vest for CM (Bergen).
  const cases = [
    ['Oslo', 59.91, 10.75],
    ['Tromsø', 69.65, 18.95],
    ['Bergen', 60.39, 5.32],
  ]

  for (const [name, lat, lon] of cases) {
    it(`${name}: fire hjørner gir ~kvadratisk (aspect ≈ 1)`, () => {
      const bbox = bboxFromCenter(lat, lon, 1.0)
      const { minE, maxE, minN, maxN } = utm32BboxFromWgs84(bbox)
      const aspect = (maxE - minE) / (maxN - minN)
      expect(aspect).toBeGreaterThan(0.98)
      expect(aspect).toBeLessThan(1.02)
    })
  }

  it('fire hjørner ⊇ to-hjørners diagonal (omslutter hele rektangelet)', () => {
    const bbox = bboxFromCenter(69.65, 18.95, 1.0)
    const four = utm32BboxFromWgs84(bbox)
    const two = twoCorner(bbox)
    // 4-hjørners øst-vest er ALDRI smalere enn diagonalen — den fanger de ekte ytter-hjørnene.
    expect(four.maxE - four.minE).toBeGreaterThanOrEqual(two.widthM - 1e-6)
    // Tromsø var grovt portrett med diagonalen; nå er den kvadratisk.
    expect(two.widthM / two.heightM).toBeLessThan(0.8)
  })
})

// v12.1.52: inversen (utm32ToWgs84) var en ren Snyder-serie som divergerer
// langt fra sentralmeridianen — roundtrip-feilen var ~310 m i Kirkenes og
// ~440 m i Vardø. Det forskjøv Terrarium-samplingen (DEM-kystlinje vs OSM-
// data som naturreservat-grenser) og Overpass-bboksen i Øst-Finnmark. Nå
// itererer inversen mot forward til < 1 mm residual, så roundtrip skal være
// meter-eksakt i HELE bruksområdet (Bergen 5°E → Vardø 31°E).
describe('utm32ToWgs84 — roundtrip-konsistens med forward (v12.1.52)', () => {
  const cases = [
    ['Oslo', 59.91, 10.75],
    ['Bergen', 60.39, 5.32],
    ['Tromsø', 69.65, 18.96],
    ['Alta', 69.97, 23.27],
    ['Kirkenes', 69.73, 30.05],
    ['Vardø', 70.37, 31.11],
  ]
  for (const [name, lat, lon] of cases) {
    it(`${name}: forward → inverse gir samme punkt (< 0.05 m)`, () => {
      const { e, n } = wgs84ToUtm32(lat, lon)
      const back = utm32ToWgs84(e, n)
      const dN = (back.lat - lat) * 111132
      const dE = (back.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180)
      expect(Math.hypot(dE, dN)).toBeLessThan(0.05)
    })
    it(`${name}: inverse → forward gir samme UTM-koordinat (< 0.05 m)`, () => {
      const { e, n } = wgs84ToUtm32(lat, lon)
      // Vilkårlig UTM-punkt i nærheten (celle-hjørner fra DEM-grid o.l.)
      const ll = utm32ToWgs84(e + 137.5, n - 262.25)
      const p2 = wgs84ToUtm32(ll.lat, ll.lon)
      expect(Math.hypot(p2.e - (e + 137.5), p2.n - (n - 262.25))).toBeLessThan(0.05)
    })
  }
})

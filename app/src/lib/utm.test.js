import { describe, it, expect } from 'vitest'
import { wgs84ToUtm32, utm32BboxFromWgs84 } from './utm.js'

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

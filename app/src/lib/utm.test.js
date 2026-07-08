import { describe, it, expect } from 'vitest'
import { wgs84ToUtm32, wgs84ToUtm33, utm32ToWgs84, utm32BboxFromWgs84 } from './utm.js'

// v12.1.64: forward-projeksjonen er 6. ordens Krüger (Karney/etmerc-ekvivalent).
// Fasit generert med proj4 (+proj=utm +zone=32/33 +ellps=GRS80) — sann UTM.
// Snyder-forwarden som ble byttet ut hadde −4,0 m Ø-V-bias i Kirkenes og
// −5,4 m i Vardø: OSM-lag ble tegnet vest for Kartverket-terrenget (DEM/WCS
// ligger i sann UTM32). Kravet < 1 cm gir god margin til flyttall-støy uten
// å slippe gjennom serie-avvik.
describe('wgs84ToUtm32/33 — absolutt nøyaktighet mot proj4-fasit (v12.1.64)', () => {
  const cases = [
    // navn, lat, lon, E32, N32, E33, N33
    ['Oslo', 59.91, 10.75, 597868.381, 6642681.510, 262409.732, 6649017.749],
    ['Bergen', 60.39, 5.32, 297230.220, 6700510.175, -32253.597, 6734074.911],
    ['Trondheim', 63.43, 10.4, 569864.338, 7034263.482, 270580.083, 7041743.103],
    ['Bodø', 67.28, 14.4, 732500.397, 7472710.152, 474140.073, 7462719.171],
    ['Tromsø', 69.65, 18.96, 885075.424, 7758322.052, 653597.495, 7731821.943],
    ['Alta', 69.97, 23.27, 1041153.552, 7826247.479, 815288.897, 7783951.429],
    ['Kirkenes', 69.727, 30.045, 1299782.811, 7875158.263, 1076688.274, 7806963.356],
    ['Vardø', 70.37, 31.11, 1312917.040, 7957147.879, 1097833.050, 7886942.078],
    ['Lindesnes', 57.98, 7.05, 384682.521, 6428147.559, 30483.414, 6454170.969],
  ]
  for (const [name, lat, lon, e32, n32, e33, n33] of cases) {
    it(`${name}: sone 32 innenfor 1 cm av proj4`, () => {
      const p = wgs84ToUtm32(lat, lon)
      expect(Math.hypot(p.e - e32, p.n - n32)).toBeLessThan(0.01)
    })
    it(`${name}: sone 33 innenfor 1 cm av proj4`, () => {
      const p = wgs84ToUtm33(lat, lon)
      expect(Math.hypot(p.e - e33, p.n - n33)).toBeLessThan(0.01)
    })
  }
})

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

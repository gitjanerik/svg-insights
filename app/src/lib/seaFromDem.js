// Sjø-deteksjon fra Kartverket DTM (NHM_DTM_25832).
//
// DTM-en gir bakken-overflate i meter over havet. Kartverket-konvensjonen er
// at havflaten ligger på 0 m og at sjø-piksler returneres med høyde nær null
// (eller nodata utenfor land-dekning). Vi utnytter dette til å avlede en
// pålitelig sjø-maske direkte fra DEM-rasteret som allerede er hentet —
// uten å være avhengig av N50 WFS (CORS-fragilt klient-side) eller
// OSM Oslofjord-relations (kan timeout for store relations).
//
// Strategi:
//   1. Inverter DEM-verdiene så sjø (≈ 0) blir høy og land blir negativ.
//   2. Marching squares (d3-contour) ved threshold = −thresholdM gir ringer
//      som omslutter områder under havnivå-toleransen.
//   3. NoData-piksler maskes som dypt-negativ → ute av sjø-polygonet.
//
// Returnerer polygoner i DEM-relative meters (samme koordinatrom som
// `buildContours`-output), klare til å rendres direkte i SVG.

import { contours as d3Contours } from 'd3-contour'
import { simplifyDP } from './pathUtils.js'

/**
 * @param {{ data: Float32Array|Array<number>, cols: number, rows: number,
 *           transform: { pixelWidth: number, pixelHeight: number,
 *                       originX: number, originY: number },
 *           noData: number }} dem
 * @param {object} [opts]
 * @param {number} [opts.thresholdM=0.5]  Høyde-toleranse for sjø-deteksjon
 * @param {number} [opts.minAreaM2=2000]  Minimum sjø-polygon areal
 * @param {number} [opts.simplifyM=2]     DP-forenkling toleranse
 * @returns {{ polygons: Array<Array<Array<[number, number]>>> }}
 *          Hver polygon = array av ringer i DEM-relative meters.
 *          Første ring = outer, øvrige = øy-hull.
 */
export function buildSeaFromDem(dem, opts = {}) {
  const { thresholdM = 0.5, minAreaM2 = 2000, simplifyM = 2 } = opts
  const { data, cols, rows, transform, noData } = dem

  let hasSea = false
  const inverted = new Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v === noData || !Number.isFinite(v)) {
      inverted[i] = -1e6
      continue
    }
    inverted[i] = -v
    if (v <= thresholdM) hasSea = true
  }

  if (!hasSea) return { polygons: [] }

  const levels = d3Contours()
    .size([cols, rows])
    .thresholds([-thresholdM])(inverted)

  if (!levels.length) return { polygons: [] }

  const px = transform.pixelWidth
  const py = transform.pixelHeight
  const polygons = []

  for (const poly of levels[0].coordinates) {
    const rings = []
    for (let r = 0; r < poly.length; r++) {
      let ring = poly[r].map(([col, row]) => [col * px, row * py])
      if (simplifyM > 0 && ring.length > 4) ring = simplifyDP(ring, simplifyM)
      if (ring.length < 4) continue
      if (Math.abs(signedArea(ring)) < minAreaM2) continue
      rings.push(ring)
    }
    if (rings.length > 0) polygons.push(rings)
  }

  return { polygons }
}

function signedArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  }
  return a / 2
}

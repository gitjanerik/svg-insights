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
 * @param {boolean} [opts.requireBoundaryTouch=true]
 *   Hvis true: bare polygoner som berører bbox-kanten beholdes. Sjø er per
 *   definisjon åpent vann og rører alltid bbox-kanten i en kyst-bbox.
 *   Innsjøer/tjern som ligger lavt over havet (slik at DTM-verdien er nær
 *   0) ville ellers feilaktig bli klassifisert som sjø.
 * @returns {{ polygons: Array<Array<Array<[number, number]>>> }}
 *          Hver polygon = array av ringer i DEM-relative meters.
 *          Første ring = outer, øvrige = øy-hull.
 */
export function buildSeaFromDem(dem, opts = {}) {
  const {
    thresholdM = 0.5,
    minAreaM2 = 2000,
    simplifyM = 2,
    requireBoundaryTouch = true,
  } = opts
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
  const maxX = cols * px
  const maxY = rows * py
  // Toleranse: 1 piksel pluss litt slack siden d3-contour kan returnere
  // koord på 0.5-piksel-grid.
  const edgeTol = Math.max(px, py) * 1.5
  const touchesEdge = (ring) => {
    for (const [x, y] of ring) {
      if (x <= edgeTol || y <= edgeTol || x >= maxX - edgeTol || y >= maxY - edgeTol) {
        return true
      }
    }
    return false
  }

  const polygons = []

  for (const poly of levels[0].coordinates) {
    const rawRings = poly.map(ring =>
      ring.map(([col, row]) => [col * px, row * py])
    )
    // Outer ring = first; må berøre bbox-kanten for å være ekte sjø
    if (requireBoundaryTouch && rawRings.length > 0 && !touchesEdge(rawRings[0])) {
      continue
    }
    const rings = []
    for (let r = 0; r < rawRings.length; r++) {
      let ring = rawRings[r]
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

/**
 * Detekterer innsjøer/tjern fra DEM via plateau-deteksjon. Innsjø-flater
 * er karakteristisk FLATE (lokal varians ≈ 0) og DEPRESJONER (omkring-
 * liggende terreng er høyere). Dette fanger tjern på øyer og fastlandet
 * der OSM/N50 ikke har data — typetilfellet er Nesøyatjern på Nesøya:
 * OSM/N50 mangler polygonen, så uten DEM-deteksjon blir tjernet rendret
 * som land-kremgul.
 *
 * Algoritme:
 *   1. Beregn lokal variance i K×K vindu per piksel.
 *   2. Marker piksler som "flat" hvis variance < 0.5 m² OG DTM > 0.5 m
 *      (utelukker sjø).
 *   3. Marching squares ved 0.5-threshold på den binære flat-grid.
 *   4. For hver outer ring: krev ikke-kant + areal-bånd + depresjons-
 *      sjekk (omkring-liggende DTM ≥ 1 m høyere enn innsjø-flate).
 *
 * @param {object} dem
 * @param {object} [opts]
 * @param {number} [opts.minAreaM2=500]
 * @param {number} [opts.maxAreaM2=5_000_000]
 * @param {number} [opts.varianceThresholdM2=0.5]
 * @param {number} [opts.minElevM=0.5]
 *   Innsjøer under denne høyden ignoreres (overlater til buildSeaFromDem).
 * @param {number} [opts.windowSize=5]
 * @param {number} [opts.depressionMinM=1.0]
 *   Minimum diff mellom omkring-liggende terreng og innsjø-flate. Filtrerer
 *   ut flate plateauer (parkeringsplasser, jorder).
 * @param {number} [opts.simplifyM=2]
 */
export function buildLakesFromDem(dem, opts = {}) {
  const {
    minAreaM2 = 500,
    maxAreaM2 = 5_000_000,
    varianceThresholdM2 = 0.5,
    minElevM = 0.5,
    windowSize = 5,
    depressionMinM = 1.0,
    simplifyM = 2,
  } = opts
  const { data, cols, rows, transform, noData } = dem
  const px = transform.pixelWidth
  const py = transform.pixelHeight
  const halfW = Math.floor(windowSize / 2)

  // 1. Variance-grid + flat-maske
  const flatMask = new Float32Array(data.length)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x
      const center = data[idx]
      if (center === noData || !Number.isFinite(center) || center < minElevM) continue
      let sum = 0, sum2 = 0, n = 0
      for (let dy = -halfW; dy <= halfW; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= rows) continue
        for (let dx = -halfW; dx <= halfW; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= cols) continue
          const v = data[ny * cols + nx]
          if (v === noData) continue
          sum += v; sum2 += v * v; n++
        }
      }
      if (n < 4) continue
      const mean = sum / n
      const variance = Math.max(0, sum2 / n - mean * mean)
      if (variance < varianceThresholdM2) flatMask[idx] = 1
    }
  }

  // 2. Marching squares
  const levels = d3Contours()
    .size([cols, rows])
    .thresholds([0.5])(Array.from(flatMask))
  if (!levels.length) return { polygons: [] }

  const maxX = cols * px
  const maxY = rows * py
  const edgeTol = Math.max(px, py) * 1.5
  const polygons = []

  for (const poly of levels[0].coordinates) {
    const rawRings = poly.map(ring =>
      ring.map(([col, row]) => [col * px, row * py])
    )
    if (!rawRings.length) continue
    const outer = rawRings[0]
    if (outer.some(([x, y]) =>
      x <= edgeTol || y <= edgeTol || x >= maxX - edgeTol || y >= maxY - edgeTol
    )) continue
    const area = Math.abs(signedArea(outer))
    if (area < minAreaM2 || area > maxAreaM2) continue
    if (!isDepression(dem, outer, rawRings.slice(1), depressionMinM)) continue
    const rings = []
    for (let r = 0; r < rawRings.length; r++) {
      let ring = rawRings[r]
      if (simplifyM > 0 && ring.length > 4) ring = simplifyDP(ring, simplifyM)
      if (ring.length >= 4) rings.push(ring)
    }
    if (rings.length) polygons.push(rings)
  }
  return { polygons }
}

function isDepression(dem, outerRing, holes, depressionMinM) {
  // Sample DTM inni ringen og i en buffer LANGT utenfor (4-5 piksler) så
  // vi rekker forbi flate-mask-grensen og treffer ekte omkring-terreng.
  // For hver kant-punkt brukes retning-mot-center for å bestemme "utover"
  // (motsatt retning = innover) så vi ikke ved et uhell sampler inni.
  const { data, cols, rows, transform, noData } = dem
  const px = transform.pixelWidth
  const py = transform.pixelHeight
  const sampleAt = (x, y) => {
    const col = Math.round(x / px)
    const row = Math.round(y / py)
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null
    const v = data[row * cols + col]
    if (v === noData || !Number.isFinite(v)) return null
    return v
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of outerRing) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  const insideValues = []
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const v = sampleAt(cx + dx * px, cy + dy * py)
      if (v != null) insideValues.push(v)
    }
  }
  if (insideValues.length < 5) return false
  insideValues.sort((a, b) => a - b)
  const insideMed = insideValues[Math.floor(insideValues.length / 2)]

  const outsideValues = []
  // Buffer 5 piksler: rekker utenfor 5×5-variance-vindu så vi unngår
  // selv-overlapp inn i innsjøen via false-flat-mask-buffer.
  const bufferM = Math.max(px, py) * 5
  for (let i = 0; i < outerRing.length; i++) {
    const [x, y] = outerRing[i]
    // Velg retning utover via dot-product mot center-vektor.
    const toCenterX = cx - x, toCenterY = cy - y
    // Outward = motsatt av to-center
    const outLen = Math.hypot(toCenterX, toCenterY) || 1
    const outX = -toCenterX / outLen
    const outY = -toCenterY / outLen
    const v = sampleAt(x + outX * bufferM, y + outY * bufferM)
    if (v != null) outsideValues.push(v)
  }
  if (outsideValues.length < 4) return false
  outsideValues.sort((a, b) => a - b)
  const outsideMed = outsideValues[Math.floor(outsideValues.length / 2)]

  return outsideMed - insideMed >= depressionMinM
}

/**
 * Generer grunne-sjø-bånd basert på avstand fra kystlinjen. Bruker en
 * chamfer 3-4 distance-transform på DEM-griden: hver sjø-piksel får
 * tildelt sin avstand til nærmeste land-piksel. Marching squares ved
 * spesifikke avstand-thresholds gir polygoner per dybde-bånd.
 *
 * Returnerer band-objekter sortert fra GRUNNEST (nærmest land) til
 * DYPEST (lengst fra land). Bånd rendret i denne rekkefølgen lag-på-lag
 * gir gradient-effekten (grunnest overstyrer ved kysten).
 *
 * @param {object} dem
 * @param {object} [opts]
 * @param {number} [opts.thresholdM=0.5]  Samme som buildSeaFromDem
 * @param {number[]} [opts.bandDistancesM=[50, 200]]
 *   Avstand-thresholds i meter. Default gir 3 bånd: 0-50, 50-200, 200+.
 *   Lengde N gir N+1 bånd inkludert basis-sjø.
 * @param {number} [opts.simplifyM=2]
 * @returns {{ bands: Array<{ maxDistanceM: number|null,
 *                            polygons: Array<Array<Array<[number, number]>>> }>
 *          }}
 *   `maxDistanceM === null` markerer det dypeste båndet (alle sjø-piksler).
 */
export function buildSeaShallowBands(dem, opts = {}) {
  const {
    thresholdM = 0.5,
    bandDistancesM = [50, 200],
    simplifyM = 2,
  } = opts
  const { data, cols, rows, transform, noData } = dem
  const px = transform.pixelWidth
  const py = transform.pixelHeight

  // 1. Bygg sjø-mask: 1 = sjø, 0 = land/nodata
  const sea = new Uint8Array(data.length)
  let hasSea = false
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v === noData || !Number.isFinite(v) || v > thresholdM) continue
    sea[i] = 1
    hasSea = true
  }
  if (!hasSea) return { bands: [] }

  // 2. Chamfer 3-4 distance transform.
  // dist[i] = chamfer-units til nærmeste land-piksel. Tre chamfer-units per
  // ortho-piksel; del med 3 og gang med pixel-meter for ekte distanse.
  const INF = 1e9
  const dist = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) dist[i] = sea[i] ? INF : 0

  // Forward pass
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (dist[i] === 0) continue
      let m = dist[i]
      if (x > 0)              m = Math.min(m, dist[i - 1] + 3)
      if (y > 0)              m = Math.min(m, dist[i - cols] + 3)
      if (x > 0 && y > 0)     m = Math.min(m, dist[i - cols - 1] + 4)
      if (x < cols - 1 && y > 0) m = Math.min(m, dist[i - cols + 1] + 4)
      dist[i] = m
    }
  }
  // Backward pass
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x
      if (dist[i] === 0) continue
      let m = dist[i]
      if (x < cols - 1) m = Math.min(m, dist[i + 1] + 3)
      if (y < rows - 1) m = Math.min(m, dist[i + cols] + 3)
      if (x < cols - 1 && y < rows - 1) m = Math.min(m, dist[i + cols + 1] + 4)
      if (x > 0 && y < rows - 1)        m = Math.min(m, dist[i + cols - 1] + 4)
      dist[i] = m
    }
  }

  // 3. Konverter chamfer-units → meter (gjennomsnitt av pixel-bredde og høyde)
  const pixSize = (Math.abs(px) + Math.abs(py)) / 2
  const distM = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    // Land = 0, sjø = chamfer/3 * pixSize. For land setter vi en stor verdi
    // så d3-contour ikke ser det som "inni" sjø-omslutningen — vi ønsker
    // grunn-bånd som ringer rundt land, ikke at land selv er inkludert.
    distM[i] = sea[i] ? (dist[i] / 3) * pixSize : -1e6
  }

  // 4. For hvert bånd-threshold: generer ringer for området med distM <= T.
  // d3-contour returnerer polygoner med value ≥ threshold, så vi inverterer:
  // negVal = -distM, threshold = -bandThreshold → polygoner der distM ≤ bandThreshold.
  const negDist = Array.from(distM, v => v <= -1e5 ? -1e9 : -v)

  const bands = []
  for (const bandT of bandDistancesM) {
    const levels = d3Contours()
      .size([cols, rows])
      .thresholds([-bandT])(negDist)
    const polygons = []
    if (levels.length) {
      for (const poly of levels[0].coordinates) {
        const rings = []
        for (const ring of poly) {
          let projected = ring.map(([col, row]) => [col * px, row * py])
          if (simplifyM > 0 && projected.length > 4) projected = simplifyDP(projected, simplifyM)
          if (projected.length < 4) continue
          rings.push(projected)
        }
        if (rings.length) polygons.push(rings)
      }
    }
    bands.push({ maxDistanceM: bandT, polygons })
  }

  return { bands }
}

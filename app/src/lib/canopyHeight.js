// Canopy Height Model (CHM) — vegetasjonshøyde fra overflate minus terreng.
//
//   CHM = DOM (digital overflate-modell) − DTM (digital terreng-modell)
//
// Hver pixel viser hvor høy vegetasjonen / bygningen er over bakken.
// Brukes til å klassifisere skog til ISOM 405-408 grønnskala uten å
// måtte parse LAZ-punkter direkte.
//
// Kartverket har ferdig-deriverte DOM-tjenester (NHM_DOM_25832 osv)
// som er basert på samme LiDAR-kampanje som DTM. Vi henter via WCS i
// CI med samme strategi som DTM-fetcher.

import { syntheticDEM } from './dem.js'
import { fetchWCSDtm } from './demFetcher.js'

const WCS_DOM_ENDPOINTS = [
  // UTM 32 native — passer for sør-Norge
  {
    url: 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dom-nhm-25832',
    coverage: 'NHM_DOM_25832',
    bboxCrs: 'EPSG:25832',
    name: 'NHM_DOM_25832 (UTM 32 native)',
  },
  // UTM 33 med 32-reprojeksjon
  {
    url: 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dom-nhm-25833',
    coverage: 'NHM_DOM_25833',
    bboxCrs: 'EPSG:25832',
    responseCrs: 'EPSG:25832',
    name: 'NHM_DOM_25833 (UTM 33 reprojisert)',
  },
  // DOM 10m alternativ
  {
    url: 'https://wms.geonorge.no/skwms1/wcs.hoyde-dom10_33',
    coverage: 'hoyde_dom10_33',
    bboxCrs: 'EPSG:25832',
    responseCrs: 'EPSG:25832',
    name: 'hoyde_dom10_33 (UTM 33 DOM 10m)',
  },
]

/**
 * Hent DOM (Digital Overflate-Modell) fra Kartverket WCS.
 * Returnerer null hvis ingen endpoints lykkes.
 *
 * @returns {Promise<DEM & { source: string } | null>}
 */
export async function fetchDOM(utmBbox, resolutionM = 10, opts = {}) {
  for (const ep of WCS_DOM_ENDPOINTS) {
    try {
      console.log(`[DOM] Forsøker ${ep.name} ...`)
      const dom = await fetchWCSDtm(utmBbox, resolutionM, ep, opts)
      console.log(`[DOM] ✓ Hentet ${dom.cols}×${dom.rows} celler @ ${dom.resolution.toFixed(1)}m fra ${ep.name}`)
      return { ...dom, source: ep.name }
    } catch (e) {
      console.warn(`[DOM] ✗ ${ep.name} feilet: ${e.message}`)
    }
  }
  console.warn('[DOM] Alle WCS-endpoints feilet — ingen vegetasjons-klassifisering')
  return null
}

/**
 * Beregn CHM = DOM − DTM. Krever at begge har samme dimensjoner og
 * transform.
 *
 * @param {DEM} dtm
 * @param {DEM} dom
 * @returns {DEM} med CHM-verdier (vegetasjons-/bygnings-høyde i m)
 */
export function computeCHM(dtm, dom) {
  if (dtm.cols !== dom.cols || dtm.rows !== dom.rows) {
    throw new Error(`DTM/DOM mismatch: ${dtm.cols}×${dtm.rows} vs ${dom.cols}×${dom.rows}`)
  }
  const chm = new Float32Array(dtm.data.length)
  for (let i = 0; i < dtm.data.length; i++) {
    const t = dtm.data[i]
    const d = dom.data[i]
    if (t === dtm.noData || d === dom.noData) {
      chm[i] = -9999
      continue
    }
    chm[i] = Math.max(0, d - t)
  }
  return {
    data: chm,
    cols: dtm.cols,
    rows: dtm.rows,
    transform: dtm.transform,
    noData: -9999,
    resolution: dtm.resolution,
  }
}

/**
 * Sample CHM-verdier innenfor et polygon. Returnerer statistikk over
 * vegetasjonshøyden.
 *
 * @param {DEM} chm
 * @param {Array<[number, number]>} ringWorld   Polygon-ring i UTM-koord
 *        (samme system som chm.transform.originX/Y)
 * @returns {{ count: number, p10: number, p50: number, p90: number, mean: number, std: number }}
 */
export function sampleCHMInPolygon(chm, ringWorld) {
  const { cols, rows, transform } = chm
  // Bbox i grid-koordinater
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of ringWorld) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const minCol = Math.max(0, Math.floor((minX - transform.originX) / transform.pixelWidth))
  const maxCol = Math.min(cols - 1, Math.ceil((maxX - transform.originX) / transform.pixelWidth))
  const minRow = Math.max(0, Math.floor((minY - transform.originY) / transform.pixelHeight))
  const maxRow = Math.min(rows - 1, Math.ceil((maxY - transform.originY) / transform.pixelHeight))

  const samples = []
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const wx = transform.originX + (c + 0.5) * transform.pixelWidth
      const wy = transform.originY + (r + 0.5) * transform.pixelHeight
      if (!pointInRing([wx, wy], ringWorld)) continue
      const v = chm.data[r * cols + c]
      if (v === chm.noData) continue
      samples.push(v)
    }
  }
  if (samples.length === 0) {
    return { count: 0, p10: 0, p50: 0, p90: 0, mean: 0, std: 0 }
  }
  samples.sort((a, b) => a - b)
  const n = samples.length
  const mean = samples.reduce((s, v) => s + v, 0) / n
  let sq = 0
  for (const v of samples) sq += (v - mean) * (v - mean)
  const std = Math.sqrt(sq / n)
  return {
    count: n,
    p10: samples[Math.floor(n * 0.1)],
    p50: samples[Math.floor(n * 0.5)],
    p90: samples[Math.floor(n * 0.9)],
    mean, std,
  }
}

function pointInRing(p, ring) {
  let inside = false
  const [px, py] = p
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = ((yi > py) !== (yj > py))
      && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Klassifiser et skog-polygon til ISOM-kode basert på CHM-statistikk.
 * Forenklet ISOM 2017-2 sportskart-mapping:
 *
 *   Ingen vegetasjon (CHM < 1m):                    401 (åpen mark)
 *   Glissen vegetasjon eller åpen skog (p90 < 5m):  401
 *   Normal skog (p50 5-12m, p90 < 18m):             406 (normal/lett løp)
 *   Tett skog (p50 8-15m, høy std, p90 > 15m):      407 (sakte løp)
 *   Svært tett (lav p50 men høy tetthet):           408 (kjempe-vanskelig)
 *
 * @param {object} stats  fra sampleCHMInPolygon
 * @param {string} osmCode  default ISOM-kode (f.eks. '406' for skog)
 * @returns {string}  ny ISOM-kode
 */
export function classifyVegetationFromCHM(stats, osmCode = '406') {
  if (stats.count < 3) return osmCode
  const { p50, p90, std } = stats

  if (p90 < 1.5) return '401'                  // egentlig åpen mark
  if (p90 < 5)   return '405'                  // åpen / glissen skog (lett løp)
  if (p50 > 8 && p90 > 18 && std > 4) return '408'   // tett blandingsskog
  if (p50 > 6 && p90 > 12 && std > 3) return '407'   // sakte løp
  if (p50 > 4 && p90 > 8) return '406'         // normal skog
  return osmCode                               // fallback
}

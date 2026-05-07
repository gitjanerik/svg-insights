// DEM-data-henting. Strategi:
//  1. Forsøk Kartverket WCS i sekvens (vi prøver flere endpoints fordi
//     coverage-navn har endret seg over tid og er forskjellig pr UTM-sone).
//  2. Fall tilbake til syntetisk DEM kalibrert for kjente områder.
//
// Aktuelle Kartverket-WCS-coverages (basert på Geonorge metadata):
//   wcs.hoyde-dtm-nhm-25832  COVERAGE=NHM_DTM_25832  (UTM 32 — sør-Norge)
//   wcs.hoyde-dtm-nhm-25833  COVERAGE=NHM_DTM_25833  (UTM 33 — hele Norge)
//   wms.hoyde-dom10_33       COVERAGE=hoyde_dom10_33 (alternativ DOM 10m UTM 33)
// WCS-server støtter i prinsippet reprojeksjon mellom 25832 og 25833 via
// RESPONSE_CRS-parameteren, så vi kan spørre 33-tjenesten med 32-bbox.

import { syntheticDEM } from './dem.js'

// Endpoints prøves i rekkefølge. Best (1m) først, fallback til 10m.
// Hvis 1m-tjenestene har andre coverage-navn enn antatt, faller vi
// pent tilbake til 10m som vi allerede vet fungerer.
const WCS_ENDPOINTS = [
  // ── DTM 1m UTM 32 native ──────────────────────────────────────────────
  {
    url: 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-1-utm32',
    coverage: 'hoyde_dtm_1_utm32',
    bboxCrs: 'EPSG:25832',
    name: 'DTM 1m UTM32 (variant a)',
  },
  {
    url: 'https://wcs.geonorge.no/skwms1/wcs.hoeyde-dtm-1-utm32',
    coverage: 'hoeyde_dtm_1_utm32',
    bboxCrs: 'EPSG:25832',
    name: 'DTM 1m UTM32 (variant b)',
  },
  {
    url: 'https://wcs.geonorge.no/skwms1/wcs.dtm1-utm32',
    coverage: 'dtm1_utm32',
    bboxCrs: 'EPSG:25832',
    name: 'DTM 1m UTM32 (variant c)',
  },
  // ── DTM 10m UTM 32 native (verifisert virker) ────────────────────────
  {
    url: 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25832',
    coverage: 'NHM_DTM_25832',
    bboxCrs: 'EPSG:25832',
    name: 'NHM_DTM_25832 (UTM 32 native)',
  },
  // ── UTM 33 med 32-reprojeksjon (fallback) ────────────────────────────
  {
    url: 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833',
    coverage: 'NHM_DTM_25833',
    bboxCrs: 'EPSG:25832',
    responseCrs: 'EPSG:25832',
    name: 'NHM_DTM_25833 (UTM 33 reprojisert)',
  },
  // ── DOM 10 (overflate-modell, siste utvei) ───────────────────────────
  {
    url: 'https://wms.geonorge.no/skwms1/wcs.hoyde-dom10_33',
    coverage: 'hoyde_dom10_33',
    bboxCrs: 'EPSG:25832',
    responseCrs: 'EPSG:25832',
    name: 'hoyde_dom10_33 (UTM 33 DOM 10m)',
  },
]

const KNOWN_AREAS = {
  vardasen: {
    description: 'Vardåsen i Asker (1 topp 349 m)',
    centerLat: 59.813746, centerLon: 10.414616,
    baseElevM: 50,
    peaks: [
      { name: 'Vardåsen', xRel: 0.50, yRel: 0.50, h: 280, sigmaM: 800 },
      { name: 'Bondivannet', xRel: 0.30, yRel: 0.65, h: -40, sigmaM: 600 },
    ],
  },
}

/**
 * Hent DEM. Forsøker ekte WCS i sekvens, fallback til syntetisk.
 * @returns {Promise<DEM & { source: string }>}
 */
export async function fetchDEM(bbox, utmBbox, options = {}) {
  const { resolutionM = 10, knownArea, useReal = true, signal } = options

  if (useReal) {
    for (const ep of WCS_ENDPOINTS) {
      try {
        console.log(`[DEM] Forsøker ${ep.name} ...`)
        const dem = await fetchWCSDtm(utmBbox, resolutionM, ep, { signal })
        console.log(`[DEM] ✓ Hentet ${dem.cols}×${dem.rows} celler @ ${dem.resolution.toFixed(1)}m fra ${ep.name}`)
        return { ...dem, source: ep.name }
      } catch (e) {
        console.warn(`[DEM] ✗ ${ep.name} feilet: ${e.message}`)
      }
    }
    console.warn('[DEM] Alle WCS-endpoints feilet — fallback til syntetisk')
  }

  const dem = buildSyntheticDEM(utmBbox, resolutionM, knownArea)
  return { ...dem, source: `synthetic (${knownArea ?? 'generic'})` }
}

function buildSyntheticDEM(utmBbox, resolutionM, knownArea) {
  const widthM = utmBbox.maxE - utmBbox.minE
  const heightM = utmBbox.maxN - utmBbox.minN
  const transform = {
    originX: 0, originY: 0,
    pixelWidth: resolutionM, pixelHeight: resolutionM,
  }
  if (knownArea && KNOWN_AREAS[knownArea]) {
    const area = KNOWN_AREAS[knownArea]
    const peaks = area.peaks.map(p => ({
      x: p.xRel * widthM, y: p.yRel * heightM,
      h: p.h, sigma: p.sigmaM,
    }))
    return syntheticDEM(widthM, heightM, transform, peaks, area.baseElevM)
  }
  return syntheticDEM(widthM, heightM, transform, [
    { x: widthM / 2, y: heightM / 2, h: 100, sigma: Math.min(widthM, heightM) / 3 },
  ], 100)
}

/**
 * Spør én WCS-endpoint om GeoTIFF og parse til DEM.
 * @param {{minE,minN,maxE,maxN}} utmBbox  i EPSG:25832
 * @param {number} resolutionM
 * @param {{ url, coverage, bboxCrs, responseCrs?, name }} ep
 * @param {{ signal? }} opts
 */
export async function fetchWCSDtm(utmBbox, resolutionM, ep, opts = {}) {
  const widthM = utmBbox.maxE - utmBbox.minE
  const heightM = utmBbox.maxN - utmBbox.minN
  const widthPx = Math.round(widthM / resolutionM)
  const heightPx = Math.round(heightM / resolutionM)

  const params = new URLSearchParams({
    SERVICE: 'WCS',
    VERSION: '1.0.0',
    REQUEST: 'GetCoverage',
    COVERAGE: ep.coverage,
    CRS: ep.bboxCrs,
    BBOX: `${utmBbox.minE},${utmBbox.minN},${utmBbox.maxE},${utmBbox.maxN}`,
    FORMAT: 'GeoTIFF',
    WIDTH: String(widthPx),
    HEIGHT: String(heightPx),
  })
  if (ep.responseCrs) params.set('RESPONSE_CRS', ep.responseCrs)

  const url = `${ep.url}?${params}`
  const res = await fetch(url, { signal: opts.signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${text.slice(0, 100)}`)
  }
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('xml') || ct.includes('html')) {
    const text = await res.text()
    throw new Error(`forventet GeoTIFF, fikk ${ct}: ${text.slice(0, 200)}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  if (arrayBuffer.byteLength < 1000) {
    throw new Error(`for liten respons (${arrayBuffer.byteLength} bytes)`)
  }

  const { fromArrayBuffer } = await import('geotiff')
  const tiff = await fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const rasters = await image.readRasters()
  const rawData = rasters[0]
  const data = rawData instanceof Float32Array ? rawData : Float32Array.from(rawData)

  const cols = image.getWidth()
  const rows = image.getHeight()
  const transform = {
    originX: 0, originY: 0,
    pixelWidth: widthM / cols,
    pixelHeight: heightM / rows,
  }

  const noData = -9999
  for (let i = 0; i < data.length; i++) {
    if (data[i] < -1000 || !Number.isFinite(data[i])) data[i] = noData
  }

  return {
    data, cols, rows, transform, noData,
    resolution: Math.max(transform.pixelWidth, transform.pixelHeight),
  }
}

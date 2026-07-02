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

// Endpoints prøves i rekkefølge. Vi har trimmet vekk tre spekulative DTM 1m-
// coverages (hoyde_dtm_1_utm32 / hoeyde_dtm_1_utm32 / dtm1_utm32) som ble
// gjettet ut fra Geonorge-navngivnings-konvensjon men aldri har eksistert
// — hver enkelt feilet med HTTP 4xx etter en round-trip og kostet 3-10 s
// per kart-bygg uten å returnere data. v8.10.18: trimmet til den faktisk
// verifiserte primær-endpointen + to fallbacks.
const WCS_ENDPOINTS = [
  // ── DTM 10m UTM 32 native (verifisert virker, primær) ────────────────
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
 * Klient-timeout for én WCS GetCoverage, skalert med forespurt pikselantall.
 * 15 s grunnlag + 20 s per megapiksel, clampet til [15 s, 60 s]. Uten denne
 * kunne en hengende WCS-endpoint blokkere hele kart-byggingen (inkl. terreng-
 * først-previewen) uendelig — DEM var det eneste eksterne kallet uten tidsgrense.
 */
export function demTimeoutForPixels(px) {
  const ms = 15000 + 20000 * (px / 1e6)
  return Math.min(60000, Math.max(15000, Math.round(ms)))
}

// Hedge-forsinkelse: fallback-endpointen (UTM 33 reprojisert) startes hvis
// primæren ikke har svart innen dette — i stedet for å vente på full timeout
// før neste endepunkt i det gamle serielle løpet.
const HEDGE_DELAY_MS = 4000

/**
 * Hedged henting mot de to DTM-endpointene: primær starter straks, fallback
 * etter HEDGE_DELAY_MS (eller umiddelbart hvis primæren feiler før det).
 * Første suksess vinner og taperen abortes. Kaster først når begge har feilet.
 */
function hedgedWCSDtm(utmBbox, resolutionM, endpoints, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Avbrutt', 'AbortError'))
      return
    }
    const ctrls = endpoints.map(() => new AbortController())
    let settled = false
    let started = 0
    let failures = 0
    let lastError = null
    let hedgeTimer = null
    const onOuterAbort = () => {
      for (const c of ctrls) c.abort(signal?.reason)
    }
    signal?.addEventListener('abort', onOuterAbort, { once: true })
    const cleanup = () => {
      if (hedgeTimer) clearTimeout(hedgeTimer)
      signal?.removeEventListener('abort', onOuterAbort)
    }
    const start = (i) => {
      started++
      console.log(`[DEM] Forsøker ${endpoints[i].name} ...`)
      fetchWCSDtm(utmBbox, resolutionM, endpoints[i], { signal: ctrls[i].signal })
        .then(dem => {
          if (settled) return
          settled = true
          ctrls.forEach((c, j) => { if (j !== i) c.abort() })
          cleanup()
          resolve({ ...dem, source: endpoints[i].name })
        })
        .catch(e => {
          failures++
          lastError = e
          if (settled) return
          console.warn(`[DEM] ✗ ${endpoints[i].name} feilet: ${e.message}`)
          if (signal?.aborted) {
            settled = true
            cleanup()
            reject(signal.reason ?? e)
            return
          }
          if (started < endpoints.length) startHedge()
          else if (failures >= started) {
            settled = true
            cleanup()
            reject(lastError)
          }
        })
    }
    const startHedge = () => {
      if (settled || started >= endpoints.length) return
      start(1)
    }
    start(0)
    hedgeTimer = setTimeout(startHedge, HEDGE_DELAY_MS)
  })
}

/**
 * Hent DEM. Hedged forsøk mot de to DTM-endpointene, deretter DOM10 som
 * seriell siste utvei (overflate-modell, kun når terreng-modellene feiler),
 * til slutt syntetisk fallback. Bruker-avbrudd (signal) kastes videre i
 * stedet for å degradere til syntetisk.
 * @returns {Promise<DEM & { source: string }>}
 */
export async function fetchDEM(bbox, utmBbox, options = {}) {
  const { resolutionM = 10, knownArea, useReal = true, signal } = options

  if (useReal) {
    const dtmEndpoints = WCS_ENDPOINTS.slice(0, 2)
    const domFallback = WCS_ENDPOINTS[2]
    try {
      const dem = await hedgedWCSDtm(utmBbox, resolutionM, dtmEndpoints, { signal })
      console.log(`[DEM] ✓ Hentet ${dem.cols}×${dem.rows} celler @ ${dem.resolution.toFixed(1)}m fra ${dem.source}`)
      return dem
    } catch (e) {
      if (signal?.aborted) throw e
      console.warn(`[DEM] ✗ DTM-endpoints feilet: ${e.message}`)
    }
    try {
      console.log(`[DEM] Forsøker ${domFallback.name} ...`)
      const dem = await fetchWCSDtm(utmBbox, resolutionM, domFallback, { signal })
      console.log(`[DEM] ✓ Hentet ${dem.cols}×${dem.rows} celler @ ${dem.resolution.toFixed(1)}m fra ${domFallback.name}`)
      return { ...dem, source: domFallback.name }
    } catch (e) {
      if (signal?.aborted) throw e
      console.warn(`[DEM] ✗ ${domFallback.name} feilet: ${e.message}`)
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
  // Klient-timeout (skalert med pikselantall) lenket til kallerens signal —
  // dekker både fetch og kropps-nedlasting (arrayBuffer).
  const timeoutMs = opts.timeoutMs ?? demTimeoutForPixels(widthPx * heightPx)
  const ctrl = new AbortController()
  const timer = setTimeout(
    () => ctrl.abort(new DOMException(`WCS-timeout etter ${Math.round(timeoutMs / 1000)} s`, 'TimeoutError')),
    timeoutMs,
  )
  const onAbort = () => ctrl.abort(opts.signal?.reason)
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer)
      throw opts.signal.reason ?? new DOMException('Avbrutt', 'AbortError')
    }
    opts.signal.addEventListener('abort', onAbort, { once: true })
  }
  let arrayBuffer
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${text.slice(0, 100)}`)
    }
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('xml') || ct.includes('html')) {
      const text = await res.text()
      throw new Error(`forventet GeoTIFF, fikk ${ct}: ${text.slice(0, 200)}`)
    }
    arrayBuffer = await res.arrayBuffer()
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
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

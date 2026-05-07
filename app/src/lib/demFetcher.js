// DEM-data-henting. Strategi:
//  1. Forsøk Kartverket WCS (Web Coverage Service) — leverer GeoTIFF
//     med ekte float-høyder for et bbox. Krever serverside / CI fordi
//     CORS er ikke garantert.
//  2. Fall tilbake til syntetisk DEM kalibrert for kjente områder
//     (Vardåsen) hvis ekte data ikke er tilgjengelig.
//
// WCS-endepunkt: https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm
// Krever EPSG:25832 (UTM 32N) for sør-Norge, 25833 for nord.

import { syntheticDEM } from './dem.js'

const KARTVERKET_WCS = 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm'

/**
 * Kalibrert kjent-områder med Gaussian-modeller (fallback).
 */
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
 * Hent DEM for et bbox. Forsøker først ekte WCS, fallback til syntetisk.
 *
 * @param {{ south:number, west:number, north:number, east:number }} bbox  WGS84
 * @param {{ minE:number, minN:number, maxE:number, maxN:number }} utmBbox  EPSG:25832
 * @param {object} options
 * @param {number} [options.resolutionM=10]
 * @param {string} [options.knownArea]
 * @param {boolean} [options.useReal=true]      Forsøk ekte data først
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<DEM>}
 */
export async function fetchDEM(bbox, utmBbox, options = {}) {
  const { resolutionM = 10, knownArea, useReal = true, signal } = options

  if (useReal) {
    try {
      const dem = await fetchWCSDtm(utmBbox, resolutionM, { signal })
      console.log(`Hentet ekte DTM: ${dem.cols}×${dem.rows} celler, oppløsning ${dem.resolution} m`)
      return dem
    } catch (e) {
      console.warn('Kartverket WCS ikke tilgjengelig — bruker syntetisk:', e.message)
    }
  }

  return buildSyntheticDEM(utmBbox, resolutionM, knownArea)
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
 * Hent ekte DTM fra Kartverket WCS som GeoTIFF og parse til Float32Array.
 * Krever at `geotiff` er tilgjengelig.
 *
 * @param {{minE,minN,maxE,maxN}} utmBbox
 * @param {number} resolutionM
 * @param {{ signal?: AbortSignal }} opts
 * @returns {Promise<DEM>}
 */
export async function fetchWCSDtm(utmBbox, resolutionM = 10, opts = {}) {
  const widthM = utmBbox.maxE - utmBbox.minE
  const heightM = utmBbox.maxN - utmBbox.minN
  const widthPx = Math.round(widthM / resolutionM)
  const heightPx = Math.round(heightM / resolutionM)

  // WCS 1.0.0 GetCoverage. SUBSET er bbox i CRS-orden (E, N).
  const params = new URLSearchParams({
    SERVICE: 'WCS',
    VERSION: '1.0.0',
    REQUEST: 'GetCoverage',
    COVERAGE: 'land_utm33_10m',  // dekker Norge i UTM 33; vi reprojekterer ved spørring
    CRS: 'EPSG:25832',
    BBOX: `${utmBbox.minE},${utmBbox.minN},${utmBbox.maxE},${utmBbox.maxN}`,
    RESPONSE_CRS: 'EPSG:25832',
    FORMAT: 'GeoTIFF',
    WIDTH: String(widthPx),
    HEIGHT: String(heightPx),
  })

  const url = `${KARTVERKET_WCS}?${params}`
  const res = await fetch(url, { signal: opts.signal })
  if (!res.ok) throw new Error(`WCS HTTP ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()

  // Parse GeoTIFF
  const { fromArrayBuffer } = await import('geotiff')
  const tiff = await fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const rasters = await image.readRasters()
  const rawData = rasters[0]   // single-band float32

  // Konverter til Float32Array hvis ikke allerede
  const data = rawData instanceof Float32Array ? rawData : new Float32Array(rawData)

  // GeoTIFF har sin egen transform — men vi lar grid-koord matche bbox-relativ
  const cols = image.getWidth()
  const rows = image.getHeight()
  const transform = {
    originX: 0,
    originY: 0,
    pixelWidth: widthM / cols,
    pixelHeight: heightM / rows,
  }

  // Erstatt nodata-verdier (typisk -9999 fra Kartverket)
  let noData = -9999
  for (let i = 0; i < data.length; i++) {
    if (data[i] < -1000) data[i] = noData
  }

  return {
    data, cols, rows, transform, noData,
    resolution: Math.max(transform.pixelWidth, transform.pixelHeight),
  }
}

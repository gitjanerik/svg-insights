// Vannmaske fra Kartverket WMS (FKB-Vann / N50-Vann).
//
// Forskjell fra waterMaskFromTiles.js: vi spør om en KUN-VANN-rendering på
// transparent bakgrunn (WMS GetMap med TRANSPARENT=true + spesifikke vann-
// lag), så pixel-klassifisering blir trivielt alpha-basert (alpha > 0 = vann)
// istedenfor en HSL-bånd-heuristikk på et stilisert kart.
//
// Det fjerner hele kategorien av "Norgeskart-tile rendret område med blå
// shading som ikke er vann"-bugs. Vi spør Kartverket direkte hva som ER
// vann og får en autoritativ raster-respons.
//
// Probe-mønster: vi prøver flere endepunkter og lag-kombinasjoner siden
// Geonorge har inkonsistent lag-navngivning. Første som svarer med faktisk
// data brukes. Hvis alle feiler (CORS / nett / endpoint nede) returnerer
// vi { source: 'failed' } så kalleren kan fall tilbake til WMTS-tile.

import { contours as d3Contours } from 'd3-contour'
import { simplifyDP, chaikin } from './pathUtils.js'
import { wgs84ToUtm32 } from './utm.js'

// Geonorge WMS-tjenester med vann-data. Probe-rekkefølge fra mest til
// minst presis. Hvert endpoint kan ha flere LAYERS-kandidater pga
// inkonsistent navngivning på tvers av datasett-versjoner.
const WMS_ENDPOINTS = [
  {
    name: 'fkb_vann',
    url: 'https://wms.geonorge.no/skwms1/wms.fkb_vann',
    layerCandidates: [
      'Vannflate,Innsjø,Havflate',
      'Vannflate',
      'Innsjø,Havflate',
      'fkb_vann_omrade',
    ],
  },
  {
    name: 'n50_kartdata',
    url: 'https://wms.geonorge.no/skwms1/wms.n50_kartdata',
    layerCandidates: [
      'N50_Vann_omrade',
      'Vann',
      'Havflate,Innsjo',
    ],
  },
]

const DEFAULT_M_PER_PX = 5
const ALPHA_THRESHOLD = 32
const MIN_PIXELS_FOR_VALID_RESPONSE = 50
const PROBE_TIMEOUT_MS = 8000

/**
 * Hent vann-rendering fra ett WMS-endpoint med spesifikke lag.
 * Per-probe timeout via AbortController så døde endepunkter ikke henger
 * hele kart-genereringen (Geonorge har inkonsistent oppetid på enkelte
 * dataset-versjoner; sekvensiell probing skal ikke akkumulere flere minutter
 * med ventetid før vi gir opp og faller tilbake til WMTS).
 */
async function fetchWmsImage(url, layers, bbox, widthPx, heightPx, signal) {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: layers,
    STYLES: '',
    CRS: 'CRS:84',
    BBOX: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    WIDTH: String(widthPx),
    HEIGHT: String(heightPx),
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
  })
  const timeoutCtrl = new AbortController()
  const timer = setTimeout(() => timeoutCtrl.abort(new Error('probe timeout')), PROBE_TIMEOUT_MS)
  const composedSignal = signal
    ? AbortSignal.any?.([signal, timeoutCtrl.signal]) ?? timeoutCtrl.signal
    : timeoutCtrl.signal
  try {
    const res = await fetch(`${url}?${params}`, { mode: 'cors', signal: composedSignal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    return await createImageBitmap(blob)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Sjekk om et returnert bilde faktisk har vann-data (ikke et tomt
 * transparent bilde fra et endpoint som ikke kjenner laget).
 */
async function imageHasContent(img, w, h) {
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, w, h).data
  let count = 0
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > ALPHA_THRESHOLD) {
      count++
      if (count >= MIN_PIXELS_FOR_VALID_RESPONSE) return true
    }
  }
  return false
}

/**
 * Bygg vannmaske fra Kartverket WMS for et bbox.
 *
 * @param {{south, west, north, east}} bbox WGS84
 * @param {object} [opts]
 * @param {number} [opts.metersPerPixel=5]   Mål-oppløsning
 * @param {number} [opts.minAreaM2=300]      Filter små støy-polygoner
 * @param {number} [opts.simplifyM=4]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{
 *   polygons: Array<{ rings: Array<Array<[number,number]>>, type: 'sea'|'lake' }>,
 *   source: 'wms'|'failed',
 *   endpoint: string|null,
 *   reason: string|null,
 * }>}
 */
export async function buildWaterMaskFromWms(bbox, opts = {}) {
  const { OffscreenCanvas } = globalThis
  if (!OffscreenCanvas || typeof createImageBitmap === 'undefined') {
    return { polygons: [], source: 'failed', endpoint: null, reason: 'no-canvas-api' }
  }
  const midLat = (bbox.north + bbox.south) / 2
  const widthM = Math.abs(bbox.east - bbox.west) * 111000 * Math.cos(midLat * Math.PI / 180)
  const heightM = Math.abs(bbox.north - bbox.south) * 111000
  const mPerPx = opts.metersPerPixel ?? DEFAULT_M_PER_PX
  const widthPx = Math.min(2048, Math.max(256, Math.round(widthM / mPerPx)))
  const heightPx = Math.min(2048, Math.max(256, Math.round(heightM / mPerPx)))

  let img = null
  let usedEndpoint = null
  const probeErrors = []
  for (const ep of WMS_ENDPOINTS) {
    for (const layers of ep.layerCandidates) {
      try {
        const candidate = await fetchWmsImage(ep.url, layers, bbox, widthPx, heightPx, opts.signal)
        if (await imageHasContent(candidate, widthPx, heightPx)) {
          img = candidate
          usedEndpoint = `${ep.name}(${layers})`
          break
        }
        candidate.close?.()
        probeErrors.push(`${ep.name}/${layers}: empty image`)
      } catch (e) {
        probeErrors.push(`${ep.name}/${layers}: ${e.message}`)
      }
    }
    if (img) break
  }

  if (!img) {
    console.warn('[WMS-vann] alle probes feilet:', probeErrors)
    return { polygons: [], source: 'failed', endpoint: null, reason: 'all-endpoints-failed' }
  }

  const canvas = new OffscreenCanvas(widthPx, heightPx)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  img.close?.()
  const imgData = ctx.getImageData(0, 0, widthPx, heightPx)
  const data = imgData.data
  const mask = new Uint8Array(widthPx * heightPx)
  for (let i = 3, p = 0; i < data.length; i += 4, p++) {
    if (data[i] > ALPHA_THRESHOLD) mask[p] = 1
  }

  return vectorizeAlphaMask({ mask, widthPx, heightPx, bbox, opts, endpoint: usedEndpoint })
}

/**
 * Test-vennlig sub-funksjon som tar en ferdig alpha-mask og returnerer
 * polygoner. Eksportert så enhetstester kan kjøre uten WMS-fetch.
 */
export function vectorizeAlphaMask(args) {
  const { mask, widthPx, heightPx, bbox, opts = {}, endpoint = null } = args
  const { minAreaM2 = 300, simplifyM = 4 } = opts
  const arr = Array.from(mask)
  const levels = d3Contours().size([widthPx, heightPx]).thresholds([0.5])(arr)
  if (!levels.length) return { polygons: [], source: 'wms', endpoint, reason: 'no-contours' }

  const swM = wgs84ToUtm32(bbox.south, bbox.west)
  const neM = wgs84ToUtm32(bbox.north, bbox.east)
  const minE = Math.min(swM.e, neM.e)
  const maxN = Math.max(swM.n, neM.n)
  const minN = Math.min(swM.n, neM.n)
  const bboxHeightM = maxN - minN

  // WMS GetMap-bilde har bbox som lineær koord-utstrekning. py=0 = nord,
  // py=H = sør. Konverter pixel → lat/lon → UTM → SVG-meter.
  const projectPx = ([px, py]) => {
    const lon = bbox.west + (px / widthPx) * (bbox.east - bbox.west)
    const lat = bbox.north - (py / heightPx) * (bbox.north - bbox.south)
    const utm = wgs84ToUtm32(lat, lon)
    return [utm.e - minE, bboxHeightM - (utm.n - minN)]
  }

  const edgeTolPx = 2
  const polygons = []
  for (const poly of levels[0].coordinates) {
    if (!poly.length) continue
    const outerPx = poly[0]
    let touchesEdge = false
    for (const [px, py] of outerPx) {
      if (px <= edgeTolPx || py <= edgeTolPx
          || px >= widthPx - edgeTolPx || py >= heightPx - edgeTolPx) {
        touchesEdge = true; break
      }
    }
    const rings = poly.map(ring => ring.map(projectPx))
    if (!rings.length) continue
    const outer = rings[0]
    const area = Math.abs(signedArea(outer))
    if (area < minAreaM2) continue
    const simplified = rings.map(ring => {
      let r2 = simplifyDP(ring, simplifyM)
      r2 = chaikin(r2, 1, true)
      r2 = simplifyDP(r2, simplifyM / 2)
      return r2
    }).filter(r => r.length >= 4)
    if (!simplified.length) continue
    polygons.push({ rings: simplified, type: touchesEdge ? 'sea' : 'lake' })
  }
  return { polygons, source: 'wms', endpoint }
}

function signedArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  }
  return a / 2
}

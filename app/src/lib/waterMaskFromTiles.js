// WMTS-basert vannmaske-deteksjon fra Kartverket Norgeskart-tiler.
//
// Strategi: Norgeskart sin offisielle kart-rendering har vann i en konsistent
// blåtone (forskjellig fra by/terreng/vei). Vi henter raster-tiler for bbox,
// klassifiserer hver piksel som vann-eller-ikke basert på fargen, og
// vektoriserer resultatet til polygoner via d3-contour marching squares.
//
// Dette er den mest autoritative kilden vi har tilgjengelig klient-side:
//   - CORS-OK (cache.kartverket.no støtter CORS — verifisert i tileBackground.js)
//   - Inkluderer ALLE Kartverket-modellerte vannflater: sjø, innsjø, tjern, elver
//   - Ingen heuristisk gjetning fra terreng-egenskaper (modsetning til
//     plateau-deteksjon som ga Oslo Mini-Venezia-bug i v8.9.17)
//
// Returverdien er polygoner i bbox-meter-koord (samme rom som DEM-sjø) klare
// til å rendres direkte. Polygoner klassifiseres som sjø (berører bbox-kant)
// eller innsjø (berører ikke) — samme prinsipp som buildSeaFromDem.

import { contours as d3Contours } from 'd3-contour'
import { simplifyDP, chaikin } from './pathUtils.js'
import { wgs84ToUtm32 } from './utm.js'

const TILE_URL = 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator'
const TILE_SIZE = 256

function lonLatToWebMercatorTile(lon, lat, z) {
  const n = 2 ** z
  const xT = (lon + 180) / 360 * n
  const latRad = lat * Math.PI / 180
  const yT = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  return { xT, yT }
}

function webMercatorPxToLonLat(px, py, zoom) {
  const n = 2 ** zoom
  const lon = px / (n * TILE_SIZE) * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * py / (n * TILE_SIZE))))
  const lat = latRad * 180 / Math.PI
  return { lat, lon }
}

function pickZoom(widthM) {
  // Norgeskart-piksel-størrelse ved 60°N: ≈ 78240 / 2^z meter.
  // Vi vil ha 2-5 m per piksel så små øyer (Hanseberget-typetilfelle: 50×100m)
  // er minst 10×20 piksler — Kartverkets renderer skjuler ellers små øyer som
  // ser ut som blå sjø på vår mask. Bumpet ett trinn i v8.9.21.
  if (widthM <= 2500) return 15   // ≈ 2.4 m/px, ~9×9 = 81 tiles
  if (widthM <= 6000) return 14   // ≈ 4.8 m/px, ~4×4 = 16 tiles
  if (widthM <= 12000) return 13  // ≈ 9.5 m/px
  return 12                        // ≈ 19 m/px
}

/**
 * Klassifiser én piksel som vann eller ikke. Norgeskart bruker en konsistent
 * blå-cyan-tone for alle vannflater (sjø, innsjø, elver). Vi tester:
 *   1. Blå-dominans: b > r og b > g (vannet er blått, ikke brunt/grønt)
 *   2. Hue i blå-cyan-bånd: 180°–225°
 *   3. Saturation moderat: ikke gråt, ikke neon
 *   4. Lightness medium-høy: ikke mørkt (sky-skygger ekskluderes)
 *
 * Returnerer true hvis pikselet sannsynligvis er vann.
 *
 * @param {number} r 0–255
 * @param {number} g 0–255
 * @param {number} b 0–255
 * @returns {boolean}
 */
export function isWaterPixel(r, g, b) {
  // Hvit / nesten-hvit: utenfor data eller papir
  if (r > 240 && g > 240 && b > 240) return false
  // Blå-dominans (loose: minst 8 mer blå enn grønn/rød)
  if (b < g + 5 || b < r + 8) return false
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max !== b) return false
  const sum = max + min
  const l = sum / 510
  if (l < 0.5 || l > 0.95) return false
  const dRng = max - min
  if (dRng < 8) return false
  // Saturation = (max-min) / (1 - |2L - 1|) i 0..255-skala
  const s = dRng / (255 - Math.abs(sum - 255))
  if (s < 0.08 || s > 0.7) return false
  // Hue: for max=b, h = 240 + 60*(r-g)/(b-min)
  const hue = 240 + 60 * (r - g) / dRng
  return hue >= 180 && hue <= 225
}

/**
 * Hent Kartverket Norgeskart WMTS-tiler for bbox, ekstraher vannmaske,
 * og vektoriser til polygoner.
 *
 * @param {{south, west, north, east}} bbox WGS84
 * @param {object} [opts]
 * @param {number} [opts.zoom]              Tving spesifikk zoom
 * @param {number} [opts.minAreaM2=300]     Filtrer små polygoner (støy)
 * @param {number} [opts.simplifyM=4]       DP-toleranse før Chaikin-glatting
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{
 *   polygons: Array<{ rings: Array<Array<[number,number]>>, type: 'sea'|'lake' }>,
 *   source: 'wmts'|'failed',
 *   tilesFetched: number,
 *   tilesFailed: number,
 * }>}
 */
export async function buildWaterMaskFromTiles(bbox, opts = {}) {
  const { OffscreenCanvas } = globalThis
  if (!OffscreenCanvas || typeof createImageBitmap === 'undefined') {
    return { polygons: [], source: 'failed', tilesFetched: 0, tilesFailed: 0 }
  }
  const bboxWidthDeg = bbox.east - bbox.west
  // Estimer bbox-bredde i meter via approx 111 km/° * cos(lat)
  const midLat = (bbox.north + bbox.south) / 2
  const widthM = Math.abs(bboxWidthDeg) * 111000 * Math.cos(midLat * Math.PI / 180)
  const { zoom = pickZoom(widthM), minAreaM2 = 300, simplifyM = 4, signal } = opts

  const sw = lonLatToWebMercatorTile(bbox.west, bbox.south, zoom)
  const ne = lonLatToWebMercatorTile(bbox.east, bbox.north, zoom)
  const tlX = Math.floor(Math.min(sw.xT, ne.xT))
  const tlY = Math.floor(Math.min(sw.yT, ne.yT))
  const brX = Math.ceil(Math.max(sw.xT, ne.xT))
  const brY = Math.ceil(Math.max(sw.yT, ne.yT))
  const tilesX = brX - tlX
  const tilesY = brY - tlY
  if (tilesX <= 0 || tilesY <= 0) {
    return { polygons: [], source: 'failed', tilesFetched: 0, tilesFailed: 0 }
  }
  // Sanity-cap så vi ikke fetcher 1000+ tiler ved katastrofalt valg av zoom
  if (tilesX * tilesY > 200) {
    console.warn(`[WMTS-vann] for mange tiler (${tilesX * tilesY}); reduserer zoom`)
    return buildWaterMaskFromTiles(bbox, { ...opts, zoom: zoom - 1 })
  }
  const canvasW = tilesX * TILE_SIZE
  const canvasH = tilesY * TILE_SIZE

  let tilesFetched = 0, tilesFailed = 0
  const tilePromises = []
  for (let ty = tlY; ty < brY; ty++) {
    for (let tx = tlX; tx < brX; tx++) {
      tilePromises.push((async () => {
        try {
          const res = await fetch(`${TILE_URL}/${zoom}/${ty}/${tx}.png`, { mode: 'cors', signal })
          if (!res.ok) { tilesFailed++; return null }
          const blob = await res.blob()
          const img = await createImageBitmap(blob)
          tilesFetched++
          return { tx: tx - tlX, ty: ty - tlY, img }
        } catch {
          tilesFailed++
          return null
        }
      })())
    }
  }
  const tiles = (await Promise.all(tilePromises)).filter(t => t != null)
  if (!tiles.length) {
    return { polygons: [], source: 'failed', tilesFetched, tilesFailed }
  }

  const canvas = new OffscreenCanvas(canvasW, canvasH)
  const ctx = canvas.getContext('2d')
  // Fyll med hvit så manglende tiler ikke smitter inn som "ikke-data" i mask
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasW, canvasH)
  for (const { tx, ty, img } of tiles) {
    ctx.drawImage(img, tx * TILE_SIZE, ty * TILE_SIZE)
    img.close?.()
  }
  const imgData = ctx.getImageData(0, 0, canvasW, canvasH)
  const data = imgData.data

  const mask = new Uint8Array(canvasW * canvasH)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (isWaterPixel(data[i], data[i + 1], data[i + 2])) mask[p] = 1
  }

  return finalizeMaskToPolygons({
    mask, canvasW, canvasH, tlX, tlY, zoom, bbox,
    minAreaM2, simplifyM, tilesFetched, tilesFailed,
  })
}

/**
 * Test-vennlig sub-funksjon som tar en ferdig vannmaske-grid og returnerer
 * polygoner. Brukes både fra buildWaterMaskFromTiles og fra enhetstester.
 */
export function finalizeMaskToPolygons(args) {
  const { mask, canvasW, canvasH, tlX, tlY, zoom, bbox, minAreaM2, simplifyM,
          tilesFetched = 0, tilesFailed = 0 } = args
  const arr = Array.from(mask)
  const levels = d3Contours().size([canvasW, canvasH]).thresholds([0.5])(arr)
  if (!levels.length) {
    return { polygons: [], source: 'wmts', tilesFetched, tilesFailed }
  }

  const swM = wgs84ToUtm32(bbox.south, bbox.west)
  const neM = wgs84ToUtm32(bbox.north, bbox.east)
  const minE = Math.min(swM.e, neM.e)
  const maxE = Math.max(swM.e, neM.e)
  const minN = Math.min(swM.n, neM.n)
  const maxN = Math.max(swM.n, neM.n)
  const bboxWidthM = maxE - minE
  const bboxHeightM = maxN - minN

  const projectCanvasPx = ([px, py]) => {
    const wmPx = tlX * TILE_SIZE + px
    const wmPy = tlY * TILE_SIZE + py
    const { lat, lon } = webMercatorPxToLonLat(wmPx, wmPy, zoom)
    const utm = wgs84ToUtm32(lat, lon)
    return [utm.e - minE, bboxHeightM - (utm.n - minN)]
  }

  // Boundary touch sjekkes i CANVAS-piksel-rom (mer presist enn meter-rom):
  // ringen er sjø hvis noen punkt ligger innen 2 piksler av canvas-kanten.
  // Toleransen demper marching-squares' 0.5-piksel-offset på threshold-grenser.
  const edgeTolPx = 2
  const polygons = []
  for (const poly of levels[0].coordinates) {
    if (!poly.length) continue
    // Sjekk edge-touch FØR projeksjon
    const outerPx = poly[0]
    let touchesEdge = false
    for (const [px, py] of outerPx) {
      if (px <= edgeTolPx || py <= edgeTolPx
          || px >= canvasW - edgeTolPx || py >= canvasH - edgeTolPx) {
        touchesEdge = true; break
      }
    }
    const rings = poly.map(ring => ring.map(projectCanvasPx))
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
  return { polygons, source: 'wmts', tilesFetched, tilesFailed }
}

function signedArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  }
  return a / 2
}

/**
 * Konverter WMTS-polygoner til mapBuilder-kompatible elementer som rendrer
 * via standard waterLayers-pipelinen. Sjø-polygoner blir ISOM 303,
 * innsjø-polygoner blir ISOM 301.
 *
 * Bruker `merged-water`-formatet med `_mergedRings` som bevarer outer/hole-
 * topologi. Hvert WMTS-polygon = én entry i `_mergedRings` = `[outer, ...holes]`.
 * Holes (øyer i sjø, øyer i innsjøer) rendres som hull via fill-rule="evenodd"
 * istedenfor å bli klassifisert som «vann».
 *
 * Koordinatene er allerede i SVG-meter-rom (samme som mapBuilder bruker for
 * `_mergedRings`), så ingen WGS84-rundtur er nødvendig.
 *
 * @param {Array} wmtsPolygons   Output fra buildWaterMaskFromTiles
 * @returns {Array}              merged-water-elementer
 */
export function polygonsToOsmLikeWays(wmtsPolygons) {
  if (!wmtsPolygons.length) return []
  const seaPolys = []
  const lakePolys = []
  for (const poly of wmtsPolygons) {
    if (!poly.rings?.length) continue
    if (poly.type === 'sea') seaPolys.push(poly.rings)
    else lakePolys.push(poly.rings)
  }
  const elements = []
  if (seaPolys.length) {
    elements.push({
      type: 'merged-water',
      id: 5_000_001,
      tags: { natural: 'water', water: 'sea', salt: 'yes' },
      _mergedRings: seaPolys,
      _source: 'wmts-sea',
    })
  }
  if (lakePolys.length) {
    elements.push({
      type: 'merged-water',
      id: 5_000_002,
      tags: { natural: 'water' },
      _mergedRings: lakePolys,
      _source: 'wmts-lake',
    })
  }
  return elements
}


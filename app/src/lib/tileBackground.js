// Enkel statisk WMTS-tile-bakgrunn for kart-preview. Ikke en full
// kart-engine — bare en mosaikk av PNG-tiler fra Kartverkets cache.
// Tilene er Web Mercator (EPSG:3857), 256x256 px, henter ferdige
// kacher fra cache.kartverket.no.
//
// Vi rendrer alltid en grid sentrert på et lat/lon-punkt og lar
// kalleren plassere et bbox-overlegg over.

import { computed } from 'vue'

const TILE_URL = 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator'
// OSM-standard som underlag: Kartverkets topo dekker bare Norge, så grensenære
// utsnitt (Børgefjell etc.) ble blanke på svensk side. OSM dekker globalt og
// rendres BAK Kartverket-flisene — der Kartverket mangler/feiler viser OSM.
// Plain <img> trenger ikke CORS, så dette virker uavhengig av tile-policy.
const OSM_TILE_URL = 'https://tile.openstreetmap.org'
const TILE_SIZE = 256

// Web Mercator tile koordinater fra lat/lon ved gitt zoom
function lonLatToTile(lon, lat, z) {
  const n = 2 ** z
  const xT = (lon + 180) / 360 * n
  const latRad = lat * Math.PI / 180
  const yT = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  return { xT, yT }
}

/**
 * Velg fornuftig zoom-nivå basert på ønsket bredde i kilometer.
 * Verdier kalibrert for Norge (≈60°N).
 */
export function zoomForKm(km) {
  if (km <= 1.5) return 15
  if (km <= 3)   return 14
  if (km <= 6)   return 13
  if (km <= 12)  return 12
  if (km <= 18)  return 11
  if (km <= 36)  return 10
  return 9
}

/**
 * Returnerer en grid av tile-objekter som dekker et viewport av gitt
 * pixel-størrelse, sentrert på lat/lon. Hver tile har:
 *   - url
 *   - leftPx, topPx (posisjon i container, fra øvre venstre)
 *
 * Vi runder til nærmeste tile-grid og fyller med litt margin.
 */
export function tileMosaic(centerLat, centerLon, zoom, viewportPx) {
  const { xT, yT } = lonLatToTile(centerLon, centerLat, zoom)
  // Pixel-koord av senter innen full Web Mercator-pyramiden:
  const centerPx = { x: xT * TILE_SIZE, y: yT * TILE_SIZE }
  // Pixel-koord av viewport øvre venstre:
  const halfW = viewportPx.w / 2
  const halfH = viewportPx.h / 2
  const tlPx = { x: centerPx.x - halfW, y: centerPx.y - halfH }
  const brPx = { x: centerPx.x + halfW, y: centerPx.y + halfH }

  const tlTile = { x: Math.floor(tlPx.x / TILE_SIZE), y: Math.floor(tlPx.y / TILE_SIZE) }
  const brTile = { x: Math.ceil(brPx.x / TILE_SIZE),  y: Math.ceil(brPx.y / TILE_SIZE) }

  const tiles = []
  for (let ty = tlTile.y; ty < brTile.y; ty++) {
    for (let tx = tlTile.x; tx < brTile.x; tx++) {
      tiles.push({
        // Kartverket bruker {TileRow}/{TileCol} = {y}/{x}; OSM bruker {z}/{x}/{y}.
        url: `${TILE_URL}/${zoom}/${ty}/${tx}.png`,
        osmUrl: `${OSM_TILE_URL}/${zoom}/${tx}/${ty}.png`,
        leftPx: tx * TILE_SIZE - tlPx.x,
        topPx:  ty * TILE_SIZE - tlPx.y,
      })
    }
  }
  return tiles
}

/**
 * Hvor mange skjermpiksler tilsvarer 1 meter ved et gitt zoom-nivå
 * og en gitt breddegrad i Web Mercator?
 */
export function metersPerPixel(lat, zoom) {
  const earth = 40075016.686  // ekvatorlengde i meter (WGS84)
  return earth * Math.cos(lat * Math.PI / 180) / (TILE_SIZE * 2 ** zoom)
}

// Web Mercator-projeksjon (EPSG:3857-pyramiden) for Ruteplanleggeren.
// tileBackground.js har samme matte innbakt i tileMosaic; denne modulen
// eksporterer den DOM-fritt og testbart for lonlat↔skjerm-px-konvertering
// (overlay-/rute-tegning oppå tile-mosaikken og tap-to-set).

export const TILE_SIZE = 256

// Verdens-piksel i full pyramide ved gitt zoom (0,0 = nordvest-hjørnet).
export function lonLatToWorldPx(lon, lat, zoom) {
  const scale = TILE_SIZE * Math.pow(2, zoom)
  const x = ((lon + 180) / 360) * scale
  const latRad = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  return { x, y }
}

export function worldPxToLonLat(x, y, zoom) {
  const scale = TILE_SIZE * Math.pow(2, zoom)
  const lon = (x / scale) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / scale
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n))
  return { lon, lat }
}

// view = { centerLat, centerLon, zoom, wPx, hPx } — skjermens senter er
// view-senteret; skjerm-px er world-px translert dit.
export function lonLatToScreenPx(lon, lat, view) {
  const c = lonLatToWorldPx(view.centerLon, view.centerLat, view.zoom)
  const p = lonLatToWorldPx(lon, lat, view.zoom)
  return { x: p.x - c.x + view.wPx / 2, y: p.y - c.y + view.hPx / 2 }
}

export function screenPxToLonLat(x, y, view) {
  const c = lonLatToWorldPx(view.centerLon, view.centerLat, view.zoom)
  return worldPxToLonLat(c.x + x - view.wPx / 2, c.y + y - view.hPx / 2, view.zoom)
}

// Synlig bbox for view-et, valgfritt utvidet symmetrisk (padFactor > 1 gir
// prefetch-margin så små pan-bevegelser ikke trenger ny henting).
export function viewBbox(view, padFactor = 1) {
  const halfW = (view.wPx / 2) * padFactor
  const halfH = (view.hPx / 2) * padFactor
  const c = lonLatToWorldPx(view.centerLon, view.centerLat, view.zoom)
  const nw = worldPxToLonLat(c.x - halfW, c.y - halfH, view.zoom)
  const se = worldPxToLonLat(c.x + halfW, c.y + halfH, view.zoom)
  return { south: se.lat, west: nw.lon, north: nw.lat, east: se.lon }
}

export function bboxAreaKm2(bbox) {
  const latMid = ((bbox.south + bbox.north) / 2) * (Math.PI / 180)
  const hKm = (bbox.north - bbox.south) * 111.32
  const wKm = (bbox.east - bbox.west) * 111.32 * Math.cos(latMid)
  return Math.abs(hKm * wKm)
}

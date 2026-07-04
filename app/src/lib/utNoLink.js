// UT.no-kartlenke (v12.1.16): åpne DNTs turkart på et gitt punkt.
// Hash-formatet er https://ut.no/kart#<zoom>/<breddegrad>/<lengdegrad> —
// samme konvensjon som Mapbox/Leaflet-hash. Delt mellom Ruteplanleggeren
// (long-press-pin) og turkartet (MapView).

export const UTNO_ZOOM_MIN = 4
export const UTNO_ZOOM_MAX = 16
// Fornuftig detalj-nivå når kallerens visning ikke har noen web-zoom å
// arve (turkartets SVG er skala-basert, ikke tile-zoom-basert).
export const UTNO_DEFAULT_ZOOM = 14

/**
 * Web-Mercator-zoom som matcher en gitt bakkeoppløsning (meter pr skjerm-px)
 * ved breddegraden. Lar turkartet (skala-basert SVG, ingen tile-zoom) åpne
 * UT.no på omtrent samme visuelle utsnitt som brukeren ser.
 */
export function utNoZoomForMPerPx(mPerPx, lat) {
  if (!Number.isFinite(mPerPx) || mPerPx <= 0 || !Number.isFinite(lat)) return UTNO_DEFAULT_ZOOM
  const z = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / mPerPx)
  if (!Number.isFinite(z)) return UTNO_DEFAULT_ZOOM
  return Math.min(UTNO_ZOOM_MAX, Math.max(UTNO_ZOOM_MIN, Math.round(z)))
}

/**
 * Bygg UT.no-kart-URL for et punkt. Zoom rundes til heltall og clampes til
 * UT.no sitt støttede spenn; 5 desimaler på koordinatene (~1 m presisjon).
 * @returns {string|null} null hvis punktet ikke er gyldige tall
 */
export function buildUtNoUrl({ lat, lon, zoom = UTNO_DEFAULT_ZOOM }) {
  if (![lat, lon, zoom].every(Number.isFinite)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const z = Math.min(UTNO_ZOOM_MAX, Math.max(UTNO_ZOOM_MIN, Math.round(zoom)))
  return `https://ut.no/kart#${z}/${lat.toFixed(5)}/${lon.toFixed(5)}`
}

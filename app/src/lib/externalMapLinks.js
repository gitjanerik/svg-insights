// Eksterne kart-lenker for et punkt (v12.1.17): Google Maps, Street View og
// Vegvesenets Vegkart. Delt mellom turkartets long-press-ark (MapView) og
// Ruteplanleggerens long-press-pin. UT.no-lenken bor i utNoLink.js.

import { wgs84ToUtm33 } from './utm.js'

export function gmapsUrl(lat, lon) {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`
}

export function streetViewUrl(lat, lon) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`
}

// Vegkart (vegkart.atlas.vegvesen.no) bruker UTM 33N-koordinater i hashen:
// #kartlag:geodata/@<easting>,<northing>,<zoom> — f.eks. er standardvisningen
// for hele Norge @600000,7225000,5. Zoom-trappen er sammenlignbar med
// web-Mercator (5 ≈ hele landet, 14 ≈ nabolag).
export const VEGKART_ZOOM_MIN = 3
export const VEGKART_ZOOM_MAX = 16
export const VEGKART_DEFAULT_ZOOM = 14

/**
 * Bygg Vegkart-URL for et punkt. Koordinater rundes til hele meter (UTM 33N);
 * zoom rundes til heltall og clampes.
 * @returns {string|null} null hvis punktet ikke er gyldige tall
 */
export function buildVegkartUrl({ lat, lon, zoom = VEGKART_DEFAULT_ZOOM }) {
  if (![lat, lon, zoom].every(Number.isFinite)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const z = Math.min(VEGKART_ZOOM_MAX, Math.max(VEGKART_ZOOM_MIN, Math.round(zoom)))
  const { e, n } = wgs84ToUtm33(lat, lon)
  return `https://vegkart.atlas.vegvesen.no/#kartlag:geodata/@${Math.round(e)},${Math.round(n)},${z}`
}

/**
 * Bygg dyplenke til Kulturminnesøk for et kulturminne (UUID). Brukes som fallback
 * når API-ets eget `linkkulturminnesok`-felt mangler.
 * @param {string} id  UUID
 * @returns {string|null}
 */
export function buildKulturminnesokUrl(id) {
  return id ? `https://www.kulturminnesok.no/kart/?id=${encodeURIComponent(id)}` : null
}

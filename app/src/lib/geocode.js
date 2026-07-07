// Stedssøk via OpenStreetMap Nominatim. Delt kjerne for useNominatim
// (UI-composable) og MCP-serveren (sok_sted / bygg_kart med sted-navn). Ren
// funksjon som tar fetch injisert, så den kan testes og kjøres i Node uten
// avhengighet av et globalt fetch eller vue.
//
// Free service — vær rate-limit-vennlig (debounce i UI) og send User-Agent i
// server-kontekst (Nominatim krever det for ikke-nettleser-klienter).

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

// Kortnavn: «Navn, tettsted» der det finnes, ellers de to første leddene av
// display_name. Trekker ut det mest gjenkjennelige stedsnavnet fra adressen.
export function shortNameFor(d) {
  const a = d.address ?? {}
  const place = a.suburb || a.village || a.town || a.city || a.municipality || a.county || ''
  const parts = []
  if (d.name) parts.push(d.name)
  else if (a.road) parts.push(a.road)
  else if (a.postcode) parts.push(a.postcode)
  if (place && place !== parts[0]) parts.push(place)
  return parts.join(', ') || d.display_name.split(',').slice(0, 2).join(',')
}

// Normaliser ett Nominatim-treff til vårt interne format.
export function normalizeNominatim(d) {
  return {
    id: d.place_id,
    name: d.display_name,
    shortName: shortNameFor(d),
    type: d.type,
    importance: d.importance,
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    bbox: d.boundingbox?.map(parseFloat) ?? null,
  }
}

/**
 * Geokod et fritekst-søk til en liste normaliserte treff (viktigst først).
 * @param {string} query
 * @param {{countryCode?:string, limit?:number, signal?:AbortSignal,
 *          fetchImpl?:Function, endpoint?:string, userAgent?:string}} opts
 * @returns {Promise<Array<{id,name,shortName,type,importance,lat,lon,bbox}>>}
 */
export async function geocodePlace(query, opts = {}) {
  const { countryCode = 'no', limit = 8, signal, fetchImpl, endpoint = NOMINATIM, userAgent } = opts
  const q = (query ?? '').trim()
  if (q.length < 2) return []

  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') throw new Error('Ingen fetch tilgjengelig for geokoding')

  const params = new URLSearchParams({
    q, format: 'jsonv2', limit: String(limit), addressdetails: '1', countrycodes: countryCode,
  })
  const headers = { Accept: 'application/json' }
  if (userAgent) headers['User-Agent'] = userAgent

  const res = await doFetch(`${endpoint}?${params}`, { signal, headers })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data.map(normalizeNominatim) : []
}

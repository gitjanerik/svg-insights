// Nærmeste Wikipedia-sted for et vilkårlig punkt — geotaggede artikler om
// innsjøer, fjelltopper, grender, elver og stedsnavn.
//
// Mens `wikiSummary.js` slår opp et KJENT navn (et verneområde), svarer denne
// på det omvendte spørsmålet: «hvilken Wikipedia-artikkel ligger nærmest disse
// koordinatene?» Det gjør long-press hvor som helst på kartet nyttig, ikke bare
// inne i de grønne verneområdene.
//
// Vi bruker MediaWiki Action API-ets geosearch-generator i ÉN forespørsel som
// også henter ingress + koordinater + miniatyr (`prop=extracts|coordinates|
// pageimages|info`). CORS er aktivert for anonyme kall med `origin=*` — samme
// nett-profil som REST-summary-endepunktet vi alt bruker. Feiler/ingen treff →
// null, og kalleren viser ingen sted-seksjon.

import { WIKI_HOSTS } from './wikiSummary.js'

const SEARCH_RADIUS_M = 10000   // geosearch maks-radius (API-grense er 10 km)
const SEARCH_LIMIT = 10
const EXTRACT_MAX_CHARS = 280

// Haversine-avstand i meter mellom to WGS84-punkter.
export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// Kutt ingressen til en kort blurb ved en setnings-/ordgrense.
function trimExtract(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= EXTRACT_MAX_CHARS) return t
  const cut = t.slice(0, EXTRACT_MAX_CHARS)
  // Foretrekk siste setningsslutt, ellers siste mellomrom.
  const dot = cut.lastIndexOf('. ')
  if (dot > EXTRACT_MAX_CHARS * 0.5) return cut.slice(0, dot + 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > 0 ? cut.slice(0, sp) : cut).trim() + ' …'
}

/**
 * Plukk den nærmeste geotaggede artikkelen fra et Action API geosearch-svar
 * (formatversion=2 → `query.pages` er et array med `index` i avstands-rekkefølge).
 * Foretrekker nærmeste artikkel som faktisk har en ingress; faller tilbake til
 * nærmeste uansett. Returnerer null hvis ingen brukbar side finnes.
 *
 * @param {object} json   Action API-svar
 * @param {number} lat     oppslag-punktets bredde
 * @param {number} lon     oppslag-punktets lengde
 */
export function parseNearestPlace(json, lat, lon) {
  const pages = json?.query?.pages
  if (!Array.isArray(pages) || pages.length === 0) return null
  // Avstands-rekkefølge: generatoren setter `index` (1 = nærmest).
  const sorted = pages
    .filter((p) => p && p.title && !p.missing)
    .sort((a, b) => (a.index ?? 1e9) - (b.index ?? 1e9))
  if (sorted.length === 0) return null

  const toResult = (p) => {
    const coord = Array.isArray(p.coordinates) ? p.coordinates[0] : null
    const distanceM =
      coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lon)
        ? Math.round(haversineM(lat, lon, coord.lat, coord.lon))
        : null
    return {
      title: p.title,
      extract: trimExtract(p.extract),
      url: p.fullurl || p.canonicalurl || null,
      thumbnail: p.thumbnail?.source ?? null,
      lat: coord?.lat ?? null,
      lon: coord?.lon ?? null,
      distanceM,
    }
  }

  // Nærmeste med ingress, ellers bare nærmeste (lenken er fortsatt nyttig).
  const withExtract = sorted.find((p) => String(p.extract ?? '').trim())
  return toResult(withExtract ?? sorted[0])
}

function geosearchUrl(host, lat, lon) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'geosearch',
    ggscoord: `${lat}|${lon}`,
    ggsradius: String(SEARCH_RADIUS_M),
    ggslimit: String(SEARCH_LIMIT),
    ggsnamespace: '0',
    prop: 'extracts|coordinates|pageimages|info',
    exintro: '1',
    explaintext: '1',
    piprop: 'thumbnail',
    pithumbsize: '200',
    inprop: 'url',
    origin: '*',
  })
  return `${host}/w/api.php?${params}`
}

/**
 * Finn den nærmeste Wikipedia-artikkelen til et WGS84-punkt. Prøver norsk
 * Wikipedia først, så engelsk. Returnerer `{ title, extract, url, thumbnail,
 * lat, lon, distanceM }` eller null.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 */
export async function fetchNearestWikiPlace(lat, lon, opts = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const { signal, timeoutMs = 6000 } = opts

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) return null
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    for (const host of WIKI_HOSTS) {
      try {
        const res = await fetch(geosearchUrl(host, lat, lon), {
          signal: ctrl.signal,
          headers: { accept: 'application/json' },
        })
        if (!res.ok) continue
        const hit = parseNearestPlace(await res.json(), lat, lon)
        if (hit) return hit
      } catch (e) {
        if (ctrl.signal.aborted) return null
        // prøv neste språk
      }
    }
    return null
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

// GBIF Occurrence API — arts- og observasjons-telling innenfor et polygon.
//
// Når et verneområde er slått opp (verneFetcher.js gir polygon-ringene),
// teller vi biologisk mangfold innenfor det via GBIF — den åpne, CORS-vennlige
// globale biodiversitets-databasen som indekserer norske Artskart/GBIF-data.
//
//   antall observasjoner  = `count` fra et søk med limit=0
//   antall arter          = antall distinkte speciesKey (facet, kan cappes)
//
// Rødliste-telling er bevisst utelatt: GBIFs `iucnRedListCategory` er den
// GLOBALE IUCN-rødlista, ikke Artsdatabankens norske rødliste. For norske arter
// blir den skjevt nedover (truet i Norge ≠ truet globalt), så vi viser den ikke.
// En ekte norsk rødliste-kilde må til for å telle dette korrekt.
//
// GBIF krever gyldig, mot-klokka (CCW) WKT. Vi bygger fra den største ringen,
// orienterer CCW, og desimerer ned til en håndterbar punktmengde (GBIF avviser
// for komplekse polygoner). Feiler det detaljerte polygonet, faller vi tilbake
// til omsluttende bounding box.

const GBIF_BASE =
  import.meta.env?.VITE_GBIF_API_URL ?? 'https://api.gbif.org/v1'

const SPECIES_FACET_LIMIT = 500
const MAX_WKT_POINTS = 400

function signedArea(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return a / 2
}

// Behold hvert n-te punkt så ringen ikke overstiger MAX_WKT_POINTS, men behold
// alltid start/slutt. Enkel, robust desimering (ikke DP — vi trenger bare å
// holde oss under GBIF-grensen, ikke perfekt form).
function decimateRing(ring, maxPoints) {
  if (ring.length <= maxPoints) return ring
  const step = Math.ceil(ring.length / maxPoints)
  const out = []
  for (let i = 0; i < ring.length; i += step) out.push(ring[i])
  return out
}

/**
 * Bygg en GBIF-vennlig WKT POLYGON fra ringer ([[lon,lat],...]). Bruker den
 * største (første) ringen, desimerer, orienterer CCW og lukker ringen.
 */
export function ringsToWkt(rings, maxPoints = MAX_WKT_POINTS) {
  if (!Array.isArray(rings) || rings.length === 0) return null
  let ring = rings[0].filter((p) => Array.isArray(p) && p.length >= 2)
  if (ring.length < 3) return null
  ring = decimateRing(ring, maxPoints)
  // GBIF vil ha mot-klokka (CCW). Positivt signedArea = CCW her.
  if (signedArea(ring) < 0) ring = ring.slice().reverse()
  // Lukk ringen.
  const [fx, fy] = ring[0]
  const [lx, ly] = ring[ring.length - 1]
  if (fx !== lx || fy !== ly) ring = [...ring, [fx, fy]]
  const coords = ring.map(([lon, lat]) => `${lon} ${lat}`).join(', ')
  return `POLYGON((${coords}))`
}

/** Omsluttende bounding box som WKT (CCW) — fallback når polygonet avvises. */
export function ringsToBboxWkt(rings) {
  if (!Array.isArray(rings) || rings.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX)) return null
  return `POLYGON((${minX} ${minY}, ${maxX} ${minY}, ${maxX} ${maxY}, ${minX} ${maxY}, ${minX} ${minY}))`
}

/** Antall distinkte arter + om facet ble capet, fra en GBIF-respons. */
export function parseSpeciesFacet(json) {
  const facet = json?.facets?.find((f) => f.field === 'SPECIES_KEY' || f.field === 'speciesKey')
  const counts = facet?.counts ?? []
  return { speciesCount: counts.length, capped: counts.length >= SPECIES_FACET_LIMIT }
}

function gbifUrl(wkt) {
  return `${GBIF_BASE}/occurrence/search?geometry=${encodeURIComponent(wkt)}` +
    `&limit=0&facet=speciesKey&facetLimit=${SPECIES_FACET_LIMIT}&facetMincount=1`
}

async function gbifFetch(url, signal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`GBIF HTTP ${res.status}`)
  return res.json()
}

/**
 * Hent arts-/observasjons-sammendrag for et verneområde-polygon.
 *
 * @param {Array<Array<[number,number]>>} rings  [[lon,lat],...] (største først)
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<{
 *   observationCount: number, speciesCount: number, speciesCapped: boolean
 * } | null>}
 */
export async function fetchSpeciesSummary(rings, opts = {}) {
  const { signal, timeoutMs = 9000 } = opts
  const detailed = ringsToWkt(rings)
  if (!detailed) return null

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) return null
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const bbox = ringsToBboxWkt(rings)

  // Prøv detaljert polygon, fall tilbake til bounding box hvis GBIF avviser det
  // (for komplekst / ugyldig).
  const searchWithFallback = async () => {
    try {
      return await gbifFetch(gbifUrl(detailed), ctrl.signal)
    } catch (e) {
      if (ctrl.signal.aborted || !bbox) throw e
      return gbifFetch(gbifUrl(bbox), ctrl.signal)
    }
  }

  try {
    const all = await searchWithFallback()
    const allSp = parseSpeciesFacet(all)
    return {
      observationCount: Number(all?.count) || 0,
      speciesCount: allSp.speciesCount,
      speciesCapped: allSp.capped,
    }
  } catch (e) {
    if (signal?.aborted || ctrl.signal.aborted) return null
    console.warn(`[GBIF] Arts-oppslag feilet: ${e?.message ?? e}`)
    return null
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

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
 * Returnerer null hvis koordinatene ikke er lon/lat-grader (f.eks. projiserte
 * UTM-meter fra en WFS som ignorerte sr=4326) — da ville WKT-en vært ugyldig.
 */
export function ringsToWkt(rings, maxPoints = MAX_WKT_POINTS) {
  if (!Array.isArray(rings) || rings.length === 0) return null
  let ring = rings[0].filter((p) => Array.isArray(p) && p.length >= 2)
  if (ring.length < 3) return null
  if (!ring.every(inDegreeRange)) return null
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

// Koordinat ser ut som lon/lat-grader (ikke projiserte meter).
function inDegreeRange(p) {
  return Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90
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
  if (!inDegreeRange([minX, minY]) || !inDegreeRange([maxX, maxY])) return null
  return `POLYGON((${minX} ${minY}, ${maxX} ${minY}, ${maxX} ${maxY}, ${minX} ${maxY}, ${minX} ${minY}))`
}

/**
 * Bounding box rundt et klikk-punkt, dimensjonert etter verneområdets areal.
 * Robust fallback når Naturbase-polygonet mangler eller er projisert (UTM-meter):
 * klikk-punktet er alltid korrekte lon/lat-grader. Bokssiden ≈ √areal, klampet
 * til 0,6–10 km så vi verken bommer på små reservater eller henter halve fylket.
 */
export function pointBboxWkt(lat, lon, areaKm2) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const halfKm = Math.min(Math.max(Math.sqrt(Math.max(areaKm2 || 1, 0.25)) / 2, 0.3), 5)
  const dLat = halfKm / 111
  const dLon = halfKm / ((111 * Math.cos(lat * Math.PI / 180)) || 1)
  const s = lat - dLat, n = lat + dLat, w = lon - dLon, e = lon + dLon
  return `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`
}

/**
 * Antall distinkte arter, om facet ble capet, og selve nøkkel-lista fra en
 * GBIF-respons. `keys` er GBIF-backbone speciesKeys — samme nøkler som
 * checklist-`nubKey`, så de kan snittes direkte mot den norske rødliste-bundelen.
 */
export function parseSpeciesFacet(json) {
  const facet = json?.facets?.find((f) => f.field === 'SPECIES_KEY' || f.field === 'speciesKey')
  const counts = facet?.counts ?? []
  const keys = counts.map((c) => Number(c?.name)).filter(Number.isFinite)
  return { speciesCount: counts.length, capped: counts.length >= SPECIES_FACET_LIMIT, keys }
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
 * Bygg WKT-kandidater i prioritert rekkefølge: nøyaktig polygon → polygonets
 * bbox → punkt-bbox rundt klikket. De to første dropper seg selv hvis ringene er
 * projisert (UTM-meter); punkt-bboksen virker alltid (klikket er lon/lat).
 */
function candidateWkts({ rings, lat, lon, areaKm2 }) {
  return [ringsToWkt(rings), ringsToBboxWkt(rings), pointBboxWkt(lat, lon, areaKm2)]
    .filter(Boolean)
}

/**
 * Hent arts-/observasjons-sammendrag for et verneområde.
 *
 * @param {Array|{rings?:Array,lat?:number,lon?:number,areaKm2?:number}} geom
 *   Enten ring-array ([[lon,lat],…]) eller et objekt med ringer + klikk-punkt +
 *   areal (punktet brukes som robust fallback når polygonet er utilgjengelig).
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<{observationCount,speciesCount,speciesCapped,speciesKeys}|null>}
 */
export async function fetchSpeciesSummary(geom, opts = {}) {
  const { signal, timeoutMs = 9000 } = opts
  const arg = Array.isArray(geom) ? { rings: geom } : (geom || {})
  const wkts = candidateWkts(arg)
  if (wkts.length === 0) return null

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) return null
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    let all = null
    for (const wkt of wkts) {
      try { all = await gbifFetch(gbifUrl(wkt), ctrl.signal); break }
      catch (e) { if (ctrl.signal.aborted) throw e /* prøv neste kandidat */ }
    }
    if (!all) return null
    const allSp = parseSpeciesFacet(all)
    return {
      observationCount: Number(all?.count) || 0,
      speciesCount: allSp.speciesCount,
      speciesCapped: allSp.capped,
      speciesKeys: allSp.keys,
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

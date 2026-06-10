// NVE Innsjødatabase — autoritativ innsjøhøyde (vannflate moh) for et punkt.
//
// Bakgrunn: NHM_DTM er en bar-bakke-modell uten LiDAR-retur over vann, så
// innsjø-flater leses som ~0 m i DEM-en. Det ga «0 moh» på store innsjøer
// (Mjøsa ~123 m, Tyrifjorden ~63 m) — en falsk verdi. NVEs Innsjødatabase
// dekker 243 000+ norske innsjøer > 2,5 dekar og har den ekte vannflate-
// høyden (felt `hoyde`/`hoyde_moh`) + navn. Den er sannheten for innsjø-moh.
//
// API: ArcGIS REST `identify` mot Innsjodatabase2 MapServer. `identify` med
// `layers=all` trenger ikke lag-id-er og returnerer attributtene for det/de
// lag som treffer punktet — robust mot skjema-endringer. WMS finnes også på
// samme tjeneste (kart.nve.no/.../WMSServer), men REST gir ren JSON og
// trenger ikke lag-numre, så den foretrekkes.
//
// CORS/nett: som de andre eksterne kildene (Kartverket WCS, Sjøkart-WFS,
// N50) kan dette feile i enkelte nettlesere/nett. Da returnerer vi null og
// kalleren viser «ikke tilgjengelig» — aldri en oppdiktet høyde.

// ArcGIS REST MapServer-baser, prøves i rekkefølge (graceful fallback).
const NVE_INNSJO_ENDPOINTS = [
  'https://kart.nve.no/enterprise/rest/services/Innsjodatabase2/MapServer',
  'https://gis3.nve.no/map/rest/services/Innsjodatabase2/MapServer',
]

// Attributt-navn varierer mellom tjeneste-versjoner. Vi skanner attributt-
// objektet med disse mønstrene istedenfor å hardkode ett feltnavn.
const HOYDE_KEY_PATTERNS = [
  /^h[oø]yde?$/i,
  /h[oø]yde.*moh/i,
  /moh/i,
  /vatnhoyde/i,
  /innsj[oø].*h[oø]yde/i,
  /elevation/i,
  /masl/i,
]
const NAVN_KEY_PATTERNS = [
  /^navn$/i,
  /^name$/i,
  /vatn.*navn/i,
  /innsj[oø].*navn/i,
]

// Sentinel-verdier som betyr «ukjent» i NVE-datasettet — IKKE en ekte høyde.
const NODATA_VALUES = new Set([-9999, -999, -1])
// Norges høyeste punkt er 2469 m; en innsjø ligger godt under. Filtrer bort
// urealistiske verdier (feilparset tekst, ID-er feiltolket som høyde).
const MAX_PLAUSIBLE_LAKE_M = 2000

function parseHoyde(raw) {
  if (raw == null) return NaN
  // ArcGIS kan levere tall som string ("123,4" eller "123.4").
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').trim())
  if (!Number.isFinite(n)) return NaN
  if (NODATA_VALUES.has(n)) return NaN
  if (n < 0 || n > MAX_PLAUSIBLE_LAKE_M) return NaN
  return n
}

/**
 * Plukk ut innsjøhøyde (moh) + navn fra et ArcGIS-attributt-objekt.
 * @param {object} attrs
 * @returns {{ hoyde: number, navn: string|null } | null}
 */
export function extractLakeFromAttributes(attrs) {
  if (!attrs || typeof attrs !== 'object') return null
  const keys = Object.keys(attrs)

  let hoyde = NaN
  for (const pat of HOYDE_KEY_PATTERNS) {
    const k = keys.find(key => pat.test(key))
    if (k != null) {
      const v = parseHoyde(attrs[k])
      if (Number.isFinite(v)) { hoyde = v; break }
    }
  }
  if (!Number.isFinite(hoyde)) return null

  let navn = null
  for (const pat of NAVN_KEY_PATTERNS) {
    const k = keys.find(key => pat.test(key))
    if (k != null && attrs[k] != null) {
      const s = String(attrs[k]).trim()
      // ArcGIS bruker «Null»/«<Null>» for tomme strenger.
      if (s && !/^<?null>?$/i.test(s)) { navn = s; break }
    }
  }

  return { hoyde, navn }
}

/**
 * Velg det beste innsjø-treffet fra en ArcGIS `identify`-respons. Ved flere
 * treff (overlappende lag) velges det første med en gyldig høyde.
 * @param {{ results?: Array<{ attributes?: object }> }} json
 */
export function pickLakeFromIdentify(json) {
  const results = json?.results
  if (!Array.isArray(results)) return null
  for (const r of results) {
    const lake = extractLakeFromAttributes(r?.attributes)
    if (lake) return lake
  }
  return null
}

function buildIdentifyUrl(base, lat, lon) {
  // Liten map-extent rundt punktet (~±0.002° ≈ 220 m) med punktet i sentrum,
  // så identify-tolerans treffer innsjøen punktet ligger i.
  const d = 0.002
  const params = new URLSearchParams({
    f: 'json',
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    sr: '4326',
    layers: 'all',
    tolerance: '4',
    mapExtent: `${lon - d},${lat - d},${lon + d},${lat + d}`,
    imageDisplay: '400,400,96',
    returnGeometry: 'false',
  })
  return `${base}/identify?${params}`
}

/**
 * Hent innsjøhøyde (vannflate, moh) for et WGS84-punkt fra NVE Innsjødatabase.
 * Returnerer `{ hoyde, navn }` eller null (punktet er ikke i en registrert
 * innsjø, eller tjenesten er utilgjengelig — kalleren viser da «ikke
 * tilgjengelig», aldri en falsk 0).
 *
 * @param {number} lat
 * @param {number} lon
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<{ hoyde: number, navn: string|null } | null>}
 */
export async function fetchLakeElevation(lat, lon, opts = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const { signal, timeoutMs = 6000 } = opts

  for (const base of NVE_INNSJO_ENDPOINTS) {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    if (signal) {
      if (signal.aborted) return null
      signal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(buildIdentifyUrl(base, lat, lon), { signal: ctrl.signal })
      if (!res.ok) continue
      const json = await res.json()
      const lake = pickLakeFromIdentify(json)
      if (lake) return lake
      // Gyldig respons uten innsjø-treff → punktet er ikke i en NVE-innsjø.
      // Ikke prøv neste endpoint (det ville gitt samme svar) — returner null.
      return null
    } catch (e) {
      if (signal?.aborted) return null
      console.warn(`[NVE] Innsjø-oppslag mot ${base} feilet: ${e?.message ?? e}`)
      // prøv neste endpoint
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }
  return null
}

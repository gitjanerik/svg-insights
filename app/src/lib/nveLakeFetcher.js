// NVE Innsjødatabase — autoritative innsjø-data (vannflate moh, dyp, areal,
// volum, magasin-status) for et punkt.
//
// Bakgrunn: NHM_DTM er en bar-bakke-modell uten LiDAR-retur over vann, så
// innsjø-flater leses som ~0 m i DEM-en. Det ga «0 moh» på store innsjøer
// (Mjøsa ~123 m, Tyrifjorden ~63 m) — en falsk verdi. NVEs Innsjødatabase
// dekker 243 000+ norske innsjøer > 2,5 dekar og har den ekte vannflate-
// høyden + (for oppmålte innsjøer) dyp/volum/areal og regulerings-status.
//
// API: ArcGIS REST `identify` mot Innsjodatabase2 MapServer. `identify` med
// `layers=all` trenger ikke lag-id-er og returnerer attributtene for det/de
// lag som treffer punktet — robust mot skjema-endringer. Vi SLÅR SAMMEN felt
// på tvers av alle treff-lag (høyde og dyp kan ligge på ulike lag).
//
// CORS/nett: som de andre eksterne kildene (Kartverket WCS, Sjøkart-WFS,
// N50) kan dette feile i enkelte nettlesere/nett. Da returnerer vi null og
// kalleren viser «ikke tilgjengelig» — aldri en oppdiktet verdi. Felt som
// mangler (uoppmålt innsjø) utelates, så UI viser kun det NVE faktisk har.

// ArcGIS REST MapServer-baser, prøves i rekkefølge (graceful fallback).
const NVE_INNSJO_ENDPOINTS = [
  'https://kart.nve.no/enterprise/rest/services/Innsjodatabase2/MapServer',
  'https://gis3.nve.no/map/rest/services/Innsjodatabase2/MapServer',
]

// Sentinel-verdier som betyr «ukjent» i NVE-datasettet — IKKE en ekte verdi.
const NODATA_VALUES = new Set([-9999, -999, -1, 0])
// Norges høyeste punkt er 2469 m; en innsjø ligger godt under.
const MAX_PLAUSIBLE_LAKE_M = 2000
// Norges dypeste innsjø (Hornindalsvatnet) er 514 m. Litt slingringsmonn.
const MAX_PLAUSIBLE_DEPTH_M = 700

// Generisk tall-parse: ArcGIS kan levere tall som string ("123,4"/"123.4").
function toNumber(raw) {
  if (raw == null) return NaN
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').trim())
  return Number.isFinite(n) ? n : NaN
}

// Felt-spesifikasjoner: hvert felt skannes mot attributt-nøklene med
// mønstre (rekkefølge = prioritet), parses og valideres. Pattern-skann i
// stedet for hardkodede feltnavn → robust mot skjema-varianter på tvers av
// tjeneste-versjoner. MAX-mønstre listes før MIDDEL så «maksdyp» ikke
// feilaktig matcher et generelt dyp-mønster ment for middeldyp.
const NUMBER_FIELDS = [
  {
    key: 'hoyde',
    patterns: [/^h[oø]yde?$/i, /h[oø]yde.*moh/i, /vatnhoyde/i, /innsj[oø].*h[oø]yde/i, /elevation/i, /masl/i, /\bmoh\b/i],
    min: 0, max: MAX_PLAUSIBLE_LAKE_M,
  },
  {
    key: 'maxDybde',
    patterns: [/maks?.?dyp/i, /max.?dyp/i, /maks?.?djup/i, /max.?djup/i, /dyp.*max/i, /djup.*maks?/i],
    min: 0.1, max: MAX_PLAUSIBLE_DEPTH_M, exclusiveMin: true,
  },
  {
    key: 'midDybde',
    patterns: [/midd?el.?dyp/i, /mid.?djup/i, /middjup/i, /snitt.?dyp/i, /mean.?depth/i],
    min: 0.1, max: MAX_PLAUSIBLE_DEPTH_M, exclusiveMin: true,
  },
  {
    // areal: NVE bruker km². Hvis feltet er i m² (stor verdi) → konverter.
    key: 'arealKm2',
    patterns: [/areal.*km2/i, /area.*km2/i, /^areal/i, /^area/i, /flate.*areal/i],
    min: 0, max: 100000, exclusiveMin: true,
    transform: (n, key) => (/km2/i.test(key) ? n : n > 5000 ? n / 1e6 : n),
  },
  {
    // volum: NVE bruker mill. m³ (volum_mill_m3). Vi viser med samme enhet.
    key: 'volumMillM3',
    patterns: [/volum.*mill/i, /volume.*mill/i, /^volum/i, /^volume/i],
    min: 0, max: 1e9, exclusiveMin: true,
  },
  {
    // magasinNr > 0 markerer regulert vannkraftmagasin.
    key: 'magasinNr',
    patterns: [/magasin.?nr/i, /magnr/i, /^magasinnr$/i],
    min: 1, max: 1e9,
  },
  {
    key: 'vatnLnr',
    patterns: [/vatn.?lnr/i, /^vatnnr$/i, /innsj[oø].?nr/i, /^objnr$/i],
    min: 1, max: 1e12,
  },
]

const STRING_FIELDS = [
  { key: 'navn', patterns: [/^navn$/i, /^name$/i, /vatn.*navn/i, /innsj[oø].*navn/i, /^sjonavn$/i] },
  { key: 'magasinNavn', patterns: [/magasin.?navn/i, /magnavn/i] },
]

function isNullString(s) {
  return !s || /^<?null>?$/i.test(s)
}

// Skann ett attributt-objekt og returnér de feltene som finnes (rå, ufiltrert
// for «beste» — kalleren slår sammen på tvers av lag). Mangler et felt,
// utelates nøkkelen helt.
function scanAttributes(attrs) {
  const out = {}
  if (!attrs || typeof attrs !== 'object') return out
  const keys = Object.keys(attrs)

  for (const spec of NUMBER_FIELDS) {
    for (const pat of spec.patterns) {
      const k = keys.find(key => pat.test(key))
      if (k == null) continue
      let n = toNumber(attrs[k])
      if (!Number.isFinite(n) || NODATA_VALUES.has(n)) continue
      if (spec.transform) n = spec.transform(n, k)
      const okMin = spec.exclusiveMin ? n > spec.min : n >= spec.min
      if (!okMin || n > spec.max) continue
      out[spec.key] = n
      break
    }
  }
  for (const spec of STRING_FIELDS) {
    for (const pat of spec.patterns) {
      const k = keys.find(key => pat.test(key))
      if (k == null || attrs[k] == null) continue
      const s = String(attrs[k]).trim()
      if (isNullString(s)) continue
      out[spec.key] = s
      break
    }
  }
  return out
}

// Bygg det offentlige innsjø-objektet fra sammenslåtte felt. Krever en gyldig
// `hoyde` (anker som betyr «dette er en ekte innsjø-record»). Felt som mangler
// utelates, og `navn` normaliseres til null (bakoverkompatibelt).
function buildLake(f) {
  if (!Number.isFinite(f.hoyde)) return null
  const lake = { hoyde: f.hoyde, navn: f.navn ?? null }
  if (Number.isFinite(f.maxDybde)) lake.maxDybde = f.maxDybde
  if (Number.isFinite(f.midDybde)) lake.midDybde = f.midDybde
  if (Number.isFinite(f.arealKm2)) lake.arealKm2 = f.arealKm2
  if (Number.isFinite(f.volumMillM3)) lake.volumMillM3 = f.volumMillM3
  if (Number.isFinite(f.magasinNr)) {
    lake.magasin = { nr: f.magasinNr, navn: f.magasinNavn ?? null }
  }
  if (Number.isFinite(f.vatnLnr)) lake.vatnLnr = f.vatnLnr
  return lake
}

/**
 * Plukk ut innsjø-data fra ett ArcGIS-attributt-objekt. Returnerer null hvis
 * objektet ikke har en gyldig høyde.
 * @param {object} attrs
 * @returns {{ hoyde: number, navn: string|null, maxDybde?: number,
 *   midDybde?: number, arealKm2?: number, volumMillM3?: number,
 *   magasin?: { nr: number, navn: string|null }, vatnLnr?: number } | null}
 */
export function extractLakeFromAttributes(attrs) {
  return buildLake(scanAttributes(attrs))
}

/**
 * Slå sammen innsjø-data fra en ArcGIS `identify`-respons. Felt fra ALLE
 * treff-lag merges (første gyldige verdi pr felt vinner) — høyde og dyp kan
 * ligge på ulike lag i Innsjodatabase2. Krever minst én gyldig høyde.
 * @param {{ results?: Array<{ attributes?: object }> }} json
 */
export function pickLakeFromIdentify(json) {
  const results = json?.results
  if (!Array.isArray(results)) return null
  const merged = {}
  for (const r of results) {
    const f = scanAttributes(r?.attributes)
    for (const k of Object.keys(f)) {
      if (merged[k] == null) merged[k] = f[k]
    }
  }
  return buildLake(merged)
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
 * Hent innsjø-data for et WGS84-punkt fra NVE Innsjødatabase. Returnerer et
 * innsjø-objekt (minst `{ hoyde, navn }`, evt. dyp/areal/volum/magasin) eller
 * null (punktet er ikke i en registrert innsjø, eller tjenesten er
 * utilgjengelig — kalleren viser da «ikke tilgjengelig», aldri en falsk 0).
 *
 * @param {number} lat
 * @param {number} lon
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<object | null>}
 */
export async function fetchLakeData(lat, lon, opts = {}) {
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

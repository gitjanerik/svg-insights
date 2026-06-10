// Naturbase verneområder — autoritativ metadata for et punkt fra
// Miljødirektoratet «vern»-tjenesten.
//
// Kartet tegner allerede verneområder (ISOM 520, grønn overlay) fra OSM, men
// OSM har ikke den offisielle forvaltnings-metadataen. Miljødirektoratets
// Naturbase ER kilden: navn, verneform, vernedato, areal, forvaltning, og en
// faktaark-ID. Vi slår opp punktet via ArcGIS REST `identify` — nøyaktig samme
// mønster som NVE-innsjøfetcheren (`nveLakeFetcher.js`).
//
// `returnGeometry: true` gir polygon-ringene (i WGS84 når sr=4326), som brukes
// videre som WKT mot GBIF for arts-/observasjons-telling.
//
// CORS/nett: som de andre eksterne kildene kan dette feile i enkelte
// nettlesere. Da returnerer vi null og kalleren viser ingen verne-seksjon —
// aldri en oppdiktet verdi.

// ArcGIS REST MapServer-base. Override mulig via miljøvariabel.
const VERN_ENDPOINT =
  import.meta.env?.VITE_NATURBASE_VERN_URL ??
  'https://kart.miljodirektoratet.no/arcgis/rest/services/vern/MapServer'

// Faktaark-base (offentlig). Bygges som `${FAKTAARK_BASE}?id=<ID>`.
const FAKTAARK_BASE =
  import.meta.env?.VITE_NATURBASE_FAKTAARK_URL ??
  'https://faktaark.naturbase.no/'

const NODATA_STRINGS = /^(<?null>?|na|n\/a|-|ukjent|0)$/i

function isNullString(s) {
  return !s || NODATA_STRINGS.test(String(s).trim())
}

function firstMatch(keys, attrs, patterns) {
  for (const pat of patterns) {
    const k = keys.find((key) => pat.test(key))
    if (k != null && attrs[k] != null) {
      const s = String(attrs[k]).trim()
      if (!isNullString(s)) return s
    }
  }
  return null
}

// Vernedato kommer enten som epoch-ms (ArcGIS date-felt) eller en dato-streng.
// Returnér ISO-dato (YYYY-MM-DD) når mulig, ellers råverdien.
export function parseVernedato(raw) {
  if (raw == null) return null
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 1e11) {
    return new Date(raw).toISOString().slice(0, 10)
  }
  const s = String(raw).trim()
  if (isNullString(s)) return null
  // Rene epoch-ms-strenger.
  if (/^\d{12,}$/.test(s)) return new Date(Number(s)).toISOString().slice(0, 10)
  // ISO eller dd.mm.yyyy — behold som dato-del.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  const dmy = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/)
  if (dmy) {
    const [, d, m, y] = dmy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return s
}

// Areal: Naturbase oppgir typisk dekar (daa). 1 daa = 0.001 km². Shape__Area
// er i m² (UTM) → 1e6 m² = 1 km². Velg fornuftig konvertering ut fra feltnavn
// og størrelsesorden.
function parseAreal(keys, attrs) {
  // Dekar-felt først (mest presist fra Naturbase).
  for (const pat of [/areal.*da[a]?/i, /\bdaa\b/i, /\bdekar\b/i]) {
    const k = keys.find((key) => pat.test(key))
    if (k != null) {
      const n = Number(String(attrs[k]).replace(',', '.'))
      if (Number.isFinite(n) && n > 0) return n / 1000 // daa → km²
    }
  }
  // m²-felt (Shape__Area / areal_m2).
  for (const pat of [/shape.?_?area/i, /areal.?m2/i, /area.?m2/i]) {
    const k = keys.find((key) => pat.test(key))
    if (k != null) {
      const n = Number(String(attrs[k]).replace(',', '.'))
      if (Number.isFinite(n) && n > 0) return n / 1e6 // m² → km²
    }
  }
  // Generisk «areal» — gjett enhet på størrelsesorden.
  for (const pat of [/^areal/i, /^area$/i]) {
    const k = keys.find((key) => pat.test(key))
    if (k != null) {
      const n = Number(String(attrs[k]).replace(',', '.'))
      if (Number.isFinite(n) && n > 0) return n > 1e5 ? n / 1e6 : n / 1000
    }
  }
  return null
}

/**
 * Plukk verneområde-metadata fra ett ArcGIS-attributt-objekt.
 * Returnerer null hvis det ikke finnes et navn (anker på en ekte record).
 */
export function extractAreaFromAttributes(attrs) {
  if (!attrs || typeof attrs !== 'object') return null
  const keys = Object.keys(attrs)

  const navn = firstMatch(keys, attrs, [
    /^navn$/i, /^omr[åa]denavn$/i, /verneomr.*navn/i, /^name$/i, /^offnavn$/i,
  ])
  if (!navn) return null

  const verneform = firstMatch(keys, attrs, [
    /verneform/i, /vernekategori/i, /vernetype/i, /^kategori$/i,
  ])
  const vernedatoRaw = firstMatch(keys, attrs, [
    /vernedato/i, /verndato/i, /ikrafttr/i, /etablert/i, /^dato$/i,
  ])
  const forvaltning = firstMatch(keys, attrs, [
    /forvaltningsmyndighet/i, /forvaltning/i, /^forvalt/i, /myndighet/i,
  ])

  // Faktaark: enten en ferdig URL, eller en ID vi bygger URL fra.
  let faktaarkUrl = firstMatch(keys, attrs, [/faktaark/i])
  const id = firstMatch(keys, attrs, [
    /^vid$/i, /^omr[åa]deid$/i, /naturbaseid/i, /^vernid$/i, /^vernr$/i,
  ])
  if (faktaarkUrl && !/^https?:\/\//i.test(faktaarkUrl)) {
    // Et bart ID-felt feilaktig matchet «faktaark» — bygg URL.
    faktaarkUrl = `${FAKTAARK_BASE}?id=${encodeURIComponent(faktaarkUrl)}`
  }
  if (!faktaarkUrl && id) {
    faktaarkUrl = `${FAKTAARK_BASE}?id=${encodeURIComponent(id)}`
  }

  return {
    id: id ?? navn,
    navn,
    verneform: verneform ?? null,
    vernedato: parseVernedato(vernedatoRaw),
    arealKm2: parseAreal(keys, attrs),
    forvaltning: forvaltning ?? null,
    faktaarkUrl: faktaarkUrl ?? null,
  }
}

// ArcGIS esriGeometryPolygon → ringer som [[lon,lat],...]. Med sr=4326 kommer
// koordinatene allerede i WGS84. Returnerer den største ringen først.
function extractRings(geometry) {
  const rings = geometry?.rings
  if (!Array.isArray(rings) || rings.length === 0) return null
  const cleaned = rings
    .filter((r) => Array.isArray(r) && r.length >= 4)
    .map((r) => r.map(([x, y]) => [x, y]))
  if (cleaned.length === 0) return null
  cleaned.sort((a, b) => ringAreaAbs(b) - ringAreaAbs(a))
  return cleaned
}

function ringAreaAbs(ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return Math.abs(a) / 2
}

/**
 * Velg verneområdet et punkt ligger i fra en ArcGIS `identify`-respons.
 * Tar det første treffet med gyldig navn, og fester geometrien (ringer) på.
 */
export function pickAreaFromIdentify(json) {
  const results = json?.results
  if (!Array.isArray(results)) return null
  for (const r of results) {
    const area = extractAreaFromAttributes(r?.attributes)
    if (area) {
      const rings = extractRings(r?.geometry)
      if (rings) area.rings = rings
      return area
    }
  }
  return null
}

function buildIdentifyUrl(base, lat, lon) {
  // Liten map-extent rundt punktet (~±0.002° ≈ 220 m) med punktet i sentrum.
  const d = 0.002
  const params = new URLSearchParams({
    f: 'json',
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    sr: '4326',
    layers: 'all',
    tolerance: '2',
    mapExtent: `${lon - d},${lat - d},${lon + d},${lat + d}`,
    imageDisplay: '400,400,96',
    returnGeometry: 'true',
    geometryPrecision: '6',
  })
  return `${base}/identify?${params}`
}

/**
 * Hent verneområde-data for et WGS84-punkt fra Naturbase (Miljødirektoratet).
 * Returnerer et område-objekt eller null (punktet er ikke i et verneområde,
 * eller tjenesten er utilgjengelig).
 *
 * @param {number} lat
 * @param {number} lon
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<object | null>}
 */
export async function fetchProtectedArea(lat, lon, opts = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const { signal, timeoutMs = 7000 } = opts

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) return null
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(buildIdentifyUrl(VERN_ENDPOINT, lat, lon), { signal: ctrl.signal })
    if (!res.ok) return null
    const json = await res.json()
    return pickAreaFromIdentify(json)
  } catch (e) {
    if (signal?.aborted) return null
    console.warn(`[Naturbase] Verneområde-oppslag feilet: ${e?.message ?? e}`)
    return null
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

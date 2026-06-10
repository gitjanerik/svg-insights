// NiN-naturtyper — kartlagte naturtype-lokaliteter for et punkt fra
// Miljødirektoratets «Naturtyper på land (NiN)»-tjeneste.
//
// Samme ArcGIS REST `identify`-mønster som verneFetcher.js / nveLakeFetcher.js.
// Et punkt kan ligge i flere overlappende naturtype-lokaliteter, så vi henter
// en liste (de fremste treffene), ikke ett enkelt objekt.
//
// Felter (varierer noe mellom sublag): Naturtype, Utforming, Verdi, Tilstand,
// områdenavn/lokalitet. Vi skanner attributtene robust med regex-mønstre.
//
// Ingen faktaark-lenke: URL-formatet for naturtype-lokaliteter i Naturbase er
// ikke verifisert herfra, og en sannsynlig-død lenke er verre enn ingen.
//
// CORS/nett: kan feile i enkelte nettlesere → returnerer null, og kalleren
// viser ingen naturtype-seksjon (aldri en oppdiktet verdi).

const NATURTYPE_ENDPOINT =
  import.meta.env?.VITE_NATURBASE_NATURTYPE_URL ??
  'https://kart.miljodirektoratet.no/arcgis/rest/services/naturtyper_nin/MapServer'

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

/**
 * Plukk én naturtype-lokalitet fra ett ArcGIS-attributt-objekt.
 * Returnerer null hvis det ikke finnes et naturtype-navn (ankerfelt).
 */
export function extractNaturtypeFromAttributes(attrs) {
  if (!attrs || typeof attrs !== 'object') return null
  const keys = Object.keys(attrs)

  const naturtype = firstMatch(keys, attrs, [
    /^naturtype$/i, /naturtypenavn/i, /^ntype/i, /hovedtype/i, /^natur_?type/i,
  ])
  if (!naturtype) return null

  const utforming = firstMatch(keys, attrs, [/utforming/i, /grunntype/i])
  const verdi = firstMatch(keys, attrs, [
    /lokalitetsverdi/i, /naturtypeverdi/i, /^verdi$/i, /kvalitet/i,
  ])
  const tilstand = firstMatch(keys, attrs, [/tilstand/i])
  const navn = firstMatch(keys, attrs, [
    /omr[åa]denavn/i, /lokalitetsnavn/i, /^lokalitet$/i, /^navn$/i,
  ])
  const id = firstMatch(keys, attrs, [
    /naturtypeid/i, /lokalitetsid/i, /^lokid$/i, /^id$/i, /globalid/i,
  ])

  return {
    id: id ?? `${naturtype}|${utforming ?? ''}`,
    naturtype,
    utforming: utforming ?? null,
    verdi: verdi ?? null,
    tilstand: tilstand ?? null,
    navn: navn ?? null,
  }
}

/**
 * Samle naturtype-lokaliteter fra en ArcGIS `identify`-respons. Dedupliserer på
 * id og begrenser til `max` treff (et punkt kan ligge i flere lokaliteter).
 */
export function pickNaturtypesFromIdentify(json, max = 4) {
  const results = json?.results
  if (!Array.isArray(results)) return []
  const out = []
  const seen = new Set()
  for (const r of results) {
    const nt = extractNaturtypeFromAttributes(r?.attributes)
    if (!nt) continue
    if (seen.has(nt.id)) continue
    seen.add(nt.id)
    out.push(nt)
    if (out.length >= max) break
  }
  return out
}

function buildIdentifyUrl(base, lat, lon) {
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
    returnGeometry: 'false',
  })
  return `${base}/identify?${params}`
}

/**
 * Hent NiN-naturtype-lokaliteter for et WGS84-punkt. Returnerer en (mulig tom)
 * liste, eller null når tjenesten er utilgjengelig (skill mellom «ingen treff»
 * og «kunne ikke spørre» — kalleren viser kun seksjonen ved faktiske treff).
 *
 * @param {number} lat
 * @param {number} lon
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<Array<object> | null>}
 */
export async function fetchNaturtypes(lat, lon, opts = {}) {
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
    const res = await fetch(buildIdentifyUrl(NATURTYPE_ENDPOINT, lat, lon), { signal: ctrl.signal })
    if (!res.ok) return null
    const json = await res.json()
    return pickNaturtypesFromIdentify(json)
  } catch (e) {
    if (signal?.aborted) return null
    console.warn(`[Naturbase] Naturtype-oppslag feilet: ${e?.message ?? e}`)
    return null
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

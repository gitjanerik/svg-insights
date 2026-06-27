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

// ── Innsjø-POLYGONER for et bbox (autoritativ innlands-vannkilde) ────────
//
// N50 Innsjø-WFS er den «riktige» innlands-vannkilden, men den feiler ofte
// CORS klient-side (returnerer 0 features på mobil) — da faller kart-pipelinen
// tilbake til rå OSM `natural=water`, og store norske innsjøer (Røssvatnet,
// Namsvatnet, Limingen) er der ofte mistagget/feil-assemblet slik at vannet
// flommer ut over land. NVEs ArcGIS-tjeneste er derimot CORS-vennlig (samme
// tjeneste som punkt-oppslaget over bruker), så vi henter innsjø-FLATENE
// derfra og bruker dem i stedet. Geometrien kommer fra `identify` med en
// envelope-geometri + `returnGeometry=true` — ingen hardkodet lag-id (robust
// mot skjema-endringer, samme filosofi som punkt-oppslaget).

// Shoelace signed area for en [lon,lat]-ring. Positiv = mot klokka (CCW).
// Esri-konvensjon: ytre ringer er MED klokka (CW → negativ), hull er CCW.
function ringSignedArea(ring) {
  let a = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

// Konverter én Esri-polygon-geometri (`{ rings: [...] }`) til et OSM-aktig
// multipolygon-`relation` med outer/inner-ringer. Rendring i buildSvg bruker
// `fill-rule="evenodd"` på outer+inner samlet, så hull (øyer i innsjøen)
// virker uavhengig av eksakt ring-paring.
export function esriPolygonToRelation(geom, attrs, idBase) {
  const rings = geom?.rings
  if (!Array.isArray(rings) || rings.length === 0) return null
  const members = []
  let anyOuter = false
  for (const r of rings) {
    // Esri-ringer er lukket (første == siste) → minst 4 punkter for et triangel.
    if (!Array.isArray(r) || r.length < 4) continue
    const role = ringSignedArea(r) < 0 ? 'outer' : 'inner'
    if (role === 'outer') anyOuter = true
    members.push({
      type: 'way',
      role,
      geometry: r.map(([lon, lat]) => ({ lat, lon })),
    })
  }
  if (members.length === 0) return null
  // Fant ingen CW-ring (uventet orientering) → behandle alle som outer.
  // evenodd-fyllingen gjengir uansett hull korrekt.
  if (!anyOuter) for (const m of members) m.role = 'outer'

  const navn = scanAttributes(attrs ?? {}).navn ?? null
  const tags = { natural: 'water' }
  if (navn) tags.name = navn
  return { type: 'relation', id: `nve-${idBase}`, members, tags, _source: 'nve' }
}

// Form-deskriptor for et sett Esri-ringer: areal-vektet sentroid + samlet
// (absolutt) areal i lon/lat-rom. Brukes til å dedup-e samme innsjø som
// identify returnerer fra FLERE lag. Sentroid og areal er INTEGRALER over
// flaten — de er nær uendret når generaliseringen varierer mellom lagene
// (ulikt punkttall, flyttede ekstrempunkter). En tidligere bbox-signatur
// (min/maks-hjørner kvantisert til ~11 m) bommet når et lag flyttet et
// ekstrempunkt over en kvantiserings-grense → samme innsjø fikk to ulike
// nøkler, dedup-en bommet, og buildSvgs evenodd-merge kansellerte fyllet.
function shapeDescriptor(rings) {
  let totNumX = 0, totNumY = 0, totA = 0, absArea = 0
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) continue
    let a = 0, nx = 0, ny = 0
    for (let i = 0, n = ring.length; i < n; i++) {
      const [x1, y1] = ring[i]
      const [x2, y2] = ring[(i + 1) % n]
      const cross = x1 * y2 - x2 * y1
      a += cross
      nx += (x1 + x2) * cross
      ny += (y1 + y2) * cross
    }
    a /= 2
    totA += a
    totNumX += nx
    totNumY += ny
    absArea += Math.abs(a)
  }
  if (totA === 0 || absArea === 0 || !Number.isFinite(totNumX)) return null
  return { cx: totNumX / (6 * totA), cy: totNumY / (6 * totA), area: absArea }
}

// To form-deskriptorer beskriver samme innsjø hvis sentroidene ligger nær
// hverandre (i meter) OG arealene er nær like. Tåler per-lag-generalisering.
function sameShape(a, b, tolM = 30) {
  if (!a || !b) return false
  const big = Math.max(a.area, b.area)
  if (big <= 0 || Math.min(a.area, b.area) / big < 0.8) return false
  const midLat = (a.cy + b.cy) / 2
  const dLatM = (a.cy - b.cy) * 111320
  const dLonM = (a.cx - b.cx) * 111320 * Math.cos(midLat * Math.PI / 180)
  return Math.hypot(dLatM, dLonM) <= tolM
}

/**
 * Parse en ArcGIS `identify`-respons til OSM-aktige vann-`relation`-elementer.
 * Kun resultater med polygon-geometri (`geometry.rings`) beholdes — dybde-
 * konturer (linjer) og dybdepunkt (punkt) faller bort. Alle lag i
 * Innsjodatabase2 er innsjø-relaterte (Innsjø-flate + Magasin), så polygon-
 * filteret alene gir vann-flater.
 *
 * DEDUP (kritisk): identify med `layers: 'all'` returnerer SAMME innsjø fra
 * flere polygon-lag (høyde og dyp ligger på ulike lag — se pickLakeFromIdentify).
 * Uten dedup ble hver innsjø emittert 2+ ganger med overlappende geometri. I
 * buildSvg slås NAVNLØSE vann-polygoner med samme stil sammen til ÉN
 * `fill-rule="evenodd"`-path per rute — to sammenfallende ringer kansellerer
 * da fyllet (evenodd: vikletall 2 = partall = ikke fylt), så små unavngitte
 * tjern endte som blå OMRISS uten blått fyll, mens navngitte innsjøer (rendret
 * som egne standalone-paths) fylte korrekt. Vi dedup-er på vatnLnr når den
 * finnes, ellers på areal-vektet sentroid + areal (stabilt under per-lag-
 * generalisering, i motsetning til bbox-hjørner), og løfter inn et navn fra
 * et duplikat-lag.
 * @param {{ results?: Array<{ geometry?: object, attributes?: object }> }} json
 * @returns {Array} OSM-aktige relation-elementer
 */
export function nveIdentifyToWater(json) {
  const results = json?.results
  if (!Array.isArray(results)) return []
  const out = []
  const kept = []   // { desc, lnr, el }
  let i = 0
  for (const r of results) {
    if (!r?.geometry?.rings) continue
    const f = scanAttributes(r.attributes ?? {})
    const lnr = Number.isFinite(f.vatnLnr) ? f.vatnLnr : null
    const desc = shapeDescriptor(r.geometry.rings)
    if (!desc) continue
    // Finn et allerede beholdt duplikat: samme vatnLnr, ellers samme form.
    let dup = null
    for (const k of kept) {
      if ((lnr != null && k.lnr === lnr) || sameShape(desc, k.desc)) { dup = k; break }
    }
    if (dup) {
      // Behold den første, men ta vare på et navn fra et senere duplikat-lag,
      // og lås vatnLnr på den beholdte hvis vi nettopp lærte den.
      if (!dup.el.tags.name && f.navn) dup.el.tags.name = f.navn
      if (lnr != null && dup.lnr == null) dup.lnr = lnr
      continue
    }
    const el = esriPolygonToRelation(r.geometry, r.attributes, String(i++))
    if (!el) continue
    kept.push({ desc, lnr, el })
    out.push(el)
  }
  return out
}

function buildIdentifyBboxUrl(base, bbox) {
  const { south, west, north, east } = bbox
  const env = `${west},${south},${east},${north}`
  const params = new URLSearchParams({
    f: 'json',
    geometry: env,
    geometryType: 'esriGeometryEnvelope',
    sr: '4326',                  // gjelder både input- og output-geometri i identify
    layers: 'all',
    tolerance: '2',
    mapExtent: env,
    imageDisplay: '800,800,96',
    returnGeometry: 'true',
    // Generaliser geometrien (~9 m ved 60° N) — vi DP-forenkler uansett i
    // buildSvg, og dette holder payload-en nede for store innsjøer.
    maxAllowableOffset: '0.00008',
  })
  return `${base}/identify?${params}`
}

/**
 * Hent innsjø-FLATER (polygoner) for et WGS84-bbox fra NVE Innsjødatabase.
 * Returnerer OSM-aktige `natural=water`-relations (klare for buildSvg) eller
 * en tom array (ingen innsjøer i bbox, eller tjenesten utilgjengelig). Feiler
 * aldri hardt — verste fall er dagens oppførsel (ingen NVE-vann → OSM-fallback).
 *
 * @param {{south:number,west:number,north:number,east:number}} bbox  WGS84
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<Array>}
 */
export async function fetchNveLakePolygons(bbox, opts = {}) {
  if (!bbox || ![bbox.south, bbox.west, bbox.north, bbox.east].every(Number.isFinite)) return []
  const { signal, timeoutMs = 8000 } = opts

  for (const base of NVE_INNSJO_ENDPOINTS) {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    if (signal) {
      if (signal.aborted) return []
      signal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(buildIdentifyBboxUrl(base, bbox), { signal: ctrl.signal })
      if (!res.ok) continue
      const json = await res.json()
      const els = nveIdentifyToWater(json)
      // Gyldig respons (også tom) → svaret er autoritativt for dette endpoint-et;
      // ikke prøv neste (ville gitt samme svar).
      return els
    } catch (e) {
      if (signal?.aborted) return []
      console.warn(`[NVE] Innsjø-polygon-oppslag mot ${base} feilet: ${e?.message ?? e}`)
      // prøv neste endpoint
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }
  return []
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

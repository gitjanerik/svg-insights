// Kartverket Sjøkart WFS-fetcher.
//
// Henter dybdedata, kystkonturer og navigasjonssymboler fra Kartverkets
// "Sjøkart-Dybdedata"-tjeneste. Brukes som fallback for OSM/N50 i
// kyst-områder der `Havflate` (N50) eller `natural=water` (OSM) mangler.
//
// To-trinns-fallback-strategi:
//
//   1. N50 Havflate (autoritativ for sjø, men har huller i åpne kyst-soner)
//   2. Sjøkart Dybdeareal (autoritativ for sjø-utstrekning, finnes alltid
//      der det er fartøys-trafikk-relevant dyp)
//   3. OSM `natural=water` (siste fallback)
//
// Tjenesten følger samme WFS 2.0.0-mønster som N50 (XML eller GeoJSON
// output, BBOX i EPSG:4326). Vi prøver flere kandidat-typenames siden
// navngivningen varierer mellom datasett-versjoner; getCapabilities-probe
// gjøres ikke (rundtur per kart-bygg er for treig — vi prøver direkte og
// fanger 400 graceful).
//
// Kjente endepunkter (probet fra Geonorge-katalog):
//   https://wfs.geonorge.no/skwms1/wfs.sjokart_dybdedata
//   https://wfs.geonorge.no/skwms1/wfs.dybdedata2          (nyere coverage)
//
// Vi prøver primær først, faller tilbake til alternativ ved feil.

const SJOKART_ENDPOINTS = [
  'https://wfs.geonorge.no/skwms1/wfs.sjokart_dybdedata',
  'https://wfs.geonorge.no/skwms1/wfs.dybdedata2',
  'https://wfs.geonorge.no/skwms1/wfs.dybdedata',
  'https://wfs.geonorge.no/skwms1/wfs.sjokartraster_navlys',
]

// Kandidat-typenames per kategori. WFS-tjenesten har vekslende prefiks
// (app:, dybdedata:, ingen). Vi prøver alle varianter og samler resultater.
const TYPENAME_CANDIDATES = {
  // Kystkontur — linjen mellom land og sjø ved middel-vannstand.
  // Brukes til å verifisere at vi har sjø-data i bbox.
  kystkontur: [
    'app:Kystkontur',
    'dybdedata:Kystkontur',
    'app:KystkonturL',
  ],
  // Dybdeareal — polygoner mellom dybdekonturene. Det er disse vi
  // hovedsakelig vil ha; én polygon dekker "hele sjøen 0-2 m dyp" osv,
  // og union av dem gir total sjø-utstrekning.
  dybdeareal: [
    'app:Dybdeareal',
    'dybdedata:Dybdeareal',
    'app:DybdearealF',
  ],
  // Dybdekontur — linjer for hver dybde-isobath.
  dybdekontur: [
    'app:Dybdekontur',
    'dybdedata:Dybdekontur',
    'app:DybdekonturL',
  ],
  // Skjær / grunner / stein over vann
  grunne: [
    'app:Grunne',
    'app:Skjer',
    'app:UndervannSkjer',
    'dybdedata:Grunne',
  ],
  // Lanterner / fyr / nav-merker
  lanterne: [
    'app:Lanterne',
    'app:Lykt',
    'app:Fyr',
    'dybdedata:Lanterne',
  ],
  // Soundings — punkter med dybde-tall
  dybdepunkt: [
    'app:Dybdepunkt',
    'dybdedata:Dybdepunkt',
  ],
}

/**
 * Hent sjøkart-data for et bbox. Returnerer feature-grupper klare for
 * mapBuilder. Alle feiler graceful — manglende kategori gir tom array,
 * ikke exception.
 *
 * @param {{south,west,north,east}} bbox  WGS84
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{
 *   kystkontur: Array,
 *   dybdeareal: Array,
 *   dybdekontur: Array,
 *   grunne: Array,
 *   lanterne: Array,
 *   dybdepunkt: Array,
 *   source: string|null,
 * }>}
 */
export async function fetchSjokart(bbox, opts = {}) {
  console.log(`[Sjøkart] Prøver ${SJOKART_ENDPOINTS.length} endepunkter for bbox ${bbox.south.toFixed(3)},${bbox.west.toFixed(3)} → ${bbox.north.toFixed(3)},${bbox.east.toFixed(3)}`)
  for (const endpoint of SJOKART_ENDPOINTS) {
    try {
      const result = await fetchAllCategories(endpoint, bbox, opts)
      const totals = Object.values(result).reduce(
        (a, v) => a + (Array.isArray(v) ? v.length : 0), 0
      )
      if (totals > 0) {
        console.log(`[Sjøkart] ${endpoint} → ${totals} features totalt`)
        return { ...result, source: endpoint }
      } else {
        console.log(`[Sjøkart] ${endpoint} svarte men 0 features (kan være feil typenames eller utenfor dekning)`)
      }
    } catch (e) {
      console.warn(`[Sjøkart] ${endpoint} feilet: ${e.message}`)
    }
  }
  console.warn('[Sjøkart] Ingen endepunkter ga data — kart vil falle tilbake til OSM coastline-rekonstruksjon')
  return emptyResult()
}

function emptyResult() {
  return {
    kystkontur: [], dybdeareal: [], dybdekontur: [],
    grunne: [], lanterne: [], dybdepunkt: [],
    source: null,
  }
}

async function fetchAllCategories(endpoint, bbox, opts) {
  const out = emptyResult()
  delete out.source
  const tasks = []
  for (const [cat, candidates] of Object.entries(TYPENAME_CANDIDATES)) {
    tasks.push(
      fetchFirstWorkingTypename(endpoint, candidates, bbox, opts)
        .then(features => { out[cat] = features })
        .catch(() => { out[cat] = [] })
    )
  }
  await Promise.allSettled(tasks)
  return out
}

async function fetchFirstWorkingTypename(endpoint, candidates, bbox, opts) {
  for (const typeName of candidates) {
    try {
      const features = await fetchTypeName(endpoint, typeName, bbox, opts)
      if (features.length > 0) return features
    } catch (e) {
      // Prøv neste kandidat
    }
  }
  return []
}

async function fetchTypeName(endpoint, typeName, bbox, opts = {}) {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: typeName,
    SRSNAME: 'EPSG:4326',
    BBOX: `${bbox.south},${bbox.west},${bbox.north},${bbox.east},EPSG:4326`,
    OUTPUTFORMAT: 'application/json',
    COUNT: '5000',
  })
  const url = `${endpoint}?${params}`
  let res
  try {
    res = await fetch(url, { signal: opts.signal })
  } catch (e) {
    // Network/CORS-feil — logg eksplisitt så det er synlig i DevTools
    console.warn(`[Sjøkart] Network/CORS-feil for ${typeName} på ${endpoint}: ${e.message}`)
    throw e
  }
  if (!res.ok) {
    console.warn(`[Sjøkart] HTTP ${res.status} for ${typeName} på ${endpoint}`)
    throw new Error(`HTTP ${res.status} for ${typeName}`)
  }
  const text = await res.text()
  // Geonorge-tjenester returnerer av og til GML når GeoJSON ikke støttes,
  // selv om OUTPUTFORMAT=application/json er bedt. Hvis svaret ikke er
  // gyldig JSON, logg så vi vet typename er feil eller format er GML.
  try {
    const json = JSON.parse(text)
    return json.features ?? []
  } catch {
    const head = text.slice(0, 200).replace(/\s+/g, ' ')
    console.warn(`[Sjøkart] Ikke-JSON respons for ${typeName} (kan være GML eller ServiceException): ${head}…`)
    throw new Error(`Ikke-JSON respons for ${typeName}`)
  }
}

/**
 * Konverter sjøkart-features til OSM-aktige elementer for mapBuilder.
 *
 * Mapping:
 *   - dybdeareal      → way med tags { natural: 'water', water: 'sea',
 *                                       sjokart: 'true', minDybde, maxDybde }
 *   - dybdekontur     → way med tags { sjokart: 'dybdekontur', dybde }
 *   - grunne          → node med tags { sjokart: 'grunne', natural: 'rock' }
 *                       eller way (polygon) for areal-grunner
 *   - lanterne        → node med tags { sjokart: 'lanterne', name }
 *   - dybdepunkt      → node med tags { sjokart: 'dybdepunkt', dybde }
 *   - kystkontur      → way (line) med tags { sjokart: 'kystkontur' } —
 *                       brukes til land-mask, ikke direkte rendret
 *
 * @param {object} sjokart Returverdi fra fetchSjokart
 * @returns {Array}        OSM-aktige elementer
 */
export function sjokartToElements(sjokart) {
  const elements = []
  let id = 1_000_000  // start høyt så det ikke kolliderer med OSM-id

  for (const f of sjokart.dybdeareal ?? []) {
    const props = f.properties ?? {}
    const minDybde = parseDepth(props.minimumsdybde ?? props.minDybde ?? props.MIN_DEPTH)
    const maxDybde = parseDepth(props.maksimumsdybde ?? props.maxDybde ?? props.MAX_DEPTH)
    const tags = {
      natural: 'water',
      water: 'sea',
      salt: 'yes',
      sjokart: 'dybdeareal',
    }
    if (minDybde != null) tags.minDybde = String(minDybde)
    if (maxDybde != null) tags.maxDybde = String(maxDybde)
    pushPolygonAsWays(f, tags, elements, () => id++)
  }

  for (const f of sjokart.dybdekontur ?? []) {
    const props = f.properties ?? {}
    const dybde = parseDepth(props.dybde ?? props.minimumsdybde ?? props.elevation)
    const tags = { sjokart: 'dybdekontur' }
    if (dybde != null) tags.dybde = String(dybde)
    pushLineAsWays(f, tags, elements, () => id++)
  }

  for (const f of sjokart.grunne ?? []) {
    const props = f.properties ?? {}
    const tags = {
      sjokart: 'grunne',
      natural: 'rock',
    }
    if (props.minimumsdybde != null) tags.dybde = String(props.minimumsdybde)
    pushAnyGeom(f, tags, elements, () => id++)
  }

  for (const f of sjokart.lanterne ?? []) {
    const props = f.properties ?? {}
    const tags = {
      sjokart: 'lanterne',
    }
    if (props.navn) tags.name = props.navn
    if (props.lyskarakter) tags.lyskarakter = props.lyskarakter
    pushPointOnly(f, tags, elements, () => id++)
  }

  for (const f of sjokart.dybdepunkt ?? []) {
    const props = f.properties ?? {}
    const dybde = parseDepth(props.dybde ?? props.minimumsdybde)
    if (dybde == null) continue
    const tags = { sjokart: 'dybdepunkt', dybde: String(dybde) }
    pushPointOnly(f, tags, elements, () => id++)
  }

  return elements
}

function parseDepth(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pushPolygonAsWays(feature, tags, out, nextId) {
  const g = feature.geometry
  if (!g) return
  if (g.type === 'Polygon' && g.coordinates[0]?.length >= 3) {
    out.push({
      type: 'way',
      id: nextId(),
      geometry: g.coordinates[0].map(([lon, lat]) => ({ lat, lon })),
      tags,
      _source: 'sjokart',
    })
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates) {
      if (!poly[0] || poly[0].length < 3) continue
      out.push({
        type: 'way',
        id: nextId(),
        geometry: poly[0].map(([lon, lat]) => ({ lat, lon })),
        tags,
        _source: 'sjokart',
      })
    }
  }
}

function pushLineAsWays(feature, tags, out, nextId) {
  const g = feature.geometry
  if (!g) return
  if (g.type === 'LineString' && g.coordinates.length >= 2) {
    out.push({
      type: 'way',
      id: nextId(),
      geometry: g.coordinates.map(([lon, lat]) => ({ lat, lon })),
      tags,
      _source: 'sjokart',
    })
  } else if (g.type === 'MultiLineString') {
    for (const line of g.coordinates) {
      if (line.length < 2) continue
      out.push({
        type: 'way',
        id: nextId(),
        geometry: line.map(([lon, lat]) => ({ lat, lon })),
        tags,
        _source: 'sjokart',
      })
    }
  }
}

function pushPointOnly(feature, tags, out, nextId) {
  const g = feature.geometry
  if (!g || g.type !== 'Point') return
  out.push({
    type: 'node',
    id: nextId(),
    lat: g.coordinates[1],
    lon: g.coordinates[0],
    tags,
    _source: 'sjokart',
  })
}

function pushAnyGeom(feature, tags, out, nextId) {
  const g = feature.geometry
  if (!g) return
  if (g.type === 'Point') {
    pushPointOnly(feature, tags, out, nextId)
  } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
    pushLineAsWays(feature, tags, out, nextId)
  } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    pushPolygonAsWays(feature, tags, out, nextId)
  }
}

/**
 * Lag en gradert blå farge for et dybdekontur basert på dyp i meter.
 * Lyseste (~5m) til mørkeste (~100m) blå nyanse, kompatibel med
 * ISOM 304 saltvann-stil.
 *
 * @param {number} dybde meter (positivt tall = dyp)
 * @returns {string} hex-farge
 */
export function depthToColor(dybde) {
  // Klem til 0-100 og normaliser. Lyseste = #b6daee, mørkeste = #1f5d8a
  const t = Math.max(0, Math.min(1, dybde / 100))
  const lerp = (a, b) => Math.round(a + (b - a) * t)
  const r = lerp(0xb6, 0x1f)
  const g = lerp(0xda, 0x5d)
  const b = lerp(0xee, 0x8a)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

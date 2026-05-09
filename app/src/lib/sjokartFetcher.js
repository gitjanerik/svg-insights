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
  // v7.1.5: samle feilmeldinger per endepunkt så vi kan eksponere dem
  // i kart-meta og MapView. CORS, HTTP-fail, og non-JSON-svar separeres.
  const fetchErrors = []
  for (const endpoint of SJOKART_ENDPOINTS) {
    try {
      const result = await fetchAllCategories(endpoint, bbox, opts, fetchErrors)
      const totals = Object.values(result).reduce(
        (a, v) => a + (Array.isArray(v) ? v.length : 0), 0
      )
      if (totals > 0) {
        console.log(`[Sjøkart] ${endpoint} → ${totals} features totalt`)
        return { ...result, source: endpoint, fetchErrors }
      } else {
        console.log(`[Sjøkart] ${endpoint} svarte men 0 features (kan være feil typenames eller utenfor dekning)`)
        fetchErrors.push({ endpoint, kind: 'zero-features', message: '0 features for alle typenames' })
      }
    } catch (e) {
      console.warn(`[Sjøkart] ${endpoint} feilet: ${e.message}`)
      fetchErrors.push({ endpoint, kind: classifyFetchError(e), message: e.message })
    }
  }
  console.warn('[Sjøkart] Ingen endepunkter ga data — kart vil falle tilbake til OSM coastline-rekonstruksjon')
  return { ...emptyResult(), fetchErrors }
}

// Kategoriser fetch-feil for synlig diagnose. Nettverks-feil i nettleser
// er typisk CORS-relatert, men kan også være DNS, TLS osv. — uten dyp
// network-API-tilgang er det vanskelig å skille, så vi bruker bredt navn.
function classifyFetchError(e) {
  const msg = (e?.message || '').toLowerCase()
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) return 'network-or-cors'
  if (msg.includes('aborted')) return 'aborted'
  if (msg.includes('http ')) return 'http-error'
  if (msg.includes('ikke-json')) return 'not-json'
  return 'unknown'
}

function emptyResult() {
  return {
    kystkontur: [], dybdeareal: [], dybdekontur: [],
    grunne: [], lanterne: [], dybdepunkt: [],
    source: null,
    fetchErrors: [],
  }
}

async function fetchAllCategories(endpoint, bbox, opts, fetchErrors = []) {
  const out = emptyResult()
  delete out.source
  delete out.fetchErrors
  const tasks = []
  for (const [cat, candidates] of Object.entries(TYPENAME_CANDIDATES)) {
    tasks.push(
      fetchFirstWorkingTypename(endpoint, candidates, bbox, opts, fetchErrors)
        .then(features => { out[cat] = features })
        .catch(() => { out[cat] = [] })
    )
  }
  await Promise.allSettled(tasks)
  return out
}

async function fetchFirstWorkingTypename(endpoint, candidates, bbox, opts, fetchErrors = []) {
  for (const typeName of candidates) {
    try {
      const features = await fetchTypeName(endpoint, typeName, bbox, opts)
      if (features.length > 0) return features
    } catch (e) {
      // Prøv neste kandidat. Logg første feil per typename-set så vi
      // har noe å vise i UI hvis alle kandidater feiler.
      fetchErrors.push({
        endpoint, typeName,
        kind: classifyFetchError(e),
        message: e.message,
      })
    }
  }
  return []
}

// v7.1.6: Geonorge WFS-endepunkter er inkonsistente i hvilken
// OUTPUTFORMAT-streng de aksepterer. Brukerrapport viser at v7.1.5
// loggget "GML/XML-svar (57)" — dvs. serveren svarer, men returnerer
// GML i stedet for JSON. Vi prøver derfor flere kandidat-strenger
// per typename før vi gir opp og evt. faller tilbake på GML.
const OUTPUT_FORMATS = [
  'application/json',
  'application/geo+json',
  'json',
  'JSON',
  'text/json',
  'geojson',
  // Siste-fallback: GML — vi parser den minimalt om JSON ikke virker.
  // GML 3.2.1 er standard for WFS 2.0.0, ikke spesifiser version her;
  // serveren velger sin default.
  'text/xml; subtype=gml/3.2.1',
  'application/gml+xml; version=3.2',
  'GML2',
]

async function fetchTypeName(endpoint, typeName, bbox, opts = {}) {
  const baseParams = {
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: typeName,
    SRSNAME: 'EPSG:4326',
    BBOX: `${bbox.south},${bbox.west},${bbox.north},${bbox.east},EPSG:4326`,
    COUNT: '5000',
  }
  let lastError = null
  for (const fmt of OUTPUT_FORMATS) {
    try {
      const features = await tryFormat(endpoint, baseParams, typeName, fmt, opts)
      if (features != null) {
        // Logg første gang vi treffer en virkende format-streng for
        // gitt endpoint/typename — hjelper diagnose.
        if (fmt !== 'application/json') {
          console.log(`[Sjøkart] ${typeName} virket med OUTPUTFORMAT=${fmt}`)
        }
        return features
      }
    } catch (e) {
      lastError = e
      // Network/CORS-feil er fatal for hele endpointet; ingen vits å
      // prøve andre format-strenger om vi ikke når serveren i det hele
      // tatt.
      if (e?.message && /Failed to fetch|NetworkError|ERR_/i.test(e.message)) {
        throw e
      }
      // Annet (HTTP-feil, ikke-JSON, etc) — prøv neste format.
    }
  }
  // Alle format-varianter failet. Last error gir mest informasjon.
  throw lastError ?? new Error(`Alle format-varianter feilet for ${typeName}`)
}

async function tryFormat(endpoint, baseParams, typeName, outputFormat, opts) {
  const params = new URLSearchParams({ ...baseParams, OUTPUTFORMAT: outputFormat })
  const url = `${endpoint}?${params}`
  const res = await fetch(url, { signal: opts.signal })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${typeName} med format ${outputFormat}`)
  }
  const text = await res.text()
  // GeoJSON-format
  if (text.trim().startsWith('{')) {
    try {
      const json = JSON.parse(text)
      return json.features ?? []
    } catch {
      throw new Error(`Ikke-JSON respons for ${typeName} (forventet med ${outputFormat})`)
    }
  }
  // GML-format — kun forsøkt for GML-MIME-types
  if (text.trim().startsWith('<') && /gml|xml/i.test(outputFormat)) {
    return parseGmlFeatures(text, typeName)
  }
  // ServiceException eller annet uventet
  if (text.includes('ServiceException')) {
    // Gi opp denne format-varianten stille, prøv neste
    return null
  }
  throw new Error(`Ikke-JSON respons for ${typeName}`)
}

/**
 * Minimal GML-parser for WFS-svar. Henter ut Point/LineString/Polygon-
 * geometrier og koblede properties. Bevisst forenkletbeginn — håndterer
 * gml:posList og gml:pos i EPSG:4326 (lat lon-rekkefølge for GML 3.2.1).
 *
 * @param {string} xml  GML-string fra WFS
 * @param {string} typeName  for diagnose-logging
 * @returns {Array<{ properties: object, geometry: object }>}
 */
function parseGmlFeatures(xml, typeName) {
  if (typeof DOMParser === 'undefined') {
    // Node-kontekst (test eller CI): vi har ikke DOMParser. Returner
    // tom liste; CI-bygg kjører Vardåsen som er innland.
    return []
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const err = doc.querySelector('parsererror')
  if (err) {
    console.warn(`[Sjøkart] GML parser-error for ${typeName}: ${err.textContent.slice(0, 100)}`)
    return []
  }
  // WFS pakker hver feature i wfs:member > <Type-element>. Hent dem.
  const ns = 'http://www.opengis.net/wfs/2.0'
  let members = Array.from(doc.getElementsByTagNameNS(ns, 'member'))
  if (members.length === 0) {
    // WFS 1.x-fallback: featureMembers
    members = Array.from(doc.getElementsByTagName('gml:featureMember'))
    if (members.length === 0) {
      members = Array.from(doc.getElementsByTagName('wfs:member'))
    }
  }
  const features = []
  for (const m of members) {
    const inner = m.firstElementChild
    if (!inner) continue
    const props = {}
    let geometry = null
    for (const child of Array.from(inner.children)) {
      const localName = child.localName
      // Geometri-felter inneholder gml-elementer
      const gmlEl = child.getElementsByTagNameNS('http://www.opengis.net/gml/3.2', '*')[0]
                 ?? child.getElementsByTagName('gml:Point')[0]
                 ?? child.getElementsByTagName('gml:LineString')[0]
                 ?? child.getElementsByTagName('gml:Polygon')[0]
                 ?? child.getElementsByTagName('gml:MultiSurface')[0]
                 ?? child.getElementsByTagName('gml:MultiCurve')[0]
      if (gmlEl) {
        geometry = gmlToGeojsonGeometry(gmlEl)
      } else if (child.children.length === 0) {
        props[localName] = child.textContent
      }
    }
    if (geometry) features.push({ properties: props, geometry })
  }
  if (features.length > 0) {
    console.log(`[Sjøkart] GML-parser hentet ${features.length} features fra ${typeName}`)
  }
  return features
}

function parseCoords(text) {
  return text.trim().split(/\s+/).map(Number).filter(Number.isFinite)
}

function gmlToGeojsonGeometry(el) {
  const tag = el.localName
  if (tag === 'Point') {
    const pos = el.getElementsByTagName('gml:pos')[0]?.textContent ?? el.getElementsByTagName('pos')[0]?.textContent
    if (!pos) return null
    const [lat, lon] = parseCoords(pos)  // GML 3.2.1 EPSG:4326 = lat lon
    return { type: 'Point', coordinates: [lon, lat] }
  }
  if (tag === 'LineString') {
    const posList = el.getElementsByTagName('gml:posList')[0]?.textContent ?? el.getElementsByTagName('posList')[0]?.textContent
    if (!posList) return null
    const flat = parseCoords(posList)
    const coords = []
    for (let i = 0; i + 1 < flat.length; i += 2) coords.push([flat[i + 1], flat[i]])
    return { type: 'LineString', coordinates: coords }
  }
  if (tag === 'Polygon') {
    const exterior = el.getElementsByTagName('gml:exterior')[0]
    if (!exterior) return null
    const posList = exterior.getElementsByTagName('gml:posList')[0]?.textContent
    if (!posList) return null
    const flat = parseCoords(posList)
    const ring = []
    for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i + 1], flat[i]])
    return { type: 'Polygon', coordinates: [ring] }
  }
  if (tag === 'MultiSurface' || tag === 'MultiCurve') {
    // Ignorerer for nå — sjeldent for sjøkart
    return null
  }
  return null
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

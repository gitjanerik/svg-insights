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

// v7.1.8: brukerverifisering 9. mai 2026 viste at sjokart_dybdedata-
// endepunktet er DØDT (returnerer ServiceException "ukjent applikasjon").
// wfs.dybdedata er live og bør prøves først. De andre endepunktene
// beholdes som fallback inntil verifisert.
const SJOKART_ENDPOINTS = [
  'https://wfs.geonorge.no/skwms1/wfs.dybdedata',
  'https://wfs.geonorge.no/skwms1/wfs.dybdedata2',
  'https://wfs.geonorge.no/skwms1/wfs.sjokartraster_navlys',
]

// v7.1.9: TYPENAME_CANDIDATES korrigert basert på faktisk
// GetCapabilities-respons fra wfs.dybdedata (verifisert 9. mai 2026).
// SOSI-spec "Dybdedata 20201001" bruker app:-prefiks. Den største feilen
// var at vi spurte etter "Dybdekontur" — riktig navn er "Dybdekurve".
// Lanterner finnes IKKE i wfs.dybdedata; må hentes fra navlys-tjenesten
// (wfs.sjokartraster_navlys eller nyere). Beholdes som tom kategori
// inntil verifisert URL.
const TYPENAME_CANDIDATES = {
  // Kystkontur — linjen mellom land og sjø ved middel-vannstand.
  kystkontur: ['app:Kystkontur'],
  // Dybdeareal — polygoner mellom dybdekonturene. Hver polygon dekker
  // "hele sjøen 0-2 m dyp" osv; union gir total sjø-utstrekning.
  dybdeareal: ['app:Dybdeareal'],
  // Dybdekontur — linjer for hver dybde-isobath. SERVER-NAVN: "Dybdekurve".
  // Vår interne kategori-navn beholdes som "dybdekontur" så
  // sjokartToElements og mapBuilder ikke trenger å endres.
  dybdekontur: ['app:Dybdekurve'],
  // Skjær / grunner / stein over/under vann.
  grunne: ['app:Grunne', 'app:Skjær'],
  // Lanterner — IKKE i wfs.dybdedata (verifisert via GetCapabilities).
  // Beholdes for fremtidig integrasjon med navlys-tjeneste.
  lanterne: ['app:Lanterne'],
  // Soundings — punkter med dybde-tall.
  dybdepunkt: ['app:Dybdepunkt'],
  // v7.1.16 (Fase 5): padle-relevante kunstige strukturer.
  // Slipp = båtopplagring/kajakk-launch (kritisk for padle-bruk).
  slipp: ['app:Slipp'],
  // KaiBrygge / Pir / Molo / Bølgebryter — ulike kunstige havne-
  // strukturer. Vi rendrer alle med samme stil (ISOM 551).
  kaibrygge: ['app:KaiBrygge'],
  pir: ['app:Pir'],
  molo: ['app:Molo', 'app:Bølgebryter'],
  // Fareområde — sikkerhets-zoner (kabel, undervannsledninger osv).
  fareomraade: ['app:Fareområde'],
}

// Areal-skalert klient-tak for hele WFS-hentingen (alle typenames, med
// endepunkt-fallback). Det gamle faste 8 s-taket var kalibrert for 4 km-kart
// (~16 km²); standardkartet er nå 10–12 km (100–190 km²) med ~6–12× større
// GML-responser som lovlig bruker titalls sekunder på mobil. Uten skalering
// timet hentingen stille ut på store kystkart og både dybdetall og kai/
// brygge/molo (551) forsvant — samme feilklasse som Overpass i v11.0.58
// (overpassTimeoutForBbox). 250 ms/km² over 16 km² → ~40 s ved 12×12 km.
const SJOKART_TIMEOUT_MS = 8000
const SJOKART_TIMEOUT_MAX_MS = 45000

export function sjokartTimeoutForBbox(bbox) {
  if (!bbox) return SJOKART_TIMEOUT_MS
  const midLat = (bbox.north + bbox.south) / 2
  const heightKm = Math.abs(bbox.north - bbox.south) * 111
  const widthKm = Math.abs(bbox.east - bbox.west) * 111 * Math.cos(midLat * Math.PI / 180)
  const areaKm2 = heightKm * widthKm
  const scaled = SJOKART_TIMEOUT_MS + Math.max(0, areaKm2 - 16) * 250
  return Math.round(Math.min(SJOKART_TIMEOUT_MAX_MS, Math.max(SJOKART_TIMEOUT_MS, scaled)))
}

/**
 * Kompakt status for kart-meta (data-meta i SVG-en) og Utvikler-fanen.
 * Den fragile WFS-hentingen falt tidligere stille tilbake til tomt resultat —
 * nå føres utfallet (ok/tom/timeout/feil/innlands) med til kartet så det er
 * mulig å se HVORFOR dybdetall/kai mangler uten konsoll-tilgang.
 *
 * @param {object} sjokart  resultatet fra fetchSjokart / EMPTY_SJOKART med
 *   evt. flagg { skipped, timedOut, timeoutMs, failed } satt av createMapFlow
 * @param {number} featureCount  antall elementer etter sjokartToElements
 */
export function summarizeSjokartStatus(sjokart, featureCount) {
  const s = sjokart ?? {}
  const state = s.skipped ? 'innlands'
    : s.timedOut ? 'timeout'
    : s.failed ? 'feil'
    : featureCount > 0 ? 'ok' : 'tom'
  return {
    state,
    features: featureCount,
    source: s.source ?? null,
    timeoutMs: s.timeoutMs ?? null,
    // Trimmes hardt: meta serialiseres inn i SVG-ens data-meta-attributt.
    errors: (s.fetchErrors ?? []).slice(0, 4).map(e => ({
      endpoint: String(e.endpoint ?? '').replace('https://wfs.geonorge.no/skwms1/', ''),
      typeName: e.typeName ?? null,
      kind: e.kind ?? null,
      message: String(e.message ?? '').slice(0, 120),
    })),
  }
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
  // v7.1.10: når en respons returnerer 0 features, lagre første ~200
  // bytes av selve responsen for diagnose. Hjelper å se hva serveren
  // faktisk returnerer.
  const debugSamples = []
  const internalOpts = { ...opts, debugSamples }
  for (const endpoint of SJOKART_ENDPOINTS) {
    try {
      const result = await fetchAllCategories(endpoint, bbox, internalOpts, fetchErrors)
      const totals = Object.values(result).reduce(
        (a, v) => a + (Array.isArray(v) ? v.length : 0), 0
      )
      if (totals > 0) {
        console.log(`[Sjøkart] ${endpoint} → ${totals} features totalt`)
        return { ...result, source: endpoint, fetchErrors, debugSamples }
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
  return { ...emptyResult(), fetchErrors, debugSamples }
}

// v7.1.10: Geonorge SOSI-feature-namespaces er forskjellige per dataset.
// Verifisert URI for wfs.dybdedata = SOSI/produktspesifikasjon/Dybdedata
// /20201001 (fra GetCapabilities). Andre endepunkter sannsynligvis har
// egen URI; må verifiseres via deres GetCapabilities.
function guessNamespaceUri(endpoint, typeName) {
  if (typeName.startsWith('app:')) {
    if (endpoint.includes('dybdedata')) {
      return 'http://skjema.geonorge.no/SOSI/produktspesifikasjon/Dybdedata/20201001'
    }
    if (endpoint.includes('navlys')) {
      // Antagelse — uverifisert. Brukes når brukeren bekrefter URL.
      return 'http://skjema.geonorge.no/SOSI/produktspesifikasjon/Navlys/20201001'
    }
  }
  return null
}

// Kategoriser fetch-feil for synlig diagnose. Nettverks-feil i nettleser
// er typisk CORS-relatert, men kan også være DNS, TLS osv. — uten dyp
// network-API-tilgang er det vanskelig å skille, så vi bruker bredt navn.
function classifyFetchError(e) {
  const msg = (e?.message || '').toLowerCase()
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) return 'network-or-cors'
  if (msg.includes('aborted')) return 'aborted'
  if (msg.includes('endpoint utdatert')) return 'endpoint-deprecated'
  if (msg.includes('http ')) return 'http-error'
  if (msg.includes('ikke-json')) return 'not-json'
  return 'unknown'
}

function emptyResult() {
  return {
    kystkontur: [], dybdeareal: [], dybdekontur: [],
    grunne: [], lanterne: [], dybdepunkt: [],
    // v7.1.16 padle-features
    slipp: [], kaibrygge: [], pir: [], molo: [], fareomraade: [],
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

// v7.1.9: GetCapabilities (9. mai 2026) bekreftet at wfs.dybdedata KUN
// støtter GML — ingen JSON. Setter GML først; én JSON-variant beholdes
// som fallback for andre endepunkter (wfs.dybdedata2 osv.).
// v12.0.17: trimmet 9 → 3. De seks droppede var redundante stavemåter av
// JSON ('application/geo+json', 'json', 'JSON', 'text/json', 'geojson') +
// 'application/gml+xml; version=3.2' — hver kostet en feilet round-trip
// per typename per endpoint (opptil 6×13×3 unødvendige requests innenfor
// den ytre hard-timeouten).
const OUTPUT_FORMATS = [
  // GML 3.2.1 — verifisert støtte for wfs.dybdedata
  'text/xml; subtype=gml/3.2.1',
  // JSON-fallback for andre endepunkter
  'application/json',
  // Legacy GML som siste utvei
  'GML2',
]

// Per-request-tak inne i format-loopen: uten dette kunne én hengende request
// spise hele den ytre hard-timeouten alene før neste format/typename fikk prøve.
const SJOKART_REQUEST_TIMEOUT_MS = 10000

async function fetchTypeName(endpoint, typeName, bbox, opts = {}) {
  // v7.1.10: WFS 2.0.0 krever at prefix→URI-binding deklareres via
  // NAMESPACES-parameter. Uten dette kan serveren tolke `app:`-prefiks
  // som ukjent og returnere tom respons (eller ServiceException). For
  // Geonorge SOSI Dybdedata 20201001 er bindingen verifisert fra
  // GetCapabilities `xmlns:app="..."`-attributtet.
  const namespaceUri = guessNamespaceUri(endpoint, typeName)
  // v7.1.12: bruker URN-form (urn:ogc:def:crs:EPSG::4326) i stedet for
  // legacy "EPSG:4326". Dette TVINGER aks-order til lat,lon (standard
  // for geografisk CRS) — legacy-formatet er ambiguøst og noen servere
  // tolker det som lon,lat. v7.1.10 ga 1098 bytes tom respons; URN-
  // formatet skal garantere at BBOX tolkes riktig.
  const CRS_URN = 'urn:ogc:def:crs:EPSG::4326'
  const baseParams = {
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: typeName,
    SRSNAME: CRS_URN,
    BBOX: `${bbox.south},${bbox.west},${bbox.north},${bbox.east},${CRS_URN}`,
    COUNT: '5000',
  }
  if (namespaceUri) {
    baseParams.NAMESPACES = `xmlns(app,${namespaceUri})`
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
  // Per-request abort lenket til kallerens signal (10 s) — en hengende
  // request skal koste én format-variant, ikke hele den ytre hard-timeouten.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('Sjøkart-request-timeout', 'TimeoutError')), SJOKART_REQUEST_TIMEOUT_MS)
  const onAbort = () => ctrl.abort(opts.signal?.reason)
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  let text
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${typeName} med format ${outputFormat}`)
    }
    text = await res.text()
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
  // v7.1.10: lagre første sample for diagnose. v7.1.11: strip XML-tegn
  // (<>) som ellers ville brutt SVG-parsing når sample lagres i
  // data-meta-attributt. Erstatter med ‹ › så strukturen er synlig
  // uten å være gyldig XML-syntaks.
  if (opts.debugSamples && opts.debugSamples.length < 5) {
    // v7.1.12: utvidet til 500 bytes så vi ser numberReturned/numberMatched-
    // attributtene som typisk ligger i wfs:FeatureCollection-rotelementet.
    const safeSample = text.slice(0, 500)
      .replace(/\s+/g, ' ')
      .replace(/</g, '‹')
      .replace(/>/g, '›')
      .replace(/&/g, '&amp;')
    opts.debugSamples.push({
      typeName, outputFormat,
      length: text.length,
      sample: safeSample,
    })
  }
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
  // ServiceException — server svarte med XML-feilmelding. Hvis det er
  // "UKJENT APPLIKASJON" er hele endpointet dødt; ingen vits å prøve
  // andre format-varianter. Ellers (annen ServiceException) prøv neste.
  if (text.includes('ServiceException')) {
    if (/UKJENT APPLIKASJON|kan ikke rutes/i.test(text)) {
      throw new Error(`Endpoint utdatert: ${endpoint?.split('/').pop() ?? '?'} returnerer ServiceException "ukjent applikasjon"`)
    }
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
// GML/WFS namespaces. Geonorge bruker GML 3.2.1.
const WFS_NS = 'http://www.opengis.net/wfs/2.0'
const GML_NS = 'http://www.opengis.net/gml/3.2'
// SOSI/Dybdedata-feature namespace. Verifisert fra GetCapabilities:
// xmlns:app="http://skjema.geonorge.no/SOSI/produktspesifikasjon/Dybdedata/20201001"
const APP_NS_PREFIX = 'http://skjema.geonorge.no/SOSI/produktspesifikasjon/'

const GEOMETRY_TYPES = ['Point', 'LineString', 'Polygon', 'MultiSurface', 'MultiCurve']

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
  // WFS 2.0 pakker features i wfs:member; WFS 1.x i gml:featureMember.
  let members = Array.from(doc.getElementsByTagNameNS(WFS_NS, 'member'))
  if (members.length === 0) {
    // GML 3.1.1 (eldre WFS) fallback
    members = Array.from(doc.getElementsByTagName('gml:featureMember'))
  }
  const features = []
  for (const m of members) {
    const inner = m.firstElementChild
    if (!inner) continue
    const { props, geometry } = parseFeatureElement(inner)
    if (geometry) features.push({ properties: props, geometry })
  }
  if (features.length > 0) {
    console.log(`[Sjøkart] GML-parser hentet ${features.length} features fra ${typeName}`)
  } else {
    console.log(`[Sjøkart] GML-parser fant 0 features i ${typeName} (${members.length} members)`)
  }
  return features
}

function parseFeatureElement(featureEl) {
  const props = {}
  let geometry = null
  for (const child of Array.from(featureEl.children)) {
    // Sjekk om dette child-elementet inneholder geometry (en gml:Point,
    // gml:LineString, gml:Polygon osv som direkte barn).
    let gmlEl = null
    for (const t of GEOMETRY_TYPES) {
      const matches = child.getElementsByTagNameNS(GML_NS, t)
      if (matches.length > 0) {
        gmlEl = matches[0]
        break
      }
    }
    if (gmlEl) {
      geometry = gmlToGeojsonGeometry(gmlEl)
    } else if (child.children.length === 0 && child.textContent) {
      // Property med tekst-innhold (ikke nested element)
      props[child.localName] = child.textContent.trim()
    }
  }
  return { props, geometry }
}

function parseCoords(text) {
  return text.trim().split(/\s+/).map(Number).filter(Number.isFinite)
}

// Namespace-aware lookup for GML child-elementer.
function gmlChildText(el, localName) {
  const matches = el.getElementsByTagNameNS(GML_NS, localName)
  return matches.length > 0 ? matches[0].textContent : null
}
function gmlChild(el, localName) {
  const matches = el.getElementsByTagNameNS(GML_NS, localName)
  return matches.length > 0 ? matches[0] : null
}

function gmlToGeojsonGeometry(el) {
  const tag = el.localName
  // GML 3.2.1 EPSG:4326 har lat lon-rekkefølge; vi konverterer til
  // GeoJSON [lon, lat] for konsistens med våre øvrige geometrier.
  if (tag === 'Point') {
    const pos = gmlChildText(el, 'pos')
    if (!pos) return null
    const [lat, lon] = parseCoords(pos)
    return { type: 'Point', coordinates: [lon, lat] }
  }
  if (tag === 'LineString') {
    const posList = gmlChildText(el, 'posList')
    if (!posList) return null
    return { type: 'LineString', coordinates: posListToLatLon(posList) }
  }
  if (tag === 'Polygon') {
    const exterior = gmlChild(el, 'exterior')
    if (!exterior) return null
    const posList = gmlChildText(exterior, 'posList')
    if (!posList) return null
    const ring = posListToLatLon(posList)
    // Inkluder eventuelle interior-ringer (hull)
    const interiors = el.getElementsByTagNameNS(GML_NS, 'interior')
    const holes = []
    for (let i = 0; i < interiors.length; i++) {
      const innerPos = gmlChildText(interiors[i], 'posList')
      if (innerPos) holes.push(posListToLatLon(innerPos))
    }
    return { type: 'Polygon', coordinates: [ring, ...holes] }
  }
  if (tag === 'MultiSurface') {
    // Sjøkart bruker MultiSurface for komplekse polygoner
    const surfaceMembers = el.getElementsByTagNameNS(GML_NS, 'surfaceMember')
    const polygons = []
    for (let i = 0; i < surfaceMembers.length; i++) {
      const innerPoly = gmlChild(surfaceMembers[i], 'Polygon')
      if (innerPoly) {
        const sub = gmlToGeojsonGeometry(innerPoly)
        if (sub) polygons.push(sub.coordinates)
      }
    }
    if (polygons.length === 0) return null
    return { type: 'MultiPolygon', coordinates: polygons }
  }
  if (tag === 'MultiCurve') {
    // Linjer som er splittet i flere ways
    const curveMembers = el.getElementsByTagNameNS(GML_NS, 'curveMember')
    const lines = []
    for (let i = 0; i < curveMembers.length; i++) {
      const innerLine = gmlChild(curveMembers[i], 'LineString')
      if (innerLine) {
        const sub = gmlToGeojsonGeometry(innerLine)
        if (sub) lines.push(sub.coordinates)
      }
    }
    if (lines.length === 0) return null
    return { type: 'MultiLineString', coordinates: lines }
  }
  return null
}

function posListToLatLon(posList) {
  const flat = parseCoords(posList)
  const coords = []
  for (let i = 0; i + 1 < flat.length; i += 2) coords.push([flat[i + 1], flat[i]])
  return coords
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
    // v7.1.18: dropp natural=rock-tagging på sjokart-grunne. Tidligere
    // ga det polygon-skjær store sorte ISOM 210-pattern-fyll (blokkmark)
    // ved zoom-inn. sjokart=grunne alene styrer rendering; polygoner
    // mappes til ISOM 212 (skjær-areal, lett blå outline).
    const tags = { sjokart: 'grunne' }
    if (props.minimumsdybde != null) tags.dybde = String(props.minimumsdybde)
    if (props.navn) tags.name = String(props.navn).trim()
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

  // v7.1.16 padle-features:
  // Slipp = kajakk/båt-opplagring. Typisk Point men kan v&aelig;re Polygon
  // (slipp-rampe). Vi pusher som point eller way etter geometri-type.
  for (const f of sjokart.slipp ?? []) {
    const props = f.properties ?? {}
    const tags = { sjokart: 'slipp' }
    if (props.navn) tags.name = String(props.navn).trim()
    pushAnyGeom(f, tags, elements, () => id++)
  }
  // KaiBrygge / Pir / Molo / Bølgebryter — alle havne-strukturer.
  // Tagges med en felles sjokart='havnestruktur' så mapBuilder kan
  // klassifisere dem til samme ISOM-kode (551).
  for (const cat of ['kaibrygge', 'pir', 'molo']) {
    for (const f of sjokart[cat] ?? []) {
      const props = f.properties ?? {}
      const tags = { sjokart: 'havnestruktur', subtype: cat }
      if (props.navn) tags.name = String(props.navn).trim()
      pushAnyGeom(f, tags, elements, () => id++)
    }
  }
  // Fareområde — sikkerhets-zoner (undervanns-kabel, ankerforbud osv).
  for (const f of sjokart.fareomraade ?? []) {
    const props = f.properties ?? {}
    const tags = { sjokart: 'fareomraade' }
    if (props.navn) tags.name = String(props.navn).trim()
    pushAnyGeom(f, tags, elements, () => id++)
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
  // Emitter ett GML-polygon. Ringer = [outer, ...holes] (hver [lon,lat][]).
  // Hull (indre ringer) er ØYER i dybdearealet — f.eks. Holmen i Drammens-
  // elvas utløp. Tidligere ble KUN g.coordinates[0] (outer) brukt og hullene
  // kastet, så dybdeareal malte rett over øyer; «single coastline»-klippingen
  // mot DEM-sjøen måtte kompensere og kappet da også bort elvekanaler som
  // ligger over havnivå. Vi bevarer nå hullene: med øy-hull intakt er Sjøkart-
  // geometrien selv autoritativ (ytre ring = kyst, indre ring = øy), og DEM-
  // klippingen er overflødig.
  const toLatLon = (ring) => ring.map(([lon, lat]) => ({ lat, lon }))
  const emit = (rings) => {
    const outer = rings[0]
    if (!outer || outer.length < 3) return
    const holes = rings.slice(1).filter(r => Array.isArray(r) && r.length >= 3)
    if (holes.length === 0) {
      out.push({ type: 'way', id: nextId(), geometry: toLatLon(outer), tags, _source: 'sjokart' })
    } else {
      const members = [
        { type: 'way', role: 'outer', geometry: toLatLon(outer) },
        ...holes.map(h => ({ type: 'way', role: 'inner', geometry: toLatLon(h) })),
      ]
      out.push({ type: 'relation', id: nextId(), members, tags, _source: 'sjokart' })
    }
  }
  if (g.type === 'Polygon' && g.coordinates[0]?.length >= 3) {
    emit(g.coordinates)
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates) {
      if (!poly[0] || poly[0].length < 3) continue
      emit(poly)
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
 * Lag en dempet blå farge for et dybdeareal basert på dyp i meter.
 *
 * Fase 2 (v9.2.0): kystnær 5-bånds-skala tilpasset padling. Den tette
 * inndelingen ligger i grunt vann (0–2 / 2–5 / 5–10 m) der padleren
 * faktisk trenger den — grunner, skjær, strømutsatte sund — mens dypt
 * vann slås sammen (10–20 / 20+). Tonene er BEVISST dempede og lav-
 * kontrast: et ISOM-kart er informasjonstett, så dybdebåndene skal gi
 * subtil kontekst uten å konkurrere med terreng/vegetasjon. Faktiske
 * farer markeres tydelig av skjær-/grunne-PUNKTsymboler (ISOM 211),
 * ikke av sterke flatefarger.
 *
 * Konvensjon: grunnest = lysest (mot kremgul land), dypest = litt mer
 * mettet — men hele skalaen holder et smalt, mykt verdi-spenn.
 *
 *   0–2 m   #d8eaf2  lyseste — grunt, sjekk for skjær
 *   2–5 m   #c5e0ec
 *   5–10 m  #aed3e4
 *   10–20 m #93c3da
 *   20+ m   #79b3d2  dypest — fortsatt dempet
 *
 * @param {number} dybde meter (positivt tall = dyp)
 * @returns {string} hex-farge
 */
// Dybde-bånd: [maxDybde (eksklusiv), tema-variabel-indeks, lys-fallback-hex].
// Lys-hexen er den kystnære skalaen og brukes uendret i lys-tema (og i tester).
// depthToFillVar pakker den i `var(--iso-depth-N, #hex)` så mørke temaer kan
// overstyre sjøblåen via applyTheme uten å miste fallbacken.
//
// v11.0.50: kollapset fra 5 til 3 bånd. Flåtens tilgjengelighets- og kajakk-
// eksperter påpekte at fem nær-identiske blåtoner er umulige å skille i sol og
// for svaksynte — og graderingen forsvinner uansett under relieffet. Tre tydelig
// adskilte bånd (grunt / middels / dypt) leser bedre. Variabel-indeksene 1/3/5
// beholdes så `--iso-depth-1..5` fra applyTheme fortsatt treffer.
const DEPTH_BANDS = [
  [5, 1, '#d8eaf2'],         // grunt 0–5 m — sjekk for skjær
  [20, 3, '#a6cfe2'],        // middels 5–20 m
  [Infinity, 5, '#79b3d2'],  // dypt 20+ m
]

function depthBand(dybde) {
  const d = Number.isFinite(dybde) ? dybde : 0
  return DEPTH_BANDS.find(b => d < b[0]) ?? DEPTH_BANDS[DEPTH_BANDS.length - 1]
}

export function depthToColor(dybde) {
  return depthBand(dybde)[2]
}

// Tema-bevisst variant: `fill`-verdi som følger valgt tema. Brukes ved bygging
// (inline style) der live tema-bytte ellers ikke ville nådd sjø-flatene fordi
// fargen var hardkodet hex. Mørke temaer setter --iso-depth-1..5 (applyTheme).
export function depthToFillVar(dybde) {
  const [, idx, hex] = depthBand(dybde)
  return `var(--iso-depth-${idx}, ${hex})`
}

// v12.0.17: 307-dybdefyllet flyttet fra per-polygon inline-style (~45 B) til
// CSS-klasser (~14 B): depthBandClass gir klassen for en polygon, og
// depthBandFills gir (klasse, fill)-parene symbolizer-CSS-en emitterer regler
// for. Fill-verdiene er identiske med depthToFillVar (tema-bevisste).
export function depthBandClass(dybde) {
  return `dyp-${depthBand(dybde)[1]}`
}

export function depthBandFills() {
  return DEPTH_BANDS.map(([, idx, hex]) => ({ cls: `dyp-${idx}`, fill: `var(--iso-depth-${idx}, ${hex})` }))
}

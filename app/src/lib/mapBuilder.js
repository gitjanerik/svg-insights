// Delt SVG-byggeverktøy for ISOM-inspirerte turkart.
// Bruker WGS84 → UTM 32N og produserer et lagdelt SVG med mm-baserte
// streker (print-kvalitet) basert på en data-drevet ISOM-katalog.
//
// Brukes både fra build-vardasen-svg.js (Node) og fra MapPickerView.vue
// (klient-side ved kart-generering).

import { wgs84ToUtm32 } from './utm.js'
import {
  classifyToIsom,
  isTrigPoint,
  buildIsomDefs,
  buildIsomCss,
  isomCatalog,
} from './symbolizer.js'
import { buildContours, detectKnauser, detectCliffs } from './dem.js'
import { fetchDEM } from './demFetcher.js'
import { polylineToPath, simplifyDP } from './pathUtils.js'
import { classifyBuildings, multiPolyToPath } from './buildingMass.js'
import { computeCHM, sampleCHMInPolygon, classifyVegetationFromCHM } from './canopyHeight.js'
import { depthToColor } from './sjokartFetcher.js'
// coastline.js: rekonstruerer LAND-polygoner fra OSM natural=coastline
// linjer. Brukes KUN som siste fallback i kyst-områder der hverken N50
// Havflate eller Sjøkart Dybdeareal returnerer sjø-polygoner. Ble fjernet
// i v6.8.0 pga wedger-bug på lake-mistags (Mjøsa, Setten); reintrodusert
// i v6.10.2 med strikt 50% bbox-areal-filter + kun aktiv når andre vann-
// kilder feiler. v6.8.4 ring-stitching reduserer wedger-risiko ytterligere.
import { buildLandPolygonsFromCoastline } from './coastline.js'
import polygonClipping from 'polygon-clipping'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export function buildOverpassQuery(bbox) {
  return `
[out:json][timeout:90][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)$"];
  way["highway"~"^(path|track|footway|bridleway|cycleway|steps)$"];
  way["natural"="water"];
  way["natural"="coastline"];
  way["water"];
  way["waterway"~"^(stream|river|canal|ditch)$"];
  way["natural"="wetland"];
  way["natural"~"^(wood|scree|bare_rock)$"];
  way["landuse"~"^(forest|meadow|grass|farmland)$"];
  way["building"];
  way["leisure"~"^(park|pitch|playground)$"];
  way["barrier"~"^(fence|wall)$"];
  way["power"="line"];
  way["place"~"^(island|islet)$"];
  way["man_made"~"^(pier|breakwater)$"];
  way["aerialway"];
  way["railway"~"^(rail|tram|narrow_gauge|light_rail|subway|funicular|monorail)$"];
  way["piste:type"];
  way["leisure"="track"]["sport"="skiing"];
  node["natural"="peak"];
  node["natural"="saddle"];
  node["natural"="cave_entrance"];
  node["man_made"~"^(adit|mineshaft|survey_point|triangulation_pillar)$"];
  node["historic"~"^(mine|survey_point)$"];
  node["survey_point"];
  node["geodesic"];
  node["seamark:type"];
  node["place"~"^(locality|hamlet|village|town|city|suburb|neighbourhood|quarter|isolated_dwelling|farm)$"];
  relation["natural"="water"];
  relation["natural"~"^(bay|strait)$"];
  relation["place"~"^(sea|ocean)$"];
  relation["place"~"^(island|islet)$"];
  relation["piste:type"];
);
out geom;
`.trim()
}

export async function fetchOverpass(bbox, { signal } = {}) {
  const body = 'data=' + encodeURIComponent(buildOverpassQuery(bbox))
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'svg-insights/6.0 (https://github.com/gitjanerik/svg-insights)',
    },
    body,
    signal,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Overpass-feil ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

export function bboxFromCenter(lat, lon, halfKm) {
  const dLat = halfKm / 111
  const dLon = halfKm / (111 * Math.cos(lat * Math.PI / 180))
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lon - dLon,
    east: lon + dLon,
  }
}

function fmt(n) { return Number(n.toFixed(2)) }

/**
 * Mutate ring i-place så orienteringen passer polygon-clipping (CCW i
 * standard y-up math = positivt shoelace signed area). I SVG y-down
 * blir det visuelt CW. Hvis ringen er feil vei, reverseres den.
 *
 * Polygon-clipping forutsetter strikt CCW outer + CW holes; uten denne
 * fix-en tolker biblioteket innkommende CW-rings som hull og produserer
 * invertert union (wedger).
 */
function ensureCCWForPolygonClipping(ring) {
  if (ring.length < 3) return
  // Shoelace med y-up math-konvensjon
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  // Negativt = CW i y-up = visuelt CCW i y-down → reverser så y-up blir CCW
  if (a < 0) ring.reverse()
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Sy sammen OSM-multipolygon relation-medlemmer til lukkede ringer.
 *
 * OSM lagrer multipolygon-relations som array av ways, der hver way er
 * et SEGMENT av en ring (ikke nødvendigvis lukket polygon). For å
 * rendre korrekt må vi greedy-joine segmenter med matchende endepunkter
 * til lukkede ringer.
 *
 * Tidligere bug: vi rendret hver way som sin egen polygon (path med Z),
 * så et lake-relation med 4 shore-segmenter ble 4 trekanter (wedger!).
 *
 * @param {Array<{type, geometry, role}>} members  relation.members
 * @param {string} role  'outer' eller 'inner'
 * @returns {Array<Array<{lat,lon}>>}  liste av sammensydde ringer
 */
function assembleRelationRings(members, role) {
  // Aksepter både eksplisitt rolle og tom rolle. OSM multipolygon-relations
  // bruker konsekvent 'outer'/'inner', men place=island/islet-relations har
  // ofte tom rolle ('') — de mangler outer/inner-distinksjon siden hele
  // relasjonen ER én øy. Når role='outer' og ingen members har den rollen,
  // faller vi tilbake til members med tom rolle (= alle relevante ways).
  const explicit = members
    .filter(m => m.type === 'way' && m.role === role && Array.isArray(m.geometry) && m.geometry.length >= 2)
  const fallback = role === 'outer' && explicit.length === 0
    ? members.filter(m => m.type === 'way' && (m.role === '' || m.role == null) && Array.isArray(m.geometry) && m.geometry.length >= 2)
    : []
  const segments = [...explicit, ...fallback].map(m => m.geometry.slice())
  const eps = 1e-6  // grader (~0.1 m ved 60° N)
  const samePt = (a, b) => Math.abs(a.lat - b.lat) < eps && Math.abs(a.lon - b.lon) < eps
  const rings = []
  while (segments.length > 0) {
    let chain = segments.shift()
    // Allerede lukket?
    if (samePt(chain[0], chain[chain.length - 1])) {
      rings.push(chain)
      continue
    }
    // Greedy: prøv å append/prepend andre segmenter til chain blir lukket
    let merged = true
    while (merged) {
      merged = false
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const head = chain[0], tail = chain[chain.length - 1]
        const sHead = seg[0], sTail = seg[seg.length - 1]
        if (samePt(tail, sHead)) {
          chain = chain.concat(seg.slice(1))
          segments.splice(i, 1); merged = true; break
        }
        if (samePt(tail, sTail)) {
          chain = chain.concat(seg.slice(0, -1).reverse())
          segments.splice(i, 1); merged = true; break
        }
        if (samePt(head, sTail)) {
          chain = seg.slice(0, -1).concat(chain)
          segments.splice(i, 1); merged = true; break
        }
        if (samePt(head, sHead)) {
          chain = seg.slice(1).reverse().concat(chain)
          segments.splice(i, 1); merged = true; break
        }
      }
      // Lukket?
      if (samePt(chain[0], chain[chain.length - 1])) break
    }
    if (chain.length >= 3) rings.push(chain)
  }
  return rings
}

/**
 * Slå sammen ways som har samme `name`-tag til én polygon. Bruker
 * polygon-clipping union på SVG-projiserte ringer. Returnerer en
 * blanding av originale (unike eller navnløse) ways og syntetiske
 * "merged-water"-elementer med _mergedRings (polygon-clipping format:
 * MultiPolygon = array av polygoner, hver polygon = array av ringer).
 *
 * Fanger opp typisk OSM-tilfelle der en innsjø er delt over et sund/bro
 * og hver del har samme navn (f.eks. Setten med Hestesund-bro).
 */
function unionByName(elements, project) {
  const byName = new Map()
  const result = []

  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) {
      result.push(el)
      continue
    }
    const name = el.tags?.name?.trim()
    if (!name) {
      result.push(el)
      continue
    }
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(el)
  }

  for (const [name, group] of byName) {
    if (group.length === 1) {
      result.push(group[0])
      continue
    }
    try {
      const inputs = group.map(el => {
        const ring = el.geometry.map(g => {
          const p = project(g.lat, g.lon)
          return [p.x, p.y]
        })
        if (ring.length > 0) {
          const f = ring[0], l = ring[ring.length - 1]
          if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]])
        }
        // polygon-clipping krever CCW outer-rings (positivt signed area i
        // standard y-up matematikk-konvensjon). Vi jobber i SVG y-down,
        // så CCW visuelt = NEGATIVT signed area i shoelace-formula.
        // Hvis ringen er CW visuelt (positivt signed area i y-down =
        // negativt y-up), reverser så biblioteket tolker den som outer
        // istedenfor hull. Bug-en før dette fix-en var at polygon-clipping
        // tolket CW-rings som "hull" og produserte invertert union →
        // wedger og merkelige polygoner.
        ensureCCWForPolygonClipping(ring)
        return [[ring]]
      })
      const merged = polygonClipping.union(...inputs)
      result.push({
        type: 'merged-water',
        id: group[0].id,
        tags: { ...group[0].tags },
        _mergedRings: merged,
        _mergedFromCount: group.length,
      })
      console.log(`[Vann-merge] "${name}": ${group.length} → 1 multipolygon`)
    } catch (e) {
      console.warn(`[Vann-merge] "${name}" feilet (${e.message}) — beholder originalene`)
      result.push(...group)
    }
  }

  return result
}

// Layer-rekkefølge (z-order, bunn til topp). Inspirert av ISOM 2017.
//
// Merk: ISOM 522 (tett bebyggelse) er ikke listet her — den rendres
// separat fra urbanMassMultiPoly mellom GROUND_CODES og WATER_CODES
// slik at vann og høydekurver legger seg over bymassen og forblir
// lesbare i tett bebygde områder (f.eks. Oslo sentrum).
// 512 (slalombakke) er areal-feature og rendres som ground sammen med
// vegetasjon — under vann og over skog så bakken vises tydelig.
const GROUND_CODES = ['401', '403', '404', '406', '407', '408', '409', '210', '512']
// Vann-stack: dybdeareal (Sjøkart) først som lyseste, så myr-pattern,
// deretter saltvann/innsjø/tjern (lokale, mer mettete blå), så
// dybdekontur-linjer og bekker øverst.
const WATER_CODES  = ['307', '308', '309', '303', '301', '302', '306', '304', '305']
// Land-overlay: OSM `place=island/islet` polygoner i kremgul som dekker
// over feilplassert OSM-vann. Renders ETTER vann-stacken.
const LAND_OVERLAY_CODES = ['001']
// Veier/stier + ski-infrastruktur (510 lysløype, 511 heistrasé) i samme
// stack som veier siden de visuelt er linjer og ofte krysser veinettet.
const ROAD_CODES   = ['501', '502', '503', '504', '515', '505', '506', '507', '508', '510', '511']
const UPPER_CODES  = ['521', '525', '528', '533']
// Plassholder-koder for lag som rendres separat (konturer/stupkanter).
// Beholdes for at MapView sin lag-toggle skal kunne finne tomme grupper.
const PLACEHOLDER_CODES = ['101', '102', '103', '104', '201', '203', '211']
const LAYER_ORDER = [
  ...GROUND_CODES,
  ...WATER_CODES,
  ...LAND_OVERLAY_CODES,
  ...PLACEHOLDER_CODES,
  ...ROAD_CODES,
  ...UPPER_CODES,
  '522',
]

const POLYGON_CODES = new Set(['001', '401', '403', '404', '406', '407', '408', '409', '210', '301', '302', '303', '307', '308', '309', '512', '521', '522'])
const LINE_CODES = new Set(['304', '305', '306', '501', '502', '503', '504', '505', '506', '507', '508', '510', '511', '515', '525', '528', '201', '203', '101', '102', '103', '104'])

/**
 * Bygg ferdig SVG-streng for et bbox + Overpass-elementer. ISOM-inspirert
 * symbolisering med mm-baserte streker for print.
 *
 * @param {Array} elements   - Overpass-elementer
 * @param {Object} bbox      - { south, west, north, east } i WGS84
 * @param {Object} [options]
 * @param {number} [options.scaleDenom=10000]
 * @param {boolean} [options.printSize=true]
 * @param {Object} [options.dem]               Pre-prosessert DEM (valgfritt)
 * @param {number} [options.contourIntervalM=5]
 * @param {boolean} [options.includeKnauser=true]
 * @param {boolean} [options.includeCliffs=true]
 * @returns {{ svg: string, counts: object, meta: object }}
 */
export function buildSvg(elements, bbox, options = {}) {
  const {
    scaleDenom = 10000,
    printSize = true,
    dem = null,
    dom = null,                    // Digital overflate-modell for CHM/vegetasjon
    contourIntervalM = 5,
    includeKnauser = true,
    includeCliffs = true,
    skipContoursIfSynthetic = false,
    // v6.10.2: brukes fortsatt av MapPickerView for å trigge coastline-
    // rekonstruksjon (`buildLandPolygonsFromCoastline`) — ringene brukes i
    // SEA-mode som bidrag til land-overlay.
    useCoastlineFallback = false,
    // v7.1.0: 'land' (kremgul bg + alle features, default) eller 'sea'
    // (sjø-blå bg + kremgul land-overlay fra coastline-rekonstruksjon +
    // OSM natural=land-polygoner). Brukeren velger eksplisitt i picker
    // for kyst-områder. v7.0.0 duomap-mask-arkitekturen er erstattet av
    // dette valget — én rendering per kart, brukeren bestemmer fokus.
    mapType = 'land',
    // v7.1.5: feilmeldinger fra Sjøkart-WFS som ikke svarte. Eksponeres
    // i meta så MapView UI kan vise "WFS feilet (CORS)" når sjøkart-
    // counts er 0 — skiller data-mangel fra rendering-bug.
    sjokartFetchErrors = [],
    // v7.1.10: response-samples når WFS returnerer 0 features. Brukes
    // i MapView for å vise hva serveren faktisk sa (ofte ServiceException
    // eller tom FeatureCollection).
    sjokartDebugSamples = [],
  } = options

  // Hvis DEM er syntetisk og bruker har bedt om at vi skal hoppe over
  // konturer i det tilfellet, bruk DEM kun til ingenting (eller faktisk
  // dropp den helt slik at hopp-igjennom-koden ikke prøver å bygge konturer)
  const isSyntheticDEM = dem?.source?.startsWith('synthetic')
  const usableDem = (skipContoursIfSynthetic && isSyntheticDEM) ? null : dem

  const sw = wgs84ToUtm32(bbox.south, bbox.west)
  const ne = wgs84ToUtm32(bbox.north, bbox.east)
  const minE = Math.min(sw.e, ne.e)
  const maxE = Math.max(sw.e, ne.e)
  const minN = Math.min(sw.n, ne.n)
  const maxN = Math.max(sw.n, ne.n)
  const widthM = maxE - minE
  const heightM = maxN - minN

  const project = (lat, lon) => {
    const utm = wgs84ToUtm32(lat, lon)
    return {
      x: utm.e - minE,
      y: heightM - (utm.n - minN),
    }
  }

  const pathFromGeometry = (geom, close = false, simplifyToleranceM = 0) => {
    if (!geom || geom.length === 0) return ''
    let pts = geom.map(g => {
      const p = project(g.lat, g.lon)
      return [p.x, p.y]
    })
    if (simplifyToleranceM > 0 && pts.length > 3) {
      pts = simplifyDP(pts, simplifyToleranceM)
    }
    if (pts.length === 0) return ''
    let d = `M${fmt(pts[0][0])},${fmt(pts[0][1])}`
    for (let i = 1; i < pts.length; i++) {
      d += `L${fmt(pts[i][0])},${fmt(pts[i][1])}`
    }
    if (close) d += 'Z'
    return d
  }

  // Beregn approksimert polygon-areal i m² for et OSM-way
  const polygonAreaM2 = (geom) => {
    if (!geom || geom.length < 3) return 0
    const pts = geom.map(g => project(g.lat, g.lon))
    let a = 0
    for (let i = 0, n = pts.length; i < n; i++) {
      const j = (i + 1) % n
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
    }
    return Math.abs(a) / 2
  }

  // Areal-vektet polygon-sentroid i SVG-koord. Returnerer null for
  // degenererte polygoner (areal ≈ 0). Brukes til å plassere
  // elevasjons-label inne i innsjø-polygoner.
  const polygonCentroid = (geom) => {
    if (!geom || geom.length < 3) return null
    const pts = geom.map(g => project(g.lat, g.lon))
    let cx = 0, cy = 0, area = 0
    for (let i = 0, n = pts.length; i < n; i++) {
      const j = (i + 1) % n
      const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y
      cx += (pts[i].x + pts[j].x) * cross
      cy += (pts[i].y + pts[j].y) * cross
      area += cross
    }
    area /= 2
    if (Math.abs(area) < 1e-6) return null
    return { x: cx / (6 * area), y: cy / (6 * area) }
  }

  // Per-kategori forenkling og filtrering. Tunet for å holde SVG <1.5 MB
  // selv i tett bebygde områder som Vardåsen-bbox.
  const POLYGON_FILTER = {
    bygning: { simplifyM: 3.0, minAreaM2: 80 },
    skog:    { simplifyM: 4.0, minAreaM2: 300 },
    eng:     { simplifyM: 4.0, minAreaM2: 300 },
    aker:    { simplifyM: 4.0, minAreaM2: 300 },
    myr:     { simplifyM: 2.5, minAreaM2: 150 },
    vann:    { simplifyM: 2.0, minAreaM2: 50 },
    aapen:   { simplifyM: 4.0, minAreaM2: 300 },
  }
  const LINE_SIMPLIFY = {
    'vei-stor':  1.5,
    'vei-liten': 2.5,
    sti:         2.5,
    bekk:        2.0,
    tog:         2.0,
  }

  // Bucket pr ISOM-kode
  const buckets = {}
  for (const code of LAYER_ORDER) buckets[code] = []
  const peaks = []
  const places = []
  const skjaer = []        // ISOM 211 (sjøkart-grunner)
  const lanterner = []     // ISOM 533 (sjøkart-lanterner)
  const dybdepunkter = []  // sjøkart-soundings (tekst-label)
  const huler = []         // ISOM 215 (cave entrance)
  const gruver = []        // ISOM 216 (mine / sjakt)
  const trigpunkter = []   // ISOM 113 (trigonometric point)
  const stakerPort = []    // ISOM 540 (lateral port — rød)
  const stakerStb = []     // ISOM 541 (lateral starboard — grønn)
  const stakerCard = []    // ISOM 542 (cardinal)
  const stakerSpec = []    // ISOM 543 (spesial / safe water)

  const counts = { peak: 0, place: 0, skjaer: 0, lanterne: 0, dybdepunkt: 0, hule: 0, gruve: 0, trig: 0, stake: 0 }
  for (const code of LAYER_ORDER) counts[code] = 0

  // Samle OSM natural=coastline + man_made=pier/breakwater ways for siste-
  // fallback sjø-rekonstruksjon. Pier/breakwater er ofte boundary mellom
  // sjø og kunstig land (Sørenga, Fornebu, dock-anlegg) og må behandles
  // som land-grense på samme måte som coastline.
  const coastlineWays = []

  // v7.1.4: tellere for sjøkart-features (Kartverket WFS). Eksponeres
  // i meta og vises i MapView attribusjons-boks for synlig diagnose:
  // hvis alle er 0 → WFS feilet, ikke et rendering-problem.
  const sjokartCounts = { dybdeareal: 0, dybdekontur: 0, lanterne: 0, grunne: 0, dybdepunkt: 0 }

  for (const el of elements) {
    const t = el.tags ?? {}
    if (t.sjokart && sjokartCounts[t.sjokart] !== undefined) sjokartCounts[t.sjokart]++
    if (el.type === 'way' && (t.natural === 'coastline' ||
                               t.man_made === 'pier' ||
                               t.man_made === 'breakwater')) {
      coastlineWays.push(el)
      continue
    }
    const cls = classifyToIsom(el)
    if (!cls) continue
    if (cls.cat === 'point') {
      if (cls.code === 'peak') { peaks.push(el); counts.peak++ }
      else if (cls.code === 'place') { places.push(el); counts.place++ }
      else if (cls.code === '211') { skjaer.push(el); counts.skjaer++ }
      else if (cls.code === '533') { lanterner.push(el); counts.lanterne++ }
      else if (cls.code === '215') { huler.push(el); counts.hule++ }
      else if (cls.code === '216') { gruver.push(el); counts.gruve++ }
      else if (cls.code === '113') { trigpunkter.push(el); counts.trig++ }
      else if (cls.code === '540') { stakerPort.push(el); counts.stake++ }
      else if (cls.code === '541') { stakerStb.push(el); counts.stake++ }
      else if (cls.code === '542') { stakerCard.push(el); counts.stake++ }
      else if (cls.code === '543') { stakerSpec.push(el); counts.stake++ }
      else if (cls.code === 'dybdepunkt') { dybdepunkter.push(el); counts.dybdepunkt++ }
      continue
    }
    if (buckets[cls.code]) {
      buckets[cls.code].push(el)
      counts[cls.code]++
    }
  }

  // ── Sjø-rekonstruksjon fra OSM natural=coastline (standard for kyst) ──
  // Når useCoastlineFallback er aktiv (alle bboxer der OSM har coastline-
  // ways): bygg LAND-polygoner og bytt SVG-bakgrunn til sjø-blå. Sjøkart
  // og N50 Havflate maler dybdetonet detalj OVER den blå bakgrunnen.
  //
  // v6.21.0: ikke lenger «siste fallback». Tidligere ble coastline-modus
  // bare aktivert hvis Sjøkart og N50 begge manglet — men de har ofte
  // sparse dekning som gir kremgul-flekk-sjø i stedet for kontinuerlig
  // blå. Coastline-rekonstruksjon er det eneste som garanterer sjø-fyll.
  let coastlineLandRings = []
  let coastlineMode = false
  if (useCoastlineFallback && coastlineWays.length > 0) {
    try {
      const result = buildLandPolygonsFromCoastline(coastlineWays, project, widthM, heightM)
      coastlineLandRings = result.rings
      // v6.21.1: aktiver coastlineMode (blå bg) når det finnes coastline-
      // ways UANSETT om rekonstruksjon ga land-polygoner. Hvis vi har
      // coastline-data men ringer feiler (algoritme-edge-case, OSM-data
      // fragmentert), er en blå bg uten cream-land-overlay LANGT bedre
      // enn 100% kremgul over hele sjøen. Ground-layers (vegetasjon,
      // bygninger, urbanmass) og place=island/islet-overlays dekker
      // de fleste viktige land-arealer på toppen. Brukerne ser blå sjø
      // selv ved fragmentert OSM-tagging.
      coastlineMode = true
      console.log(`[Kystlinje] ${coastlineWays.length} coastline-ways → ${coastlineLandRings.length} land-polygoner (${result.closedRingsCount} lukkede øyer + ${result.openArcsCount} bbox-lukkede mainland)`)
      if (coastlineLandRings.length === 0) {
        console.warn(`[Kystlinje] 0 ringer rekonstruert — bg blir blå men land kan se ufullstendig ut. Stoler på ground-layers og place=island for land-dekning.`)
      }
    } catch (e) {
      console.warn(`[Kystlinje] Land-rekonstruksjon feilet: ${e.message}`)
    }
  }

  // ── Vann-polygoner med samme navn slås sammen ────────────────────────
  // OSM deler ofte store innsjøer i flere polygoner (f.eks. Setten med
  // Hestesund som strait på midten — mappet som to separate ways). Hvis
  // de har samme `name`-tag, slår vi dem sammen til én polygon med
  // polygon-clipping union, slik at innsjøen renders som én sammen-
  // hengende blå flate med bro/vei oppå.
  for (const code of ['301', '302', '303']) {
    if (buckets[code].length < 2) continue
    buckets[code] = unionByName(buckets[code], project)
  }

  // ── Vegetasjons-klassifisering via CHM (DOM − DTM) ───────────────────
  // For hvert OSM-skog-polygon: sample CHM og bestem ISOM-kode basert
  // på vegetasjonshøyde og varians. Beveger features mellom buckets.
  let chm = null
  let vegReclassified = 0
  if (dem && dom) {
    try {
      chm = computeCHM(dem, dom)
      console.log(`[CHM] Beregnet ${chm.cols}×${chm.rows} celler`)
      const oldSkogCodes = ['405', '406', '407', '408', '409']
      const allSkog = []
      for (const c of oldSkogCodes) {
        for (const el of buckets[c] ?? []) allSkog.push({ code: c, el })
        buckets[c] = []
        counts[c] = 0
      }
      for (const { code, el } of allSkog) {
        if (el.type === 'way' && el.geometry) {
          const ring = el.geometry.map(g => {
            const p = project(g.lat, g.lon)
            return [p.x, p.y]
          })
          const stats = sampleCHMInPolygon(chm, ring)
          const newCode = classifyVegetationFromCHM(stats, code)
          if (buckets[newCode]) {
            buckets[newCode].push(el)
            counts[newCode]++
            if (newCode !== code) vegReclassified++
          }
        } else {
          buckets[code].push(el)
          counts[code]++
        }
      }
      console.log(`[CHM] Re-klassifiserte ${vegReclassified} vegetasjons-features`)
    } catch (e) {
      console.warn(`[CHM] Klassifisering feilet: ${e.message}`)
    }
  }

  // ── ISOM 522: tette bebyggelse-klynger ───────────────────────────────
  // Slå sammen tett bebygde områder til urbanmasse-multipolygoner med
  // pattern-fyll. Reduserer SVG-størrelsen og gir bedre kart-look.
  let urbanMassMultiPoly = []
  if (buckets['521'].length >= 4) {
    const buildingsXY = buckets['521']
      .filter(el => el.geometry && el.geometry.length >= 3)
      .map(el => ({
        ring: el.geometry.map(g => {
          const p = project(g.lat, g.lon)
          return [p.x, p.y]
        }),
        original: el,
      }))
    const { urbanMass, scattered } = classifyBuildings(buildingsXY, {
      neighborRadiusM: 15,
      minClusterSize: 3,
      bufferM: 6,
    })
    if (urbanMass.length > 0) {
      urbanMassMultiPoly = urbanMass
      // Erstatt 521-bucket med kun spredte bygninger
      buckets['521'] = scattered.map(b => b.original)
      counts['521'] = buckets['521'].length
      counts['522'] = urbanMass.length
    }
  }

  // ── DEM-deriverte features (konturer, knauser, stupkanter) ───────────
  let demFeatures = { contours: { features: [] }, knauser: [], cliffs: [], equidistanceM: null }
  if (usableDem) {
    const c = buildContours(usableDem, contourIntervalM, 5)
    const k = includeKnauser ? detectKnauser(usableDem, 5, 1.5) : []
    const cl = includeCliffs ? detectCliffs(usableDem, 45, 10) : []
    demFeatures = { contours: c, knauser: k, cliffs: cl, equidistanceM: contourIntervalM }
  }

  // Bygg ISOM-defs (patterns + symbols) og CSS
  const { defs: isomDefs, patternIds, symbolIds } = buildIsomDefs(isomCatalog)
  const isomCss = buildIsomCss(isomCatalog, patternIds)

  const layerSvg = (code) => {
    const els = buckets[code]
    if (!els.length) return `  <g data-layer="${categoryFor(code)}" data-iso="${code}"></g>\n`
    const cat = categoryFor(code)

    if (POLYGON_CODES.has(code)) {
      const filter = POLYGON_FILTER[cat] ?? { simplifyM: 0, minAreaM2: 0 }
      // Hver feature får sin egen <path> så overlappende polygoner ikke
      // kanselleres av evenodd. Holes inni en relation/multipolygon
      // hånderes fortsatt med evenodd internt i samme path.
      const pathElements = []
      for (const el of els) {
        let d = ''
        let src = el._source ?? (el._mergedRings ? 'merged' : el.type)
        const name = el.tags?.name ?? el.tags?.navn ?? ''
        if (el.type === 'merged-water' && el._mergedRings) {
          // polygon-clipping output: én <path> per topologisk polygon
          // (outer + dens hull), så holes virker via evenodd uten at
          // separate polygoner kanselleres mot hverandre.
          for (let pi = 0; pi < el._mergedRings.length; pi++) {
            const polygon = el._mergedRings[pi]
            const ringPaths = []
            for (let ring of polygon) {
              if (ring.length < 3) continue
              if (filter.simplifyM > 0 && ring.length > 3) {
                ring = simplifyDP(ring, filter.simplifyM)
                if (ring.length < 3) continue
              }
              let rd = `M${fmt(ring[0][0])},${fmt(ring[0][1])}`
              for (let i = 1; i < ring.length; i++) rd += `L${fmt(ring[i][0])},${fmt(ring[i][1])}`
              rd += 'Z'
              ringPaths.push(rd)
            }
            if (ringPaths.length > 0) {
              pathElements.push(
                `    <path d="${ringPaths.join(' ')}" fill-rule="evenodd" data-src="merged" data-name="${xmlEscape(name)}"/>`
              )
            }
          }
          continue
        }
        if (el.type === 'way' && el.geometry) {
          if (filter.minAreaM2 && polygonAreaM2(el.geometry) < filter.minAreaM2) continue
          d = pathFromGeometry(el.geometry, true, filter.simplifyM)
        } else if (el.type === 'relation' && el.members) {
          // OSM multipolygon: outer/inner-rings er splittet over flere
          // ways. Sy sammen først (greedy join på matchende endepunkter)
          // så vi får ekte lukkede ringer i stedet for segment-trekanter.
          const outerRings = assembleRelationRings(el.members, 'outer')
          const innerRings = assembleRelationRings(el.members, 'inner')
          const subpaths = []
          for (const ring of [...outerRings, ...innerRings]) {
            const sd = pathFromGeometry(ring, true, filter.simplifyM)
            if (sd) subpaths.push(sd)
          }
          d = subpaths.join(' ')
        }
        if (d) {
          // v7.1.4: ISOM 307 (Sjøkart dybdeareal) får per-polygon fill
          // basert på snitt-dybde. Catalog default-fyll er identisk med
          // SEA_BLUE bg, så en flat fill ville vært usynlig. depthToColor
          // gir gradient #b6daee (grunt) → #1f5d8a (dypt) som synliggjør
          // dybde-shading mot bg.
          let inlineStyle = ''
          if (code === '307' && el.tags) {
            const minD = Number(el.tags.minDybde)
            const maxD = Number(el.tags.maxDybde)
            const avgD = Number.isFinite(minD) && Number.isFinite(maxD) ? (minD + maxD) / 2
                       : Number.isFinite(minD) ? minD
                       : Number.isFinite(maxD) ? maxD
                       : null
            if (avgD != null) inlineStyle = ` style="fill: ${depthToColor(avgD)}"`
          }
          pathElements.push(
            `    <path d="${d}" fill-rule="evenodd"${inlineStyle} data-src="${xmlEscape(String(src))}" data-name="${xmlEscape(name)}"/>`
          )
        }
      }
      if (pathElements.length === 0) {
        return `  <g data-layer="${cat}" data-iso="${code}"></g>\n`
      }
      return `  <g data-layer="${cat}" data-iso="${code}">\n${pathElements.join('\n')}\n  </g>\n`
    }
    if (LINE_CODES.has(code)) {
      const tol = LINE_SIMPLIFY[cat] ?? 0
      // Jernbane (515) trenger to paths per geometri: solid sort base +
      // hvit dasharray-overlay som danner ladder-stripes (sviller).
      // CSS-regelen for `.overlay` settes opp i symbolizer.js.
      //
      // Tunnel-deteksjon: railway-ways tagget `tunnel=yes` rendres som
      // grå dashed phantom-linje uten sviller, og start/slutt-noder får
      // perpendikulære tunnel-portal-streker så det blir tydelig at
      // toget går under bakken (Lieråstunnelen mellom Asker og Drammen).
      if (code === '515') {
        const pathParts = []
        const entrances = []
        const TICK_HALF_M = 6  // 12 m total = ~1.2 mm @ 1:10 000
        for (const el of els) {
          const d = pathFromGeometry(el.geometry, false, tol)
          if (!d) continue
          const isTunnel = !!el.tags?.tunnel && el.tags.tunnel !== 'no'
          const tAttr = isTunnel ? ' data-tunnel="yes"' : ''
          pathParts.push(`    <path d="${d}"${tAttr}/>`)
          pathParts.push(`    <path d="${d}" class="overlay"${tAttr}/>`)
          if (isTunnel && el.geometry && el.geometry.length >= 2) {
            const g = el.geometry
            const p0 = project(g[0].lat, g[0].lon)
            const p1 = project(g[1].lat, g[1].lon)
            const len0 = Math.hypot(p1.x - p0.x, p1.y - p0.y)
            if (len0 > 0) entrances.push({ x: p0.x, y: p0.y, ux: (p1.x - p0.x) / len0, uy: (p1.y - p0.y) / len0 })
            const n = g.length
            const pE = project(g[n - 1].lat, g[n - 1].lon)
            const pE2 = project(g[n - 2].lat, g[n - 2].lon)
            const lenE = Math.hypot(pE.x - pE2.x, pE.y - pE2.y)
            if (lenE > 0) entrances.push({ x: pE.x, y: pE.y, ux: (pE.x - pE2.x) / lenE, uy: (pE.y - pE2.y) / lenE })
          }
        }
        for (const e of entrances) {
          const px = -e.uy, py = e.ux
          const x1 = e.x - px * TICK_HALF_M, y1 = e.y - py * TICK_HALF_M
          const x2 = e.x + px * TICK_HALF_M, y2 = e.y + py * TICK_HALF_M
          pathParts.push(`    <line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" class="tunnel-portal"/>`)
        }
        return `  <g data-layer="${cat}" data-iso="${code}">\n${pathParts.join('\n')}\n  </g>\n`
      }
      const paths = els.map(el => pathFromGeometry(el.geometry, false, tol)).filter(Boolean)
      return `  <g data-layer="${cat}" data-iso="${code}">\n${paths.map(d => `    <path d="${d}"/>`).join('\n')}\n  </g>\n`
    }
    return ''
  }

  const labelSvg = () => {
    const parts = []
    for (const el of peaks) {
      const p = project(el.lat, el.lon)
      const name = xmlEscape(el.tags?.name ?? '')
      const ele = el.tags?.ele ?? ''
      const eleNum = parseFloat(ele)
      // Vis navn over og høyde under separat når begge finnes; ellers
      // bare navn. Dette matcher orienteringskart-konvensjon (navn over
      // toppsymbol, høyde italic under). Krever mer plass enn én linje
      // men gir bedre lesbarhet ved zoom.
      // Hvis peak-noden også har trigpunkt-tagger (vanlig i Norge — én
      // OSM-node med både natural=peak og man_made=survey_point), erstatt
      // peak-prikken med trigpunkt-trekant. Beholder navn+ele label slik
      // at brukeren ser «Vardåsen 349» med trekant istedenfor sort prikk.
      const isTrig = isTrigPoint(el.tags)
      const symbol = isTrig
        ? `<use href="#${symbolIds.get('trigpunkt')}" x="-0.8mm" y="-0.8mm" width="1.6mm" height="1.6mm"/>`
        : `<use href="#${symbolIds.get('peak')}" x="-0.7mm" y="-0.7mm" width="1.4mm" height="1.4mm"/>`
      const lines = []
      if (name) {
        lines.push(`<text x="2mm" y="-0.4mm" data-label="peak">${name}</text>`)
        if (Number.isFinite(eleNum)) {
          lines.push(`<text x="2mm" y="3.6mm" data-label="peak-ele">${Math.round(eleNum)}</text>`)
        }
      } else if (Number.isFinite(eleNum)) {
        lines.push(`<text x="2mm" y="1.4mm" data-label="peak">${Math.round(eleNum)}</text>`)
      }
      parts.push(`    <g transform="translate(${fmt(p.x)},${fmt(p.y)})">${symbol}${lines.join('')}</g>`)
    }
    for (const el of places) {
      if (!el.tags?.name) continue
      const p = project(el.lat, el.lon)
      parts.push(`    <text x="${fmt(p.x)}" y="${fmt(p.y)}" dy="-0.5mm" text-anchor="middle" data-label="place">${xmlEscape(el.tags.name)}</text>`)
    }
    if (!parts.length) return '  <g data-layer="navn"></g>\n'
    return `  <g data-layer="navn">\n${parts.join('\n')}\n  </g>\n`
  }

  // ── Bygg land-mask: alle vann-polygoner blir svart, slik at
  // kontur-laget kun rendres der det er land. Konturer som "krysser"
  // innsjøer er nonsens (innsjø = én høyde) — de skal maskeres bort.
  const waterPaths = []
  for (const code of ['301', '302', '303', '308', '309']) {
    for (const el of buckets[code] ?? []) {
      if (el.type === 'merged-water' && el._mergedRings) {
        for (const polygon of el._mergedRings) {
          for (const ring of polygon) {
            if (ring.length < 3) continue
            let d = `M${fmt(ring[0][0])},${fmt(ring[0][1])}`
            for (let i = 1; i < ring.length; i++) d += `L${fmt(ring[i][0])},${fmt(ring[i][1])}`
            d += 'Z'
            waterPaths.push(d)
          }
        }
      } else if (el.type === 'way' && el.geometry) {
        waterPaths.push(pathFromGeometry(el.geometry, true))
      } else if (el.type === 'relation' && el.members) {
        // Sy sammen multipolygon-ringer før vi pusher (samme bug ville
        // ellers gi land-mask med segment-trekanter i stedet for lake)
        const outerRings = assembleRelationRings(el.members, 'outer')
        const innerRings = assembleRelationRings(el.members, 'inner')
        for (const ring of [...outerRings, ...innerRings]) {
          waterPaths.push(pathFromGeometry(ring, true))
        }
      }
    }
  }
  const landMaskSvg = waterPaths.length
    ? `<mask id="land-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${fmt(widthM)}" height="${fmt(heightM)}"><rect width="${fmt(widthM)}" height="${fmt(heightM)}" fill="white"/><path d="${waterPaths.join(' ')}" fill="black" fill-rule="evenodd"/></mask>`
    : ''
  const contourMaskAttr = waterPaths.length ? ' mask="url(#land-mask)"' : ''
  // Samme mask brukes for vegetasjon (404, 405-408 etc.) og 522 bymasse
  // slik at OSM-polygoner som strekker seg utover N50 vann-grensa blir
  // klippet i stedet for å bli rendret over vann (som ellers ville være
  // synlig hvis vann-polygonen ikke ligger oppå dem).
  const landMaskAttr = contourMaskAttr

  // ── Bygg kontur-, knaus- og cliff-lag fra DEM-features ───────────────
  // DEM-transformen (demFetcher / dem.js#gridToWorld) gir world-koord der
  // row=0 (GeoTIFF øverst = NORD i UTM-bbox) maps til y=0. Det er allerede
  // samme konvensjon som OSM-`project` (nord=y=0). Identitet er korrekt;
  // tidligere `heightM - y`-flip ga vertikal speiling = kontur-tall i feil
  // ende av kartet (rapportert v6.20.0, fikset v6.20.1).
  const demProject = ([x, y]) => [x, y]

  const contourMinorPaths = []
  const contourIndexPaths = []
  const contourLabels = []
  for (const f of demFeatures.contours.features) {
    const projected = f.coordinates.map(demProject)
    const d = polylineToPath(projected, true)
    if (f.isIndex) {
      contourIndexPaths.push(d)
      // Legg på elevasjons-tall midt på kurven (forenklet — bare første punkt)
      const mid = projected[Math.floor(projected.length / 2)]
      contourLabels.push({ x: mid[0], y: mid[1], elev: Math.round(f.elevation) })
    } else {
      contourMinorPaths.push(d)
    }
  }

  // ── Dybdekontur-labels (Sjøkart 306) ─────────────────────────────────
  // v7.1.5: meter-tall på sjø-kontur-linjer, samme stil som land-konturer.
  // Vi tegner kun på lengre dybdekontur-strekninger (>200m i SVG-koord)
  // for å unngå overcrowding. tags.dybde er i meter (positiv = under
  // havflaten).
  const dybdeKonturLabels = []
  for (const el of buckets['306'] ?? []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue
    const dybde = Number(el.tags?.dybde)
    if (!Number.isFinite(dybde)) continue
    const pts = el.geometry.map(g => project(g.lat, g.lon))
    // Estimere total lengde i SVG-meter
    let len = 0
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    }
    if (len < 200) continue  // kort segment — skip label
    const mid = pts[Math.floor(pts.length / 2)]
    dybdeKonturLabels.push({ x: mid.x, y: mid.y, dybde: Math.round(dybde) })
  }

  // ── Navn og elevasjon på innsjøer/tjern ──────────────────────────────
  // For hver innsjø/tjern (301/302): rendrer navn (når OSM har `name`-tag)
  // og høyde over havet (når DEM er tilgjengelig). Brukes for orientering
  // og for å lese kartet ved zoom-inn.
  //
  // Terskel:
  //   - Felles MIN_AREA (1500 m², ~40×40 m). Norske tjern er ofte
  //     mindre enn 5000 m², så vi unifiserer: alle vann over terskel
  //     får både navn (hvis OSM har det) og moh (hvis DTM tilgjengelig).
  //
  // Skipped for saltvann (303 ≈ 0) og myr (308/309).
  const MIN_AREA = 1500
  const lakeLabels = []

  // Sample DEM ved et punkt i bbox-relativt koord-rom — samme som
  // `project()` returnerer (x ∈ [0, widthM], y ∈ [0, heightM] med y=0
  // = nord). Transformen (originX/Y=0, positiv pixelHeight) gjør at
  // row=0 (GeoTIFF nord) ↔ yM=0 stemmer direkte.
  const sampleDem = usableDem
    ? (xM, yM) => {
        const t = usableDem.transform
        const col = Math.round((xM - t.originX) / t.pixelWidth)
        const row = Math.round((yM - t.originY) / t.pixelHeight)
        if (col < 0 || col >= usableDem.cols || row < 0 || row >= usableDem.rows) return null
        const v = usableDem.data[row * usableDem.cols + col]
        if (v === usableDem.noData) return null
        return v
      }
    : null

  // Areal og sentroid fra en SVG-projisert ring (brukes for merged-water).
  const ringAreaCentroid = (ring) => {
    if (!ring || ring.length < 3) return null
    let a = 0, cx = 0, cy = 0
    for (let i = 0, n = ring.length; i < n; i++) {
      const j = (i + 1) % n
      const cr = ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]
      a += cr
      cx += (ring[i][0] + ring[j][0]) * cr
      cy += (ring[i][1] + ring[j][1]) * cr
    }
    if (Math.abs(a) < 1e-6) return null
    return { areaM2: Math.abs(a) / 2, x: cx / (3 * a), y: cy / (3 * a) }
  }

  for (const code of ['301', '302']) {
    for (const el of buckets[code] ?? []) {
      let areaM2 = 0
      let centroid = null

      if (el.type === 'merged-water' && el._mergedRings && el._mergedRings.length) {
        // Bruk største outer-ring (første polygon, første ring) som proxy
        const ring = el._mergedRings[0]?.[0]
        const ac = ringAreaCentroid(ring)
        if (!ac) continue
        areaM2 = ac.areaM2
        centroid = { x: ac.x, y: ac.y }
      } else if (el.type === 'way' && el.geometry) {
        areaM2 = polygonAreaM2(el.geometry)
        centroid = polygonCentroid(el.geometry)
      } else {
        continue
      }
      if (!centroid) continue

      if (areaM2 < MIN_AREA) continue
      const name = (el.tags?.name ?? '').trim()

      let elev = null
      if (sampleDem) {
        const v = sampleDem(centroid.x, centroid.y)
        if (v != null && Number.isFinite(v)) elev = Math.round(v)
      }

      if (name || elev != null) {
        lakeLabels.push({ x: centroid.x, y: centroid.y, name, elev })
      }
    }
  }

  const knauserSvg = demFeatures.knauser.map(k => {
    const [x, y] = demProject([k.x, k.y])
    return `    <use href="#${symbolIds.get('knaus')}" x="${fmt(x - 0.6)}mm" y="${fmt(y - 0.6)}mm" width="1.2mm" height="1.2mm"/>`
  }).join('\n')

  // ── Sjøkart: skjær (211), lanterner (533), dybdepunkter ──────────────
  // Rendres som <use> mot point-symbols i defs. Dybdepunkter rendres som
  // tekst-label med dybde-tall (paint-order: stroke for halo).
  const skjaerSvg = skjaer.map(el => {
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('skjaer')
    if (!sid) return ''
    return `    <use href="#${sid}" x="${fmt(p.x - 0.5)}mm" y="${fmt(p.y - 0.5)}mm" width="1mm" height="1mm"/>`
  }).filter(Boolean).join('\n')

  const lanterneSvg = lanterner.map(el => {
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('lanterne')
    if (!sid) return ''
    const name = xmlEscape(el.tags?.name ?? '')
    const labelPart = name
      ? `<text x="1mm" y="0.4mm" data-label="lanterne-tall">${name}</text>`
      : ''
    return `    <g transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${sid}" x="-0.8mm" y="-0.8mm" width="1.6mm" height="1.6mm"/>${labelPart}</g>`
  }).filter(Boolean).join('\n')

  // Hule (ISOM 215) og gruve (ISOM 216): point-symboler. Sentrert ±0.7mm
  // = 1.4mm bredde (matcher scaleMm i katalogen).
  const huleSvg = huler.map(el => {
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('hule')
    if (!sid) return ''
    return `    <use href="#${sid}" x="${fmt(p.x - 0.7)}mm" y="${fmt(p.y - 0.7)}mm" width="1.4mm" height="1.4mm"/>`
  }).filter(Boolean).join('\n')

  const gruveSvg = gruver.map(el => {
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('gruve')
    if (!sid) return ''
    return `    <use href="#${sid}" x="${fmt(p.x - 0.7)}mm" y="${fmt(p.y - 0.7)}mm" width="1.4mm" height="1.4mm"/>`
  }).filter(Boolean).join('\n')

  // Trigonometrisk punkt (ISOM 113): trekant-symbol 1.6mm
  const trigSvg = trigpunkter.map(el => {
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('trigpunkt')
    if (!sid) return ''
    return `    <use href="#${sid}" x="${fmt(p.x - 0.8)}mm" y="${fmt(p.y - 0.8)}mm" width="1.6mm" height="1.6mm"/>`
  }).filter(Boolean).join('\n')

  // Sjømerker (ISOM 540-543): stake-port (rød), starboard (grønn),
  // cardinal (gul/sort), spesial (gul). Alle 1.4mm sentrert.
  const renderStake = (list, symId) => list.map(el => {
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get(symId)
    if (!sid) return ''
    return `    <use href="#${sid}" x="${fmt(p.x - 0.7)}mm" y="${fmt(p.y - 0.7)}mm" width="1.4mm" height="1.4mm"/>`
  }).filter(Boolean).join('\n')
  const stakerPortSvg = renderStake(stakerPort, 'stake-port')
  const stakerStbSvg  = renderStake(stakerStb,  'stake-starboard')
  const stakerCardSvg = renderStake(stakerCard, 'stake-cardinal')
  const stakerSpecSvg = renderStake(stakerSpec, 'stake-special')

  const dybdepunktSvg = dybdepunkter.map(el => {
    const p = project(el.lat, el.lon)
    const dybde = el.tags?.dybde
    if (!dybde) return ''
    return `    <text x="${fmt(p.x)}" y="${fmt(p.y)}" text-anchor="middle" data-label="dybde-tall">${xmlEscape(dybde)}</text>`
  }).filter(Boolean).join('\n')

  // Cliff-teeth (ISOM 203): perpendikulær tann på nedside. Hvis vi har
  // ekte DEM, sampler vi høyde på begge sider av spine for å velge
  // riktig side; ellers default til høyre. Spacing ~20m (~2mm @ 1:10k),
  // tann-lengde ~5m (~0.5mm). Cliff-koord er bbox-relativt (samme rom
  // som transformen, originX/Y=0), så vi sampler direkte uten å legge
  // til minE/minN.
  const cliffSampleDem = sampleDem

  const cliffsSvg = demFeatures.cliffs.map(c => {
    const projected = c.coordinates.map(demProject)
    const linePath = polylineToPath(projected, false)
    const teethPaths = []
    const SPACING_M = 20
    const TOOTH_LEN_M = 5
    let acc = SPACING_M
    for (let i = 1; i < c.coordinates.length; i++) {
      const [x0, y0] = c.coordinates[i - 1]
      const [x1, y1] = c.coordinates[i]
      const dx = x1 - x0, dy = y1 - y0
      const segLen = Math.hypot(dx, dy)
      if (segLen < 1) continue
      const ux = dx / segLen, uy = dy / segLen
      const lpx = -uy, lpy = ux
      const rpx =  uy, rpy = -ux
      while (acc <= segLen) {
        const t = acc / segLen
        const cx = x0 + dx * t, cy = y0 + dy * t
        let side = [rpx, rpy]
        if (cliffSampleDem) {
          const sx = TOOTH_LEN_M * 1.5
          const lh = cliffSampleDem(cx + lpx * sx, cy + lpy * sx)
          const rh = cliffSampleDem(cx + rpx * sx, cy + rpy * sx)
          if (Number.isFinite(lh) && Number.isFinite(rh)) {
            side = lh < rh ? [lpx, lpy] : [rpx, rpy]
          }
        }
        const tipX = cx + side[0] * TOOTH_LEN_M
        const tipY = cy + side[1] * TOOTH_LEN_M
        const [csx, csy] = demProject([cx, cy])
        const [tsx, tsy] = demProject([tipX, tipY])
        teethPaths.push(`M${fmt(csx)},${fmt(csy)}L${fmt(tsx)},${fmt(tsy)}`)
        acc += SPACING_M
      }
      acc -= segLen
      if (acc < 0) acc = SPACING_M
    }
    const teeth = teethPaths.length
      ? `\n    <path d="${teethPaths.join(' ')}" data-cliff-teeth="1"/>`
      : ''
    return `    <path d="${linePath}" />${teeth}`
  }).join('\n')

  // v7.1.3: derived state for sjø-bakgrunn. Trengs i både meta (for at
  // MapView.applyTheme skal kunne re-applysere --bg) og senere i SVG-
  // komposisjon (bgFill, coastlineLandSvg). Beregnes før meta så vi kan
  // referere det.
  const isCoastalRender = coastlineLandRings.length > 0
  const useSeaBg = mapType === 'sea' || isCoastalRender

  const meta = {
    bbox,
    utmBbox: { minE, minN, maxE, maxN },
    widthM, heightM,
    scaleDenom,
    equidistance: demFeatures.equidistanceM,
    elevationRange: usableDem
      ? { min: Math.round(demFeatures.contours.minElevM), max: Math.round(demFeatures.contours.maxElevM) }
      : null,
    demSource: dem?.source ?? null,
    domSource: dom?.source ?? null,
    vegReclassified: chm ? vegReclassified : null,
    lakeLabels: lakeLabels.length,
    contoursSkipped: dem && !usableDem ? 'syntetisk DEM — ingen ekte høydekurver tilgjengelig' : null,
    // v7.1.0: mapType er den autoritative kart-modus-indikatoren
    // (brukervalg). v7.1.3: useSeaBg er derived state — true hvis bg
    // skal være blå (kyst-bbox eller eksplisitt sjø-modus). Brukes av
    // MapView.applyTheme for å re-applysere --bg etter theme-reset.
    mapType,
    useSeaBg,
    // v7.1.4: synlig sjøkart-feature-diagnose i kart-UI. Hvis alle 0 →
    // WFS feilet (CORS/nett), ikke rendering-problem.
    sjokartCounts,
    // v7.1.5: feilmeldinger fra Sjøkart-WFS — gjør UI i stand til å
    // vise konkret årsak (CORS, HTTP-feil, ikke-JSON-svar) når counts=0.
    sjokartFetchErrors,
    // v7.1.10: råe response-samples for diagnose når 0 features.
    sjokartDebugSamples,
    coastlineLandRings: coastlineLandRings.length || null,
    coastlineWaysCount: coastlineWays.length,
    useCoastlineFallback: !!useCoastlineFallback,
    isomVersion: '2017-2-derived',
    source: 'OpenStreetMap (ODbL) + ISOM-katalog v6.5' + (usableDem ? ` + DEM (${dem.source})` : ''),
    generated: new Date().toISOString(),
  }

  // ViewBox = meter (1 SVG-enhet = 1 m)
  const viewBox = `0 0 ${fmt(widthM)} ${fmt(heightM)}`

  // Print-størrelse: 1:10000 betyr at 1 m kart = 0.1 mm papir.
  // For å printe et 5×5 km kart i 1:10000 trenger vi 500×500 mm papir.
  // Vi setter width/height kun hvis printSize er true.
  const printAttrs = printSize
    ? `width="${fmt(widthM * 1000 / scaleDenom)}mm" height="${fmt(heightM * 1000 / scaleDenom)}mm"`
    : ''

  const renderCodes = (codes) => codes.map(layerSvg).join('')
  const groundLayers = renderCodes(GROUND_CODES)
  const waterLayers  = renderCodes(WATER_CODES)
  const landOverlayLayers = renderCodes(LAND_OVERLAY_CODES)
  const roadLayers   = renderCodes(ROAD_CODES)
  const upperLayers  = renderCodes(UPPER_CODES)
  const placeholderLayers = renderCodes(PLACEHOLDER_CODES)
  const labelLayer = labelSvg()

  const contourLayerSvg = (contourMinorPaths.length || contourIndexPaths.length)
    ? `  <g data-layer="kontur"${contourMaskAttr}>\n` +
      `    <g data-iso="101"><path d="${contourMinorPaths.join(' ')}" /></g>\n` +
      `    <g data-iso="102"><path d="${contourIndexPaths.join(' ')}" /></g>\n` +
      (contourLabels.length
        ? `    <g data-label="kontur-tall">\n${contourLabels.slice(0, 80).map(l =>
            `      <text x="${fmt(l.x)}" y="${fmt(l.y)}" text-anchor="middle">${l.elev}</text>`).join('\n')}\n    </g>\n`
        : '') +
      `  </g>\n`
    : ''

  const lakeLabelLayer = lakeLabels.length
    ? `  <g data-layer="vann">\n${lakeLabels.map(l => {
        const lines = []
        // Når både navn og elev finnes: stack name over senteret, elev under.
        // Når bare ett finnes: plasser sentrert. dy i mm via SVG-attributt så
        // posisjonen er print-skalert (1 mm = 1 mm på papir, uavhengig av
        // viewBox-meter).
        if (l.name) {
          const dyMm = l.elev != null ? -0.4 : 0.4
          lines.push(`    <text x="${fmt(l.x)}" y="${fmt(l.y)}" dy="${dyMm}mm" text-anchor="middle" data-label="vann-navn">${xmlEscape(l.name)}</text>`)
        }
        if (l.elev != null) {
          const dyMm = l.name ? 1.5 : 0.4
          lines.push(`    <text x="${fmt(l.x)}" y="${fmt(l.y)}" dy="${dyMm}mm" text-anchor="middle" data-label="vann-tall">${l.elev}</text>`)
        }
        return lines.join('\n')
      }).join('\n')}\n  </g>\n`
    : ''

  const knauserLayerSvg = knauserSvg
    ? `  <g data-layer="stein" data-iso="213">\n${knauserSvg}\n  </g>\n` : ''

  const cliffsLayerSvg = cliffsSvg
    ? `  <g data-layer="stupkant" data-iso="203">\n${cliffsSvg}\n  </g>\n` : ''

  // Sjøkart-punkter (skjær, lanterner) og dybdepunkt-labels.
  const skjaerLayerSvg = skjaerSvg
    ? `  <g data-layer="stein" data-iso="211">\n${skjaerSvg}\n  </g>\n` : ''
  const huleLayerSvg = huleSvg
    ? `  <g data-layer="stein" data-iso="215">\n${huleSvg}\n  </g>\n` : ''
  const gruveLayerSvg = gruveSvg
    ? `  <g data-layer="stein" data-iso="216">\n${gruveSvg}\n  </g>\n` : ''
  const trigLayerSvg = trigSvg
    ? `  <g data-layer="trig" data-iso="113">\n${trigSvg}\n  </g>\n` : ''
  const stakerLayerSvg = (stakerPortSvg || stakerStbSvg || stakerCardSvg || stakerSpecSvg)
    ? `  <g data-layer="staker">\n` +
      (stakerPortSvg ? `    <g data-iso="540">\n${stakerPortSvg}\n    </g>\n` : '') +
      (stakerStbSvg  ? `    <g data-iso="541">\n${stakerStbSvg}\n    </g>\n` : '') +
      (stakerCardSvg ? `    <g data-iso="542">\n${stakerCardSvg}\n    </g>\n` : '') +
      (stakerSpecSvg ? `    <g data-iso="543">\n${stakerSpecSvg}\n    </g>\n` : '') +
      `  </g>\n`
    : ''
  const lanterneLayerSvg = lanterneSvg
    ? `  <g data-layer="sjokart" data-iso="533">\n${lanterneSvg}\n  </g>\n` : ''
  const dybdepunktLayerSvg = dybdepunktSvg
    ? `  <g data-layer="dybde">\n${dybdepunktSvg}\n  </g>\n` : ''

  // v7.1.5: dybdekontur-meter-tall (samme stil som land-kontur). Tekst-
  // farge matcher dybde-kontur-stroke (#3a8db8) for visuell sammenheng.
  const dybdeKonturLabelSvg = dybdeKonturLabels.length
    ? `  <g data-label="dybde-kontur-tall">\n${dybdeKonturLabels.slice(0, 80).map(l =>
        `    <text x="${fmt(l.x)}" y="${fmt(l.y)}" text-anchor="middle">${l.dybde}</text>`).join('\n')}\n  </g>\n`
    : ''

  // ISOM 522 — tett bebyggelse pattern fyll. Y-flippet siden urbanMass-
  // ringene er i SVG-koordinatsystem (project() returnerer y-flippet).
  // Plasseres mellom vegetasjon og vann i z-order så vann/konturer
  // forblir lesbare over bymassen i tett bebygde områder.
  const urbanMassPath = urbanMassMultiPoly.length
    ? multiPolyToPath(urbanMassMultiPoly, fmt)
    : ''
  const urbanMassLayerSvg = urbanMassPath
    ? `  <g data-layer="bygning" data-iso="522"><path d="${urbanMassPath}" fill-rule="evenodd"/></g>\n`
    : ''

  // v7.1.3: kyst-bbox skal alltid ha blå sjø — også i Land-kart-modus.
  // Tidligere var bg-flippet bundet til mapType=sea; men brukerrapport
  // viser at LAND-kart i kystområde også trenger blå sjø for å se
  // korrekt ut (kremgul-flekker rundt øyer er bare forvirring). mapType
  // bestemmer FOKUS (sjøkart-detaljer eller ikke), ikke bg-fargen.
  const SEA_BLUE = '#9ec9de'  // matcher ISOM 307 dybdeareal-farge
  const landFill = isomCatalog.background.color
  // useSeaBg/isCoastalRender beregnet høyere oppe (før meta-blokken).
  const bgFill = useSeaBg ? SEA_BLUE : landFill

  // Render coastline-rekonstruerte land-ringer som kremgule polygoner
  // over blå bg når bg er blå. I begge modi (land/sea), så lenge vi
  // har kystdata. For pure innland skipper vi (kremgul-på-kremgul =
  // unødvendig).
  const coastlineLandSvg = useSeaBg && coastlineLandRings.length
    ? `  <g id="kyst-land" data-layer="land" data-iso="001">\n` +
      coastlineLandRings.map(ring => {
        if (ring.length < 3) return ''
        let d = `M${fmt(ring[0][0])},${fmt(ring[0][1])}`
        for (let i = 1; i < ring.length; i++) d += `L${fmt(ring[i][0])},${fmt(ring[i][1])}`
        d += 'Z'
        return `    <path d="${d}" fill="${landFill}" data-src="kystlinje"/>`
      }).filter(Boolean).join('\n') +
      `\n  </g>\n`
    : ''

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" class="isom-map" viewBox="${viewBox}" ${printAttrs} style="--bg: ${bgFill}" data-meta='${JSON.stringify(meta).replace(/'/g, '&apos;').replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}'>
  <defs>${isomDefs}${landMaskSvg}</defs>
  <style>${isomCss}</style>
  <g id="bakgrunn"><rect width="${fmt(widthM)}" height="${fmt(heightM)}" fill="${bgFill}"/></g>
${coastlineLandSvg}${landMaskAttr ? `<g${landMaskAttr}>${groundLayers}${urbanMassLayerSvg}</g>` : `${groundLayers}${urbanMassLayerSvg}`}${waterLayers}${landOverlayLayers}${lakeLabelLayer}${dybdepunktLayerSvg}${dybdeKonturLabelSvg}${contourLayerSvg}${roadLayers}${upperLayers}${knauserLayerSvg}${cliffsLayerSvg}${skjaerLayerSvg}${huleLayerSvg}${gruveLayerSvg}${trigLayerSvg}${stakerLayerSvg}${lanterneLayerSvg}${placeholderLayers}${labelLayer}</svg>
`

  return { svg, counts, meta }
}

function categoryFor(code) {
  // Mapping fra ISOM-kode til UI-kategori (for lag-toggling i MapView).
  // Flere koder kan ende i samme kategori (skog samler 406-409 osv).
  switch (code) {
    case '001':                                  return 'land'
    case '401': case '403':                     return 'aapen'
    case '404':                                  return 'aker'
    case '406': case '407': case '408': case '409': return 'skog'
    case '308': case '309':                     return 'myr'
    case '301': case '302': case '303': case '307': return 'vann'
    case '304': case '305': case '306':         return 'bekk'
    case '521': case '522':                     return 'bygning'
    case '501': case '502':                     return 'vei-stor'
    case '503': case '504':                     return 'vei-liten'
    case '505': case '506': case '507':         return 'sti'
    case '508':                                  return 'sykkel'
    case '510':                                  return 'lysloype'
    case '511':                                  return 'heistrase'
    case '512':                                  return 'slalombakke'
    case '515':                                  return 'tog'
    case '201': case '203':                     return 'stupkant'
    case '210': case '211': case '212': case '213':
    case '215': case '216':                          return 'stein'
    case '525': case '528':                     return 'linje'
    case '533':                                  return 'sjokart'
    case '113':                                  return 'trig'
    case '540': case '541': case '542': case '543': return 'staker'
    case '101': case '102': case '103': case '104': return 'kontur'
    default:                                     return 'other'
  }
}

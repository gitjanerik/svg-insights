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
  getIsomDef,
  isomCatalog,
} from './symbolizer.js'
import { buildContours, detectKnauser, detectCliffs } from './dem.js'
import { buildSeaFromDem, buildSeaShallowBands } from './seaFromDem.js'
import { depthToColor } from './sjokartFetcher.js'
import { fetchDEM } from './demFetcher.js'
import { polylineToPath, simplifyDP } from './pathUtils.js'
import { classifyBuildings, multiPolyToPath } from './buildingMass.js'
import { computeCHM, sampleCHMInPolygon, classifyVegetationFromCHM } from './canopyHeight.js'
import polygonClipping from 'polygon-clipping'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export function buildOverpassQuery(bbox) {
  return `
[out:json][timeout:90][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)$"];
  way["highway"~"^(path|track|bridleway|steps)$"];
  way["natural"="water"];
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
  node["place"~"^(locality|hamlet|village|town|city|suburb|neighbourhood|quarter|isolated_dwelling|farm)$"];
  node["amenity"="place_of_worship"];
  node["building"~"^(church|chapel)$"];
  way["amenity"="place_of_worship"];
  way["building"~"^(church|chapel)$"];
  node["amenity"="parking"];
  way["amenity"="parking"];
  node["barrier"~"^(gate|lift_gate|swing_gate|bollard|block|cycle_barrier|cattle_grid)$"];
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
// lesbare i tett bebygde områder (f.eks. Oslo sentrum). v8.9.28: 522
// toggles sammen med 521 under «Bygninger»-bryteren (categoryFor →
// 'bygning'), men beholdes som eget render-pass for å holde SVG-
// størrelsen i sjakk i tettbygde områder.
// 512 (slalombakke) er areal-feature og rendres som ground sammen med
// vegetasjon — under vann og over skog så bakken vises tydelig.
const GROUND_CODES = ['401', '403', '404', '406', '407', '408', '409', '210', '512']
// Vann-stack: dybdeareal (Sjøkart 307, diskrete blå-bånd pr dybde) først,
// så myr-pattern, så ISOM 303/301/302 (mer mettete blå overstyrer for navn-
// gitte vann), så bekker.
// v8.9.25: ISOM 306 (dybdekontur-linjer) er fjernet — de lå alt for tett
// og maskerte fargebåndene. Dybde formidles nå via 307-polygonens
// fargeskala (depthToColor) som har 4 distinkte blå-bånd.
const WATER_CODES  = ['307', '308', '309', '303', '301', '302', '304', '305']
// Land-overlay: OSM `place=island/islet` polygoner i kremgul som dekker
// over feilplassert OSM-vann. Renders ETTER vann-stacken.
const LAND_OVERLAY_CODES = ['001']
const ROAD_CODES   = ['501', '502', '503', '504', '515', '505', '506', '507', '510', '511']
const UPPER_CODES  = ['521', '525', '528']
// Plassholder-koder for lag som rendres separat (konturer/stupkanter).
const PLACEHOLDER_CODES = ['101', '102', '103', '104', '201', '203']
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
const LINE_CODES = new Set(['304', '305', '501', '502', '503', '504', '505', '506', '507', '510', '511', '515', '525', '528', '201', '203', '101', '102', '103', '104'])

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
    skipDemSea = false,
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
  //
  // v8.10.3 — Perf: skalér tersklene med kart-størrelse. Et 10×10 km kart
  // har 4× areal av et 5×5 km — uten skalering blir det fire ganger så mange
  // DOM-noder å rendre på samme skjerm. simplifyM skaleres med √(factor)
  // (mildere — bevarer hjørne-detalj på små polygoner), mens minAreaM2
  // skaleres lineært (filtrerer aggressivt på små features som likevel ikke
  // er synlige i 1:10000 ved fullt utzoomet kart). Referanse-størrelse 5 km;
  // factor er clampet [0.7, 2.5] så ekstreme bbox ikke kollapser geometri.
  const sizeFactor = Math.max(0.7, Math.min(2.5, widthM / 5000))
  const simpScale = Math.sqrt(sizeFactor)
  const areaScale = sizeFactor
  const POLYGON_FILTER = {
    // v8.9.30: senket bygning-terskelene så hytter (typisk 20–60 m²) ikke
    // forsvinner. 80 m² filtrerte bort hele kategorier av småhytter i
    // marka, og simplifyM 3.0 kollapset korner på små rektangler
    // (4×4 m polygon med DP 3.0 → degenerert). 10 m² + 1.5 m DP bevarer
    // hytter og spikertelt, mens skur < 10 m² fortsatt filtreres bort.
    bygning: { simplifyM: 1.5 * simpScale, minAreaM2: 10 * areaScale },
    skog:    { simplifyM: 4.0 * simpScale, minAreaM2: 300 * areaScale },
    eng:     { simplifyM: 4.0 * simpScale, minAreaM2: 300 * areaScale },
    aker:    { simplifyM: 4.0 * simpScale, minAreaM2: 300 * areaScale },
    myr:     { simplifyM: 2.5 * simpScale, minAreaM2: 150 * areaScale },
    vann:    { simplifyM: 2.0 * simpScale, minAreaM2: 50 * areaScale },
    aapen:   { simplifyM: 4.0 * simpScale, minAreaM2: 300 * areaScale },
  }
  const LINE_SIMPLIFY = {
    'vei-stor':  1.5 * simpScale,
    'vei-liten': 2.5 * simpScale,
    sti:         2.5 * simpScale,
    bekk:        2.0 * simpScale,
    tog:         2.0 * simpScale,
  }

  // Bucket pr ISOM-kode
  const buckets = {}
  for (const code of LAYER_ORDER) buckets[code] = []
  const peaks = []
  const places = []
  const huler = []         // ISOM 215 (cave entrance)
  const gruver = []        // ISOM 216 (mine / sjakt)
  const trigpunkter = []   // ISOM 113 (trigonometric point)
  const kirker = []        // ISOM 532-derivert (kirker / chapels)
  const parkeringer = []   // ISOM 534-derivert (amenity=parking)
  const broer = []         // ISOM 509-derivert (bridge=yes på highway/path)
  const bommer = []        // ISOM 526-derivert (barrier=gate/lift_gate/...)

  const counts = { peak: 0, place: 0, hule: 0, gruve: 0, trig: 0, kirke: 0, parkering: 0, bro: 0, bom: 0 }
  for (const code of LAYER_ORDER) counts[code] = 0

  for (const el of elements) {
    // Way-kirker (building=church / amenity=place_of_worship på en
    // bygnings-polygon) plukker vi opp UANSETT om classifyToIsom returnerer
    // bygnings-koden — også way-er som kun har amenity=place_of_worship
    // (uten building-tag) skal få korsmarkør.
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      const t = el.tags ?? {}
      if (t.amenity === 'place_of_worship' || t.building === 'church' || t.building === 'chapel') {
        kirker.push(el)
        counts.kirke++
      }
    }
    // Way-parkering: polygon med amenity=parking → ett P-symbol på centroid.
    // classifyToIsom returnerer '534' både for nodes og ways, men ways skal
    // ikke fortsette inn i buckets — vi rendrer dem som point her.
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3 && el.tags?.amenity === 'parking') {
      parkeringer.push(el)
      counts.parkering++
    }
    // Bro-deteksjon: way med bridge=yes (eller annen truthy bridge-verdi)
    // langs en høyveg-, sti-, fot-, eller togtrasé. Vi plasserer ett bru-
    // symbol på midten av way-en og roterer det langs sti-tangenten. OSM-
    // verdien `no` regnes som ikke-bro; alt annet (yes, viaduct, aqueduct,
    // boardwalk, movable osv.) regnes som bro.
    if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const b = el.tags?.bridge
      if (b && b !== 'no') {
        // Bare når way-en faktisk er en sti eller veg som vi rendrer.
        const t = el.tags
        const isRoute = !!(t.highway || t.railway || t.aerialway || t['piste:type'] || (t.leisure === 'track' && t.sport === 'skiing'))
        if (isRoute) {
          broer.push(el)
          counts.bro++
        }
      }
    }
    const cls = classifyToIsom(el)
    if (!cls) continue
    if (cls.cat === 'point') {
      if (cls.code === 'peak') { peaks.push(el); counts.peak++ }
      else if (cls.code === 'place') { places.push(el); counts.place++ }
      else if (cls.code === '215') { huler.push(el); counts.hule++ }
      else if (cls.code === '216') { gruver.push(el); counts.gruve++ }
      else if (cls.code === '113') { trigpunkter.push(el); counts.trig++ }
      else if (cls.code === '532') { kirker.push(el); counts.kirke++ }
      else if (cls.code === '534') {
        // Node-parkering (way-varianten ble allerede plukket over).
        if (el.type === 'node') { parkeringer.push(el); counts.parkering++ }
      }
      else if (cls.code === '526') { bommer.push(el); counts.bom++ }
      continue
    }
    if (buckets[cls.code]) {
      buckets[cls.code].push(el)
      counts[cls.code]++
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
  // pattern-fyll. Kritisk for å holde SVG-størrelsen i sjakk i tette
  // strøk — uten dette får nettleseren tusenvis av enkelt-bygnings-
  // polygoner som gjør pinch/zoom og pan tregt.
  //
  // v8.9.28: Toggler sammen med 521 under «Bygninger» (categoryFor →
  // 'bygning'). Tidligere v8.9.27 forsøk på å fjerne urbanMass helt
  // ga uakseptabel ytelse i bymiljø-kart.
  let urbanMassMultiPoly = []
  if (buckets['521'].length >= 5) {
    const buildingsXY = buckets['521']
      .filter(el => el.geometry && el.geometry.length >= 3)
      .map(el => ({
        ring: el.geometry.map(g => {
          const p = project(g.lat, g.lon)
          return [p.x, p.y]
        }),
        original: el,
      }))
    // v8.9.29: tilbake til 15 m naboradius (original v6.3.0-verdi).
    // 50/100 m var for slappe — eneboligfelt med store tomter ble
    // aldri klyngetegnet, og SVG-en blåste opp i tettbygde områder.
    // Min klyngestørrelse holdes på 5 så enslige tun ikke slukes.
    const { urbanMass, scattered } = classifyBuildings(buildingsXY, {
      neighborRadiusM: 15,
      minClusterSize: 5,
      bufferM: 6,
    })
    if (urbanMass.length > 0) {
      urbanMassMultiPoly = urbanMass
      buckets['521'] = scattered.map(b => b.original)
      counts['521'] = buckets['521'].length
      counts['522'] = urbanMass.length
    }
  }

  // ── DEM-deriverte features (konturer, knauser, stupkanter, sjø) ──────
  let demFeatures = { contours: { features: [] }, knauser: [], cliffs: [], equidistanceM: null }
  let demSeaPolygons = []
  let demSeaBands = []
  if (usableDem) {
    const c = buildContours(usableDem, contourIntervalM, 5)
    const k = includeKnauser ? detectKnauser(usableDem, 5, 1.5) : []
    const cl = includeCliffs ? detectCliffs(usableDem, 45, 10) : []
    demFeatures = { contours: c, knauser: k, cliffs: cl, equidistanceM: contourIntervalM }
    // Sjø-deteksjon fra DTM: Kartverket NHM_DTM_25832 returnerer havflaten på
    // 0 m. Områder ≤ 0.5 m blir blå sjø-polygon (ISOM 303). FALLBACK når
    // WMTS-vannmaske ikke leverte data — heuristikken kan "smitte" inn på
    // lavtliggende øyer DEM-resolusjonen ikke fanger, så WMTS foretrekkes
    // når det er tilgjengelig (skipDemSea=true).
    if (!skipDemSea) {
      const seaResult = buildSeaFromDem(usableDem, {
        thresholdM: 0.5, minAreaM2: 2000, simplifyM: 2, requireBoundaryTouch: true,
      })
      demSeaPolygons = seaResult.polygons
      if (demSeaPolygons.length) {
        const shallow = buildSeaShallowBands(usableDem, {
          thresholdM: 0.5, bandDistancesM: [50, 200], simplifyM: 2,
        })
        demSeaBands = shallow.bands
      }
    }
  }

  // Bygg ISOM-defs (patterns + symbols) og CSS. widthM sendes inn så
  // label-fonts skaleres proporsjonalt med kartstørrelsen (v8.9.24).
  const { defs: isomDefs, patternIds, symbolIds } = buildIsomDefs(isomCatalog)
  const isomCss = buildIsomCss(isomCatalog, patternIds, { widthM })

  const layerSvg = (code, phase = 'both') => {
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
        let isSmall = false
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
          const areaM2 = polygonAreaM2(el.geometry)
          if (filter.minAreaM2 && areaM2 < filter.minAreaM2) continue
          // ISOM 521: små bygg (< 70 m², typisk hytter/uthus) erstattes
          // med standardisert kvadrat-symbol (13 m × 13 m = 1.3 mm @ 1:10k)
          // sentrert på OSM-bygnings-centroid. Faktiske små OSM-polygoner
          // er ofte irregulære og masketes lett av nærliggende stier; et
          // rent, lett over-dimensjonert kvadrat med tynt omriss leses
          // klart på alle zoom-nivåer (Kartverket-konvensjon).
          if (code === '521' && areaM2 < 70) {
            const c = polygonCentroid(el.geometry)
            if (!c) continue
            const half = 6.5
            d = `M${fmt(c.x - half)},${fmt(c.y - half)}L${fmt(c.x + half)},${fmt(c.y - half)}L${fmt(c.x + half)},${fmt(c.y + half)}L${fmt(c.x - half)},${fmt(c.y + half)}Z`
            isSmall = true
          } else {
            d = pathFromGeometry(el.geometry, true, filter.simplifyM)
          }
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
          // ISOM 307 (Sjøkart dybdeareal): per-polygon fill basert på
          // gjennomsnitts-dybde. depthToColor gradierer fra grunn (#b6daee)
          // til dyp (#1f5d8a) så dybde-skiftene blir synlige som distinkte
          // blå-toner istedenfor ett flat farget areal.
          let inlineStyle = ''
          let dybdeAttr = ''
          if (code === '307' && el.tags) {
            const minD = Number(el.tags.minDybde)
            const maxD = Number(el.tags.maxDybde)
            const avgD = Number.isFinite(minD) && Number.isFinite(maxD) ? (minD + maxD) / 2
                       : Number.isFinite(minD) ? minD
                       : Number.isFinite(maxD) ? maxD
                       : null
            if (avgD != null) {
              inlineStyle = ` style="fill: ${depthToColor(avgD)}"`
              // v8.9.24: data-dybde lar MapView lage depth-shade PNG ved å
              // raster-fylle disse polygonene i gråtoner (Path2D på d-attr).
              dybdeAttr = ` data-dybde="${fmt(avgD)}"`
            }
          }
          const smallAttr = isSmall ? ' data-small="yes"' : ''
          pathElements.push(
            `    <path d="${d}" fill-rule="evenodd"${inlineStyle}${dybdeAttr}${smallAttr} data-src="${xmlEscape(String(src))}" data-name="${xmlEscape(name)}"/>`
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
      // v8.1.0: koder som har overlayStroke (f.eks. veier 501-503) får dual
      // path: base = casing (sort, breiere), overlay = farget fyll (smalere,
      // på toppen). CSS i symbolizer.js styler `path.overlay` separat. Gir
      // den klassiske ISOM-veiestilen med tydelig sort omriss rundt farget
      // veifyll — uten en casing forsvinner små veier i bg-cream-fargen.
      // v8.1.2 fix: bruker getIsomDef som slår opp på ISOM-kategori (manmade),
      // ikke UI-kategorien (vei-stor) som ble brukt i v8.1.0/v8.1.1 — derfor
      // ble aldri overlay-pathene emittet og roads ble bare sort casing.
      const hasOverlay = !!getIsomDef(code, isomCatalog, false)?.overlayStroke
      if (hasOverlay) {
        // v8.5.7: To-fase rendering støtter "casing pattern". Når veier
        // emitteres separat som casing- og overlay-pass over flere koder,
        // bryter call-site dette opp slik at sorte omriss ikke stacker
        // oppå nabosegmentets fargefyll i kryss. Default 'both' beholder
        // gammel atferd for andre koder.
        const lines = []
        if (phase !== 'overlay') {
          for (const d of paths) lines.push(`    <path d="${d}"/>`)
        }
        if (phase !== 'casing') {
          for (const d of paths) lines.push(`    <path d="${d}" class="overlay"/>`)
        }
        return `  <g data-layer="${cat}" data-iso="${code}">\n${lines.join('\n')}\n  </g>\n`
      }
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
    if (!parts.length) return '  <g data-layer="navn"></g>\n'
    return `  <g data-layer="navn">\n${parts.join('\n')}\n  </g>\n`
  }

  // v8.1.0: stedsnavn-overlay (default AV). Vises som eget data-layer
  // med større skrift slik at bruker kan slå på et tydelig områdenavn-
  // overlegg uten å rote til hovedkartet. Inkluderer ALLE place=*-noder
  // (locality, hamlet, village, town, city, suburb, neighbourhood,
  // quarter, isolated_dwelling, farm).
  const stedsnavnSvg = () => {
    const parts = []
    for (const el of places) {
      if (!el.tags?.name) continue
      const p = project(el.lat, el.lon)
      parts.push(`    <text x="${fmt(p.x)}" y="${fmt(p.y)}" dy="-0.5mm" text-anchor="middle" data-label="stedsnavn">${xmlEscape(el.tags.name)}</text>`)
    }
    if (!parts.length) return '  <g data-layer="stedsnavn" style="display:none"></g>\n'
    return `  <g data-layer="stedsnavn" style="display:none">\n${parts.join('\n')}\n  </g>\n`
  }

  // ── Bygg land-mask: alle vann-polygoner blir svart, slik at
  // kontur-laget kun rendres der det er land. Konturer som "krysser"
  // innsjøer er nonsens (innsjø = én høyde) — de skal maskeres bort.
  const waterPaths = []
  for (const code of ['301', '302', '303', '307', '308', '309']) {
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
  // DEM-derivert sjø går også i land-mask så konturer/vegetasjon ikke renderes over.
  for (const poly of demSeaPolygons) {
    for (const ring of poly) {
      if (ring.length < 3) continue
      let d = `M${fmt(ring[0][0])},${fmt(ring[0][1])}`
      for (let i = 1; i < ring.length; i++) d += `L${fmt(ring[i][0])},${fmt(ring[i][1])}`
      d += 'Z'
      waterPaths.push(d)
    }
  }

  const hasMaskContent = waterPaths.length > 0
  const landMaskSvg = hasMaskContent
    ? `<mask id="land-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${fmt(widthM)}" height="${fmt(heightM)}"><rect width="${fmt(widthM)}" height="${fmt(heightM)}" fill="white"/><path d="${waterPaths.join(' ')}" fill="black" fill-rule="evenodd"/></mask>`
    : ''
  const contourMaskAttr = hasMaskContent ? ' mask="url(#land-mask)"' : ''
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

  // v7.1.14: utvidet med 303 (saltvann/bukt/sund/fjord). For padlekart er
  // navn på bukter/sund/poll viktige orienteringspunkter. 303-features
  // kommer fra OSM-relations med natural=bay/strait/water=sea og har ofte
  // name-tag. Vi skipper elev-sampling for saltvann (det er ~0 moh per
  // definisjon).
  for (const code of ['301', '302', '303']) {
    const isSeawater = code === '303'
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
      } else if (el.type === 'relation' && el.members) {
        // OSM-relation (typisk for saltvann/fjord). Bygg outer-rings og
        // bruk største ring som sentroid-proxy.
        const outerRings = assembleRelationRings(el.members, 'outer')
        if (outerRings.length === 0) continue
        const projectedRings = outerRings.map(ring =>
          ring.map(g => {
            const p = project(g.lat, g.lon)
            return [p.x, p.y]
          })
        )
        let largest = null, largestArea = 0
        for (const r of projectedRings) {
          const ac = ringAreaCentroid(r)
          if (ac && ac.areaM2 > largestArea) { largest = ac; largestArea = ac.areaM2 }
        }
        if (!largest) continue
        areaM2 = largestArea
        centroid = { x: largest.x, y: largest.y }
      } else {
        continue
      }
      if (!centroid) continue

      // Saltvann har lavere areal-terskel siden et lite "Pollen" eller
      // "Bukta" er like viktig for orientering som en stor fjord.
      const minArea = isSeawater ? Math.max(MIN_AREA / 4, 500) : MIN_AREA
      if (areaM2 < minArea) continue
      const name = (el.tags?.name ?? '').trim()
      // Saltvann uten navn er ikke verdt å rendre (brukeren ser jo at
      // det er sjø). Innsjøer uten navn kan likevel ha elev som info.
      if (isSeawater && !name) continue

      let elev = null
      if (!isSeawater && sampleDem) {
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

  // Kirke (ISOM 532-derivert): hytte-stil rektangulær ramme med kors 2.6mm.
  // Node-kirker plasseres direkte på OSM-noden; way-kirker (building=church
  // polygon) plasseres på centroid og rendres OVER bygnings-laget så
  // symbolet er synlig over den brune bygnings-fyllen.
  const kirkeSize = 2.6
  const kirkeSvg = kirker.map(el => {
    let p = null
    if (el.type === 'node') p = project(el.lat, el.lon)
    else if (el.type === 'way' && el.geometry) p = polygonCentroid(el.geometry)
    if (!p) return ''
    const sid = symbolIds.get('kirke')
    if (!sid) return ''
    const half = kirkeSize / 2
    return `    <use href="#${sid}" x="${fmt(p.x - half)}mm" y="${fmt(p.y - half)}mm" width="${kirkeSize}mm" height="${kirkeSize}mm"/>`
  }).filter(Boolean).join('\n')

  // Utfartsparkering (ISOM 534-derivert): blå P-symbol 2.4mm. Node-
  // parkering på OSM-noden, way-parkering på polygon-centroid.
  const parkeringSize = 2.4
  const parkeringSvg = parkeringer.map(el => {
    let p = null
    if (el.type === 'node') p = project(el.lat, el.lon)
    else if (el.type === 'way' && el.geometry) p = polygonCentroid(el.geometry)
    if (!p) return ''
    const sid = symbolIds.get('parkering')
    if (!sid) return ''
    const half = parkeringSize / 2
    return `    <use href="#${sid}" x="${fmt(p.x - half)}mm" y="${fmt(p.y - half)}mm" width="${parkeringSize}mm" height="${parkeringSize}mm"/>`
  }).filter(Boolean).join('\n')

  // Bom / barriere (ISOM 526-derivert): sort horisontal bar 1.6mm. OSM-
  // node-posisjon direkte. Ingen rotasjon — vi har ikke pålitelig vei-
  // tangent ved barriere-noden uten å indeksere alle ways først.
  const bomSize = 1.6
  const bomSvg = bommer.map(el => {
    if (el.type !== 'node') return ''
    const p = project(el.lat, el.lon)
    const sid = symbolIds.get('bom')
    if (!sid) return ''
    const half = bomSize / 2
    return `    <use href="#${sid}" x="${fmt(p.x - half)}mm" y="${fmt(p.y - half)}mm" width="${bomSize}mm" height="${bomSize}mm"/>`
  }).filter(Boolean).join('\n')

  // Bro / bru (ISOM 509-derivert): to korte parallelle ticks på midten av
  // bridge=yes-way-en, rotert langs sti-tangenten så de ligger langs sti-
  // retningen. Wrapped i <g transform="translate(...) rotate(...)"> siden
  // SVG <use> ikke selv kan både posisjoneres OG roteres mot et lokalt
  // senter via attributter alene. translate uses user units (meters) som
  // matcher project()-output, mens use-offsets fortsatt er i mm.
  const broSize = 1.8
  const broSvg = broer.map(el => {
    if (!el.geometry || el.geometry.length < 2) return ''
    const pts = el.geometry.map(g => project(g.lat, g.lon))
    let totalLen = 0
    const segLens = []
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x
      const dy = pts[i].y - pts[i - 1].y
      const len = Math.hypot(dx, dy)
      segLens.push(len)
      totalLen += len
    }
    if (totalLen < 1) return ''
    const target = totalLen / 2
    let acc = 0
    let midX = null, midY = null, midDeg = 0
    for (let i = 1; i < pts.length; i++) {
      const segLen = segLens[i - 1]
      if (acc + segLen >= target) {
        const t = segLen > 1e-6 ? (target - acc) / segLen : 0
        const dx = pts[i].x - pts[i - 1].x
        const dy = pts[i].y - pts[i - 1].y
        midX = pts[i - 1].x + dx * t
        midY = pts[i - 1].y + dy * t
        midDeg = Math.atan2(dy, dx) * 180 / Math.PI
        break
      }
      acc += segLen
    }
    if (midX == null) return ''
    const sid = symbolIds.get('bru')
    if (!sid) return ''
    const half = broSize / 2
    return `    <g transform="translate(${fmt(midX)},${fmt(midY)}) rotate(${fmt(midDeg)})"><use href="#${sid}" x="-${half}mm" y="-${half}mm" width="${broSize}mm" height="${broSize}mm"/></g>`
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
  // DEM-derivert sjø: blå polygoner under N50/OSM-vannlag, så autoritative
  // vann-polygoner overstyrer der de finnes. Basis-laget får ISOM 303-blå
  // (mørk dyp); grunne-bånd legges på toppen med gradient-toner.
  const polygonsToPathRing = (poly) => {
    const ringPaths = []
    for (const ring of poly) {
      if (ring.length < 3) continue
      let rd = `M${fmt(ring[0][0])},${fmt(ring[0][1])}`
      for (let i = 1; i < ring.length; i++) rd += `L${fmt(ring[i][0])},${fmt(ring[i][1])}`
      rd += 'Z'
      ringPaths.push(rd)
    }
    return ringPaths.join(' ')
  }
  const demSeaBaseSvg = demSeaPolygons.length
    ? `  <g data-layer="vann" data-iso="303" data-src="dem-sea">\n${demSeaPolygons.map(poly => {
        const d = polygonsToPathRing(poly)
        return d ? `    <path d="${d}" fill-rule="evenodd"/>` : ''
      }).filter(Boolean).join('\n')}\n  </g>\n`
    : ''
  // Grunn-bånd: kumulative subset-polygoner (≤50 m ⊂ ≤200 m ⊂ alt sjø).
  // Renderingsrekkefølge: største bånd FØRST (mørkere), så minste sist
  // (lysest) så grunnest farge overstyrer ved kysten. Basis-sjø er
  // ISOM 303-mørk; båndene blir progressivt lysere mot land.
  const BAND_COLORS_BY_DESC_DISTANCE = ['#8fc4dd', '#b6daee']
  const sortedBands = [...demSeaBands].sort((a, b) => b.maxDistanceM - a.maxDistanceM)
  const demSeaBandsSvg = sortedBands
    .map((band, idx) => {
      const color = BAND_COLORS_BY_DESC_DISTANCE[idx] ?? '#b6daee'
      const paths = band.polygons.map(poly => {
        const d = polygonsToPathRing(poly)
        return d ? `    <path d="${d}" fill="${color}" fill-rule="evenodd"/>` : ''
      }).filter(Boolean).join('\n')
      return paths
        ? `  <g data-layer="vann" data-iso="303" data-src="dem-sea-band" data-band-m="${band.maxDistanceM}">\n${paths}\n  </g>\n`
        : ''
    })
    .filter(Boolean)
    .join('')
  const demSeaLayerSvg = demSeaBaseSvg + demSeaBandsSvg
  const waterLayers  = renderCodes(WATER_CODES)
  const landOverlayLayers = renderCodes(LAND_OVERLAY_CODES)
  // v8.5.7: Klassisk casing-pattern for veier — render ALLE sorte omriss
  // (casings) først, så ALLE fargefyll (overlays). Det forhindrer at sorte
  // omriss på nabosegmenter ligger oppå fargefyll i kryss ("pølse"-blobsene
  // som vises der mange OSM-veisegmenter møtes). Overlay-passet kjøres i
  // omvendt ROAD_CODES-rekkefølge så større veier renderes sist og dominerer
  // i kryss: motorvei (501) > hovedvei (502) > småvei (503). Jernbane (515)
  // og trail-koder (504-511) beholder dagens enkel-stroke-rendering.
  const roadOverlayCodes = ROAD_CODES.filter(c =>
    c !== '515' && !!getIsomDef(c, isomCatalog, false)?.overlayStroke
  )
  const roadOtherCodes = ROAD_CODES.filter(c => !roadOverlayCodes.includes(c))
  const roadLayers =
    roadOverlayCodes.map(c => layerSvg(c, 'casing')).join('') +
    [...roadOverlayCodes].reverse().map(c => layerSvg(c, 'overlay')).join('') +
    roadOtherCodes.map(c => layerSvg(c)).join('')
  const upperLayers  = renderCodes(UPPER_CODES)
  const placeholderLayers = renderCodes(PLACEHOLDER_CODES)
  const labelLayer = labelSvg()
  const stedsnavnLayer = stedsnavnSvg()

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

  const huleLayerSvg = huleSvg
    ? `  <g data-layer="stein" data-iso="215">\n${huleSvg}\n  </g>\n` : ''
  const gruveLayerSvg = gruveSvg
    ? `  <g data-layer="stein" data-iso="216">\n${gruveSvg}\n  </g>\n` : ''
  const trigLayerSvg = trigSvg
    ? `  <g data-layer="trig" data-iso="113">\n${trigSvg}\n  </g>\n` : ''
  const kirkeLayerSvg = kirkeSvg
    ? `  <g data-layer="kirke" data-iso="532">\n${kirkeSvg}\n  </g>\n` : ''
  const parkeringLayerSvg = parkeringSvg
    ? `  <g data-layer="parkering" data-iso="534">\n${parkeringSvg}\n  </g>\n` : ''
  const broLayerSvg = broSvg
    ? `  <g data-layer="bro" data-iso="509">\n${broSvg}\n  </g>\n` : ''
  const bomLayerSvg = bomSvg
    ? `  <g data-layer="bom" data-iso="526">\n${bomSvg}\n  </g>\n` : ''

  // ── Stedsnavn for elver og bekker (304/305) ─────────────────────────
  // Gjenta navnet ~hver 2 km langs polylinjen så det er synlig uansett
  // hvilken del av kartet brukeren ser på. For korte bekker (< 1 km) plasseres
  // ett label sentralt slik at tagget-navn alltid blir synlig — turkart-
  // bbox kan være helt nede i 1 km × 1 km, og uten dette ville mange bekker
  // mistet sitt navn på små kart.
  const SEG_REPEAT_M = 2000
  const waterwayLabels = []
  for (const code of ['304', '305']) {
    for (const el of buckets[code] ?? []) {
      const name = (el.tags?.name ?? '').trim()
      if (!name || !el.geometry || el.geometry.length < 2) continue
      const pts = el.geometry.map(g => project(g.lat, g.lon))
      const segLens = []
      let totalLen = 0
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x
        const dy = pts[i].y - pts[i - 1].y
        const segLen = Math.hypot(dx, dy)
        segLens.push(segLen)
        totalLen += segLen
      }
      if (totalLen < 80) continue
      const positions = totalLen < SEG_REPEAT_M
        ? [totalLen / 2]
        : []
      if (positions.length === 0) {
        for (let p = SEG_REPEAT_M / 2; p < totalLen; p += SEG_REPEAT_M) positions.push(p)
      }
      let acc = 0
      let posIdx = 0
      for (let i = 1; i < pts.length && posIdx < positions.length; i++) {
        const segLen = segLens[i - 1]
        const dx = pts[i].x - pts[i - 1].x
        const dy = pts[i].y - pts[i - 1].y
        while (posIdx < positions.length && positions[posIdx] <= acc + segLen) {
          const t = segLen > 0.01 ? (positions[posIdx] - acc) / segLen : 0.5
          const x = pts[i - 1].x + dx * t
          const y = pts[i - 1].y + dy * t
          let deg = Math.atan2(dy, dx) * 180 / Math.PI
          if (deg > 90 || deg < -90) deg += 180
          waterwayLabels.push({ x, y, deg, name, isStream: code === '305' })
          posIdx++
        }
        acc += segLen
      }
    }
  }
  const waterwayLabelLayer = waterwayLabels.length
    ? `  <g data-layer="bekk">\n${waterwayLabels.map(l =>
        `    <text x="${fmt(l.x)}" y="${fmt(l.y)}" dy="-0.4mm" text-anchor="middle" transform="rotate(${fmt(l.deg)} ${fmt(l.x)} ${fmt(l.y)})" data-label="vann-navn">${xmlEscape(l.name)}</text>`
      ).join('\n')}\n  </g>\n`
    : ''

  // ISOM 522 — tett bebyggelse pattern fyll. Y-flippet siden urbanMass-
  // ringene er i SVG-koordinatsystem (project() returnerer y-flippet).
  // Plasseres mellom vegetasjon og vann i z-order så vann/konturer
  // forblir lesbare over bymassen i tett bebygde områder.
  //
  // v8.9.28: data-layer="bygning" (samme som ISOM 521) så «Bygninger»-
  // toggle slår begge av/på samtidig — visuelt sett er det fortsatt to
  // ulike strålingsstiler, men brukeren forholder seg til ett lag.
  const urbanMassPath = urbanMassMultiPoly.length
    ? multiPolyToPath(urbanMassMultiPoly, fmt)
    : ''
  const urbanMassLayerSvg = urbanMassPath
    ? `  <g data-layer="bygning" data-iso="522"><path d="${urbanMassPath}" fill-rule="evenodd"/></g>\n`
    : ''

  const bgFill = isomCatalog.background.color

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" class="isom-map" viewBox="${viewBox}" ${printAttrs} style="--bg: ${bgFill}" data-meta='${JSON.stringify(meta).replace(/'/g, '&apos;').replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}'>
  <defs>${isomDefs}${landMaskSvg}</defs>
  <style>${isomCss}</style>
  <g id="bakgrunn"><rect width="${fmt(widthM)}" height="${fmt(heightM)}" fill="${bgFill}"/></g>
${landMaskAttr ? `<g${landMaskAttr}>${groundLayers}${urbanMassLayerSvg}</g>` : `${groundLayers}${urbanMassLayerSvg}`}${landOverlayLayers}${demSeaLayerSvg}${waterLayers}${lakeLabelLayer}${waterwayLabelLayer}${contourLayerSvg}${roadLayers}${broLayerSvg}${bomLayerSvg}${upperLayers}${knauserLayerSvg}${cliffsLayerSvg}${huleLayerSvg}${gruveLayerSvg}${trigLayerSvg}${kirkeLayerSvg}${parkeringLayerSvg}${placeholderLayers}${labelLayer}${stedsnavnLayer}</svg>
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
    case '304': case '305':                     return 'bekk'
    case '521': case '522':                     return 'bygning'
    case '501': case '502':                     return 'vei-stor'
    case '503': case '504':                     return 'vei-liten'
    case '505': case '506': case '507':         return 'sti'
    case '510':                                  return 'lysloype'
    case '511':                                  return 'heistrase'
    case '512':                                  return 'slalombakke'
    case '515':                                  return 'tog'
    case '201': case '203':                     return 'stupkant'
    case '210': case '213':
    case '215': case '216':                          return 'stein'
    case '525': case '528':                     return 'linje'
    case '113':                                  return 'trig'
    case '509':                                  return 'bro'
    case '526':                                  return 'bom'
    case '534':                                  return 'parkering'
    case '101': case '102': case '103': case '104': return 'kontur'
    default:                                     return 'other'
  }
}

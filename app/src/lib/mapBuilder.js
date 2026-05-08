// Delt SVG-byggeverktøy for ISOM-inspirerte turkart.
// Bruker WGS84 → UTM 32N og produserer et lagdelt SVG med mm-baserte
// streker (print-kvalitet) basert på en data-drevet ISOM-katalog.
//
// Brukes både fra build-vardasen-svg.js (Node) og fra MapPickerView.vue
// (klient-side ved kart-generering).

import { wgs84ToUtm32 } from './utm.js'
import {
  classifyToIsom,
  buildIsomDefs,
  buildIsomCss,
  isomCatalog,
} from './symbolizer.js'
import { buildContours, detectKnauser, detectCliffs } from './dem.js'
import { fetchDEM } from './demFetcher.js'
import { polylineToPath, simplifyDP } from './pathUtils.js'
import { classifyBuildings, multiPolyToPath } from './buildingMass.js'
import { computeCHM, sampleCHMInPolygon, classifyVegetationFromCHM } from './canopyHeight.js'
// coastline.js (sjø-rekonstruksjon fra OSM natural=coastline) er fjernet
// fra v6.8.0. Vi bruker N50 Havflate (autoritativ) og OSM natural=water
// som vannkilder direkte, og rekonstruerer ikke sjø-polygoner fra
// kystlinje-linjer. Dette eliminerer wedger og land/vann-inversjon
// som plaget v6.5.x–v6.7.x.
import polygonClipping from 'polygon-clipping'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export function buildOverpassQuery(bbox) {
  return `
[out:json][timeout:90][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)$"];
  way["highway"~"^(path|track|footway|bridleway|cycleway|steps)$"];
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
  node["natural"="peak"];
  node["place"~"^(locality|hamlet|village|suburb|neighbourhood|isolated_dwelling)$"];
  relation["natural"="water"];
  relation["natural"~"^(bay|strait)$"];
  relation["place"~"^(sea|ocean)$"];
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
  const segments = members
    .filter(m => m.type === 'way' && m.role === role && Array.isArray(m.geometry) && m.geometry.length >= 2)
    .map(m => m.geometry.slice())  // kopi så vi ikke muterer original
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
const GROUND_CODES = ['401', '403', '404', '406', '407', '408', '409', '210']
const WATER_CODES  = ['308', '309', '301', '302', '303', '304', '305']
const ROAD_CODES   = ['501', '502', '503', '504', '505', '506', '507']
const UPPER_CODES  = ['521', '525', '528']
// Plassholder-koder for lag som rendres separat (konturer/stupkanter).
// Beholdes for at MapView sin lag-toggle skal kunne finne tomme grupper.
const PLACEHOLDER_CODES = ['101', '102', '103', '104', '201', '203']
const LAYER_ORDER = [
  ...GROUND_CODES,
  ...WATER_CODES,
  ...PLACEHOLDER_CODES,
  ...ROAD_CODES,
  ...UPPER_CODES,
  '522',
]

const POLYGON_CODES = new Set(['401', '403', '404', '406', '407', '408', '409', '210', '301', '302', '303', '308', '309', '521', '522'])
const LINE_CODES = new Set(['304', '305', '501', '502', '503', '504', '505', '506', '507', '525', '528', '201', '203', '101', '102', '103', '104'])

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
  }

  // Bucket pr ISOM-kode
  const buckets = {}
  for (const code of LAYER_ORDER) buckets[code] = []
  const peaks = []
  const places = []

  const counts = { peak: 0, place: 0 }
  for (const code of LAYER_ORDER) counts[code] = 0

  for (const el of elements) {
    const cls = classifyToIsom(el)
    if (!cls) continue
    if (cls.cat === 'point') {
      if (cls.code === 'peak') { peaks.push(el); counts.peak++ }
      else if (cls.code === 'place') { places.push(el); counts.place++ }
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
          pathElements.push(
            `    <path d="${d}" fill-rule="evenodd" data-src="${xmlEscape(String(src))}" data-name="${xmlEscape(name)}"/>`
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
      const label = name + (Number.isFinite(eleNum) ? ` ${Math.round(eleNum)}` : '')
      parts.push(`    <g transform="translate(${fmt(p.x)},${fmt(p.y)})"><use href="#${symbolIds.get('peak')}" x="-0.5mm" y="-0.5mm" width="1mm" height="1mm"/><text x="1.5mm" y="0.5mm" data-label="peak">${label}</text></g>`)
    }
    for (const el of places) {
      if (!el.tags?.name) continue
      const p = project(el.lat, el.lon)
      parts.push(`    <text x="${fmt(p.x)}" y="${fmt(p.y)}" data-label="place">${xmlEscape(el.tags.name)}</text>`)
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
  // DEM-koordinater er i meter relativ til UTM bbox sw-hjørne. Vi må
  // y-flippe for SVG (y vokser nedover).
  const demProject = ([x, y]) => [x, heightM - y]

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

  // ── Elevasjons-labels på innsjøer ────────────────────────────────────
  // Sample DTM i polygon-sentroid for hver innsjø/tjern (301/302) og vis
  // høyde over havet som italic blå tekst. Skipped for saltvann (303 ≈ 0)
  // og myr (308/309 — typisk for små polygoner). Krever ekte DEM, ikke
  // syntetisk, ellers gir tallet falsk informasjon. Min-areal 5000 m²
  // for å unngå clutter på små vannhull.
  const lakeLabels = []
  if (usableDem) {
    const t = usableDem.transform
    const sampleDem = (utmE, utmN) => {
      const col = Math.round((utmE - t.originX) / t.pixelWidth)
      const row = Math.round((utmN - t.originY) / t.pixelHeight)
      if (col < 0 || col >= usableDem.cols || row < 0 || row >= usableDem.rows) return null
      const v = usableDem.data[row * usableDem.cols + col]
      if (v === usableDem.noData) return null
      return v
    }
    for (const code of ['301', '302']) {
      for (const el of buckets[code] ?? []) {
        if (el.type !== 'way' || !el.geometry) continue
        if (polygonAreaM2(el.geometry) < 5000) continue
        const c = polygonCentroid(el.geometry)
        if (!c) continue
        // Konverter SVG-sentroid tilbake til UTM for DEM-sampling
        const utmE = c.x + minE
        const utmN = (heightM - c.y) + minN
        const elev = sampleDem(utmE, utmN)
        if (elev == null || !Number.isFinite(elev)) continue
        lakeLabels.push({ x: c.x, y: c.y, elev: Math.round(elev) })
      }
    }
  }

  const knauserSvg = demFeatures.knauser.map(k => {
    const [x, y] = demProject([k.x, k.y])
    return `    <use href="#${symbolIds.get('knaus')}" x="${fmt(x - 0.6)}mm" y="${fmt(y - 0.6)}mm" width="1.2mm" height="1.2mm"/>`
  }).join('\n')

  // Cliff-teeth (ISOM 203): perpendikulær tann på nedside. Hvis vi har
  // ekte DEM, sampler vi høyde på begge sider av spine for å velge
  // riktig side; ellers default til høyre. Spacing ~20m (~2mm @ 1:10k),
  // tann-lengde ~5m (~0.5mm). Coordinates er i meter-rom relativt til
  // UTM bbox sw-hjørne (samme som cliff-spine).
  const cliffSampleDem = usableDem
    ? (xM, yM) => {
        const t = usableDem.transform
        const utmE = xM + minE
        const utmN = yM + minN
        const col = Math.round((utmE - t.originX) / t.pixelWidth)
        const row = Math.round((utmN - t.originY) / t.pixelHeight)
        if (col < 0 || col >= usableDem.cols || row < 0 || row >= usableDem.rows) return null
        const v = usableDem.data[row * usableDem.cols + col]
        if (v === usableDem.noData) return null
        return v
      }
    : null

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
  const waterLayers  = renderCodes(WATER_CODES)
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
    ? `  <g data-layer="vann">\n    <g data-label="vann-tall">\n${lakeLabels.map(l =>
        `      <text x="${fmt(l.x)}" y="${fmt(l.y)}" text-anchor="middle">${l.elev}</text>`).join('\n')}\n    </g>\n  </g>\n`
    : ''

  const knauserLayerSvg = knauserSvg
    ? `  <g data-layer="stein" data-iso="213">\n${knauserSvg}\n  </g>\n` : ''

  const cliffsLayerSvg = cliffsSvg
    ? `  <g data-layer="stupkant" data-iso="203">\n${cliffsSvg}\n  </g>\n` : ''

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

  // Bakgrunn: alltid kremgul (land) som default. Vann rendres som
  // eksplisitte polygoner fra N50 (Havflate, Innsjø, ElvBekk) eller OSM
  // (natural=water). Vi rekonstruerer IKKE sjø fra OSM coastline-linjer
  // lenger — det skapte wedger og inversjon når OSM mistagget innlands-
  // innsjøer. Hvis N50 feiler i kyst-områder vises ingen sjø (synlig
  // degradering, ikke wedge-magi).
  const bgFill = isomCatalog.background.color

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" class="isom-map" viewBox="${viewBox}" ${printAttrs} data-meta='${JSON.stringify(meta).replace(/'/g, '&apos;')}'>
  <defs>${isomDefs}${landMaskSvg}</defs>
  <style>${isomCss}</style>
  <g id="bakgrunn"><rect width="${fmt(widthM)}" height="${fmt(heightM)}" fill="${bgFill}"/></g>
${landMaskAttr ? `<g${landMaskAttr}>${groundLayers}${urbanMassLayerSvg}</g>` : `${groundLayers}${urbanMassLayerSvg}`}${waterLayers}${lakeLabelLayer}${contourLayerSvg}${roadLayers}${upperLayers}${knauserLayerSvg}${cliffsLayerSvg}${placeholderLayers}${labelLayer}</svg>
`

  return { svg, counts, meta }
}

function categoryFor(code) {
  // Mapping fra ISOM-kode til UI-kategori (for lag-toggling i MapView).
  // Flere koder kan ende i samme kategori (skog samler 406-409 osv).
  switch (code) {
    case '401': case '403':                     return 'aapen'
    case '404':                                  return 'aker'
    case '406': case '407': case '408': case '409': return 'skog'
    case '308': case '309':                     return 'myr'
    case '301': case '302': case '303':         return 'vann'
    case '304': case '305':                     return 'bekk'
    case '521': case '522':                     return 'bygning'
    case '501': case '502':                     return 'vei-stor'
    case '503': case '504':                     return 'vei-liten'
    case '505': case '506': case '507':         return 'sti'
    case '201': case '203':                     return 'stupkant'
    case '210': case '212': case '213':         return 'stein'
    case '525': case '528':                     return 'linje'
    case '101': case '102': case '103': case '104': return 'kontur'
    default:                                     return 'other'
  }
}

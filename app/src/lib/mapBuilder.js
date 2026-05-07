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

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Layer-rekkefølge (z-order, bunn til topp). Inspirert av ISOM 2017.
const LAYER_ORDER = [
  // 400-serien: vegetasjon og åpen mark
  '401', '403', '404', '406', '407', '408', '409',
  // 200-serien: stein/blokkmark/knaus (under vann, men over vegetasjon)
  '210',
  // 300-serien: vann
  '308', '309', '301', '302', '304', '305',
  // 100-serien: konturer (over vann, under stier)
  '101', '103', '104', '102',
  // 500-serien: veier nedenfra opp
  '501', '502', '503', '504', '505', '506', '507',
  // bygninger og menneskeskapt over alt
  '521', '522', '525', '528',
  // stupkanter
  '201', '203',
]

const POLYGON_CODES = new Set(['401', '403', '404', '406', '407', '408', '409', '210', '301', '302', '308', '309', '521', '522'])
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
    contourIntervalM = 5,
    includeKnauser = true,
    includeCliffs = true,
  } = options

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

  // ── DEM-deriverte features (konturer, knauser, stupkanter) ───────────
  let demFeatures = { contours: { features: [] }, knauser: [], cliffs: [], equidistanceM: null }
  if (dem) {
    const c = buildContours(dem, contourIntervalM, 5)
    const k = includeKnauser ? detectKnauser(dem, 5, 1.5) : []
    const cl = includeCliffs ? detectCliffs(dem, 60, 5) : []
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
      const paths = els.map(el => {
        if (el.type === 'way' && el.geometry) {
          if (filter.minAreaM2 && polygonAreaM2(el.geometry) < filter.minAreaM2) return ''
          return pathFromGeometry(el.geometry, true, filter.simplifyM)
        }
        if (el.type === 'relation' && el.members) {
          return el.members
            .filter(m => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === 'inner'))
            .map(m => pathFromGeometry(m.geometry, true, filter.simplifyM))
            .join(' ')
        }
        return ''
      }).filter(Boolean)
      return `  <g data-layer="${cat}" data-iso="${code}"><path d="${paths.join(' ')}" fill-rule="evenodd"/></g>\n`
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
  for (const code of ['301', '302', '308', '309']) {
    for (const el of buckets[code] ?? []) {
      if (el.type === 'way' && el.geometry) {
        waterPaths.push(pathFromGeometry(el.geometry, true))
      } else if (el.type === 'relation' && el.members) {
        for (const m of el.members) {
          if (m.type === 'way' && m.geometry) {
            waterPaths.push(pathFromGeometry(m.geometry, true))
          }
        }
      }
    }
  }
  const landMaskSvg = waterPaths.length
    ? `<mask id="land-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${fmt(widthM)}" height="${fmt(heightM)}"><rect width="${fmt(widthM)}" height="${fmt(heightM)}" fill="white"/><path d="${waterPaths.join(' ')}" fill="black" fill-rule="evenodd"/></mask>`
    : ''
  const contourMaskAttr = waterPaths.length ? ' mask="url(#land-mask)"' : ''

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

  const knauserSvg = demFeatures.knauser.map(k => {
    const [x, y] = demProject([k.x, k.y])
    return `    <use href="#${symbolIds.get('knaus')}" x="${fmt(x - 0.6)}mm" y="${fmt(y - 0.6)}mm" width="1.2mm" height="1.2mm"/>`
  }).join('\n')

  const cliffsSvg = demFeatures.cliffs.map(c => {
    const projected = c.coordinates.map(demProject)
    return `    <path d="${polylineToPath(projected, false)}" />`
  }).join('\n')

  const meta = {
    bbox,
    utmBbox: { minE, minN, maxE, maxN },
    widthM, heightM,
    scaleDenom,
    equidistance: demFeatures.equidistanceM,
    elevationRange: dem
      ? { min: Math.round(demFeatures.contours.minElevM), max: Math.round(demFeatures.contours.maxElevM) }
      : null,
    demSource: dem?.source ?? null,
    isomVersion: '2017-2-derived',
    source: 'OpenStreetMap (ODbL) + ISOM-katalog v6.0' + (dem ? ` + DEM (${dem.source ?? 'unknown'})` : ''),
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

  const layers = LAYER_ORDER.map(layerSvg).join('') + labelSvg()

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

  const knauserLayerSvg = knauserSvg
    ? `  <g data-layer="stein" data-iso="213">\n${knauserSvg}\n  </g>\n` : ''

  const cliffsLayerSvg = cliffsSvg
    ? `  <g data-layer="stupkant" data-iso="203">\n${cliffsSvg}\n  </g>\n` : ''

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" class="isom-map" viewBox="${viewBox}" ${printAttrs} data-meta='${JSON.stringify(meta).replace(/'/g, '&apos;')}'>
  <defs>${isomDefs}${landMaskSvg}</defs>
  <style>${isomCss}</style>
  <g id="bakgrunn"><rect width="${fmt(widthM)}" height="${fmt(heightM)}" fill="${isomCatalog.background.color}"/></g>
${layers}${contourLayerSvg}${knauserLayerSvg}${cliffsLayerSvg}</svg>
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
    case '301': case '302':                     return 'vann'
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

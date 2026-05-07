// Delt SVG-byggeverktøy for turkart. Bruker WGS84 → UTM 32N og produserer
// et lagdelt SVG identisk med det Node-scriptet genererer offline.
//
// Brukes både fra build-vardasen-svg.js (Node, headless) og fra
// MapPickerView.vue (nettleser, klient-side ved kart-generering).

import { wgs84ToUtm32 } from './utm.js'

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
  way["natural"="wood"];
  way["landuse"~"^(forest|meadow|grass|farmland)$"];
  way["building"];
  way["leisure"~"^(park|pitch|playground)$"];
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
      'User-Agent': 'svg-insights/5.2 (https://github.com/gitjanerik/svg-insights)',
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

function fmt(n) {
  return Number(n.toFixed(2))
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function classify(el) {
  const t = el.tags ?? {}
  if (el.type === 'node' && t.natural === 'peak') return 'peak'
  if (el.type === 'node' && t.place) return 'place'
  if (t.building) return 'bygning'
  if (t.natural === 'water' || t.water) return 'vann'
  if (t.waterway) return 'bekk'
  if (t.natural === 'wetland') return 'myr'
  if (t.natural === 'wood' || t.landuse === 'forest') return 'skog'
  if (t.landuse === 'meadow' || t.landuse === 'grass' || t.leisure === 'park') return 'eng'
  if (t.landuse === 'farmland') return 'aker'
  if (t.highway) {
    const major = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']
    const minor = ['residential', 'unclassified', 'service', 'living_street']
    const trail = ['path', 'track', 'footway', 'bridleway', 'cycleway', 'steps']
    if (major.includes(t.highway)) return 'vei-stor'
    if (minor.includes(t.highway)) return 'vei-liten'
    if (trail.includes(t.highway)) return 'sti'
  }
  return null
}

const STYLE = `
svg { background: var(--bg, #f4ecd8); font-family: ui-sans-serif, system-ui, sans-serif; }
[data-layer] path { vector-effect: non-scaling-stroke; }
[data-layer="skog"] path { fill: var(--skog, #cde3b8); stroke: none; }
[data-layer="eng"] path { fill: var(--eng, #e8edc4); stroke: none; }
[data-layer="aker"] path { fill: var(--aker, #efe3c2); stroke: none; }
[data-layer="myr"] path { fill: var(--myr, #cfe1d8); stroke: var(--myr-s, #5a8a78); stroke-dasharray: 2 2; stroke-width: 0.3; }
[data-layer="vann"] path { fill: var(--vann, #a8d4e8); stroke: var(--vann-s, #4a9bbf); stroke-width: 0.4; }
[data-layer="bygning"] path { fill: var(--bygning, #b8a190); stroke: var(--bygning-s, #6e5a4a); stroke-width: 0.25; }
[data-layer="bekk"] path { fill: none; stroke: var(--vann-s, #4a9bbf); stroke-width: 0.7; stroke-linecap: round; }
[data-layer="vei-stor"] path { fill: none; stroke: var(--vei-stor, #d97a5a); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
[data-layer="vei-liten"] path { fill: none; stroke: var(--vei-liten, #d4b08a); stroke-width: 1.0; stroke-linecap: round; stroke-linejoin: round; }
[data-layer="sti"] path { fill: none; stroke: var(--sti, #6b3a1e); stroke-width: 0.6; stroke-dasharray: 2.5 1.5; stroke-linecap: round; }
[data-symbol="peak"] { fill: var(--peak, #6b3a1e); }
[data-label] { font-size: 14px; fill: var(--label, #2a2a2a); paint-order: stroke; stroke: var(--bg, #f4ecd8); stroke-width: 3; stroke-linejoin: round; }
[data-label="peak"] { font-weight: 600; }
`.trim().replace(/\s+/g, ' ')

const LAYER_ORDER = ['skog', 'eng', 'aker', 'myr', 'vann', 'bekk', 'vei-stor', 'vei-liten', 'bygning', 'sti']
const POLYGON_CATS = new Set(['skog', 'eng', 'aker', 'myr', 'vann', 'bygning'])
const LINE_CATS = new Set(['bekk', 'vei-liten', 'vei-stor', 'sti'])

/**
 * Bygg ferdig SVG-streng for et bbox + Overpass-elementer.
 * @returns {{ svg: string, counts: object, meta: object }}
 */
export function buildSvg(elements, bbox) {
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

  const pathFromGeometry = (geom, close = false) => {
    if (!geom || geom.length === 0) return ''
    const pts = geom.map(g => project(g.lat, g.lon))
    let d = `M${fmt(pts[0].x)},${fmt(pts[0].y)}`
    for (let i = 1; i < pts.length; i++) {
      d += `L${fmt(pts[i].x)},${fmt(pts[i].y)}`
    }
    if (close) d += 'Z'
    return d
  }

  const buckets = {
    skog: [], eng: [], aker: [], myr: [], vann: [], bekk: [],
    bygning: [], 'vei-liten': [], 'vei-stor': [], sti: [],
    peak: [], place: [],
  }

  for (const el of elements) {
    const cat = classify(el)
    if (!cat) continue
    buckets[cat].push(el)
  }

  const layerSvg = (cat) => {
    const els = buckets[cat]
    if (!els.length) return `  <g data-layer="${cat}"></g>\n`
    if (POLYGON_CATS.has(cat)) {
      const paths = els.map(el => {
        if (el.type === 'way' && el.geometry) return pathFromGeometry(el.geometry, true)
        if (el.type === 'relation' && el.members) {
          return el.members
            .filter(m => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === 'inner'))
            .map(m => pathFromGeometry(m.geometry, true))
            .join(' ')
        }
        return ''
      }).filter(Boolean)
      return `  <g data-layer="${cat}"><path d="${paths.join(' ')}" fill-rule="evenodd"/></g>\n`
    }
    if (LINE_CATS.has(cat)) {
      const paths = els.map(el => pathFromGeometry(el.geometry, false)).filter(Boolean)
      return `  <g data-layer="${cat}">\n${paths.map(d => `    <path d="${d}"/>`).join('\n')}\n  </g>\n`
    }
    return ''
  }

  const labelSvg = () => {
    const parts = []
    for (const el of buckets.peak) {
      const p = project(el.lat, el.lon)
      const name = xmlEscape(el.tags?.name ?? '')
      const ele = el.tags?.ele ?? ''
      const eleNum = parseFloat(ele)
      const label = name + (Number.isFinite(eleNum) ? ` ${Math.round(eleNum)}` : '')
      parts.push(`    <g transform="translate(${fmt(p.x)},${fmt(p.y)})"><circle r="3" data-symbol="peak"/><text x="6" y="2" data-label="peak">${label}</text></g>`)
    }
    for (const el of buckets.place) {
      if (!el.tags?.name) continue
      const p = project(el.lat, el.lon)
      parts.push(`    <text x="${fmt(p.x)}" y="${fmt(p.y)}" data-label="place">${xmlEscape(el.tags.name)}</text>`)
    }
    if (!parts.length) return '  <g data-layer="navn"></g>\n'
    return `  <g data-layer="navn">\n${parts.join('\n')}\n  </g>\n`
  }

  const counts = Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, v.length])
  )

  const meta = {
    bbox,
    utmBbox: { minE, minN, maxE, maxN },
    widthM, heightM,
    equidistance: null,
    source: 'OpenStreetMap (ODbL)',
    generated: new Date().toISOString(),
  }

  const layers = LAYER_ORDER.map(layerSvg).join('') + labelSvg()

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(widthM)} ${fmt(heightM)}" data-meta='${JSON.stringify(meta).replace(/'/g, '&apos;')}'>
  <style>${STYLE}</style>
${layers}</svg>
`

  return { svg, counts, meta }
}

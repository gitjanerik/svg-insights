// ISOM-inspirert symbolisering. Tar OSM/N50-features og en ISOM-katalog,
// produserer SVG-strenger (path, defs, symbols) med mm-baserte streker
// for print-kvalitet.
//
// Inn: GeoJSON-aktige features med isomCode satt på properties.
// Ut: { defs, layers } — defs er <pattern>/<symbol>-blokk, layers er
// kategori-keyed strings med <g data-layer="kategori">…

import isomCatalogDefault from './isomCatalog.json' with { type: 'json' }

const ISOM_CATEGORY_BY_CODE = (() => {
  const map = {}
  for (const cat of ['terrain', 'water', 'rock', 'contour', 'manmade']) {
    for (const code of Object.keys(isomCatalogDefault.categories[cat])) {
      map[code] = { cat, def: isomCatalogDefault.categories[cat][code] }
    }
  }
  return map
})()

function fmt(n) {
  return Number(n.toFixed(2))
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function strokeAttrs(s) {
  if (!s) return ''
  const parts = []
  if (s.color) parts.push(`stroke="${s.color}"`)
  if (s.widthMm) parts.push(`stroke-width="${s.widthMm}mm"`)
  if (s.linecap) parts.push(`stroke-linecap="${s.linecap}"`)
  if (s.linejoin) parts.push(`stroke-linejoin="${s.linejoin}"`)
  if (s.dasharray) parts.push(`stroke-dasharray="${s.dasharray.map(d => `${d}mm`).join(' ')}"`)
  if (s.opacity != null) parts.push(`stroke-opacity="${s.opacity}"`)
  return parts.join(' ')
}

function fillAttrs(f, patternId) {
  if (!f) return 'fill="none"'
  if (f.type === 'pattern' && patternId) return `fill="url(#${patternId})"`
  if (f.color) return `fill="${f.color}"`
  return 'fill="none"'
}

/** Lag en <pattern>-streng fra patterns-katalogen */
export function buildPatternDef(patternId, spec) {
  const elements = (spec.elements ?? []).map(el => {
    if (el.type === 'line') {
      return `<line x1="${el.x1}mm" y1="${el.y1}mm" x2="${el.x2}mm" y2="${el.y2}mm" stroke="${el.stroke}" stroke-width="${el.widthMm}mm"/>`
    }
    if (el.type === 'circle') {
      return `<circle cx="${el.cx}mm" cy="${el.cy}mm" r="${el.r}mm" fill="${el.fill}"/>`
    }
    if (el.type === 'rect') {
      return `<rect x="${el.x}mm" y="${el.y}mm" width="${el.w}mm" height="${el.h}mm" fill="${el.fill}"/>`
    }
    if (el.type === 'polygon') {
      const pts = el.points.split(' ').map(p => p.split(',').map(c => `${c}mm`).join(',')).join(' ')
      return `<polygon points="${pts}" fill="${el.fill}"/>`
    }
    return ''
  }).join('')

  const bg = spec.background
    ? `<rect width="${spec.widthMm}mm" height="${spec.heightMm}mm" fill="${spec.background}"/>`
    : ''

  return `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="${spec.widthMm}mm" height="${spec.heightMm}mm">${bg}${elements}</pattern>`
}

/** Lag en <symbol>-streng fra pointSymbols-katalogen */
export function buildPointSymbolDef(symId, spec) {
  const elements = (spec.elements ?? []).map(el => {
    if (el.type === 'line') {
      return `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" stroke="${el.stroke}" stroke-width="${el.widthMm}mm" ${el.fill === 'none' ? 'fill="none"' : ''}/>`
    }
    if (el.type === 'circle') {
      const stroke = el.stroke ? `stroke="${el.stroke}" stroke-width="${el.widthMm}mm"` : ''
      const fill = el.fill ?? 'none'
      return `<circle cx="${el.cx}" cy="${el.cy}" r="${el.r}" fill="${fill}" ${stroke}/>`
    }
    if (el.type === 'path') {
      const stroke = el.stroke ? `stroke="${el.stroke}" stroke-width="${el.widthMm}mm"` : ''
      const fill = el.fill ?? 'none'
      return `<path d="${el.d}" fill="${fill}" ${stroke}/>`
    }
    if (el.type === 'polygon') {
      return `<polygon points="${el.points}" fill="${el.fill}"/>`
    }
    return ''
  }).join('')
  return `<symbol id="${symId}" viewBox="${spec.viewBox}">${elements}</symbol>`
}

/**
 * Klassifiser en OSM/N50-feature til ISOM-kode (forenklet — full versjon
 * vil bruke LiDAR/CHM/NIBIO i fase 3 av v6.0).
 */
export function classifyToIsom(el) {
  const t = el.tags ?? {}
  if (el.type === 'node' && t.natural === 'peak') return { code: 'peak', cat: 'point' }
  if (el.type === 'node' && t.place) return { code: 'place', cat: 'point' }

  if (t.building)                                   return { code: '521', cat: 'manmade' }
  if (t.natural === 'water' || t.water)             return { code: '301', cat: 'water' }
  if (t.waterway === 'stream' || t.waterway === 'ditch') return { code: '305', cat: 'water' }
  if (t.waterway === 'river' || t.waterway === 'canal')  return { code: '304', cat: 'water' }
  if (t.natural === 'wetland')                      return { code: '308', cat: 'water' }
  if (t.natural === 'wood' || t.landuse === 'forest') return { code: '406', cat: 'terrain' }
  if (t.landuse === 'meadow' || t.landuse === 'grass') return { code: '401', cat: 'terrain' }
  if (t.leisure === 'park')                         return { code: '401', cat: 'terrain' }
  if (t.landuse === 'farmland')                     return { code: '404', cat: 'terrain' }
  if (t.natural === 'scree' || t.natural === 'bare_rock') return { code: '210', cat: 'rock' }

  if (t.highway === 'motorway' || t.highway === 'trunk')   return { code: '501', cat: 'manmade' }
  if (t.highway === 'primary' || t.highway === 'secondary') return { code: '502', cat: 'manmade' }
  if (t.highway === 'tertiary' || t.highway === 'residential' || t.highway === 'unclassified') return { code: '503', cat: 'manmade' }
  if (t.highway === 'service' || t.highway === 'living_street') return { code: '503', cat: 'manmade' }
  if (t.highway === 'track')                        return { code: '504', cat: 'manmade' }
  if (t.highway === 'path' || t.highway === 'footway') return { code: '505', cat: 'manmade' }
  if (t.highway === 'bridleway' || t.highway === 'cycleway') return { code: '505', cat: 'manmade' }
  if (t.highway === 'steps')                        return { code: '506', cat: 'manmade' }
  if (t.power === 'line')                           return { code: '528', cat: 'manmade' }
  if (t.barrier === 'fence' || t.barrier === 'wall') return { code: '525', cat: 'manmade' }
  return null
}

/**
 * Bygg <defs> for ISOM-katalog: alle patterns + alle pointSymbols.
 * Returnerer { defs: string, patternIds: Map, symbolIds: Map }.
 */
export function buildIsomDefs(catalog = isomCatalogDefault) {
  const patternIds = new Map()
  const symbolIds = new Map()
  const defs = []

  for (const [name, spec] of Object.entries(catalog.patterns)) {
    const id = `iso-pat-${name}`
    patternIds.set(name, id)
    defs.push(buildPatternDef(id, spec))
  }
  for (const [name, spec] of Object.entries(catalog.pointSymbols)) {
    const id = `iso-sym-${name}`
    symbolIds.set(name, id)
    defs.push(buildPointSymbolDef(id, spec))
  }

  return { defs: defs.join(''), patternIds, symbolIds }
}

/** Returnerer ISOM-spec for en kode med valgfri darkMode-overstyring. */
export function getIsomDef(code, catalog = isomCatalogDefault, dark = false) {
  const entry = ISOM_CATEGORY_BY_CODE[code]
  if (!entry) return null
  let def = entry.def
  if (dark && catalog.darkMode?.categories?.[code]) {
    def = { ...def, ...catalog.darkMode.categories[code] }
  }
  return def
}

/**
 * Bygg path-attributter for en feature med gitt ISOM-kode.
 * Returnerer { fill, stroke } som er klare attribut-strenger.
 */
export function pathAttrsForIsomCode(code, catalog = isomCatalogDefault, patternIds, dark = false) {
  const def = getIsomDef(code, catalog, dark)
  if (!def) return null
  let fill = ''
  if (def.fill) {
    if (def.fill.type === 'pattern' && def.fill.pattern) {
      fill = `fill="url(#${patternIds.get(def.fill.pattern)})"`
    } else if (def.fill.color) {
      fill = `fill="${def.fill.color}"`
    }
  } else {
    fill = 'fill="none"'
  }
  const stroke = strokeAttrs(def.stroke)
  return { fill, stroke }
}

/** Inline CSS for en kategori-stil. Alle regler er prefikset med
 * `.isom-map` slik at stilene ikke lekker til andre SVG-er på siden
 * (f.eks. ikoner i toppbar-knapper). */
export function buildIsomCss(catalog = isomCatalogDefault, patternIds) {
  const rules = []
  const root = `.isom-map`
  rules.push(`${root} { background: var(--bg, ${catalog.background.color}); font-family: ui-sans-serif, system-ui, sans-serif; }`)
  rules.push(`${root} [data-layer] path { vector-effect: non-scaling-stroke; }`)

  for (const cat of ['terrain', 'water', 'rock', 'contour', 'manmade']) {
    for (const [code, def] of Object.entries(catalog.categories[cat])) {
      const sel = `${root} [data-iso="${code}"]`
      const props = []
      if (def.fill) {
        if (def.fill.type === 'pattern' && def.fill.pattern) {
          props.push(`fill: url(#${patternIds.get(def.fill.pattern)})`)
        } else if (def.fill.color) {
          props.push(`fill: var(--iso-${code}-fill, ${def.fill.color})`)
        }
      }
      if (def.stroke) {
        if (def.stroke.color) props.push(`stroke: var(--iso-${code}-stroke, ${def.stroke.color})`)
        if (def.stroke.widthMm) props.push(`stroke-width: ${def.stroke.widthMm}mm`)
        if (def.stroke.linecap) props.push(`stroke-linecap: ${def.stroke.linecap}`)
        if (def.stroke.linejoin) props.push(`stroke-linejoin: ${def.stroke.linejoin}`)
        if (def.stroke.dasharray) props.push(`stroke-dasharray: ${def.stroke.dasharray.map(d => `${d}mm`).join(' ')}`)
      }
      if (!def.fill) props.push('fill: none')
      if (props.length) rules.push(`${sel} { ${props.join('; ')} }`)
    }
  }

  // Etiketter
  const lab = catalog.labels
  rules.push(`${root} [data-label] { font-size: ${lab.place.fontSizeMm}mm; fill: ${lab.place.color}; paint-order: stroke; stroke: ${lab.place.haloColor}; stroke-width: ${lab.place.haloWidthMm}mm; stroke-linejoin: round; }`)
  rules.push(`${root} [data-label="peak"] { font-size: ${lab.peak.fontSizeMm}mm; fill: ${lab.peak.color}; font-weight: ${lab.peak.weight}; }`)
  rules.push(`${root} [data-label="kontur-tall"] { font-size: ${lab['kontur-tall'].fontSizeMm}mm; fill: ${lab['kontur-tall'].color}; font-style: italic; }`)

  return rules.join(' ')
}

export { isomCatalogDefault as isomCatalog }

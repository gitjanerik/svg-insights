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
  for (const cat of ['land', 'terrain', 'water', 'rock', 'contour', 'manmade']) {
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
// Norske navn-suffix som med rimelig sikkerhet indikerer saltvann.
// Bevisst konservativ liste — "sjøen"/"sjø" alene er IKKE med (Mjøsa,
// Storsjøen, Lutvann er innsjøer; Nordsjøen er sjø). "vannet"/"vatnet"
// er omtrent alltid ferskvann og blir derfor ikke filtrert som salt.
const SALT_NAME_SUFFIXES = [
  'fjord', 'fjorden', 'fjorder',
  'sundet', 'sund',
  'havet', 'havn', 'havna',
  'pollen',
]
function nameLooksSalty(name) {
  if (!name) return false
  const lower = name.toLowerCase().trim()
  return SALT_NAME_SUFFIXES.some(suf =>
    lower === suf || lower.endsWith(' ' + suf) || lower.endsWith('-' + suf) || lower.endsWith(suf)
  )
}

/**
 * Heuristikk for om et OSM-vann-element representerer saltvann (sjø, fjord,
 * bay, strait osv) snarere enn ferskvann (innsjø, tjern, dam). Brukes både
 * til ISOM-koding (303 vs 301) og til granulært filter når vi velger mellom
 * autoritative kilder (N50 Havflate vs Innsjø).
 */
export function isOsmWaterSalty(tags) {
  const t = tags ?? {}
  if (t.salt === 'yes' || t.tidal === 'yes') return true
  if (t.place === 'sea' || t.place === 'ocean') return true
  if (t.natural === 'bay' || t.natural === 'strait') return true
  const saltyWaterTypes = new Set(['sea', 'fjord', 'bay', 'strait', 'lagoon', 'cove'])
  if (saltyWaterTypes.has(t.water)) return true
  if (nameLooksSalty(t.name)) return true
  if (nameLooksSalty(t['name:no'])) return true
  if (nameLooksSalty(t['name:nb'])) return true
  return false
}

// Sjekk om en OSM-node har trigpunkt-relaterte tagger.
// Eksportert så peak-rendering kan overlappe trigpunkt-symbol når peak
// og trigpunkt deler node (vanlig i Norge: én node med både
// natural=peak og man_made=survey_point).
export function isTrigPoint(t) {
  if (!t) return false
  if (t.man_made === 'survey_point' || t.man_made === 'triangulation_pillar') return true
  if (t.historic === 'survey_point') return true
  if (t.geodesic) return true
  if (t.survey_point) return true  // any value, e.g. survey_point=yes på peak-node
  if (t['kartverket:objtype'] === 'Fastmerke') return true
  return false
}

export function classifyToIsom(el) {
  const t = el.tags ?? {}
  // Peak-noder sjekkes først, men hvis noden også har trigpunkt-tagger
  // returneres `peak` likevel (label-rendering håndterer overlay) slik at
  // navn + ele beholdes.
  if (el.type === 'node' && (t.natural === 'peak' || t.natural === 'saddle')) return { code: 'peak', cat: 'point' }
  if (el.type === 'node' && t.natural === 'cave_entrance') return { code: '215', cat: 'point' }
  if (el.type === 'node' && (t.man_made === 'adit' || t.man_made === 'mineshaft' || t.historic === 'mine')) return { code: '216', cat: 'point' }
  // Standalone trigpunkt-noder (uten peak-tag) får ISOM 113. Bruker
  // isTrigPoint() for å fange alle vanlige tagging-varianter.
  if (el.type === 'node' && isTrigPoint(t)) {
    return { code: '113', cat: 'point' }
  }
  // Sjømerker (ISOM 540-543). OSM `seamark:type=*` med fargevariant fra
  // colour-tag. Lateral skiller på colour=red/green; cardinal og spesial
  // eget kode.
  if (el.type === 'node' && t['seamark:type']) {
    const stype = t['seamark:type']
    if (stype === 'buoy_lateral' || stype === 'beacon_lateral') {
      const colour = (t['seamark:buoy_lateral:colour'] ?? t['seamark:beacon_lateral:colour'] ?? t['seamark:lateral:colour'] ?? '').toLowerCase()
      if (colour.includes('red')) return { code: '540', cat: 'point' }
      if (colour.includes('green')) return { code: '541', cat: 'point' }
      return { code: '543', cat: 'point' }
    }
    if (stype === 'buoy_cardinal' || stype === 'beacon_cardinal') return { code: '542', cat: 'point' }
    if (stype === 'buoy_safe_water' || stype === 'beacon_safe_water' ||
        stype === 'buoy_special_purpose' || stype === 'beacon_special_purpose' ||
        stype === 'buoy_isolated_danger' || stype === 'beacon_isolated_danger') {
      return { code: '543', cat: 'point' }
    }
    // Andre seamark-typer (lighthouse, daymark) får ingen ISOM-kode her;
    // lighthouse fanges av lanterne-kode hvis det er på sjøkart-fetcher.
  }
  if (el.type === 'node' && t.place) return { code: 'place', cat: 'point' }

  // ── Sjøkart-spesifikke tags (Kartverket Sjøkart-Dybdedata WFS) ────────
  // Disse settes av sjokartFetcher.sjokartToElements() og må mappes
  // før de generelle natural=water-reglene under (siden Dybdeareal også
  // har natural=water + water=sea satt for backward-kompatibilitet).
  if (t.sjokart === 'lanterne')   return { code: '533', cat: 'point' }
  if (t.sjokart === 'grunne' && el.type === 'node') return { code: '211', cat: 'point' }
  if (t.sjokart === 'dybdepunkt') return { code: 'dybdepunkt', cat: 'point' }
  if (t.sjokart === 'dybdekontur') return { code: '306', cat: 'water' }
  if (t.sjokart === 'dybdeareal')  return { code: '307', cat: 'water' }

  // OSM `place=island/islet` — land-øy-overlay som dekker over feilplassert
  // OSM-vann ("Landøya-problemet": natural=water-relations som ikke har
  // riktige inner-rings for hver øy → blå smitter inn på land). Renders
  // som kremgul polygon ETTER vann-laget, før konturer/veier.
  if (t.place === 'island' || t.place === 'islet') return { code: '001', cat: 'land' }

  if (t.building)                                   return { code: '521', cat: 'manmade' }
  // Saltvann / fjord / sjø → ISOM 303 (mørkere, mer mettet blå).
  // Eksplisitte tags først, deretter navn-heuristikk for fjord-polygoner
  // som mangler subtype-tag (svært vanlig for Oslofjord, Sognefjord osv.)
  const isSeaPlace = t.place === 'sea' || t.place === 'ocean'
  if (t.natural === 'water' || t.water || t.natural === 'bay' || t.natural === 'strait' || isSeaPlace) {
    if (isOsmWaterSalty(t)) return { code: '303', cat: 'water' }
    return { code: '301', cat: 'water' }
  }
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
  // Sykkel-sti (508) før gang-sti så cycleway ikke blir behandlet som
  // vanlig sti. Også OSM highway=path/footway med bicycle=designated/yes.
  if (t.highway === 'cycleway')                     return { code: '508', cat: 'manmade' }
  if ((t.highway === 'path' || t.highway === 'footway') &&
      (t.bicycle === 'designated' || t.bicycle === 'yes')) {
    return { code: '508', cat: 'manmade' }
  }
  // Sti-differensiering basert på OSM-tagger:
  //   trail_visibility (excellent|good|intermediate|bad|horrible|no)
  //   path:visibility (alternativ skrivemåte)
  //   informal=yes (uoffisielt tråkk uten skilting)
  //   sac_scale (T1=hiking, T2=mountain_hiking, T3+=demanding/alpine)
  // Faller tilbake til 505 (sti godt løp) for vanlige path/footway/bridleway
  // når ingen kvalitets-tags finnes. Tidligere ble ALLE sliket kodet 505,
  // så ingen skille mellom DNT-merket sti og knapt synlig stitråkk.
  if (t.highway === 'path' || t.highway === 'footway' || t.highway === 'bridleway') {
    const tv = t.trail_visibility ?? t['path:visibility']
    // 507 — knapt synlig stitråkk
    if (tv === 'horrible' || tv === 'no' ||
        t.sac_scale === 'demanding_mountain_hiking' ||
        t.sac_scale === 'alpine_hiking' ||
        t.sac_scale === 'demanding_alpine_hiking' ||
        t.sac_scale === 'difficult_alpine_hiking') {
      return { code: '507', cat: 'manmade' }
    }
    // 506 — sti uklar (DNT-trasé som ikke er ryddet, off-trail-tråkk)
    if (tv === 'intermediate' || tv === 'bad' ||
        t.informal === 'yes' ||
        t.sac_scale === 'mountain_hiking') {
      return { code: '506', cat: 'manmade' }
    }
    // 505 — sti godt løp (default for tagget path/footway/bridleway)
    return { code: '505', cat: 'manmade' }
  }
  if (t.highway === 'steps')                        return { code: '506', cat: 'manmade' }
  if (t.power === 'line')                           return { code: '528', cat: 'manmade' }
  if (t.barrier === 'fence' || t.barrier === 'wall') return { code: '525', cat: 'manmade' }
  // Jernbane (ISOM 515) — solid sort linje med hvite ladder-stripes
  if (t.railway && ['rail', 'tram', 'narrow_gauge', 'light_rail', 'subway', 'funicular', 'monorail'].includes(t.railway)) {
    return { code: '515', cat: 'manmade' }
  }

  // Ski-infrastruktur (Norge):
  //   aerialway=* (chair_lift, gondola, drag_lift, t-bar etc) → 511 heistrasé
  //   piste:type=downhill (way som area) → 512 slalombakke (gulgrønn fyll)
  //   piste:type=nordic/hike/skitour (way som linje) → 510 lysløype-style
  //   leisure=track + sport=skiing → 510 lysløype (vanligvis langrenns-rundløype)
  if (t.aerialway) return { code: '511', cat: 'manmade' }
  const piste = t['piste:type']
  if (piste === 'downhill' || piste === 'sled' || piste === 'snow_park') {
    return { code: '512', cat: 'manmade' }
  }
  if (piste === 'nordic' || piste === 'hike' || piste === 'skitour' || piste === 'classic' || piste === 'skating') {
    return { code: '510', cat: 'manmade' }
  }
  if (t.leisure === 'track' && t.sport === 'skiing') {
    return { code: '510', cat: 'manmade' }
  }
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

  for (const cat of ['land', 'terrain', 'water', 'rock', 'contour', 'manmade']) {
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
      // Overlay-stroke (f.eks. jernbane-sviller). Kun strokes som har
      // overlayStroke får dette ekstra path-laget — selektor matcher
      // path med klasse "overlay" inni samme data-iso.
      if (def.overlayStroke) {
        const ov = def.overlayStroke
        const ovProps = ['fill: none']
        if (ov.color) ovProps.push(`stroke: ${ov.color}`)
        if (ov.widthMm) ovProps.push(`stroke-width: ${ov.widthMm}mm`)
        if (ov.linecap) ovProps.push(`stroke-linecap: ${ov.linecap}`)
        if (ov.linejoin) ovProps.push(`stroke-linejoin: ${ov.linejoin}`)
        if (ov.dasharray) ovProps.push(`stroke-dasharray: ${ov.dasharray.map(d => `${d}mm`).join(' ')}`)
        rules.push(`${sel} path.overlay { ${ovProps.join('; ')} }`)
      }
    }
  }

  // Jernbane (515) tunnel-fantom: grå dashed linje uten sviller.
  // Datapath har attributt `data-tunnel="yes"` på både base og overlay.
  // Overlay skjules; base får ny stroke. Tunnel-portal: tverrstrek ved
  // start/slutt av tunnel-way.
  rules.push(`${root} [data-iso="515"] path[data-tunnel="yes"] { stroke: #555; stroke-width: 0.18mm; stroke-dasharray: 1mm 0.4mm; fill: none; opacity: 0.5 }`)
  rules.push(`${root} [data-iso="515"] path.overlay[data-tunnel="yes"] { display: none }`)
  rules.push(`${root} [data-iso="515"] line.tunnel-portal { stroke: #000; stroke-width: 0.3mm; stroke-linecap: square; fill: none }`)

  // Etiketter
  const lab = catalog.labels
  rules.push(`${root} [data-label] { font-size: ${lab.place.fontSizeMm}mm; fill: ${lab.place.color}; paint-order: stroke; stroke: ${lab.place.haloColor}; stroke-width: ${lab.place.haloWidthMm}mm; stroke-linejoin: round; }`)
  rules.push(`${root} [data-label="peak"] { font-size: ${lab.peak.fontSizeMm}mm; fill: ${lab.peak.color}; font-weight: ${lab.peak.weight}; stroke: ${lab.peak.haloColor}; stroke-width: ${lab.peak.haloWidthMm}mm; paint-order: stroke; stroke-linejoin: round; }`)
  if (lab['peak-ele']) {
    const pe = lab['peak-ele']
    const styleProps = [
      `font-size: ${pe.fontSizeMm}mm`,
      `fill: ${pe.color}`,
      pe.italic ? 'font-style: italic' : null,
      pe.weight ? `font-weight: ${pe.weight}` : null,
      `stroke: ${pe.haloColor}`,
      `stroke-width: ${pe.haloWidthMm}mm`,
      'paint-order: stroke',
      'stroke-linejoin: round',
    ].filter(Boolean).join('; ')
    rules.push(`${root} [data-label="peak-ele"] { ${styleProps} }`)
  }
  rules.push(`${root} [data-label="kontur-tall"] { font-size: ${lab['kontur-tall'].fontSizeMm}mm; fill: ${lab['kontur-tall'].color}; font-style: italic; }`)
  if (lab['vann-navn']) {
    const vn = lab['vann-navn']
    const styleProps = [
      `font-size: ${vn.fontSizeMm}mm`,
      `fill: ${vn.color}`,
      vn.italic ? 'font-style: italic' : null,
      vn.weight ? `font-weight: ${vn.weight}` : null,
      `stroke: ${vn.haloColor}`,
      `stroke-width: ${vn.haloWidthMm}mm`,
      'paint-order: stroke',
      'stroke-linejoin: round',
    ].filter(Boolean).join('; ')
    rules.push(`${root} [data-label="vann-navn"] { ${styleProps} }`)
  }
  if (lab['vann-tall']) {
    rules.push(`${root} [data-label="vann-tall"] { font-size: ${lab['vann-tall'].fontSizeMm}mm; fill: ${lab['vann-tall'].color}; font-style: italic; stroke: ${lab['vann-tall'].haloColor}; stroke-width: ${lab['vann-tall'].haloWidthMm}mm; }`)
  }
  if (lab['dybde-tall']) {
    rules.push(`${root} [data-label="dybde-tall"] { font-size: ${lab['dybde-tall'].fontSizeMm}mm; fill: ${lab['dybde-tall'].color}; stroke: ${lab['dybde-tall'].haloColor}; stroke-width: ${lab['dybde-tall'].haloWidthMm}mm; }`)
  }

  return rules.join(' ')
}

export { isomCatalogDefault as isomCatalog }

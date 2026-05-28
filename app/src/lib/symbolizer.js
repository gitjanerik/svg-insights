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
    if (el.type === 'rect') {
      // ISOM 540 (stake-port) og 542 (stake-cardinal) bruker rect-elementer
      // — uten denne handleren ble de silent dropped → tomme symboler
      // (usynlig på kart og i Tegnforklaring).
      const stroke = el.stroke ? `stroke="${el.stroke}" stroke-width="${el.widthMm}mm"` : ''
      const fill = el.fill ?? 'none'
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="${fill}" ${stroke}/>`
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
  if (el.type === 'node' && t.place) return { code: 'place', cat: 'point' }

  // ── Sjøkart-spesifikke tags (Kartverket Sjøkart-Dybdedata WFS) ────────
  // Settes av sjokartFetcher.sjokartToElements() og må mappes før den
  // generelle natural=water-regelen under (dybdeareal har også
  // natural=water + water=sea satt for backward-kompatibilitet).
  if (t.sjokart === 'dybdekontur') return { code: '306', cat: 'water' }
  if (t.sjokart === 'dybdeareal')  return { code: '307', cat: 'water' }
  if (t.sjokart === 'grunne') {
    return el.type === 'node' ? { code: '211', cat: 'point' } : { code: '214', cat: 'rock' }
  }
  if (t.sjokart === 'lanterne')   return { code: '533', cat: 'point' }
  if (t.sjokart === 'dybdepunkt') return { code: 'dybdepunkt', cat: 'point' }

  // OSM `place=island/islet` — land-øy-overlay som dekker over feilplassert
  // OSM-vann ("Landøya-problemet": natural=water-relations som ikke har
  // riktige inner-rings for hver øy → blå smitter inn på land). Renders
  // som kremgul polygon ETTER vann-laget, før konturer/veier.
  if (t.place === 'island' || t.place === 'islet') return { code: '001', cat: 'land' }

  // Kirke (ISOM 532-derivert): point-symbol. OSM tagger churches på flere
  // måter — `amenity=place_of_worship` (vanligst), eller `building=church`
  // direkte. Node-varianten klassifiseres her som point; way-varianten
  // (en bygning som *er* kirken) faller gjennom til 521 og får en
  // korsmarkør plassert på centroid i mapBuilder.
  if (el.type === 'node' && (t.amenity === 'place_of_worship' || t.building === 'church' || t.building === 'chapel')) {
    return { code: '532', cat: 'point' }
  }

  // Utfartsparkering (ISOM 534-derivert): blå P-symbol. OSM tagger parkering
  // på flere måter — `amenity=parking` på node (vanlig for små lommer langs
  // skogsbilvei) eller way (polygon for større parkeringsplasser). Way-
  // varianten klassifiseres her som point siden vi rendrer ett symbol på
  // sentroid uavhengig av polygon-størrelse.
  if (t.amenity === 'parking') {
    return { code: '534', cat: 'point' }
  }

  // Bom / barriere (ISOM 526-derivert): sort horisontal bar. OSM tagger bom
  // på noder med `barrier=gate/lift_gate/swing_gate/bollard/block/cycle_barrier/
  // cattle_grid`. Vi viser dem på alle disse typene siden de alle stopper
  // ferdsel (motorisert eller alle) langs skogsbilvei eller sti.
  if (el.type === 'node' && t.barrier) {
    const allowedBarriers = new Set(['gate', 'lift_gate', 'swing_gate', 'bollard', 'block', 'cycle_barrier', 'cattle_grid'])
    if (allowedBarriers.has(t.barrier)) {
      return { code: '526', cat: 'point' }
    }
  }

  // Naturreservat / verneområde (ISOM 520-derivert, Norge-spesifikk
  // utvidelse). Sjekkes FØR vegetasjon/vann/landuse siden et naturreservat-
  // polygon kan også ha andre tags (f.eks. natural=wood på samme polygon),
  // og vernet status skal vinne over generell landbruks-/vegetasjons-
  // klassifisering. Lett grønn overlay matcher Kartverkets konvensjon.
  //
  // OSM tagger Norske naturreservater/nasjonalparker som ENTEN:
  //   - leisure=nature_reserve (vanlig på way)
  //   - boundary=protected_area + protect_class=1/1a/1b/4 (vanlig på relation,
  //     tilsvarer IUCN-kategoriene for strict nature reserve / habitat management
  //     = norske naturreservater og biotopvern)
  //   - boundary=national_park (nasjonalparker, egen kategori men samme rendering)
  //
  // KRITISK: krever name-tag. Uten denne sjekken fanget vi opp store unavn-
  // gitte multipolygoner (f.eks. friluftslivsområder / markalov-områder feil-
  // tagget i OSM) som dekket hele kart-bbox-en med grønn overlay (v8.10.14
  // bug-rapport: Kjekstadmarka). Ekte naturreservater og nasjonalparker har
  // ALLTID et navn — så name-kravet er trygt og filtrerer effektivt bort
  // mistags.
  //
  // protect_class er strammere enn før: tidligere ^[1-7]$ inkluderte også
  // landskapsvernområder (5) og managed resources (6) som kan dekke vast
  // arealer. Nå kun strict reserves (1/1a/1b) og habitat management (4).
  if (el.type !== 'node') {
    const name = t.name ?? t['name:no'] ?? t['name:nb']
    if (name && String(name).trim()) {
      if (t.leisure === 'nature_reserve') return { code: '520', cat: 'manmade' }
      if (t.boundary === 'national_park') return { code: '520', cat: 'manmade' }
      if (t.boundary === 'protected_area' && /^(1|1a|1b|4)$/.test(String(t.protect_class ?? ''))) {
        return { code: '520', cat: 'manmade' }
      }
    }
  }
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
  // v8.9.24: gang-/sykkelstier og fortau er fjernet fra turkartet — ISOM 508
  // (sykkel-sti) blir ikke lenger emittet, og OSM highway=footway/cycleway
  // filtreres bort i Overpass-spørringen. Bredere markerte stier
  // (highway=path/bridleway) beholdes som ISOM 505/506/507 nedenfor.
  // Fortau (footway=sidewalk) faller automatisk bort siden vi avviser
  // footway-ways helt; sidewalks tagget på vei-objekt selv (sidewalk=*)
  // genererer ikke egen way og rendres dermed ikke.
  if (t.footway === 'sidewalk') return null
  if (t.highway === 'path' || t.highway === 'bridleway') {
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
 * (f.eks. ikoner i toppbar-knapper).
 *
 * v8.9.24: `options.widthM` skalerer label-font og halo proporsjonalt
 * med kartstørrelsen. Bakgrunn: viewBox er i meter (1 user-unit = 1m),
 * mens label-font er i mm (absolutt = ~3.78 user-units pr mm). Et større
 * kart har større viewBox, så absolutte mm-størrelser blir en mindre
 * andel av synlig kart — labels blir mikroskopiske ved max zoom. Vi
 * skalerer mm-verdiene med `clamp(widthM/4000, 1, 3)` så et 10 km kart
 * får 2.5× større labels (matches det 4 km referansekart leverte) uten
 * å sprenge ved ekstreme 30 km+ kart.
 */
export function buildIsomCss(catalog = isomCatalogDefault, patternIds, options = {}) {
  const rules = []
  const root = `.isom-map`
  const widthM = Number(options.widthM)
  const labelScale = Number.isFinite(widthM) && widthM > 0
    ? Math.min(3, Math.max(1, widthM / 4000))
    : 1
  const mm = (v) => `${Number((v * labelScale).toFixed(3))}mm`
  // Halo skal vokse mindre dramatisk (bare ~kvadratrot) så ikke teksten
  // drukner i hvit ramme på store kart.
  const haloMm = (v) => `${Number((v * Math.sqrt(labelScale)).toFixed(3))}mm`
  // Global strek-skala: FAB-knotten i MapView setter `--stroke-scale` på
  // `.isom-map`-roten. calc() lar brukeren justere all kartlinje-tykkelse i
  // sanntid uten re-render. Default 1 = ISOM-spec-bredder. Påvirker kun
  // kartlinjer (kategori-strokes), ikke tekst-haloer.
  const sw = (v) => `calc(${v}mm * var(--stroke-scale, 1))`
  // Inter variable webfont (selv-hostet via @fontsource-variable/inter, lastet
  // i appens style.css). font-weight: 400 er base for labels; spesifikke labels
  // (peak, stedsnavn) overstyrer under. tabular-nums sørger for at høyde-,
  // dybde- og kontur-tall står monospaced.
  rules.push(`${root} { background: var(--bg, ${catalog.background.color}); font-family: 'Inter Variable', ui-sans-serif, system-ui, sans-serif; font-weight: 400; font-variant-numeric: tabular-nums; }`)
  // Bakgrunn-rect bruker også --bg så mørk modus erstatter den kremgule
  // landoverflaten med dark brown (presentation-attr fill blir overstyrt).
  rules.push(`${root} #bakgrunn rect { fill: var(--bg, ${catalog.background.color}); }`)
  rules.push(`${root} [data-layer] path { vector-effect: non-scaling-stroke; }`)
  // v8.10.3 — Perf: under aktiv pinch/wheel-gest slår vi av non-scaling-stroke
  // så browseren slipper å re-tessellere stroke-geometri i device-piksler per
  // frame. Strokene skalerer med viewBox-transformen mens gesten varer
  // (visuelt OK i 200 ms) og snapper tilbake til riktig bredde via klassen
  // som fjernes etter gesten. Stor frame-rate-gevinst på store kart.
  rules.push(`${root}.is-zooming [data-layer] path { vector-effect: none; }`)
  // v8.10.3 — Perf: CSS containment isolerer layer-grupper så browseren kan
  // skippe repaint av lag som ikke har endret seg (toggle av/på, hill-shade
  // re-render osv). `paint` containment betyr at lag-en ikke "smitter" visuelt
  // utenfor sin egen bounding box — trygt siden lagene allerede er klippet
  // til kartets viewBox.
  rules.push(`${root} [data-layer] { contain: paint; }`)
  // v8.10.4 — Perf: skjul kontur-tall ved utzoomet visning. Ved fit-to-extent
  // er tall-labels uleselig små uansett (mange hundre tall i synet samtidig);
  // browseren bruker likevel tid på text-shaping + halo-rendering. Vis dem
  // når MapView setter `.zoomed-in` på SVG-host (default ved scale >= 1.3).
  // Bekk-navn skjules også siden mange OSM-bekker har samme navn repetert
  // hver 2 km og blir visuell støy ved utzoom.
  rules.push(`${root}:not(.zoomed-in) [data-label="kontur-tall"] { display: none; }`)
  rules.push(`${root}:not(.zoomed-in) [data-layer="bekk"] text { display: none; }`)
  // Art-mode opacity for fyll-områder (skog/vann/aker/bygning osv).
  // Stroke-only features beholder full skarphet (fill-opacity påvirker ikke strokes).
  // CSS-var settes av MapView ved tema-bytte; default = 1 (vanlig modus).
  rules.push(`${root} [data-iso] { fill-opacity: var(--art-fill-opacity, 1); }`)

  for (const cat of ['land', 'terrain', 'water', 'rock', 'contour', 'manmade']) {
    for (const [code, def] of Object.entries(catalog.categories[cat])) {
      const sel = `${root} [data-iso="${code}"]`
      const props = []
      if (def.fill) {
        if (def.fill.type === 'pattern' && def.fill.pattern) {
          // v8.9.24: pattern-fills får også CSS-var-fallback så tema-
          // overstyringer (mørk, sepia, indigo, mocha, forest) faktisk
          // bytter åker-fyllet, ikke bare solid-fyll-koder. Settes ved
          // applyTheme() i MapView; default (lys/ISOM) bruker pattern.
          props.push(`fill: var(--iso-${code}-fill, url(#${patternIds.get(def.fill.pattern)}))`)
        } else if (def.fill.color) {
          props.push(`fill: var(--iso-${code}-fill, ${def.fill.color})`)
        }
      }
      if (def.stroke) {
        if (def.stroke.color) props.push(`stroke: var(--iso-${code}-stroke, ${def.stroke.color})`)
        if (def.stroke.widthMm) props.push(`stroke-width: ${sw(def.stroke.widthMm)}`)
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
        if (ov.color) ovProps.push(`stroke: var(--iso-${code}-overlay-stroke, ${ov.color})`)
        if (ov.widthMm) ovProps.push(`stroke-width: ${sw(ov.widthMm)}`)
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
  rules.push(`${root} [data-iso="515"] path[data-tunnel="yes"] { stroke: #555; stroke-width: ${sw(0.18)}; stroke-dasharray: 1mm 0.4mm; fill: none; opacity: 0.5 }`)
  rules.push(`${root} [data-iso="515"] path.overlay[data-tunnel="yes"] { display: none }`)
  rules.push(`${root} [data-iso="515"] line.tunnel-portal { stroke: #000; stroke-width: ${sw(0.3)}; stroke-linecap: square; fill: none }`)

  // ISOM 521 — små bygg (< 70 m²) får Kartverket-style hvit fyll + tynt
  // sort omriss. Skiller hytter/uthus visuelt fra bolig- og forretnings-
  // bygg som beholder den brune default-fargen. v8.9.32: stroke ned til
  // 0.05 mm (var 0.08 mm) så det normaliserte kvadrat-symbolet ikke
  // overdøves av sin egen kant ved små zoom-nivåer.
  rules.push(`${root} [data-iso="521"] path[data-small="yes"] { fill: var(--iso-521-small-fill, #fff); stroke: var(--iso-521-small-stroke, #000); stroke-width: ${sw(0.05)}; }`)

  // Etiketter — fill og halo er CSS-variabler så MapView kan overstyre i mørk modus.
  // Font og halo skaleres med kartstørrelse (se labelScale over) så et 10 km
  // kart leverer like lesbare labels ved max zoom som 4 km referanse-kart.
  const lab = catalog.labels
  rules.push(`${root} [data-label] { font-size: ${mm(lab.place.fontSizeMm)}; fill: var(--label-place-fill, ${lab.place.color}); paint-order: stroke; stroke: var(--label-place-halo, ${lab.place.haloColor}); stroke-width: ${haloMm(lab.place.haloWidthMm)}; stroke-linejoin: round; }`)
  rules.push(`${root} [data-label="peak"] { font-size: ${mm(lab.peak.fontSizeMm)}; fill: var(--label-peak-fill, ${lab.peak.color}); font-weight: ${lab.peak.weight}; stroke: var(--label-peak-halo, ${lab.peak.haloColor}); stroke-width: ${haloMm(lab.peak.haloWidthMm)}; paint-order: stroke; stroke-linejoin: round; }`)
  if (lab['peak-ele']) {
    const pe = lab['peak-ele']
    const styleProps = [
      `font-size: ${mm(pe.fontSizeMm)}`,
      `fill: var(--label-peak-ele-fill, ${pe.color})`,
      pe.italic ? 'font-style: italic' : null,
      pe.weight ? `font-weight: ${pe.weight}` : null,
      `stroke: var(--label-peak-ele-halo, ${pe.haloColor})`,
      `stroke-width: ${haloMm(pe.haloWidthMm)}`,
      'paint-order: stroke',
      'stroke-linejoin: round',
    ].filter(Boolean).join('; ')
    rules.push(`${root} [data-label="peak-ele"] { ${styleProps} }`)
  }
  rules.push(`${root} [data-label="kontur-tall"] { font-size: ${mm(lab['kontur-tall'].fontSizeMm)}; fill: var(--label-kontur-tall-fill, ${lab['kontur-tall'].color}); font-style: italic; }`)
  if (lab['vann-navn']) {
    const vn = lab['vann-navn']
    const styleProps = [
      `font-size: ${mm(vn.fontSizeMm)}`,
      `fill: var(--label-vann-navn-fill, ${vn.color})`,
      vn.italic ? 'font-style: italic' : null,
      vn.weight ? `font-weight: ${vn.weight}` : null,
      `stroke: var(--label-vann-navn-halo, ${vn.haloColor})`,
      `stroke-width: ${haloMm(vn.haloWidthMm)}`,
      'paint-order: stroke',
      'stroke-linejoin: round',
    ].filter(Boolean).join('; ')
    rules.push(`${root} [data-label="vann-navn"] { ${styleProps} }`)
  }
  if (lab['vann-tall']) {
    rules.push(`${root} [data-label="vann-tall"] { font-size: ${mm(lab['vann-tall'].fontSizeMm)}; fill: var(--label-vann-tall-fill, ${lab['vann-tall'].color}); font-style: italic; stroke: var(--label-vann-tall-halo, ${lab['vann-tall'].haloColor}); stroke-width: ${haloMm(lab['vann-tall'].haloWidthMm)}; }`)
  }
  // v8.10.9: områdenavn (myr, heath, locality-polygoner osv) og hytte-navn.
  // v8.10.15: naturreservat-navn — grønn skrift + hvit halo, samme visuelle
  // hierarki som blå vann-navn over innsjø-flater.
  for (const kind of ['omrade-navn', 'hytte-navn', 'naturreservat-navn']) {
    const cfg = lab[kind]
    if (!cfg) continue
    const styleProps = [
      `font-size: ${mm(cfg.fontSizeMm)}`,
      `fill: var(--label-${kind}-fill, ${cfg.color})`,
      cfg.italic ? 'font-style: italic' : null,
      cfg.weight ? `font-weight: ${cfg.weight}` : null,
      `stroke: var(--label-${kind}-halo, ${cfg.haloColor})`,
      `stroke-width: ${haloMm(cfg.haloWidthMm)}`,
      'paint-order: stroke',
      'stroke-linejoin: round',
    ].filter(Boolean).join('; ')
    rules.push(`${root} [data-label="${kind}"] { ${styleProps} }`)
  }
  // v8.1.0: stedsnavn-overlay — stor, fet skrift med tydelig hvit halo
  // som overlay over kartet. Toggleable via 'Stedsnavn'-knapp i drawer
  // (default AV). Bruker --label-stedsnavn-* CSS-vars så tema kan tilpasse.
  rules.push(`${root} [data-label="stedsnavn"] { font-size: ${mm(6.4)}; font-weight: 800; fill: var(--label-stedsnavn-fill, #1a1a1a); paint-order: stroke; stroke: var(--label-stedsnavn-halo, #fff); stroke-width: ${haloMm(1.2)}; stroke-linejoin: round; pointer-events: none; }`)

  return rules.join(' ')
}

export { isomCatalogDefault as isomCatalog }

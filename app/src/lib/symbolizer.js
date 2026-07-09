// ISOM-inspirert symbolisering. Tar OSM/N50-features og en ISOM-katalog,
// produserer SVG-strenger (path, defs, symbols) med mm-baserte streker
// for print-kvalitet.
//
// Inn: GeoJSON-aktige features med isomCode satt på properties.
// Ut: { defs, layers } — defs er <pattern>/<symbol>-blokk, layers er
// kategori-keyed strings med <g data-layer="kategori">…

import isomCatalogDefault from './isomCatalog.json' with { type: 'json' }
import { depthBandFills } from './sjokartFetcher.js'

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
  // GOTCHA (anker-buggen, v9.3.10): point-symbolene har viewBox="-1 -1 2 2"
  // (2 bruker-enheter brede) og plasseres via <use width="{scaleMm}mm">. En
  // stroke-width oppgitt i "mm" konverteres til bruker-enheter i symbolets
  // EGET koordinatrom (~3.78 enheter/mm), så f.eks. "0.14mm" → ~0.53 enheter
  // = ~26 % av symbolbredden → tykk klump (ankeret ble en solid blob fordi
  // dens lille ring r=0.16 + bue ble fylt av streken). Riktig strekbredde i
  // dette rommet er i SYMBOL-ENHETER, ikke mm: med scaleMm=2 er 1 enhet ≈ 1 mm
  // på kartet, så strokeW=0.12 ≈ 0.12 mm trykk-strek. Bruk `strokeW` for nye/
  // korrigerte symboler; `widthMm` beholdes for bakoverkompat på de øvrige
  // strek-symbolene (knaus/brønn/bro/skjaer/…) til de evt. migreres.
  const strokeW = el => el.strokeW != null ? `${el.strokeW}` : `${el.widthMm}mm`
  const cap = el => el.linecap ? ` stroke-linecap="${el.linecap}"` : ''
  const elements = (spec.elements ?? []).map(el => {
    if (el.type === 'line') {
      return `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" stroke="${el.stroke}" stroke-width="${strokeW(el)}"${cap(el)} ${el.fill === 'none' ? 'fill="none"' : ''}/>`
    }
    if (el.type === 'circle') {
      const stroke = el.stroke ? `stroke="${el.stroke}" stroke-width="${strokeW(el)}"` : ''
      const fill = el.fill ?? 'none'
      return `<circle cx="${el.cx}" cy="${el.cy}" r="${el.r}" fill="${fill}" ${stroke}/>`
    }
    if (el.type === 'path') {
      const stroke = el.stroke ? `stroke="${el.stroke}" stroke-width="${strokeW(el)}"${cap(el)}` : ''
      const fill = el.fill ?? 'none'
      return `<path d="${el.d}" fill="${fill}" ${stroke}/>`
    }
    if (el.type === 'polygon') {
      return `<polygon points="${el.points}" fill="${el.fill}"/>`
    }
    if (el.type === 'text') {
      // Brukt av WC-symbolet (ISOM 554): kort tekst sentrert i symbol-viewBox.
      return `<text x="${el.x ?? 0}" y="${el.y ?? 0}" font-size="${el.fontSize}" text-anchor="middle" fill="${el.fill}" font-family="sans-serif" font-weight="700">${el.content}</text>`
    }
    if (el.type === 'rect') {
      // ISOM 540 (stake-port) og 542 (stake-cardinal) bruker rect-elementer
      // — uten denne handleren ble de silent dropped → tomme symboler
      // (usynlig på kart og i Tegnforklaring).
      const stroke = el.stroke ? `stroke="${el.stroke}" stroke-width="${strokeW(el)}"` : ''
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
/**
 * Avgjør om et OSM-vann-element representerer saltvann (sjø, fjord, bay,
 * strait) snarere enn ferskvann (innsjø, tjern, dam). Brukes både til ISOM-
 * koding (303 vs 301) og til granulært filter når vi velger mellom autoritative
 * kilder (N50 Havflate vs Innsjø).
 *
 * PRINSIPP: KUN autoritative tagger avgjør salinitet — ALDRI navnet. Norske
 * stedsnavn er upålitelige: Tyrifjorden/Randsfjorden/Steinsfjorden er ferskvanns-
 * innsjøer med «fjord»-navn, og «Hestesund» er innlands. En tidligere navne-
 * suffiks-heuristikk (`nameLooksSalty`) feilklassifiserte alle fjord-navngitte
 * innsjøer som sjø og er nå fjernet. `water=fjord` er også droppet: en water-tagg
 * på et innlands natural=water-polygon er upålitelig (ofte feil-tagget på
 * ferskvanns-fjord-innsjøer), og ekte sjø-fjorder fanges uansett av kystlinje/
 * Sjøkart/place=sea/salt=yes/DEM-sjø.
 */
export function isOsmWaterSalty(tags) {
  const t = tags ?? {}
  if (t.salt === 'yes' || t.tidal === 'yes') return true
  if (t.place === 'sea' || t.place === 'ocean') return true
  if (t.natural === 'bay' || t.natural === 'strait') return true
  const saltyWaterTypes = new Set(['sea', 'bay', 'strait', 'lagoon', 'cove'])
  if (saltyWaterTypes.has(t.water)) return true
  return false
}

// Maritime navne-features: geografiske navn i/ved sjøen som hører hjemme i et
// eget «Sjønavn»-lag — bukt/vik/kile (natural=bay), nes/odde (natural=cape),
// sund (natural=strait), grunne (natural=shoal), rev (natural=reef), halvøy
// (natural=peninsula), holme/øy (place=islet/island) og navngitte skjær
// (seamark:type=rock). Brukes KUN til etikett-innsamling — geometrien (øy-
// overlay 001, bukt-flate 303, sjømerke-symbol 211) klassifiseres som før via
// classifyToIsom. Krever name-tag hos kalleren; predikatet ser kun på type.
const MARITIME_NAME_NATURAL = new Set(['bay', 'cape', 'strait', 'shoal', 'reef', 'peninsula', 'isthmus'])
export function isMaritimeNameFeature(tags) {
  const t = tags ?? {}
  if (MARITIME_NAME_NATURAL.has(t.natural)) return true
  if (t.place === 'islet' || t.place === 'island') return true
  if (t['seamark:type'] === 'rock') return true
  return false
}

// Maritime navne-NODER uten eget kart-symbol (bukt/nes/sund/grunne/holme/øy).
// Disse har ingen geometri å rendre — vi samler kun navnet som sjønavn-etikett.
// Sjømerke-skjær (seamark:type=rock) er bevisst UTELATT: de beholder punkt-
// symbolet (ISOM 211) og får navnet i tillegg, så de skal IKKE skippes i
// klassifiseringen.
export function isMaritimeNameOnlyNode(tags) {
  const t = tags ?? {}
  if (t['seamark:type']) return false
  return isMaritimeNameFeature(t)
}

// Flytende ferskvann tagget som FLATE: elve-/kanal-/bekkeløp (water=river osv.)
// eller waterway-areal (riverbank/dock). Skilles ut fordi de autoritative norske
// ferskvanns-kildene (NVE innsjø-flater, N50 vann) KUN dekker stillestående vann
// (innsjøer/magasin) — aldri elveløp. Slike flater må derfor aldri undertrykkes
// av N50/NVE, ellers kollapser brede elver (f.eks. Drammenselva) fra fylt blå
// flate til kun en hårtynn OSM-senterlinje (waterway=river → 304).
const FLOWING_WATER_SUBTYPES = new Set(['river', 'canal', 'stream', 'ditch', 'lock', 'moat', 'rapids', 'fish_pass'])
export function isFlowingWaterArea(tags) {
  const t = tags ?? {}
  if (FLOWING_WATER_SUBTYPES.has(t.water)) return true
  if (t.waterway === 'riverbank' || t.waterway === 'river' ||
      t.waterway === 'canal' || t.waterway === 'dock') return true
  return false
}

// Utfartsparkering vs. vanlig/privat parkering — regelsettet bor i
// parkingRules.js (delt med Ruteplanleggeren, v12.1.16); re-eksporteres her
// så eksisterende imports er uendret.
export { isTrailheadParking } from './parkingRules.js'

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
  if (t.sjokart === 'slipp')      return { code: '550', cat: 'point' }
  if (t.sjokart === 'havnestruktur') return { code: '551', cat: 'water' }  // kai/brygge/molo (areal)
  if (t.sjokart === 'fareomraade')   return { code: '552', cat: 'water' }  // fareområde (areal)

  // ── Fase 3: marine / padle-POI ───────────────────────────────────────
  // Mange koder her gjenbruker eksisterende ISOM-marine katalog-symboler
  // (533/540–543/211/550) som tidligere ble klassifisert men ikke rendret.
  // Kilder: OSM (man_made=lighthouse, seamark:type, leisure=marina/slipway,
  // natural=beach, amenity=toilets/drinking_water) + Sjøkart-WFS.
  if (t.man_made === 'lighthouse') return { code: '533', cat: 'point' }
  const seamark = t['seamark:type']
  if (seamark) {
    if (/light/.test(seamark)) return { code: '533', cat: 'point' }   // fyr/lykt
    // v11.0.54 (kajakkpadler): babord/styrbord/cardinal/generisk slått sammen
    // til ETT «sjømerke» (543). Fire varianter med farge-koding er chart-
    // pedanteri på turkart-skala; fyr (533) og skjær (211) holdes tydelige.
    if (/rock|obstruction|wreck/.test(seamark)) return { code: '211', cat: 'point' }  // skjær/grunne
    if (/lateral|cardinal|beacon|buoy|pile|stake|mooring/.test(seamark)) {
      return { code: '543', cat: 'point' }
    }
  }
  if (t.leisure === 'marina')          return { code: '553', cat: 'point' }  // småbåthavn
  if (t.leisure === 'slipway')         return { code: '550', cat: 'point' }  // landingssted
  if (t.natural === 'beach')           return { code: '556', cat: 'manmade' }  // strand / badeplass — areal (sand-stippel-flate), ikke punkt (v9.3.37)
  if (t.amenity === 'toilets')         return { code: '554', cat: 'point' }
  if (t.amenity === 'drinking_water')  return { code: '555', cat: 'point' }

  // Holdeplass (ISOM-derivert 560): buss-/tog-/trikkestopp. Hentes fra OSM
  // highway=bus_stop, railway=station/halt/tram_stop, public_transport=station.
  // Brukes av «nærmeste holdeplass»-snarveien i kart-søket.
  if (t.highway === 'bus_stop')        return { code: '560', cat: 'point' }
  if (t.railway === 'station' || t.railway === 'halt' || t.railway === 'tram_stop') return { code: '560', cat: 'point' }
  if (t.public_transport === 'station') return { code: '560', cat: 'point' }

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
  // Idrettsanlegg (Norge-spesifikk ISOM-utvidelse 513): stadion, idrettspark,
  // idrettsbane, travbane, friidrettsbane, hoppbakke, arena. Markeres med
  // anleggets faktiske form («baneform») i en distinkt farge. Eget toggle-lag
  // som rendres nederst sammen med slalombakke/heistrasé. Sjekkes FØR
  // `building` (et stadion-/arena-bygg skal bli idrettsanlegg, ikke hus) og
  // FØR generell landuse/leisure-klassifisering.
  //   leisure=stadium        → stadion / arena
  //   leisure=sports_centre  → idrettspark / idrettshall
  //   leisure=pitch          → idrettsbane (fotball, tennis, håndball …)
  //   leisure=track          → løpebane / friidrettsbane / travbane
  //   leisure=horse_racing   → travbane / galoppbane
  //   landuse=recreation_ground → idrettspark / anleggsareal
  //   building=stadium       → arena-bygg
  //   sport=ski_jumping      → hoppbakke (uansett base-tag)
  // MERK: leisure=track + sport=skiing er lysløype (510), ikke idrettsanlegg
  // — den ekskluderes her og fanges lenger ned i ski-infrastruktur-grenen.
  if (
    t.leisure === 'stadium' ||
    t.leisure === 'sports_centre' ||
    t.leisure === 'pitch' ||
    t.leisure === 'horse_racing' ||
    (t.leisure === 'track' && t.sport !== 'skiing') ||
    t.landuse === 'recreation_ground' ||
    t.building === 'stadium' ||
    t.sport === 'ski_jumping'
  ) {
    return { code: '513', cat: 'manmade' }
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
  const patternDefs = new Map()   // name → def-streng (for lazy/filtrert emit)
  const symbolDefs = new Map()

  for (const [name, spec] of Object.entries(catalog.patterns)) {
    const id = `iso-pat-${name}`
    patternIds.set(name, id)
    patternDefs.set(name, buildPatternDef(id, spec))
  }
  for (const [name, spec] of Object.entries(catalog.pointSymbols)) {
    const id = `iso-sym-${name}`
    symbolIds.set(name, id)
    symbolDefs.set(name, buildPointSymbolDef(id, spec))
  }

  const defs = [...patternDefs.values()].join('') + [...symbolDefs.values()].join('')
  return { defs, patternIds, symbolIds, patternDefs, symbolDefs }
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
  // v9.1.10 — Lazy CSS: hvis kaller sender et `usedCodes`-sett, emitterer vi
  // kun kode-spesifikke regler for koder som faktisk forekommer i SVG-en.
  // Spar konstant ~4-5 KB CSS pr kart. Uten settet (f.eks. Tegnforklaring)
  // emitteres alt som før. Trygt: en regel for en data-iso som ikke finnes
  // i dokumentet matcher uansett ingenting.
  const usedCodes = options.usedCodes instanceof Set ? options.usedCodes : null
  const codeUsed = (code) => !usedCodes || usedCodes.has(code)
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
  // v11.0.51: REVERTERT linjevekt-gulvet fra v11.0.48. Et 0,08 mm-gulv klampet
  // de tynneste basisstrekene (høydekurve 101 = 0,07 mm) allerede ved nøytral
  // knott, så «Strek»-knotten sluttet å påvirke de røde kurvene — en av kartets
  // mest karakteristiske, brukerstyrte egenskaper. Strek-skalaen er igjen fri og
  // fullt dynamisk. (Et evt. framtidig lesbarhets-gulv MÅ ligge under basis-
  // breddene, jf. utsatt-listen i CLAUDE.md.)
  const sw = (v) => `calc(${v}mm * var(--stroke-scale, 1))`
  // Global tekst-skala: rotasjons-slidens søsken i MapView (desktop) setter
  // `--label-scale` på `.isom-map`-roten. calc() lar brukeren øke/minske ALLE
  // kart-etiketter (navn, høyde, stedsnavn, naturreservat, vann osv) i sanntid
  // uten re-render. Default 1 = «normal» (slider midtstilt). Halo-bredder
  // skaleres IKKE — de følger kartstørrelse som før, så teksten ikke drukner.
  const fs = (v) => `calc(${mm(v)} * var(--label-scale, 1))`
  // Land-font (bebyggelse/topp/område/hytte) er rotens font-family og settes via
  // --land-font (brukervalgt par under Innstillinger, se useLabelFonts.js i MapView).
  // Fallback = Inter Variable (selv-hostet i style.css) for eldre kart uten var-en.
  // Vann-navn overstyrer til --water-font (kursiv serif) lenger ned. font-weight: 400
  // er base; peak/stedsnavn overstyrer. tabular-nums = monospaced høyde-/dybde-/kontur-tall.
  rules.push(`${root} { background: var(--bg, ${catalog.background.color}); font-family: var(--land-font, 'Inter Variable'), ui-sans-serif, system-ui, sans-serif; font-weight: 400; font-variant-numeric: tabular-nums; }`)
  // Bakgrunn-rect bruker også --bg så mørk modus erstatter den kremgule
  // landoverflaten med dark brown (presentation-attr fill blir overstyrt).
  rules.push(`${root} #bakgrunn rect { fill: var(--bg, ${catalog.background.color}); }`)
  // Mosaikk-spøkelser (data-ghost-layer) får SAMME non-scaling-stroke som aktiv
  // flis, ellers skalerer strekene deres med zoom og blir tynnere enn originalen
  // når man zoomer ut for å se hele 2×2-mosaikken (rapportert v11.0.15). Samme
  // gest-perf-unntak under (.is-zooming) så de re-tessellerer ikke per frame.
  rules.push(`${root} [data-layer] path, ${root} [data-ghost-layer] path { vector-effect: non-scaling-stroke; }`)
  // v8.10.3 — Perf: under aktiv pinch/wheel-gest slår vi av non-scaling-stroke
  // så browseren slipper å re-tessellere stroke-geometri i device-piksler per
  // frame. Strokene skalerer med viewBox-transformen mens gesten varer
  // (visuelt OK i 200 ms) og snapper tilbake til riktig bredde via klassen
  // som fjernes etter gesten. Stor frame-rate-gevinst på store kart.
  rules.push(`${root}.is-zooming [data-layer] path, ${root}.is-zooming [data-ghost-layer] path { vector-effect: none; }`)
  // v8.10.3 — Perf: CSS containment isolerer layer-grupper så browseren kan
  // skippe repaint av lag som ikke har endret seg (toggle av/på, hill-shade
  // re-render osv). `paint` containment betyr at lag-en ikke "smitter" visuelt
  // utenfor sin egen bounding box — trygt siden lagene allerede er klippet
  // til kartets viewBox.
  rules.push(`${root} [data-layer] { contain: paint; }`)
  // v8.10.4 / v11.0.34 — Detalj-LOD: høyde-tall og bekke-navn er bare lesbare
  // (og verdt text-shaping + halo-rendering) når brukeren er «nesten helt inn».
  // De holdes derfor igjen til MapView setter `.zoom-near` (scale >= 2.5) — ikke
  // bare `.zoomed-in` (1.3) som før. Gjelder kontur-tall (moh på høydekurver),
  // vann-tall (moh i innsjø-sentroid) og bekke-navn (mange OSM-bekker repeterer
  // samme navn hver 2 km → visuell støy ved utzoom).
  // v12.0.17 — Dybdeareal (307): fyll per dybdebånd via klasse (class="dyp-N")
  // i stedet for per-polygon inline-style. Samme tema-bevisste var()-verdier
  // som depthToFillVar; mørke temaer setter --iso-depth-N via applyTheme.
  if (codeUsed('307')) {
    for (const { cls, fill } of depthBandFills()) {
      rules.push(`${root} [data-iso="307"] path.${cls} { fill: ${fill}; }`)
    }
  }
  rules.push(`${root}:not(.zoom-near) [data-label="kontur-tall"] { display: none; }`)
  rules.push(`${root}:not(.zoom-near) [data-label="vann-tall"] { display: none; }`)
  rules.push(`${root}:not(.zoom-near) [data-layer="bekk"] text { display: none; }`)
  // Dybde-tall to-trinns tetthet (mapBuilder grid-tynning): grov-cellevinnerne
  // (480 m, grunneste) vises alltid når dybde-laget er på; de fine (120 m,
  // data-fine) holdes igjen til .zoom-near. Long-press-lupen setter .zoom-near
  // på sin egen SVG-rot og viser dermed full lupe-tetthet.
  rules.push(`${root}:not(.zoom-near) [data-label="dybde-tall"][data-fine] { display: none; }`)
  // v12.0.15 — Bymasse (522) er nå flat dempet flate og PÅ som default:
  // dempes ekstra ved utzoom så den ligger som kontekst, og trer tydeligere
  // frem når man zoomer inn (.zoomed-in = scale >= 1.3).
  rules.push(`${root}:not(.zoomed-in) [data-layer="bymasse"] { opacity: 0.55; }`)
  // v12.0.15 — Veinummer-skilt: fylkesvei-bokser holdes igjen til .zoomed-in;
  // E-vei-skilt (data-rank="e") vises alltid.
  rules.push(`${root}:not(.zoomed-in) [data-label="veinummer"][data-rank="fylke"] { display: none; }`)
  // Art-mode opacity for fyll-områder (skog/vann/aker/bygning osv).
  // Stroke-only features beholder full skarphet (fill-opacity påvirker ikke strokes).
  // CSS-var settes av MapView ved tema-bytte; default = 1 (vanlig modus).
  rules.push(`${root} [data-iso] { fill-opacity: var(--art-fill-opacity, 1); }`)

  for (const cat of ['land', 'terrain', 'water', 'rock', 'contour', 'manmade']) {
    for (const [code, def] of Object.entries(catalog.categories[cat])) {
      if (!codeUsed(code)) continue
      const sel = `${root} [data-iso="${code}"]`
      const props = []
      if (def.fill) {
        if (def.fill.type === 'pattern' && def.fill.pattern) {
          // v8.9.24: pattern-fills får også CSS-var-fallback så tema-
          // overstyringer (mørk, sepia, indigo, mocha, forest) faktisk
          // bytter åker-fyllet, ikke bare solid-fyll-koder. Settes ved
          // applyTheme() i MapView; default (lys/ISOM) bruker pattern.
          props.push(`fill: var(--iso-${code}-fill, url(#${patternIds.get(def.fill.pattern)}))`)
          // v10.2.9 — Perf: pattern-tiles re-rastreres per frame under
          // pinch-zoom (dyrest av alle fyll på mobil-GPU). Under aktiv gest
          // (.is-zooming) byttes mønsteret til flat farge: mønsterets
          // background-farge der den finnes (kratt/halv-åpen/hugst/522/
          // strand), ellers none (rene strek-mønstre som myr forsvinner i
          // ~200 ms — samme kontrakt som dasharray-/relieff-undertrykkingen).
          const flat = catalog.patterns?.[def.fill.pattern]?.background ?? 'none'
          rules.push(`${root}.is-zooming [data-iso="${code}"] { fill: ${flat}; }`)
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
      // Casing-stroke (v12.0.15, stier 505/506): kontinuerlig lys underlinje
      // UNDER den stiplede streken (motsatt av overlayStroke som ligger over).
      // Fargen faller tilbake på var(--bg) slik at mørke temaer automatisk
      // visker til sin egen bakgrunn — ingen tema-blokker trenger casing-farge.
      if (def.casingStroke) {
        const ca = def.casingStroke
        const caProps = ['fill: none', `stroke: var(--iso-${code}-casing-stroke, var(--bg, ${ca.color ?? '#fbf7ec'}))`]
        if (ca.widthMm) caProps.push(`stroke-width: ${sw(ca.widthMm)}`)
        if (ca.linecap) caProps.push(`stroke-linecap: ${ca.linecap}`)
        if (ca.linejoin) caProps.push(`stroke-linejoin: ${ca.linejoin}`)
        caProps.push('stroke-dasharray: none')
        rules.push(`${sel} path.casing { ${caProps.join('; ')} }`)
      }
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
  if (codeUsed('515')) {
    rules.push(`${root} [data-iso="515"] path[data-tunnel="yes"] { stroke: #555; stroke-width: ${sw(0.18)}; stroke-dasharray: 1mm 0.4mm; fill: none; opacity: 0.5 }`)
    rules.push(`${root} [data-iso="515"] path.overlay[data-tunnel="yes"] { display: none }`)
    rules.push(`${root} [data-iso="515"] line.tunnel-portal { stroke: #000; stroke-width: ${sw(0.3)}; stroke-linecap: square; fill: none }`)
  }

  // ISOM 521 — små bygg (< 70 m²) får Kartverket-style hvit fyll + tynt
  // sort omriss. Skiller hytter/uthus visuelt fra bolig- og forretnings-
  // bygg som beholder den brune default-fargen. v8.9.32: stroke ned til
  // 0.05 mm (var 0.08 mm) så det normaliserte kvadrat-symbolet ikke
  // overdøves av sin egen kant ved små zoom-nivåer.
  if (codeUsed('521')) {
    rules.push(`${root} [data-iso="521"] path[data-small="yes"] { fill: var(--iso-521-small-fill, #fff); stroke: var(--iso-521-small-stroke, #000); stroke-width: ${sw(0.05)}; }`)
  }

  // Etiketter — fill og halo er CSS-variabler så MapView kan overstyre i mørk modus.
  // Font og halo skaleres med kartstørrelse (se labelScale over) så et 10 km
  // kart leverer like lesbare labels ved max zoom som 4 km referanse-kart.
  const lab = catalog.labels
  rules.push(`${root} [data-label] { font-size: ${fs(lab.place.fontSizeMm)}; fill: var(--label-place-fill, ${lab.place.color}); paint-order: stroke; stroke: var(--label-place-halo, ${lab.place.haloColor}); stroke-width: ${haloMm(lab.place.haloWidthMm)}; stroke-linejoin: round; }`)
  rules.push(`${root} [data-label="peak"] { font-size: ${fs(lab.peak.fontSizeMm)}; fill: var(--label-peak-fill, ${lab.peak.color}); font-weight: ${lab.peak.weight}; stroke: var(--label-peak-halo, ${lab.peak.haloColor}); stroke-width: ${haloMm(lab.peak.haloWidthMm)}; paint-order: stroke; stroke-linejoin: round; }`)
  if (lab['peak-ele']) {
    const pe = lab['peak-ele']
    const styleProps = [
      `font-size: ${fs(pe.fontSizeMm)}`,
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
  rules.push(`${root} [data-label="kontur-tall"] { font-size: ${fs(lab['kontur-tall'].fontSizeMm)}; fill: var(--label-kontur-tall-fill, ${lab['kontur-tall'].color}); font-style: italic; }`)
  if (lab['vann-navn']) {
    const vn = lab['vann-navn']
    const styleProps = [
      `font-size: ${fs(vn.fontSizeMm)}`,
      `fill: var(--label-vann-navn-fill, ${vn.color})`,
      // Vann-navn bruker --water-font (kursiv serif) — brukervalgt par under
      // Innstillinger. Fallback Inter for eldre kart uten var-en.
      `font-family: var(--water-font, 'Inter Variable'), Georgia, serif`,
      vn.italic ? 'font-style: italic' : null,
      vn.weight ? `font-weight: ${vn.weight}` : null,
      `stroke: var(--label-vann-navn-halo, ${vn.haloColor})`,
      `stroke-width: ${haloMm(vn.haloWidthMm)}`,
      'paint-order: stroke',
      'stroke-linejoin: round',
    ].filter(Boolean).join('; ')
    rules.push(`${root} [data-label="vann-navn"] { ${styleProps} }`)
    // Bekk/elv (rotert langs vannløpet, data-layer="bekk") får lettere vekt enn
    // innsjø-navn — bekreftet skille i CD-handoffen (bekk 400, innsjø 500).
    rules.push(`${root} [data-layer="bekk"] [data-label="vann-navn"] { font-weight: 400; }`)
  }
  if (lab['vann-tall']) {
    rules.push(`${root} [data-label="vann-tall"] { font-size: ${fs(lab['vann-tall'].fontSizeMm)}; fill: var(--label-vann-tall-fill, ${lab['vann-tall'].color}); font-family: var(--water-font, 'Inter Variable'), Georgia, serif; font-style: italic; stroke: var(--label-vann-tall-halo, ${lab['vann-tall'].haloColor}); stroke-width: ${haloMm(lab['vann-tall'].haloWidthMm)}; }`)
  }
  // Dybde-tall (Sjøkart-soundings). Uten denne regelen falt de gjennom til den
  // generiske [data-label]-regelen = place-størrelse (4 mm), så dybde-tallene
  // ble store og dominerende i inset/Padling-laget. Egen, mindre størrelse
  // (2,6 mm, på linje med vann-tall) — soundings skal være diskret kartstoff.
  if (lab['dybde-tall']) {
    rules.push(`${root} [data-label="dybde-tall"] { font-size: ${fs(lab['dybde-tall'].fontSizeMm)}; fill: var(--label-dybde-tall-fill, ${lab['dybde-tall'].color}); stroke: var(--label-dybde-tall-halo, ${lab['dybde-tall'].haloColor}); stroke-width: ${haloMm(lab['dybde-tall'].haloWidthMm)}; paint-order: stroke; stroke-linejoin: round; }`)
  }
  // v12.0.15 — Veinummer-skilt (E-vei grønt skilt / fylkesvei hvit boks).
  // Skilt-rect-en ER haloen, så tekst-halo slås av. Trafikkskiltfarger er
  // konstante på tvers av temaer (som ekte skilt) — ingen CSS-var-hooks.
  // v12.1.40: font settes med mm() (kartstørrelse-skala), IKKE fs() — skiltet
  // er en fast-dimensjonert rect bygget ved kart-tid, så tekst-slideren
  // (--label-scale) ville sprengt teksten ut av boksen. Veinummer skal derfor
  // ikke følge «Skrift»-slideren.
  rules.push(`${root} [data-label="veinummer"] { font-size: ${mm(2.8)}; font-weight: 700; stroke: none; text-anchor: middle; }`)
  rules.push(`${root} [data-label="veinummer"][data-rank="e"] { fill: #fff; }`)
  rules.push(`${root} [data-label="veinummer"][data-rank="fylke"] { fill: #161616; }`)
  // v8.10.9: områdenavn (myr, heath, locality-polygoner osv) og hytte-navn.
  // v8.10.15: naturreservat-navn — grønn skrift + hvit halo, samme visuelle
  // hierarki som blå vann-navn over innsjø-flater.
  for (const kind of ['omrade-navn', 'hytte-navn', 'naturreservat-navn']) {
    const cfg = lab[kind]
    if (!cfg) continue
    const styleProps = [
      `font-size: ${fs(cfg.fontSizeMm)}`,
      `fill: var(--label-${kind}-fill, ${cfg.color})`,
      cfg.italic ? 'font-style: italic' : null,
      cfg.weight ? `font-weight: ${cfg.weight}` : null,
      cfg.textTransform ? `text-transform: ${cfg.textTransform}` : null,
      Number.isFinite(cfg.letterSpacingMm) ? `letter-spacing: ${mm(cfg.letterSpacingMm)}` : null,
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
  // Base: farge/halo/vekt. Skrift-STØRRELSE settes per rank (v9.1.12) — by/
  // tettsted større enn grend/gård, etter OSM place-type (placeRank i
  // mapBuilder). Default-størrelse (mangler data-rank, f.eks. eldre kart) = mid.
  // v12.0.7 (Stedsnavn-typografi): vekt senket fra 800 til medium (500 base /
  // 600 major) og farge #1a1a1a → #161616 — designets «bebyggelse · medium».
  // Arver --land-font (sans) fra roten. Tung 800-vekt drukna terrenget; medium
  // gir tydelig men ikke skrikende bebyggelse-hierarki.
  rules.push(`${root} [data-label="stedsnavn"] { font-size: ${fs(5.8)}; font-weight: 500; fill: var(--label-stedsnavn-fill, #161616); paint-order: stroke; stroke: var(--label-stedsnavn-halo, #fff); stroke-width: ${haloMm(1.2)}; stroke-linejoin: round; pointer-events: none; }`)
  rules.push(`${root} [data-label="stedsnavn"][data-rank="major"] { font-size: ${fs(7.2)}; font-weight: 600; }`)
  rules.push(`${root} [data-label="stedsnavn"][data-rank="minor"] { font-size: ${fs(4.8)}; }`)
  // LOD (v9.1.12 / v11.0.34): det tette grend-/gård-/locality-teppet (rank=minor)
  // er detalj — det dukker først opp på nærmeste trinn (.zoom-near, scale >= 2.5),
  // mens by/tettsted/landsby (major/mid) beholdes for oversikts-orientering.
  // Stor frame-rate-gevinst på navn-tette 10 km-kart uten å miste planleggings-
  // oversikten. (Alle navn forblir søkbare uansett zoom — kun visning gates her.)
  rules.push(`${root}:not(.zoom-near) [data-label="stedsnavn"][data-rank="minor"] { display: none; }`)

  // Kulturminne-overlegg (Kulturminnesøk brukerminner — IKKE ISOM). Ett felles
  // fasade-symbol (iso-sym-kulturminne, fill=currentColor) farges pr kategori via
  // `color` her. Fargene er bevisst utenfor ISOM-paletten (grønn/blå/brun-terreng)
  // så kulturminnene leser som et eget tematisk lag. Klikkbart → cursor: pointer.
  rules.push(`${root} [data-layer="kulturminne"] g[data-kat] { color: #6d4c41; cursor: pointer; }`)
  rules.push(`${root} [data-layer="kulturminne"] g[data-kat="fangst"] { color: #b8730f; }`)
  rules.push(`${root} [data-layer="kulturminne"] g[data-kat="gravminne"] { color: #7d3c98; }`)
  rules.push(`${root} [data-layer="kulturminne"] g[data-kat="stein"] { color: #5d6d7e; }`)
  rules.push(`${root} [data-layer="kulturminne"] g[data-kat="bygning"] { color: #b03a2e; }`)

  return rules.join(' ')
}

export { isomCatalogDefault as isomCatalog }

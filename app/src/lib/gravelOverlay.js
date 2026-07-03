// Grusvei-overlay for Ruteplanleggeren: Overpass-spørring + klassifisering av
// grusveier i et bbox-utsnitt.
//
// Datagrunnlag og holdninger (dokumentert stance):
//  - OSM `surface`-tags er ufullstendige på norske bygdeveier. Vi viser derfor
//    to klasser: 'surfaced' (eksplisitt grus-familie-surface) og 'assumed'
//    (highway=track UTEN surface — skogsbilveier er nesten alltid grus i Norge;
//    tracktype=grade1 ekskluderes siden grade1 = fast dekke).
//  - Umerket unclassified/tertiary tas IKKE inn i overlayen (for mange falske
//    positiver i tettbygde strøk) — den antakelsen håndteres kun i rute-
//    profilens kostheuristikk (grusprofil.brf).
//  - Overlayen er for MOTORSYKLISTER: ways der motorisert ferdsel er forbudt
//    (access/vehicle/motor_vehicle no|private|agricultural|forestry|…) vises
//    ikke, og track tagget som turvei (foot/bicycle=designated uten eksplisitt
//    motor_vehicle=yes) filtreres — «grusveien langs Drammenselva»-tilfellet.
//  - Fase 2 (NVDB Vegdekke): `classifyGravelWay` tar en valgfri `enrich`-
//    callback som konsulteres FØR OSM-heuristikken — der plugges offisiell
//    dekketype inn uten endring i overlay eller lagringsskjema.

export const MIN_OVERLAY_ZOOM = 11        // under dette: for stort areal, vis hint
export const MAX_OVERLAY_AREA_KM2 = 600

export const GRAVEL_SURFACES = ['gravel', 'compacted', 'fine_gravel', 'unpaved', 'ground', 'dirt', 'pebblestone']
const GRAVEL_SURFACE_SET = new Set(GRAVEL_SURFACES)
const OVERLAY_HIGHWAYS = new Set(['track', 'unclassified', 'tertiary', 'secondary', 'residential', 'service'])

export function buildGravelQuery(bbox, { timeoutS = 25 } = {}) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `
[out:json][timeout:${timeoutS}][bbox:${b}];
(
  way["highway"~"^(track|unclassified|tertiary|secondary|residential|service)$"]["surface"~"^(${GRAVEL_SURFACES.join('|')})$"];
  way["highway"="track"][!"surface"]["tracktype"!~"^grade1$"];
);
out geom;
`.trim()
}

// Access-verdier som betyr at allmenn motorisert ferdsel IKKE er tillatt.
// «destination» er lovlig (kjøring til eiendom) og beholdes.
const MOTOR_BLOCKED = new Set(['no', 'private', 'agricultural', 'forestry', 'delivery', 'permit', 'emergency', 'military', 'customers'])

function accessBlocked(value) {
  if (!value) return false
  // OSM tillater semikolon-lister («agricultural;forestry») — blokkert hvis
  // ALLE deler er blokkert (én lovlig verdi holder for å kjøre der).
  return String(value).split(';').every((v) => MOTOR_BLOCKED.has(v.trim()))
}

/**
 * Er motorisert ferdsel (MC) lovlig på way-en etter OSM-access-tags?
 * Mest spesifikke tag vinner (motorcycle > motor_vehicle > vehicle > access).
 */
export function isMotorAccessible(tags = {}) {
  for (const key of ['motorcycle', 'motor_vehicle', 'vehicle', 'access']) {
    const v = tags[key]
    if (v != null && v !== '') {
      if (accessBlocked(v)) return false
      return true
    }
  }
  // Gang-/sykkelvei-heuristikk (generalisert i v12.1.6, var track-only):
  // ALT dedikert gående/syklende uten eksplisitt motor-access er i praksis
  // turvei / gang- og sykkelvei — ikke lovlig for MC, uansett highway-type.
  if (tags.foot === 'designated' || tags.bicycle === 'designated') {
    return false
  }
  return true
}

/**
 * Klassifiser én way etter tags: 'surfaced' (bekreftet grus), 'assumed'
 * (antatt grus — track uten surface), eller null (ikke i overlayen).
 * `enrich(tags)` kan returnere 'surfaced' | 'paved' | null og vinner over
 * OSM-heuristikken (fase 2: NVDB dekketype). Access-filteret (motorisert
 * ferdsel) gjelder ALLTID — også når enrich sier 'surfaced'.
 */
export function classifyGravelWay(tags = {}, { enrich } = {}) {
  if (!isMotorAccessible(tags)) return null
  if (enrich) {
    const e = enrich(tags)
    if (e === 'surfaced') return 'surfaced'
    if (e === 'paved') return null
  }
  if (!OVERLAY_HIGHWAYS.has(tags.highway)) return null
  if (tags.surface) {
    return GRAVEL_SURFACE_SET.has(tags.surface) ? 'surfaced' : null
  }
  if (tags.highway === 'track') {
    return tags.tracktype === 'grade1' ? null : 'assumed'
  }
  return null
}

/**
 * Trekk grusveiene ut av et Overpass-JSON-svar (`out geom;`-format: hver way
 * har `geometry: [{lat, lon}, …]`). Returnerer polylines i [lon, lat]-par.
 */
export function extractGravelWays(overpassJson, { enrich } = {}) {
  const out = []
  for (const el of overpassJson?.elements ?? []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue
    const kind = classifyGravelWay(el.tags ?? {}, { enrich })
    if (!kind) continue
    out.push({
      id: el.id,
      kind,
      tags: el.tags ?? {},
      points: el.geometry.map((g) => [g.lon, g.lat]),
    })
  }
  return out
}

// Bbox-primitiver for én-slots hentecache (padBbox ved fetch, bboxContains
// avgjør om synlig utsnitt fortsatt dekkes av forrige henting).
export function bboxContains(outer, inner) {
  if (!outer || !inner) return false
  return outer.south <= inner.south && outer.west <= inner.west &&
         outer.north >= inner.north && outer.east >= inner.east
}

export function padBbox(bbox, factor = 1.5) {
  const halfH = (bbox.north - bbox.south) / 2
  const halfW = (bbox.east - bbox.west) / 2
  const cLat = (bbox.north + bbox.south) / 2
  const cLon = (bbox.east + bbox.west) / 2
  return {
    south: cLat - halfH * factor,
    west: cLon - halfW * factor,
    north: cLat + halfH * factor,
    east: cLon + halfW * factor,
  }
}

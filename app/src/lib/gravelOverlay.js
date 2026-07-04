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

import { isTrailheadParking } from './parkingRules.js'
import { isPointNearPolylines } from './pathUtils.js'

export const MIN_OVERLAY_ZOOM = 11        // under dette: for stort areal, vis hint
export const MAX_OVERLAY_AREA_KM2 = 600

export const GRAVEL_SURFACES = ['gravel', 'compacted', 'fine_gravel', 'unpaved', 'ground', 'dirt', 'pebblestone']
const GRAVEL_SURFACE_SET = new Set(GRAVEL_SURFACES)
const OVERLAY_HIGHWAYS = new Set(['track', 'unclassified', 'tertiary', 'secondary', 'residential', 'service'])

export function buildGravelQuery(bbox, { timeoutS = 25, includeParking = false } = {}) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  // Etter `out geom;` står way-settet fortsatt i `_` — `node(w)["barrier"]`
  // henter barrier-nodene PÅ de samme veiene (bommer, kjettinger, steiner …)
  // så stengte innkjøringer kan markeres i overlayen.
  //
  // Parkering (valgfritt, samme regler som turkartets ISOM 534): node- og
  // way-parkering hentes med `out center` (centroid holder — vi rendrer et
  // punktsymbol). Utfart-regelens (b)-krav trenger sti/skogsbilvei NÆR hver
  // P-plass; `way(around.pk:…)` henter kun de få sti-way-ene innen 100 m av
  // en parkering (klient-side måles så eksakt 50 m fra P-punktet), i stedet
  // for alle stier i hele bbox-en.
  const parking = includeParking ? `
(
  node["amenity"="parking"];
  way["amenity"="parking"];
)->.pk;
.pk out center;
way(around.pk:${PARKING_STI_FETCH_RADIUS_M})["highway"~"^(${PARKING_STI_HIGHWAYS.join('|')})$"]->.sti;
.sti out geom;` : ''
  return `
[out:json][timeout:${timeoutS}][bbox:${b}];
(
  way["highway"~"^(track|unclassified|tertiary|secondary|residential|service)$"]["surface"~"^(${GRAVEL_SURFACES.join('|')})$"];
  way["highway"="track"][!"surface"]["tracktype"!~"^grade1$"];
);
out geom;
node(w)["barrier"];
out;${parking}
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
 * Lysløype: langrennsløype MED belysning (piste:type inneholder nordic og
 * lit finnes og ikke er no). I praksis stengt for motorisert ferdsel også
 * snøfritt/sommerstid → hard sperre i både overlay og ruteprofil (v7).
 * Skiløyper UTEN lys er ofte kjørbar skogsbilvei sommerstid og forblir
 * «antatt grus».
 */
export function isLysloype(tags = {}) {
  const piste = String(tags['piste:type'] ?? '')
  if (!piste.split(';').some((v) => v.trim() === 'nordic')) return false
  const lit = String(tags.lit ?? '').toLowerCase()
  return lit !== '' && lit !== 'no'
}

/**
 * Klassifiser én way etter tags: 'surfaced' (bekreftet grus), 'assumed'
 * (antatt grus — track uten surface), eller null (ikke i overlayen).
 * `enrich(tags)` kan returnere 'surfaced' | 'paved' | null og vinner over
 * OSM-heuristikken (fase 2: NVDB dekketype). Access-filteret (motorisert
 * ferdsel) og lysløype-sperren gjelder ALLTID — også når enrich sier
 * 'surfaced'.
 */
export function classifyGravelWay(tags = {}, { enrich } = {}) {
  if (!isMotorAccessible(tags)) return null
  if (isLysloype(tags)) return null
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
  // Samme way kan dukke opp i to `out`-blokker (grus-settet OG sti-rundt-
  // parkering-settet når includeParking er på) — dedup på id.
  const seen = new Set()
  for (const el of overpassJson?.elements ?? []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue
    if (seen.has(el.id)) continue
    seen.add(el.id)
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

// ── Bommer og fysiske sperringer (v12.1.15) ─────────────────────────────────
// «Grusvei bak bom»-problemet: bommen ligger i OSM som en NODE
// (barrier=gate/lift_gate), som regel uten access-tags på selve veien.
// Norsk stance: bom på skogsbilvei = stengt for allmenn motorferdsel med
// mindre noden eksplisitt sier noe annet — motsatt default av veier.

// Fysisk umulig/ulovlig for MC uansett access-tags på noden.
const BARRIER_HARD_BLOCKED = new Set([
  'bollard', 'block', 'cycle_barrier', 'chain', 'log', 'debris', 'planter',
  'jersey_barrier', 'motorcycle_barrier', 'turnstile', 'full-height_turnstile',
  'kissing_gate', 'stile', 'horse_stile',
])
// Bom-familien: stengt med mindre eksplisitt åpen.
const BARRIER_GATE_LIKE = new Set([
  'gate', 'lift_gate', 'swing_gate', 'sliding_gate', 'wicket_gate',
  'barrier_board', 'hampshire_gate',
])
// Passerbare for MC — aldri markert.
const BARRIER_PASSABLE = new Set([
  'entrance', 'cattle_grid', 'toll_booth', 'border_control',
  'height_restrictor', 'sally_port', 'bump_gate', 'kerb',
])

/**
 * Klassifiser en barrier-NODE for MC: 'closed' | 'open' | null (irrelevant).
 * Eksplisitt access-tag på noden vinner (mest spesifikke først, som for
 * veier); ellers: fysiske sperringer og låste/umerkede bommer er stengt.
 */
export function classifyBarrierNode(tags = {}) {
  const barrier = tags.barrier
  if (!barrier || BARRIER_PASSABLE.has(barrier)) return null
  for (const key of ['motorcycle', 'motor_vehicle', 'vehicle', 'access']) {
    const v = tags[key]
    if (v != null && v !== '') return accessBlocked(v) ? 'closed' : 'open'
  }
  if (tags.locked === 'yes') return 'closed'
  if (BARRIER_HARD_BLOCKED.has(barrier)) return 'closed'
  if (BARRIER_GATE_LIKE.has(barrier)) return 'closed'
  return null
}

/**
 * Trekk barrier-noder ut av samme Overpass-svar som extractGravelWays
 * (`node(w)["barrier"]`-delen). Returnerer kun klassifiserte noder.
 */
export function extractBarrierNodes(overpassJson) {
  const out = []
  for (const el of overpassJson?.elements ?? []) {
    if (el.type !== 'node' || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue
    const kind = classifyBarrierNode(el.tags ?? {})
    if (!kind) continue
    out.push({ id: el.id, kind, lon: el.lon, lat: el.lat, tags: el.tags ?? {} })
  }
  return out
}

// ── Parkering (v12.1.16) — samme regler som turkartets ISOM 534/534u ───────
// Kilder: amenity=parking som node (punkt) og way (polygon → Overpass
// `out center`-centroid). Utfart-status krever BEGGE (identisk med
// mapBuilder):
//   (a) isTrailheadParking(tags) — offentlig access eller utfart-/tur-navn
//   (b) sti/skogsbilvei (highway=track/path/footway/bridleway/steps — samme
//       OSM-tags som klassifiseres til ISOM 504–507) innen 50 m av P-punktet
// Uttynning gjøres av kallere via thinParkering (utfart vises alltid).

// OSM highway-verdier som tilsvarer turkartets STI_CODES 504–507.
export const PARKING_STI_HIGHWAYS = ['track', 'path', 'footway', 'bridleway', 'steps']
const PARKING_STI_HIGHWAY_SET = new Set(PARKING_STI_HIGHWAYS)
export const UTFART_STI_MAXDIST_M = 50
// Overpass-around-radius: raus nok til at klient-sidens eksakte 50 m-måling
// fra way-parkeringens CENTROID alltid har sti-geometrien tilgjengelig
// (around måler fra way-geometrien, ikke centroiden).
export const PARKING_STI_FETCH_RADIUS_M = 100

/**
 * Trekk parkeringsplasser ut av et Overpass-svar bygget med
 * `buildGravelQuery(bbox, { includeParking: true })`. Returnerer
 * `{ id, lat, lon, p:{x,y} (meter, lokal ekvirektangulær), utfart }` —
 * formen thinParkering forventer, så kallere kan tynne i ekte meter.
 */
export function extractParkingSpots(overpassJson) {
  const parkings = []
  const stiLls = []
  const seenWays = new Set()
  for (const el of overpassJson?.elements ?? []) {
    const t = el.tags ?? {}
    if (t.amenity === 'parking') {
      const lat = el.type === 'node' ? el.lat : el.center?.lat
      const lon = el.type === 'node' ? el.lon : el.center?.lon
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        parkings.push({ id: `${el.type}-${el.id}`, lat, lon, tags: t })
      }
    } else if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2 &&
               PARKING_STI_HIGHWAY_SET.has(t.highway) && !seenWays.has(el.id)) {
      seenWays.add(el.id)
      stiLls.push(el.geometry)
    }
  }
  if (!parkings.length) return []
  // Lokal meter-projeksjon rundt utsnittet — god nok for 50 m-avstander.
  const lat0 = parkings[0].lat
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const toM = (lat, lon) => ({ x: lon * mPerDegLon, y: lat * mPerDegLat })
  const stiM = stiLls.map((g) => g.map((pt) => toM(pt.lat, pt.lon)))
  return parkings.map(({ id, lat, lon, tags }) => {
    const p = toM(lat, lon)
    const utfart = isTrailheadParking(tags) && isPointNearPolylines(p, stiM, UTFART_STI_MAXDIST_M)
    return { id, lat, lon, p, utfart }
  })
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

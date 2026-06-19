// tileCache.js — bounded cache for auto-genererte kart-fliser (tiles).
//
// Bakgrunn: auto-kart bygger et nytt kart-utsnitt når du drar forbi kanten.
// Tidligere slettet MapView forrige auto-kart umiddelbart (router.replace +
// deleteMap) for å unngå opphopning — men da var det umulig å «scrolle tilbake»
// til der man kom fra. Nå beholder vi de siste flisene som en mosaikk-cache, og
// kapper de FJERNESTE (fra der man er nå) når cachen vokser forbi MAX_AUTO_TILES.
//
// Kun fliser markert `isAuto: true` (satt i createMapFlow.buildEntry via
// auto-kart-flyten) regnes som cache. Brukerens egne kart fra picker/hjem-FAB
// og innebygde kart har ikke flagget → telles aldri og slettes aldri her.

import { listMaps, deleteMap } from './mapStorage.js'

// Hvor mange auto-fliser vi beholder i IndexedDB. SVG-en er ~1–5 MB per flis +
// ~160 KB pakket DEM, så 16 fliser ≈ 20–80 MB — godt innenfor IndexedDB-kvoten.
// Rendering begrenses separat (kun naboflisene tegnes), så lagrings-cap kan være
// raus uten å koste framerate.
export const MAX_AUTO_TILES = 16

// Equirektangulær tilnærming til avstand mellom to lat/lon-punkter. Distansene
// her er på km-skala (nabofliser), så vi trenger ikke ekte haversine — bare et
// monotont mål for «hvilken flis er lengst unna». lon vektes med cos(lat) så
// øst-vest ikke overvurderes på høye breddegrader.
export function tileDistance(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity
  const dLat = a.lat - b.lat
  const dLon = (a.lon - b.lon) * Math.cos((a.lat + b.lat) * Math.PI / 360)
  return Math.hypot(dLat, dLon)
}

/**
 * Ren utvelging (ingen I/O): gitt metadata for auto-fliser, et senter og en cap,
 * returnér id-ene som skal slettes — de fjerneste fra senteret først, men aldri
 * en beskyttet id (typisk den vi nettopp bygde / skal vise). Hvis alt utenom de
 * beskyttede må slettes for å nå cap, kan cap overskrides marginalt (vi sletter
 * aldri en beskyttet flis).
 *
 * @param {Array<{id:string, center?:{lat:number,lon:number}}>} autoTiles
 * @param {{lat:number,lon:number}} center
 * @param {number} max
 * @param {string[]} [protectIds]
 * @returns {string[]} ids å slette
 */
export function selectTilesToEvict(autoTiles, center, max, protectIds = []) {
  if (!Array.isArray(autoTiles) || autoTiles.length <= max) return []
  const protect = new Set(protectIds)
  const evictable = autoTiles
    .filter(t => !protect.has(t.id))
    .sort((a, b) => tileDistance(b.center, center) - tileDistance(a.center, center))
  const nEvict = autoTiles.length - max
  return evictable.slice(0, nEvict).map(t => t.id)
}

/**
 * Kapp auto-flis-cachen til MAX_AUTO_TILES (eller `max`) ved å slette de fjerneste
 * fra `center`. Fire-and-forget-vennlig; svelger slette-feil per flis.
 *
 * @returns {Promise<{total:number, evicted:number}>}
 */
export async function pruneAutoTiles({ center, max = MAX_AUTO_TILES, protectIds = [] } = {}) {
  const all = await listMaps()
  const autos = all.filter(m => m.isAuto)
  const victims = selectTilesToEvict(autos, center, max, protectIds)
  for (const id of victims) {
    try { await deleteMap(id) } catch { /* noop — best effort */ }
  }
  return { total: autos.length, evicted: victims.length }
}

/** Antall auto-fliser i cachen (for debug-readout). */
export async function countAutoTiles() {
  const all = await listMaps()
  return all.filter(m => m.isAuto).length
}

// ── Mosaikk-geometri (steg 2) ──────────────────────────────────────────────
// Fliser deler UTM-rutenett (bbox snappes til res-grid i createMapFlow), så en
// nabo-flis kan plasseres i den aktive flisas SVG-meter-rom via et rent offset.

/**
 * Offset (i meter = SVG-brukerenheter) for å plassere en nabo-flis i den aktive
 * flisas koordinatrom. SVG-y vokser nedover mens UTM-nord vokser oppover, så
 * y speiles om maxN.
 *
 * @param {{minE:number, maxN:number}} active  aktiv flis' UTM-hjørne
 * @param {{minE:number, maxN:number}} ghost    nabo-flis' UTM-hjørne
 * @returns {{dx:number, dy:number}|null}
 */
export function tileOffset(active, ghost) {
  if (!active || !ghost) return null
  if (active.minE == null || active.maxN == null || ghost.minE == null || ghost.maxN == null) return null
  return { dx: ghost.minE - active.minE, dy: active.maxN - ghost.maxN }
}

/**
 * Kan nabo-flisa `ghost` legges sømløst inntil `active` som spøkelses-mosaikk?
 * Krever (1) SAMME størrelse (widthM/heightM innen `tolM`) og (2) at den ligger
 * på SAMME flis-gitter — origo-deltaene må være ~heltalls-multipla av flis-
 * størrelsen. Uten dette tegnes ulik-bygde kart (innebygd demo, eldre brukerkart
 * med annen halfKm/aspect) som feiljusterte spøkelser som «smelter sammen» i
 * trappetrinn. Ren funksjon (enhetstestet); UTM-meter-rom.
 *
 * @param {{minE:number, minN:number, widthM:number, heightM:number}} active
 * @param {{minE:number, minN:number, widthM:number, heightM:number}} ghost
 * @param {{tolM?:number}} [opts]  toleranse i meter (default 1)
 * @returns {boolean}
 */
export function tilesAreGridCompatible(active, ghost, { tolM = 1 } = {}) {
  if (!active || !ghost) return false
  if (!(active.widthM > 0) || !(active.heightM > 0)) return false
  if (!(ghost.widthM > 0) || !(ghost.heightM > 0)) return false
  if (Math.abs(ghost.widthM - active.widthM) > tolM) return false
  if (Math.abs(ghost.heightM - active.heightM) > tolM) return false
  // Samme gitter: delta ≡ 0 (mod flis-størrelse). Håndterer negativt offset
  // (vest/sør-nabo) og wrap-around (delta like under en hel flis ≈ 0).
  const onLattice = (delta, size) => {
    const r = ((delta % size) + size) % size
    return Math.min(r, size - r) <= tolM
  }
  if (!onLattice(ghost.minE - active.minE, active.widthM)) return false
  if (!onLattice(ghost.minN - active.minN, active.heightM)) return false
  return true
}

/**
 * Andel av rektangel `a` som overlappes av `b` (0..1). Brukes for å avgjøre om
 * et nytt auto-kart (sentrert der man ser) ville duplisere en flis vi allerede
 * har — da skal auto-kart-triggeren undertrykkes (man «scroller tilbake», ikke
 * bygger nytt). Rektangler: {x, y, w, h}.
 */
export function rectOverlapFraction(a, b) {
  if (!a || !b || !(a.w > 0) || !(a.h > 0)) return 0
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return (ix * iy) / (a.w * a.h)
}

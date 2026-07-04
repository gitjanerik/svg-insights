// Delte parkerings-regler for turkartet (mapBuilder/symbolizer) og
// Ruteplanleggeren. Skilt ut i egen modul (v12.1.16) så planleggeren kan
// gjenbruke NØYAKTIG samme regelsett uten å dra inn mapBuilder-kjeden
// (polygon-clipping, DEM, sjøkart …) i sitt bundle. mapBuilder.js og
// symbolizer.js re-eksporterer herfra, så eksisterende imports/tester er
// uendret.

// Utfartsparkering vs. vanlig/privat parkering.
//
// OSM har ingen egen tag for «utfartsparkering», men trailhead-/turparkering
// skiller seg fra de mange private plassene på to lesbare måter: (1) navn,
// operator eller beskrivelse nevner utfart/tur/friluft, eller (2) tilgangen
// er eksplisitt offentlig (access=yes/permissive/public/destination). Private
// plasser tagges typisk access=private/customers/no — disse skal ALDRI
// markeres som utfart. Default (ingen access-tag) regnes konservativt som
// vanlig parkering: vi framhever bare plasser vi er trygge på er offentlige,
// siden problemet nettopp er at de fleste P-plassene er private.
const UTFART_KEYWORDS = /utfart|turparkering|friluft|badeplass|fotturist|skiløper/i
const PARKING_PUBLIC_ACCESS = new Set(['yes', 'public', 'permissive', 'destination'])
const PARKING_PRIVATE_ACCESS = new Set(['private', 'customers', 'no', 'permit', 'residents', 'agricultural', 'forestry'])
export function isTrailheadParking(tags) {
  const t = tags ?? {}
  if (t.amenity !== 'parking') return false
  const text = [t.name, t['name:no'], t['name:nb'], t.operator, t.description, t.ref]
    .filter(Boolean).join(' ')
  if (UTFART_KEYWORDS.test(text)) return true
  const access = String(t.access ?? '').toLowerCase()
  if (PARKING_PRIVATE_ACCESS.has(access)) return false
  if (PARKING_PUBLIC_ACCESS.has(access)) return true
  return false
}

// Minste avstand (meter) mellom to vanlige parkerings-symboler (ISOM 534) før
// vi anser dem som «samme P-plass» og skjuler den ene. Tett bebygde områder har
// én OSM-node/-way pr p-flekk (gateparkering, kjøpesenter, boligfelt) — uten
// uttynning blir kartet en uleselig vegg av blå P-skilt (se skjermbildet fra
// Asker/Bondi). Utfartsparkering (534u) er UNNTATT og vises alltid uansett
// nærhet — se thinParkering().
export const PARKERING_MIN_SEP_M = 50

/**
 * Tynner ut tett plasserte parkerings-symboler. Utfartsparkeringer
 * (`utfart === true`) beholdes ALLTID uansett naboer — de er det viktigste
 * utgangspunktet for marka-turer og skal aldri skjules. Vanlige P-plasser
 * beholdes greedy: en vanlig P beholdes bare hvis den ligger minst `minSepM`
 * meter fra alle allerede beholdte markører (inkludert utfartsparkeringene, som
 * legges inn først og dermed «vinner» når en vanlig P ligger tett inntil).
 *
 * Punktene er i meter-rom (project()-output eller lokal ekvirektangulær
 * projeksjon), så `minSepM` er ekte meter. O(n²) er trivielt her — antall
 * parkeringer i et kart-utsnitt er lite.
 *
 * @param {Array} items  { p:{x,y} (meter), utfart:boolean, ... }
 * @param {number} minSepM  minste avstand i meter mellom to vanlige P-symboler
 * @returns {Array} delmengde av items i opprinnelig rekkefølge
 */
export function thinParkering(items, minSepM = PARKERING_MIN_SEP_M) {
  const list = (items || []).filter(
    it => it && it.p && Number.isFinite(it.p.x) && Number.isFinite(it.p.y)
  )
  const occupied = []  // {x,y} for hver beholdt markør
  const keep = new Set()
  const tooClose = p => occupied.some(q => Math.hypot(q.x - p.x, q.y - p.y) < minSepM)
  // Utfart først: alltid med, og de opptar plass som vanlige P må holde unna.
  for (const it of list) {
    if (it.utfart) { keep.add(it); occupied.push(it.p) }
  }
  // Vanlige P greedy i opprinnelig rekkefølge.
  for (const it of list) {
    if (it.utfart || tooClose(it.p)) continue
    keep.add(it); occupied.push(it.p)
  }
  return list.filter(it => keep.has(it))
}

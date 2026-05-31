// marineTopology.js — én autoritativ kyst + topologisk normalisering.
//
// Bakgrunn: kyst-sømmer i kartet kommer ikke fra strandlinjen i seg selv,
// men fra at marine data (dybdeareal, skjær, sjømerker) stammer fra en
// ANNEN geometri enn kysten. Da får man skjær på land, dybdeareal som
// flyter inn over øyer, og sjømerker plassert i terrenget.
//
// Fiksen: velg ÉN autoritativ sjø-geometri, og klipp + valider alt annet
// marint mot den:
//
//   DepthArea ∩ Land = 0     (dybdeareal klippes til sjø)
//   Rock      ∩ Land = 0     (skjær på land droppes)
//   Marker    ∈ Water        (sjømerke/fyr beholdes kun i vann)
//   Island    ∩ Sea  = 0     (øyer er hull i sjøen, ikke maling oppå)
//
// Alle funksjoner jobber i SVG-meter-rom ([x, y], y-ned), samme rom som
// mapBuilder.project()-output og seaFromDem-polygonene. Rene funksjoner
// uten DOM/nettverk-avhengighet → fullt enhetstestbare i Node.
//
// MultiPolygon-format følger `polygon-clipping`:
//   MultiPolygon = [ Polygon, ... ]
//   Polygon      = [ outerRing, hole, hole, ... ]
//   Ring         = [ [x, y], ... ]  (første punkt gjentatt som siste)
// Outer er CCW, hull er CW i bibliotekets output-konvensjon.

import polygonClipping from 'polygon-clipping'

/** Shoelace signed area i input-koordinatrom. Positiv/negativ avhenger av
 *  vinding; bruk Math.abs for areal. */
export function ringSignedArea(ring) {
  if (!ring || ring.length < 3) return 0
  let a = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** Areal-vektet sentroid av en ring. Returnerer null for degenererte ringer. */
export function ringCentroid(ring) {
  if (!ring || ring.length < 3) return null
  let cx = 0, cy = 0, area = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    const cross = x1 * y2 - x2 * y1
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
    area += cross
  }
  area /= 2
  if (Math.abs(area) < 1e-9) return null
  return { x: cx / (6 * area), y: cy / (6 * area) }
}

/** Sørg for at en ring er lukket (siste punkt == første). Muterer ikke
 *  input; returnerer en (evt. forlenget) kopi. */
export function closeRing(ring) {
  if (!ring || ring.length === 0) return ring
  const f = ring[0], l = ring[ring.length - 1]
  if (f[0] === l[0] && f[1] === l[1]) return ring.slice()
  return [...ring, [f[0], f[1]]]
}

/** Punkt-i-ring via ray casting (odd-even). Ringen kan være åpen eller
 *  lukket. Punkter eksakt på kanten regnes som inkonsistent (ray casting-
 *  standard) — for vår bruk (sentroid-tester) er det uten praktisk
 *  betydning. */
export function pointInRing(x, y, ring) {
  if (!ring || ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/** Punkt-i-multipolygon. `mp` er på polygon-clipping-form (ring[0] = outer,
 *  resten = hull). Punkt er inne hvis det for NOEN polygon ligger i outer
 *  OG ikke i et hull. Robust mot output fra union/intersection. */
export function pointInMultiPolygon(x, y, mp) {
  if (!Array.isArray(mp)) return false
  for (const polygon of mp) {
    if (!polygon || polygon.length === 0) continue
    if (!pointInRing(x, y, polygon[0])) continue
    let inHole = false
    for (let h = 1; h < polygon.length; h++) {
      if (pointInRing(x, y, polygon[h])) { inHole = true; break }
    }
    if (!inHole) return true
  }
  return false
}

/**
 * Bygg én autoritativ sjø-MultiPolygon ved å unione et sett ytre ringer.
 * Brukes til å smelte N50 Havflate-flekker (eller DEM-sjø-ringer) til én
 * sammenhengende sjø-geometri der øyer faller ut som hull.
 *
 * @param {Array<Array<[number,number]>>} rings  ytre ringer i SVG-meter
 * @returns {Array} MultiPolygon (polygon-clipping-form). Tom array hvis
 *                  ingen gyldige ringer.
 */
export function unionRingsToSea(rings) {
  const inputs = []
  for (const ring of rings ?? []) {
    if (!ring || ring.length < 3) continue
    const closed = closeRing(ring)
    if (closed.length < 4) continue
    inputs.push([[closed]])
  }
  if (inputs.length === 0) return []
  try {
    return inputs.length === 1
      ? inputs[0]
      : polygonClipping.union(inputs[0], ...inputs.slice(1))
  } catch (e) {
    console.warn(`[marineTopology] union feilet (${e?.message ?? e})`)
    return []
  }
}

/**
 * Unione allerede-sammensatte polygoner (med hull) til sjø. Brukes for
 * DEM-sjø der hver polygon allerede har øy-hull.
 *
 * @param {Array<Array<Array<[number,number]>>>} polygons  hver = [outer, ...holes]
 * @returns {Array} MultiPolygon
 */
export function unionPolygonsToSea(polygons) {
  const inputs = []
  for (const poly of polygons ?? []) {
    if (!poly || poly.length === 0) continue
    const rings = poly
      .filter(r => r && r.length >= 3)
      .map(r => closeRing(r))
      .filter(r => r.length >= 4)
    if (rings.length === 0) continue
    inputs.push([rings])
  }
  if (inputs.length === 0) return []
  try {
    return inputs.length === 1
      ? inputs[0]
      : polygonClipping.union(inputs[0], ...inputs.slice(1))
  } catch (e) {
    console.warn(`[marineTopology] unionPolygons feilet (${e?.message ?? e})`)
    return []
  }
}

/**
 * Klipp et polygon (sett ringer) til sjø-geometrien (intersection).
 * Implementerer `DepthArea ∩ Land = 0`: dybdeareal som flyter forbi
 * kysten kappes ved strandlinjen.
 *
 * @param {Array<Array<[number,number]>>} polygonRings  [outer, ...holes]
 * @param {Array} seaMP  autoritativ sjø-MultiPolygon
 * @returns {Array} MultiPolygon (klippet). Tom hvis ingen overlapp.
 */
export function clipPolygonToSea(polygonRings, seaMP) {
  if (!seaMP || seaMP.length === 0) return []
  const rings = (polygonRings ?? [])
    .filter(r => r && r.length >= 3)
    .map(r => closeRing(r))
    .filter(r => r.length >= 4)
  if (rings.length === 0) return []
  try {
    return polygonClipping.intersection([rings], seaMP)
  } catch (e) {
    console.warn(`[marineTopology] clipPolygonToSea feilet (${e?.message ?? e})`)
    // Konservativ degradering: behold ukklippet polygon framfor å miste det
    return [rings]
  }
}

/**
 * Klassifiser om en marin punkt-feature skal beholdes gitt sjø-geometrien.
 *
 *   requireWater=true  (skjær, sjømerke, fyr, dybdetall): behold kun i sjø
 *   requireWater=false (havnestruktur, slipp): behold uansett
 *
 * @param {number} x
 * @param {number} y
 * @param {Array} seaMP
 * @param {{ requireWater?: boolean }} [opts]
 * @returns {boolean} true = behold
 */
export function pointFeatureKept(x, y, seaMP, opts = {}) {
  const { requireWater = false } = opts
  if (!requireWater) return true
  if (!seaMP || seaMP.length === 0) return true  // ingen kyst-modell → ikke filtrer
  return pointInMultiPolygon(x, y, seaMP)
}

/**
 * Render en MultiPolygon til SVG path-d. `fmt` formaterer hvert tall
 * (default: 1 desimal). Hver ring blir et eget M…Z-subpath; bruk
 * fill-rule="evenodd" så hull virker.
 */
export function multiPolygonToPathD(mp, fmt = (n) => Number(n.toFixed(1))) {
  if (!Array.isArray(mp)) return ''
  const parts = []
  for (const polygon of mp) {
    for (const ring of polygon) {
      if (!ring || ring.length < 3) continue
      let d = `M${fmt(ring[0][0])},${fmt(ring[0][1])}`
      for (let i = 1; i < ring.length; i++) d += `L${fmt(ring[i][0])},${fmt(ring[i][1])}`
      d += 'Z'
      parts.push(d)
    }
  }
  return parts.join(' ')
}

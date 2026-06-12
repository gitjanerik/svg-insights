// coastlineToSea.js — bygg sjø-polygoner fra OSM `natural=coastline`.
//
// HVORFOR: Sjøen i kartet stammer primært fra Kartverket DEM-0m og N50
// Havflate — begge norske kilder uten dekning i Sverige/Finland. På svensk
// kyst (Stockholms skjærgård, Bohuslän) finnes derfor ingen autoritativ sjø,
// og havet rendres som tørt land. OSM `natural=coastline` er derimot GLOBAL,
// svært detaljert (hver holme i skjærgården er kartlagt) og hentes CORS-trygt
// via Overpass som allerede er i pipelinen.
//
// HISTORIKK: coastline-polygonisering ble fjernet i v6.8.0 etter fire forsøk
// (wedger, land/vann-inversjon for Mjøsa). Rotårsaken til wedgene (OSM-ways er
// SEGMENTER, ikke ferdige ringer) løses her av `stitchChains`. Denne modulen
// er bevisst KONSERVATIV: den produserer heller INGEN sjø enn feil sjø
// (flommer aldri land), og er rene funksjoner i SVG-meter-rom (y-ned), fullt
// enhetstestbar i Node.
//
// OSM-KONVENSJON: en coastline-way har LAND på VENSTRE side av way-retningen
// (i geografisk y-opp-rom). Projeksjonen vår speiler y (nord opp → y ned),
// som snur hendigheten — utledet og LÅST av testen «land vest / sjø øst»:
// følg hver kjede i sin egen retning (start→slutt), gå så langs bbox-kanten i
// ØKENDE perimeter-parameter (med klokka på skjerm) til neste kjedes start.
// Det omslutter sjø-siden. Lukkede løkker = øyer (land) → trekkes fra som hull.
//
// ALGORITME:
//   1. stitchChains  — sy sammen way-segmenter til kjeder (bevarer retning).
//   2. del i lukkede løkker (øyer) vs åpne kjeder (fastlandskyst).
//   3. klipp åpne kjeder til bbox (endepunkter havner på kanten).
//   4. boundary-walk → sjø-ringer (kjede + kant-bue i økende perimeter).
//   5. sjø = union(sjø-ringer) − union(øyer)  via polygon-clipping.
//   6. sikkerhet: ingen åpne kjeder, dangling endepunkt, eller urimelig
//      areal → returnér [] (ingen sjø) heller enn å gjette.

import polygonClipping from 'polygon-clipping'
import { ringSignedArea, closeRing } from './marineTopology.js'

const DEFAULT_TOL = 0.5  // meter — endepunkt-match og kant-toleranse

const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol

/**
 * Sy sammen polyline-segmenter til lengre kjeder ved å matche slutt→start.
 * Bevarer retningen (coastline er retnings-konsistent). Uparede kjeder blir
 * stående. O(n²) — greit for typiske coastline-mengder i en kart-bbox.
 *
 * @param {Array<Array<[number,number]>>} lines
 * @param {number} [tol]
 * @returns {Array<Array<[number,number]>>}
 */
export function stitchChains(lines, tol = DEFAULT_TOL) {
  const chains = []
  for (const l of lines ?? []) {
    if (Array.isArray(l) && l.length >= 2) chains.push(l.map(p => [p[0], p[1]]))
  }
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < chains.length; i++) {
      const a = chains[i]
      if (!a) continue
      for (let j = 0; j < chains.length; j++) {
        if (i === j) continue
        const b = chains[j]
        if (!b) continue
        // a.slutt == b.start → b henges på a (retning bevart)
        if (near(a[a.length - 1], b[0], tol)) {
          for (let k = 1; k < b.length; k++) a.push(b[k])
          chains[j] = null
          merged = true
        }
      }
    }
  }
  return chains.filter(Boolean)
}

const isClosed = (chain, tol) => chain.length >= 4 && near(chain[0], chain[chain.length - 1], tol)

// ── Bbox-rektangel: perimeter-parametrisering (CW på skjerm, y-ned) ────────
// Hjørner: TL(minX,minY) t=0 → TR(maxX,minY) → BR(maxX,maxY) → BL(minX,maxY).

function makeRect(bbox) {
  const { minX, minY, maxX, maxY } = bbox
  const W = maxX - minX, H = maxY - minY
  return { minX, minY, maxX, maxY, W, H, P: 2 * (W + H) }
}

/** Punkt på rektangel-kanten → perimeter-parameter t∈[0,P), eller null hvis
 *  punktet ikke ligger på kanten (innenfor tol). */
export function perimeterParam(pt, bbox, tol = DEFAULT_TOL) {
  const { minX, minY, maxX, maxY, W, H } = makeRect(bbox)
  const [x, y] = pt
  if (Math.abs(y - minY) <= tol && x >= minX - tol && x <= maxX + tol) return clamp(x - minX, 0, W)            // topp
  if (Math.abs(x - maxX) <= tol && y >= minY - tol && y <= maxY + tol) return W + clamp(y - minY, 0, H)        // høyre
  if (Math.abs(y - maxY) <= tol && x >= minX - tol && x <= maxX + tol) return W + H + clamp(maxX - x, 0, W)    // bunn
  if (Math.abs(x - minX) <= tol && y >= minY - tol && y <= maxY + tol) return 2 * W + H + clamp(maxY - y, 0, H) // venstre
  return null
}

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v

/** Hjørne-punktene (i økende t) strengt mellom tFrom og tTo (med wrap). */
export function boundaryArcCorners(tFrom, tTo, bbox) {
  const { minX, minY, maxX, maxY, W, H, P } = makeRect(bbox)
  const corners = [
    { t: 0, p: [minX, minY] },
    { t: W, p: [maxX, minY] },
    { t: W + H, p: [maxX, maxY] },
    { t: 2 * W + H, p: [minX, maxY] },
  ]
  const out = []
  // Normaliser til en framoverlengde fra tFrom (wrap)
  let span = tTo - tFrom
  while (span <= 0) span += P
  for (const c of corners) {
    let d = c.t - tFrom
    while (d <= 0) d += P
    if (d < span - 1e-9) out.push({ d, p: c.p })
  }
  out.sort((a, b) => a.d - b.d)
  return out.map(o => o.p)
}

// ── Polyline-klipping mot bbox ──────────────────────────────────────────────

const inside = (p, bbox, tol) =>
  p[0] >= bbox.minX - tol && p[0] <= bbox.maxX + tol &&
  p[1] >= bbox.minY - tol && p[1] <= bbox.maxY + tol

/** Liang–Barsky: klipp segment a→b til bbox. Returnerer { p, q, enteredAt,
 *  exitedAt } eller null. enteredAt/exitedAt = true hvis p/q er KLIPP-punkt
 *  (dvs. a hhv. b lå utenfor). */
function clipSegment(a, b, bbox) {
  let t0 = 0, t1 = 1
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const p = [-dx, dx, -dy, dy]
  const q = [a[0] - bbox.minX, bbox.maxX - a[0], a[1] - bbox.minY, bbox.maxY - a[1]]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null }
    else {
      const r = q[i] / p[i]
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r }
      else { if (r < t0) return null; if (r < t1) t1 = r }
    }
  }
  return {
    p: [a[0] + t0 * dx, a[1] + t0 * dy],
    q: [a[0] + t1 * dx, a[1] + t1 * dy],
    enteredAt: t0 > 0,
    exitedAt: t1 < 1,
  }
}

/** Klipp en åpen kjede til bbox → liste av delkjeder, hver med endepunkter
 *  (forhåpentlig) på kanten. `dangling` = true om en delkjede ender STRENGT
 *  inni bbox (ufullstendige data) → kalleren bør avbryte for sikkerhets skyld. */
export function clipChainToBbox(pts, bbox, tol = DEFAULT_TOL) {
  const subs = []
  let cur = null
  for (let i = 1; i < pts.length; i++) {
    const seg = clipSegment(pts[i - 1], pts[i], bbox)
    if (!seg) { if (cur) { subs.push(cur); cur = null } continue }
    if (!cur) cur = [seg.p, seg.q]
    else if (near(cur[cur.length - 1], seg.p, tol)) cur.push(seg.q)
    else { subs.push(cur); cur = [seg.p, seg.q] }
    if (seg.exitedAt) { subs.push(cur); cur = null }
  }
  if (cur) subs.push(cur)
  // Filtrer degenererte, og rapporter dangling.
  let dangling = false
  const clean = []
  for (const s of subs) {
    if (s.length < 2) continue
    if (perimeterParam(s[0], bbox, tol) == null || perimeterParam(s[s.length - 1], bbox, tol) == null) {
      dangling = true
      continue
    }
    clean.push(s)
  }
  return { subs: clean, dangling }
}

// ── Hovedbygger ─────────────────────────────────────────────────────────────

/**
 * Bygg sjø-polygoner fra projiserte coastline-linjer.
 *
 * @param {Array<Array<[number,number]>>} lines  coastline-ways i SVG-meter (y-ned)
 * @param {{minX,minY,maxX,maxY}} bbox            kart-extent i samme rom
 * @param {object} [opts]
 * @param {number} [opts.tol]
 * @param {number} [opts.minSeaFrac=0.005]  forkast sjø < dette av bbox-areal
 * @param {number} [opts.maxSeaFrac=0.999]  forkast sjø > dette (≈ alt er sjø → mistenkelig)
 * @returns {Array<Array<Array<[number,number]>>>}  sjø-polygoner [outer, ...holes],
 *          samme form som buildSeaFromDem. Tom = ingen/usikker sjø.
 */
export function buildSeaFromCoastline(lines, bbox, opts = {}) {
  const tol = opts.tol ?? DEFAULT_TOL
  const minSeaFrac = opts.minSeaFrac ?? 0.005
  const maxSeaFrac = opts.maxSeaFrac ?? 0.999
  const rect = makeRect(bbox)
  if (rect.W <= 0 || rect.H <= 0) return []

  const chains = stitchChains(lines, tol)
  if (chains.length === 0) return []

  const islands = []        // lukkede løkker = land
  const openChains = []
  for (const c of chains) {
    if (isClosed(c, tol)) islands.push(c)
    else openChains.push(c)
  }

  // Klipp åpne kjeder til bbox. Dangling (ufullstendige) → avbryt trygt.
  const subChains = []
  for (const c of openChains) {
    const { subs, dangling } = clipChainToBbox(c, bbox, tol)
    if (dangling) return []   // konservativt: heller ingen sjø enn feil sjø
    for (const s of subs) subChains.push(s)
  }

  // Ingen fastlandskyst krysser bbox → kan ikke trygt avgjøre hva som er sjø
  // (en bbox full av åpent hav med bare øyer er tvetydig). Returnér ingen sjø.
  if (subChains.length === 0) return []

  // Boundary-walk → sjø-ringer.
  const annotated = subChains.map(pts => ({
    pts,
    tStart: perimeterParam(pts[0], bbox, tol),
    tEnd: perimeterParam(pts[pts.length - 1], bbox, tol),
  })).filter(s => s.tStart != null && s.tEnd != null)
  if (annotated.length === 0) return []

  const seaRings = assembleSeaRings(annotated, bbox)
  if (seaRings.length === 0) return []

  // Bygg sjø-MP og trekk fra øyene som hull.
  let seaMP
  try {
    const ringPolys = seaRings.map(r => [closeRing(r)])
    // union normaliserer alltid til MultiPolygon (også for én ring).
    seaMP = polygonClipping.union(ringPolys[0], ...ringPolys.slice(1))
    const islandPolys = islands
      .map(r => [closeRing(r)])
      .filter(poly => Math.abs(ringSignedArea(poly[0])) > 1)
    if (islandPolys.length) {
      seaMP = polygonClipping.difference(seaMP, ...islandPolys)
    }
  } catch (e) {
    console.warn(`[coastlineToSea] boolean feilet (${e?.message ?? e})`)
    return []
  }

  // Konverter polygon-clipping-MP → buildSeaFromDem-form [outer, ...holes].
  const polygons = []
  let totalArea = 0
  for (const poly of seaMP) {
    const rings = poly.filter(r => r && r.length >= 4)
    if (!rings.length) continue
    polygons.push(rings.map(r => r.map(p => [p[0], p[1]])))
    totalArea += Math.abs(ringSignedArea(rings[0]))
    for (let h = 1; h < rings.length; h++) totalArea -= Math.abs(ringSignedArea(rings[h]))
  }
  // Sikkerhetssjekk på areal — fanger inverterte/sprukne resultater.
  const bboxArea = rect.W * rect.H
  const frac = totalArea / bboxArea
  if (frac < minSeaFrac || frac > maxSeaFrac) return []

  return polygons
}

/**
 * Sett sammen sjø-ringer fra annoterte delkjeder. Regel (låst av test
 * «land vest / sjø øst»): følg hver kjede start→slutt, gå så langs bbox-kanten
 * i ØKENDE perimeter-t til neste kjedes start; gjenta til ringen lukkes.
 */
export function assembleSeaRings(annotated, bbox) {
  const { P } = makeRect(bbox)
  // Sorter kjeder etter tStart for «neste start i økende retning»-oppslag.
  const byStart = [...annotated].sort((a, b) => a.tStart - b.tStart)
  const nextFrom = (tEnd, exclude) => {
    // Første kjede med tStart > tEnd (wrap), ikke den vi nettopp brukte med
    // mindre den er eneste. Returnerer kjede-objektet.
    let best = null, bestD = Infinity
    for (const s of byStart) {
      let d = s.tStart - tEnd
      while (d <= 1e-9) d += P
      if (d < bestD) { bestD = d; best = s }
    }
    return best
  }

  const visited = new Set()
  const rings = []
  for (const start of annotated) {
    if (visited.has(start)) continue
    const ring = []
    let cur = start
    let guard = 0
    while (cur && !visited.has(cur) && guard++ < annotated.length + 2) {
      visited.add(cur)
      for (const p of cur.pts) ring.push([p[0], p[1]])
      const corners = boundaryArcCorners(cur.tEnd, nextFrom(cur.tEnd).tStart, bbox)
      for (const c of corners) ring.push([c[0], c[1]])
      cur = nextFrom(cur.tEnd)
      if (cur === start) break
    }
    if (ring.length >= 3) rings.push(ring)
  }
  return rings
}

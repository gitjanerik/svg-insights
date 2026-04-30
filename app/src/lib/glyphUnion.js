/**
 * glyphUnion.js
 *
 * Boolean union for glyph contours. The brush tool can produce overlapping
 * polygons (two strokes that cross, or new strokes on top of existing
 * vectors). A glyph is a single mathematical shape — it can't have
 * "stacked layers" — so before we save, we union everything into one clean
 * set of outer rings + holes.
 *
 * Pipeline:
 *   1. Flatten every existing M/L/C subpath into a polygon (sample cubics)
 *   2. Classify each polygon as outer (CCW, positive signed area in y-up
 *      font-units) or hole (CW); pair holes with their containing outers
 *   3. Run polygon-clipping's `union` over the existing MultiPolygon plus
 *      any new brush-stroke polygons
 *   4. Smooth each output ring back into Catmull-Rom cubic Béziers
 *
 * polygon-clipping outputs GeoJSON-style winding (CCW outer / CW hole),
 * which matches the TrueType convention opentype.js expects, so no extra
 * flip is needed.
 */

import polygonClipping from 'polygon-clipping'
import { polygonToBezier } from './bezierSmoothing.js'

// ── Existing-path → polygon rings ────────────────────────────────────────

/** Sample a cubic Bézier between p0 and p3 with control points cp1, cp2.
 *  Returns intermediate points (excludes p0; includes p3 implicitly via the
 *  last sample at t=1). */
function sampleCubic(p0, cp1, cp2, p3, samples) {
  const out = []
  for (let i = 1; i <= samples; i++) {
    const t = i / samples
    const u = 1 - t
    const x = u*u*u * p0.x + 3*u*u*t * cp1.x + 3*u*t*t * cp2.x + t*t*t * p3.x
    const y = u*u*u * p0.y + 3*u*u*t * cp1.y + 3*u*t*t * cp2.y + t*t*t * p3.y
    out.push({ x: Math.round(x), y: Math.round(y) })
  }
  return out
}

/** Convert glyph editor points (array of {type:M|L|C, x, y, cp1*, cp2*})
 *  into one polygon (Array<{x,y}>) per subpath. */
export function editorPointsToRings(points, samplesPerCurve = 12) {
  if (!points?.length) return []
  const rings = []
  let cur = null
  let prev = null
  for (const p of points) {
    if (p.type === 'M') {
      if (cur && cur.length >= 3) rings.push(cur)
      cur = [{ x: p.x, y: p.y }]
      prev = p
    } else if (p.type === 'L') {
      cur.push({ x: p.x, y: p.y })
      prev = p
    } else if (p.type === 'C') {
      const samples = sampleCubic(
        { x: prev.x, y: prev.y },
        { x: p.cp1x, y: p.cp1y },
        { x: p.cp2x, y: p.cp2y },
        { x: p.x,    y: p.y },
        samplesPerCurve,
      )
      cur.push(...samples)
      prev = p
    }
  }
  if (cur && cur.length >= 3) rings.push(cur)
  return rings
}

// ── Geometric helpers ────────────────────────────────────────────────────

function signedArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length
    a += ring[i].x * ring[j].y - ring[j].x * ring[i].y
  }
  return a / 2
}

function bboxOf(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of ring) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

function bboxContains(outer, inner) {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX
      && inner.minY >= outer.minY && inner.maxY <= outer.maxY
}

/** Classify rings as outer (CCW, positive area in y-up) vs hole (CW), and
 *  attach each hole to the smallest containing outer. Returns Polygons in
 *  polygon-clipping's [outerRing, hole, hole, ...] form (rings are arrays
 *  of [x, y] pairs, closed). */
function ringsToPolygons(rings) {
  const outers = []
  const holes = []
  for (const r of rings) {
    if (r.length < 3) continue
    const a = signedArea(r)
    const closed = closeRing(r)
    if (a >= 0) outers.push({ ring: closed, bbox: bboxOf(r), holes: [] })
    else        holes.push({ ring: closed, bbox: bboxOf(r) })
  }
  for (const h of holes) {
    // Pick the smallest outer whose bbox contains the hole. Smallest avoids
    // attaching a hole to an oversized outer when nested outers exist.
    let best = null, bestArea = Infinity
    for (const o of outers) {
      if (!bboxContains(o.bbox, h.bbox)) continue
      const area = (o.bbox.maxX - o.bbox.minX) * (o.bbox.maxY - o.bbox.minY)
      if (area < bestArea) { best = o; bestArea = area }
    }
    if (best)            best.holes.push(h.ring)
    else if (outers[0])  outers[0].holes.push(h.ring)
  }
  return outers.map(o => [o.ring, ...o.holes])
}

function closeRing(ring) {
  // polygon-clipping wants the first vertex repeated as the last one
  const arr = ring.map(p => [p.x, p.y])
  const f = arr[0], l = arr[arr.length - 1]
  if (f[0] !== l[0] || f[1] !== l[1]) arr.push([f[0], f[1]])
  return arr
}

/** Ensure ring orientation: index 0 is CCW (outer), rest are CW (holes).
 *  Reverses the {x,y}-array in place when needed. */
function orientPolygonRings(rings) {
  const out = []
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i]
    if (!r || r.length < 3) continue
    const a = signedArea(r)
    const wantOuter = i === 0
    const isOuter   = a >= 0
    const oriented  = wantOuter === isOuter ? r : r.slice().reverse()
    out.push(closeRing(oriented))
  }
  return out
}

// ── Public API ────────────────────────────────────────────────────────────

/** Take the editor's existing Bézier path plus a list of brush strokes
 *  (each as `{ polygons: Array<Array<{x,y}>>, isClosed }`) and return the
 *  unioned glyph as a fresh path-d string with cubic Béziers smoothed via
 *  `polygonToBezier`. */
export function unionAndSmoothGlyph(existingPoints, brushStrokes, samplesPerCurve = 12, tension = 1) {
  // Existing path → MultiPolygon
  const existingRings = editorPointsToRings(existingPoints, samplesPerCurve)
  const existingMP    = ringsToPolygons(existingRings)

  // Each brush stroke → one Polygon (polygons[0] is outer, polygons[1+] are
  // holes by construction). Treat each stroke as its own Polygon so the
  // calligraphic ribbon and any closed-stroke annulus stay topologically
  // correct before union runs.
  const brushMPs = brushStrokes
    .map(s => s.polygons)
    .filter(arr => arr && arr.length)
    .map(arr => [orientPolygonRings(arr)])
    .filter(mp => mp[0].length)

  const inputs = [existingMP, ...brushMPs].filter(mp => mp.length)
  if (!inputs.length) return ''

  // polygon-clipping signature is union(mp1, mp2, ...mpN). Filter out empty
  // multipolygons so we don't pass [] which the lib treats as no-area.
  let result
  try {
    result = inputs.length === 1
      ? inputs[0]
      : polygonClipping.union(inputs[0], ...inputs.slice(1))
  } catch (e) {
    // polygon-clipping throws on invalid inputs (self-intersect at vertex,
    // duplicate points, etc.). Fallback: emit raw concatenation so the user
    // doesn't lose work, even though the overlap won't be merged.
    console.warn('[glyphUnion] union failed, falling back to raw concat', e)
    return null
  }

  return multiPolygonToBezierPathD(result, tension)
}

/** Convert a polygon-clipping result back to an SVG path-d, with each ring
 *  smoothed into a Catmull-Rom cubic Bézier subpath. */
function multiPolygonToBezierPathD(multiPolygon, tension) {
  const parts = []
  for (const poly of multiPolygon) {
    for (const ring of poly) {
      // polygon-clipping repeats the first vertex as the last; drop it for
      // polygonToBezier which treats input as inherently closed.
      const pts = ring.slice(0, -1).map(([x, y]) => ({ x, y }))
      if (pts.length < 3) continue
      const beziers = polygonToBezier(pts, tension)
      if (!beziers?.length) continue
      for (const p of beziers) {
        if      (p.type === 'M') parts.push(`M${p.x} ${p.y}`)
        else if (p.type === 'C') parts.push(`C${p.cp1x} ${p.cp1y} ${p.cp2x} ${p.cp2y} ${p.x} ${p.y}`)
        else                     parts.push(`L${p.x} ${p.y}`)
      }
      parts.push('Z')
    }
  }
  return parts.join(' ')
}

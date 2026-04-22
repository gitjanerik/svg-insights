/**
 * qualityMetrics.js
 *
 * Detects the main rendering problems the user complained about:
 *   1. Path self-intersections ("bubbles", "amoebas")
 *   2. Outer/inner path crossings (e.g. C with figure-8 topology)
 *   3. Bézier handle overshoot (spikes past the contour)
 *   4. Excessive anchor count (regression indicator)
 */

/**
 * Flatten a Bézier path into a dense polyline for intersection testing.
 * Samples each cubic segment uniformly.
 */
export function flattenBezier(bezierPts, samplesPerCurve = 16) {
  const flat = []
  if (!bezierPts.length) return flat
  flat.push({ x: bezierPts[0].x, y: bezierPts[0].y })
  for (let i = 1; i < bezierPts.length; i++) {
    const p = bezierPts[i]
    const prev = bezierPts[i - 1]
    if (p.type === 'C') {
      for (let t = 1; t <= samplesPerCurve; t++) {
        const u = t / samplesPerCurve
        const x = cubic(prev.x, p.cp1x, p.cp2x, p.x, u)
        const y = cubic(prev.y, p.cp1y, p.cp2y, p.y, u)
        flat.push({ x, y })
      }
    } else {
      flat.push({ x: p.x, y: p.y })
    }
  }
  return flat
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3
}

/** Segment-segment intersection test (open segments, excludes shared endpoints). */
function segmentsIntersect(a, b, c, d) {
  // Skip if they share an endpoint
  const eq = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01
  if (eq(a, c) || eq(a, d) || eq(b, c) || eq(b, d)) return false

  const d1 = cross(sub(b, a), sub(c, a))
  const d2 = cross(sub(b, a), sub(d, a))
  const d3 = cross(sub(d, c), sub(a, c))
  const d4 = cross(sub(d, c), sub(b, c))
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  return false
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y } }
function cross(a, b) { return a.x * b.y - a.y * b.x }

/**
 * Count self-intersections in a polyline (closed loop).
 * Skip adjacent segments (always share a point).
 */
export function countSelfIntersections(poly) {
  const n = poly.length
  if (n < 4) return 0
  let count = 0
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      // Skip segment pairs that wrap around: segment n-1→0 shares pt with segment 0→1
      if (i === 0 && j === n - 2) continue
      if (segmentsIntersect(poly[i], poly[i+1], poly[j], poly[j+1])) {
        count++
      }
    }
  }
  return count
}

/**
 * Count crossings between two separate polylines (e.g., outer vs inner contour of C).
 */
export function countCrossings(polyA, polyB) {
  let count = 0
  for (let i = 0; i < polyA.length - 1; i++) {
    for (let j = 0; j < polyB.length - 1; j++) {
      if (segmentsIntersect(polyA[i], polyA[i+1], polyB[j], polyB[j+1])) {
        count++
      }
    }
  }
  return count
}

/**
 * Measure how far Bézier control points stretch beyond the chord distance.
 * Overshoot > 1.5x chord length is suspicious; > 3x is likely a spike bug.
 */
export function measureHandleOvershoot(bezierPts) {
  let maxOvershoot = 0
  let totalOvershoot = 0
  let segments = 0

  for (let i = 1; i < bezierPts.length; i++) {
    const p = bezierPts[i]
    if (p.type !== 'C') continue
    const prev = bezierPts[i - 1]

    const chordLen = Math.hypot(p.x - prev.x, p.y - prev.y) || 1

    // Distance from anchor to its handle
    const h1 = Math.hypot(p.cp1x - prev.x, p.cp1y - prev.y)
    const h2 = Math.hypot(p.cp2x - p.x, p.cp2y - p.y)

    const r1 = h1 / chordLen
    const r2 = h2 / chordLen
    const worst = Math.max(r1, r2)

    maxOvershoot = Math.max(maxOvershoot, worst)
    totalOvershoot += worst
    segments++
  }

  return {
    max: maxOvershoot,
    avg: segments ? totalOvershoot / segments : 0,
    segments,
  }
}

/**
 * Overall glyph quality summary.
 */
export function analyzeGlyph(result) {
  if (!result || !result.contours) {
    return { ok: false, error: 'no contours' }
  }
  const contourAnalysis = []
  let totalAnchors = 0
  let totalSelfIntersect = 0
  let totalCross = 0

  const flatPolys = result.contours.map(c => flattenBezier(c.bezierPts))

  for (let i = 0; i < result.contours.length; i++) {
    const c = result.contours[i]
    const flat = flatPolys[i]
    const selfInt = countSelfIntersections(flat)
    const overshoot = measureHandleOvershoot(c.bezierPts)
    contourAnalysis.push({
      anchors: c.anchorCount,
      denseLen: c.densePtCount,
      selfIntersections: selfInt,
      overshootMax: overshoot.max.toFixed(2),
      overshootAvg: overshoot.avg.toFixed(2),
    })
    totalAnchors += c.anchorCount
    totalSelfIntersect += selfInt
  }

  // Cross-contour intersections (C vs C-inner, O vs O-inner, etc)
  for (let i = 0; i < flatPolys.length; i++) {
    for (let j = i + 1; j < flatPolys.length; j++) {
      totalCross += countCrossings(flatPolys[i], flatPolys[j])
    }
  }

  // Problem scoring
  const problems = []
  if (totalSelfIntersect > 0) problems.push(`self-intersects: ${totalSelfIntersect}`)
  if (totalCross > 0) problems.push(`inter-contour crosses: ${totalCross}`)
  if (totalAnchors > 40) problems.push(`anchor explosion: ${totalAnchors}`)
  const maxOver = Math.max(...contourAnalysis.map(c => parseFloat(c.overshootMax)))
  if (maxOver > 2.0) problems.push(`handle overshoot: ${maxOver.toFixed(2)}x`)

  return {
    ok: problems.length === 0,
    problems,
    totalAnchors,
    totalSelfIntersect,
    totalCross,
    maxOvershoot: maxOver,
    contourCount: result.contours.length,
    contours: contourAnalysis,
  }
}

/**
 * brushStroke.js
 *
 * Convert a free-hand brush stroke (a polyline of pointer-sampled points)
 * into one or more closed offset polygons that can be smoothed into a glyph
 * contour. The brush is an ellipse rotated by `angleDeg` and squashed by
 * `roundness` so that moving along the major axis produces a thin stroke
 * and moving across produces a thick one — classic calligraphy.
 *
 * Two modes, picked from the centerline shape:
 *
 *   - OPEN  (start and end are far apart): one "ribbon" polygon — the left
 *           offset polyline followed by the reversed right offset polyline,
 *           with two extra cap samples at each end so the ribbon ends in
 *           an ellipse-shaped cap rather than a square.
 *   - CLOSED (start and end are within ~1.5× thickness of each other): two
 *           rings — outer (left offset, full loop) and inner (right offset,
 *           full loop, reversed for opposite winding). Together with
 *           fill-rule="evenodd" they render an annulus, which is what the
 *           user expects when they draw an O-shape.
 *
 * Centerline points are first run through Douglas-Peucker so the output
 * carries far fewer anchors than the raw pointer samples (often 4–6× fewer),
 * and the polygons can then be smoothed with `polygonToBezier` to produce
 * cubic Béziers instead of dense polyline segments.
 */

/**
 * @param {Array<{x:number,y:number}>} points  raw pointer-sampled centerline (≥ 2)
 * @param {number} thickness                    major-axis diameter in font-units
 * @param {number} roundness                    0.05–1.0 (1.0 = round, lower = calligraphy)
 * @param {number} [angleDeg=35]                rotation of the brush major axis
 * @returns {{ polygons: Array<Array<{x:number,y:number}>>, isClosed: boolean }}
 */
export function strokeToPolygons(points, thickness, roundness, angleDeg = 35) {
  if (!points || points.length < 2) return { polygons: [], isClosed: false }

  const epsilon = Math.max(3, thickness * 0.15)
  const simplified = simplifyPath(points, epsilon)
  if (simplified.length < 2) return { polygons: [], isClosed: false }

  const a = thickness / 2
  const b = (thickness / 2) * Math.max(0.05, Math.min(1, roundness))
  const ang = (angleDeg * Math.PI) / 180
  const ux  = Math.cos(ang),  uy  = Math.sin(ang)
  const vx  = -Math.sin(ang), vy  = Math.cos(ang)

  const start = simplified[0]
  const end   = simplified[simplified.length - 1]
  const closeDist = thickness * 1.5
  const isClosed = simplified.length >= 4
                && Math.hypot(end.x - start.x, end.y - start.y) <= closeDist

  if (isClosed) {
    // Drop the user's closing-back-to-start point so the centerline is a
    // proper unique-point ring, then offset twice — once outward (left
    // normal) and once inward (right normal) — to get the two boundaries
    // of an annulus.
    const ring = simplified.slice(0, -1)
    const outer = ringOffset(ring, a, b, ux, uy, vx, vy, +1)
    const inner = ringOffset(ring, a, b, ux, uy, vx, vy, -1).reverse()
    return { polygons: [outer, inner], isClosed: true }
  }

  return { polygons: [openRibbon(simplified, a, b, ux, uy, vx, vy)], isClosed: false }
}

/** Ribbon polygon for an open stroke: left side + capped end + reversed right side + capped start. */
function openRibbon(points, a, b, ux, uy, vx, vy) {
  const n = points.length
  const left = [], right = []
  for (let i = 0; i < n; i++) {
    const p = points[i]
    let tx, ty
    if      (i === 0)         { tx = points[1].x   - p.x;        ty = points[1].y   - p.y }
    else if (i === n - 1)     { tx = p.x - points[i - 1].x;      ty = p.y - points[i - 1].y }
    else                      { tx = points[i + 1].x - points[i - 1].x
                                ty = points[i + 1].y - points[i - 1].y }
    const tlen = Math.hypot(tx, ty) || 1
    const nx = -ty / tlen, ny = tx / tlen
    const half = ellipseExtent(nx, ny, a, b, ux, uy, vx, vy)
    left.push ({ x: p.x + nx * half, y: p.y + ny * half })
    right.push({ x: p.x - nx * half, y: p.y - ny * half })
  }
  const startCap = capPoints(points[0],     points[1],     a, b, ux, uy, vx, vy, -1)
  const endCap   = capPoints(points[n - 1], points[n - 2], a, b, ux, uy, vx, vy, +1)
  return [...left, ...endCap, ...right.reverse(), ...startCap]
}

/** Closed-loop offset: walk the ring computing each anchor's tangent from its
 *  cyclic neighbors, no caps. `side` = +1 for outer, -1 for inner. */
function ringOffset(points, a, b, ux, uy, vx, vy, side) {
  const n = points.length
  const out = []
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const tlen = Math.hypot(tx, ty) || 1
    const nx = (-ty / tlen) * side
    const ny = ( tx / tlen) * side
    const half = ellipseExtent(nx, ny, a, b, ux, uy, vx, vy)
    out.push({ x: points[i].x + nx * half, y: points[i].y + ny * half })
  }
  return out
}

function ellipseExtent(nx, ny, a, b, ux, uy, vx, vy) {
  const cosA = nx * ux + ny * uy
  const sinA = nx * vx + ny * vy
  return Math.sqrt((a * cosA) ** 2 + (b * sinA) ** 2)
}

// Build two interpolated points at ±60° around the cap so the ellipse
// outline stays smooth at line ends.
function capPoints(p, neighbor, a, b, ux, uy, vx, vy, sign) {
  const tx = sign * (p.x - neighbor.x)
  const ty = sign * (p.y - neighbor.y)
  const tlen = Math.hypot(tx, ty) || 1
  const dx = tx / tlen, dy = ty / tlen
  const out = []
  for (const angle of [Math.PI / 3, -Math.PI / 3]) {
    const rcos = Math.cos(angle), rsin = Math.sin(angle)
    const ex = dx * rcos - dy * rsin
    const ey = dx * rsin + dy * rcos
    const r  = ellipseExtent(ex, ey, a, b, ux, uy, vx, vy)
    out.push({ x: p.x + ex * r, y: p.y + ey * r })
  }
  return out
}

/**
 * Open Douglas-Peucker simplification. Returns a subset of `points` that
 * still represents the curve to within `epsilon` perpendicular distance.
 */
export function simplifyPath(points, epsilon) {
  if (!points || points.length < 3) return points ? points.slice() : []
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let maxD = 0, maxI = -1
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(points[i], points[a], points[b])
      if (d > maxD) { maxD = d; maxI = i }
    }
    if (maxD > epsilon && maxI !== -1) {
      keep[maxI] = 1
      stack.push([a, maxI], [maxI, b])
    }
  }
  const out = []
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i])
  return out
}

function perpDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
}

/** Convert an array of polygons to a path-d using straight-line segments
 *  (used for live preview while drawing — fast). */
export function polygonsToPathD(polygons) {
  const parts = []
  for (const poly of polygons) {
    if (poly.length < 3) continue
    parts.push(`M${Math.round(poly[0].x)} ${Math.round(poly[0].y)}`)
    for (let i = 1; i < poly.length; i++) {
      parts.push(`L${Math.round(poly[i].x)} ${Math.round(poly[i].y)}`)
    }
    parts.push('Z')
  }
  return parts.join(' ')
}

/** Smooth each polygon with Catmull-Rom-style cubic Béziers and emit a
 *  glyph-style path-d (used at commit time so the saved glyph carries
 *  smooth curves rather than dense polylines). */
export function polygonsToBezierPathD(polygons, polygonToBezier, tension = 1) {
  const parts = []
  for (const poly of polygons) {
    if (poly.length < 3) continue
    const beziers = polygonToBezier(poly, tension)
    if (!beziers?.length) continue
    for (const p of beziers) {
      if (p.type === 'M')      parts.push(`M${p.x} ${p.y}`)
      else if (p.type === 'C') parts.push(`C${p.cp1x} ${p.cp1y} ${p.cp2x} ${p.cp2y} ${p.x} ${p.y}`)
      else                     parts.push(`L${p.x} ${p.y}`)
    }
    parts.push('Z')
  }
  return parts.join(' ')
}

// Path-forenkling og glatting. Brukes for konturer, OSM-stier og
// hvor som helst vi trenger zoom-aware generalisering.
//
// - simplifyDP(points, tol)     Douglas-Peucker
// - simplifyVW(points, tol)     Visvalingam-Whyatt (areal-basert)
// - chaikin(points, iters)      Chaikin corner-cutting
// - smoothCatmullRom(points, t) Catmull-Rom interpolation
// - polylineLength(points)
// - polylineToPath(points, [close]) → SVG d-attr
//
// Alle koordinater er [x, y] i meter (SVG-units).

import simplifyJs from 'simplify-js'

/** @param {Array<[number,number]>} points */
export function simplifyDP(points, toleranceM = 1) {
  if (points.length < 3) return points
  const obj = points.map(([x, y]) => ({ x, y }))
  return simplifyJs(obj, toleranceM, true).map(p => [p.x, p.y])
}

/**
 * Visvalingam-Whyatt — areal-basert. Bedre for konturer og kyst hvor
 * vi ønsker å bevare visuell kompleksitet.
 */
export function simplifyVW(points, toleranceArea = 1) {
  if (points.length < 3) return points
  const pts = points.map(([x, y], i) => ({ x, y, i, area: Infinity }))

  // Beregn trekant-areal for hver indre punkt
  for (let i = 1; i < pts.length - 1; i++) {
    pts[i].area = triangleArea(pts[i - 1], pts[i], pts[i + 1])
  }

  // Iterativt fjern minste areal-punkt og oppdater naboer
  while (pts.length > 2) {
    let minIdx = 1
    for (let i = 2; i < pts.length - 1; i++) {
      if (pts[i].area < pts[minIdx].area) minIdx = i
    }
    if (pts[minIdx].area > toleranceArea) break
    pts.splice(minIdx, 1)
    if (minIdx > 0 && minIdx < pts.length - 1) {
      pts[minIdx].area = triangleArea(pts[minIdx - 1], pts[minIdx], pts[minIdx + 1])
    }
    if (minIdx > 1) {
      pts[minIdx - 1].area = triangleArea(pts[minIdx - 2], pts[minIdx - 1], pts[minIdx])
    }
  }
  return pts.map(p => [p.x, p.y])
}

function triangleArea(a, b, c) {
  return Math.abs((a.x - c.x) * (b.y - a.y) - (a.x - b.x) * (c.y - a.y)) / 2
}

/**
 * Chaikin corner-cutting smoothing. Hver iterasjon dobler antall
 * punkter og kutter hjørnene. 2-3 iterasjoner er typisk nok.
 */
export function chaikin(points, iterations = 2, closed = false) {
  let pts = points.slice()
  for (let it = 0; it < iterations; it++) {
    const next = []
    const n = pts.length
    if (n < 3) return pts
    if (!closed) next.push(pts[0])
    const start = closed ? 0 : 0
    const end = closed ? n : n - 1
    for (let i = start; i < end; i++) {
      const p0 = pts[i]
      const p1 = pts[(i + 1) % n]
      next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]])
      next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]])
    }
    if (!closed) next.push(pts[n - 1])
    pts = next
  }
  return pts
}

export function polylineLength(points) {
  let s = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0]
    const dy = points[i][1] - points[i - 1][1]
    s += Math.hypot(dx, dy)
  }
  return s
}

/** Konverter polyline til SVG path-d. */
export function polylineToPath(points, close = false) {
  if (!points.length) return ''
  let d = `M${fmt(points[0][0])},${fmt(points[0][1])}`
  for (let i = 1; i < points.length; i++) {
    d += `L${fmt(points[i][0])},${fmt(points[i][1])}`
  }
  if (close) d += 'Z'
  return d
}

/**
 * Generaliser en feature avhengig av zoom: forenkle og evt smoothe.
 * Returnerer transformert kopi.
 */
export function generalize(geom, zoom = 14, opts = {}) {
  const tol = opts.toleranceM ?? (zoom >= 14 ? 0.5 : zoom >= 12 ? 2 : 5)
  const smooth = opts.smooth ?? false
  const smoothIters = opts.smoothIters ?? 2

  const transformLine = (coords, closed = false) => {
    let p = simplifyDP(coords, tol)
    if (smooth && p.length >= 3) p = chaikin(p, smoothIters, closed)
    return p
  }

  if (geom.type === 'LineString') {
    return { ...geom, coordinates: transformLine(geom.coordinates) }
  }
  if (geom.type === 'Polygon') {
    return { ...geom, coordinates: geom.coordinates.map(r => transformLine(r, true)) }
  }
  return geom
}

function fmt(n) { return Number(n.toFixed(2)) }

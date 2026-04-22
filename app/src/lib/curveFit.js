/**
 * curveFit.js — reconstructed from gh-pages v4.8.6
 *
 * Fits cubic Bézier curves through anchor points, using the *original dense
 * contour* to estimate accurate tangent directions at each anchor.
 */

/**
 * Fit a closed cubic Bézier path to a set of anchor indices within a dense
 * polygon contour.
 */
export function fitBezierThrough(densePts, anchorIdxs) {
  const N = anchorIdxs.length
  if (N < 3) return []

  const TAN_WIN = Math.max(3, Math.min(8, Math.floor(densePts.length / 60)))
  const tangents = anchorIdxs.map(i => estimateTangent(densePts, i, TAN_WIN))
  const cornerness = anchorIdxs.map(i => measureCornerness(densePts, i, TAN_WIN))

  // Extrema-lock tangents
  for (let k = 0; k < N; k++) {
    const ext = extremaType(densePts, anchorIdxs[k], TAN_WIN)
    if (ext === 'y') {
      tangents[k] = { x: Math.sign(tangents[k].x) || 1, y: 0 }
    } else if (ext === 'x') {
      tangents[k] = { x: 0, y: Math.sign(tangents[k].y) || 1 }
    }
  }

  const out = [{
    x: densePts[anchorIdxs[0]].x,
    y: densePts[anchorIdxs[0]].y,
    type: 'M',
  }]

  for (let k = 0; k < N; k++) {
    const iA = anchorIdxs[k]
    const iB = anchorIdxs[(k + 1) % N]
    const A  = densePts[iA]
    const B  = densePts[iB]
    let tA = tangents[k]
    let tB = tangents[(k + 1) % N]

    const chordX = B.x - A.x
    const chordY = B.y - A.y
    const chordLen = Math.hypot(chordX, chordY) || 1

    const cornerA = cornerness[k]
    const cornerB = cornerness[(k + 1) % N]

    // Smooth blend between estimated tangent and chord direction
    const smoothstep = (t) => t * t * (3 - 2 * t)
    const blendA = smoothstep(Math.max(0, Math.min(1, (cornerA - 0.15) / 0.2)))
    const blendB = smoothstep(Math.max(0, Math.min(1, (cornerB - 0.15) / 0.2)))
    const chordUx = chordX / chordLen, chordUy = chordY / chordLen
    tA = {
      x: tA.x * (1 - blendA) + chordUx * blendA,
      y: tA.y * (1 - blendA) + chordUy * blendA,
    }
    tB = {
      x: tB.x * (1 - blendB) + chordUx * blendB,
      y: tB.y * (1 - blendB) + chordUy * blendB,
    }
    const lenA = Math.hypot(tA.x, tA.y) || 1
    const lenB = Math.hypot(tB.x, tB.y) || 1
    tA = { x: tA.x / lenA, y: tA.y / lenA }
    tB = { x: tB.x / lenB, y: tB.y / lenB }

    if (tA.x * chordX + tA.y * chordY < 0) tA = { x: -tA.x, y: -tA.y }
    if (tB.x * chordX + tB.y * chordY < 0) tB = { x: -tB.x, y: -tB.y }

    const dampA = Math.max(0.15, 1 - cornerA * 0.7)
    const dampB = Math.max(0.15, 1 - cornerB * 0.7)

    // Corner-cluster detection
    const cornerBefore = cornerness[(k - 1 + N) % N]
    const cornerAfter  = cornerness[(k + 2) % N]
    const inCluster =
      (cornerA > 0.3 && cornerB > 0.3) &&
      (cornerBefore > 0.3 || cornerAfter > 0.3)
    const clusterShrink = inCluster ? 0.5 : 1.0

    const handleA = (chordLen / 3) * dampA * clusterShrink
    const handleB = (chordLen / 3) * dampB * clusterShrink

    const cp1x = A.x + tA.x * handleA
    const cp1y = A.y + tA.y * handleA
    const cp2x = B.x - tB.x * handleB
    const cp2y = B.y - tB.y * handleB

    out.push({
      x: B.x, y: B.y,
      cp1x: Math.round(cp1x), cp1y: Math.round(cp1y),
      cp2x: Math.round(cp2x), cp2y: Math.round(cp2y),
      type: 'C',
    })
  }
  return out
}

function measureCornerness(pts, i, win) {
  const n = pts.length
  let lx = 0, ly = 0
  for (let d = 1; d <= win; d++) {
    const a = pts[(i - d - 1 + n * 2) % n]
    const b = pts[(i - d + n) % n]
    lx += b.x - a.x; ly += b.y - a.y
  }
  let rx = 0, ry = 0
  for (let d = 1; d <= win; d++) {
    const a = pts[(i + d - 1) % n]
    const b = pts[(i + d) % n]
    rx += b.x - a.x; ry += b.y - a.y
  }
  const ll = Math.hypot(lx, ly) || 1
  const rl = Math.hypot(rx, ry) || 1
  const cos = (lx * rx + ly * ry) / (ll * rl)
  return Math.max(0, Math.min(1, (0.3 - cos) / 1.3))
}

function estimateTangent(pts, i, win) {
  const n = pts.length
  let sx = 0, sy = 0
  for (let d = 1; d <= win; d++) {
    const before = pts[(i - d + n) % n]
    const after  = pts[(i + d) % n]
    sx += after.x - before.x
    sy += after.y - before.y
  }
  const len = Math.hypot(sx, sy) || 1
  return { x: sx / len, y: sy / len }
}

function extremaType(pts, i, win) {
  const n = pts.length
  const p = pts[i]
  let maxX = true, minX = true, maxY = true, minY = true
  for (let d = 1; d <= win; d++) {
    const a = pts[(i - d + n) % n]
    const b = pts[(i + d) % n]
    if (a.x >= p.x || b.x >= p.x) maxX = false
    if (a.x <= p.x || b.x <= p.x) minX = false
    if (a.y >= p.y || b.y >= p.y) maxY = false
    if (a.y <= p.y || b.y <= p.y) minY = false
  }
  if (maxY || minY) return 'y'
  if (maxX || minX) return 'x'
  return null
}

export function adaptiveSimplify(pts, targetPoints) {
  const n = pts.length
  if (n <= targetPoints) return pts.map((_, i) => i)

  const WIN1 = Math.max(3, Math.floor(n / 50))
  const WIN2 = Math.max(6, Math.floor(n / 20))
  const curvature = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    curvature[i] = localAngle(pts, i, WIN1) + 0.5 * localAngle(pts, i, WIN2)
  }

  const minSpacing = Math.max(4, Math.floor(n / (targetPoints * 1.5)))
  const scored = Array.from({ length: n }, (_, i) => ({ i, c: curvature[i] }))
    .sort((a, b) => b.c - a.c)

  const kept = new Uint8Array(n)
  let count = 0
  for (const { i } of scored) {
    if (count >= targetPoints) break
    let ok = true
    for (let d = 1; d < minSpacing; d++) {
      if (kept[(i + d) % n] || kept[(i - d + n) % n]) { ok = false; break }
    }
    if (ok) { kept[i] = 1; count++ }
  }

  if (count < Math.max(6, targetPoints / 2)) {
    const step = Math.floor(n / Math.max(8, targetPoints))
    for (let i = 0; i < n && count < targetPoints; i += step) {
      if (kept[i]) continue
      let ok = true
      for (let d = 1; d < Math.max(3, Math.floor(minSpacing / 2)); d++) {
        if (kept[(i + d) % n] || kept[(i - d + n) % n]) { ok = false; break }
      }
      if (ok) { kept[i] = 1; count++ }
    }
  }

  const result = []
  for (let i = 0; i < n; i++) if (kept[i]) result.push(i)
  return result
}

function localAngle(pts, i, win) {
  const n = pts.length
  const a = pts[(i - win + n) % n]
  const b = pts[i]
  const c = pts[(i + win) % n]
  const v1x = b.x - a.x, v1y = b.y - a.y
  const v2x = c.x - b.x, v2y = c.y - b.y
  const cross = v1x * v2y - v1y * v2x
  const dot   = v1x * v2x + v1y * v2y
  return Math.abs(Math.atan2(cross, dot))
}

export function cornerAwareSimplify(pts) {
  const n = pts.length
  if (n < 8) return pts.map((_, i) => i)

  const WIN = Math.max(4, Math.floor(n / 30))
  const CORNER_THRESH = 0.5
  const STRONG_CORNER = 1.0
  const NMS_RADIUS = Math.max(4, Math.floor(n / 40))
  const NMS_STRONG  = 3

  const angles = new Float32Array(n)
  for (let i = 0; i < n; i++) angles[i] = localAngle(pts, i, WIN)

  const corners = []
  for (let i = 0; i < n; i++) {
    if (angles[i] < CORNER_THRESH) continue
    const nmsWin = angles[i] >= STRONG_CORNER ? NMS_STRONG : NMS_RADIUS
    let isPeak = true
    for (let d = 1; d <= nmsWin; d++) {
      if (angles[(i + d) % n] > angles[i] || angles[(i - d + n) % n] > angles[i]) {
        isPeak = false; break
      }
    }
    if (isPeak) corners.push(i)
  }
  corners.sort((a, b) => a - b)

  // Smooth-curve detection: no strong corners → treat as smooth curve
  let strongCount = 0
  for (const i of corners) if (angles[i] > 1.0) strongCount++
  if (strongCount === 0) {
    return adaptiveSimplify(pts, 8)
  }

  if (corners.length > 24) {
    corners.sort((a, b) => angles[b] - angles[a])
    corners.length = 24
    corners.sort((a, b) => a - b)
  }

  const budget = Math.min(28, Math.max(8, corners.length * 2 + 2))

  const kept = new Uint8Array(n)
  for (const i of corners) kept[i] = 1
  let count = corners.length

  const arcLen = (from, to) => {
    let L = 0
    let i = from
    while (i !== to) {
      const j = (i + 1) % n
      const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y
      L += Math.hypot(dx, dy)
      i = j
    }
    return L
  }

  let totalLen = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y
    totalLen += Math.hypot(dx, dy)
  }

  const segments = corners.length === 0
    ? [[0, 0]]
    : corners.map((c, k) => [c, corners[(k + 1) % corners.length]])

  const segLengths = segments.map(([a, b]) => arcLen(a, b))
  const remainingBudget = budget - count
  if (remainingBudget > 0) {
    const totalSegLen = segLengths.reduce((s, L) => s + L, 0)
    const segBudget = segments.map((_, k) => {
      const share = segLengths[k] / totalSegLen
      if (share < 0.08) return 0
      return Math.round(remainingBudget * share)
    })
    let assigned = segBudget.reduce((s, b) => s + b, 0)
    if (assigned > remainingBudget) {
      const order = segBudget.map((b, k) => ({ k, b, L: segLengths[k] }))
        .sort((a, b) => a.L - b.L)
      let k = 0
      while (assigned > remainingBudget && k < order.length) {
        if (segBudget[order[k].k] > 0) { segBudget[order[k].k]--; assigned-- }
        else k++
      }
    } else if (assigned < remainingBudget) {
      const order = segBudget.map((b, k) => ({ k, L: segLengths[k] }))
        .sort((a, b) => b.L - a.L)
      let k = 0
      while (assigned < remainingBudget && k < order.length) {
        segBudget[order[k].k]++
        assigned++
        k = (k + 1) % order.length
      }
    }

    for (let k = 0; k < segments.length; k++) {
      const need = segBudget[k]
      if (need <= 0) continue
      const [startI, endI] = segments[k]
      const segIdxs = []
      let i = (startI + 1) % n
      while (i !== endI) {
        segIdxs.push(i)
        i = (i + 1) % n
      }
      if (segIdxs.length === 0) continue

      const scored = segIdxs.map(i => ({ i, c: angles[i] }))
        .sort((a, b) => b.c - a.c)

      const MIN_CURVE = 0.15
      const minSpacing = Math.max(4, Math.floor(segIdxs.length / (need + 1)))
      let added = 0
      for (const { i, c } of scored) {
        if (added >= need) break
        if (c < MIN_CURVE) break
        let ok = true
        for (let d = 1; d < minSpacing; d++) {
          if (kept[(i + d) % n] || kept[(i - d + n) % n]) { ok = false; break }
        }
        if (ok) { kept[i] = 1; count++; added++ }
      }
    }
  }

  if (count < 4) {
    const step = Math.floor(n / 4)
    for (let i = 0; i < n; i += step) {
      if (!kept[i]) { kept[i] = 1; count++ }
    }
  }

  const result = []
  for (let i = 0; i < n; i++) if (kept[i]) result.push(i)
  return result
}

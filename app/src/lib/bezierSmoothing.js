/**
 * bezierSmoothing.js
 *
 * Converts a closed polygon of anchor points to a smooth cubic Bézier path
 * using a Catmull-Rom-inspired tangent estimation. Used by the "Gjør myk"
 * button in the glyph editor, and as a one-shot smoothing pass on raw
 * auto-traced polygon paths before they are rendered.
 *
 * @param {Array<{x,y}>} pts  anchor points (will be treated as a closed loop)
 * @param {number} [tension=1]  0 = straight lines, 1 = default Catmull-Rom tension
 * @returns {Array}  [{x,y,type:'M'}, {x,y,cp1x,cp1y,cp2x,cp2y,type:'C'}, ...]
 */
export function polygonToBezier(pts, tension = 1) {
  if (!pts || pts.length < 3) {
    return (pts || []).map((p, i) => ({
      x: p.x, y: p.y,
      type: i === 0 ? 'M' : 'L',
    }))
  }

  const n = pts.length
  const t = tension / 6
  const cp1 = Array(n)
  const cp2 = Array(n)

  // Tangent at each anchor is derived from its two neighbors
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]
    const curr = pts[i]
    const next = pts[(i + 1) % n]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    cp1[i] = { x: curr.x + dx * t, y: curr.y + dy * t }
    cp2[i] = { x: curr.x - dx * t, y: curr.y - dy * t }
  }

  const out = [{ x: pts[0].x, y: pts[0].y, type: 'M' }]
  for (let i = 1; i <= n; i++) {
    const handleA = cp1[(i - 1) % n]
    const handleB = cp2[i % n]
    const anchor  = pts[i % n]
    out.push({
      x: anchor.x, y: anchor.y,
      cp1x: Math.round(handleA.x), cp1y: Math.round(handleA.y),
      cp2x: Math.round(handleB.x), cp2y: Math.round(handleB.y),
      type: 'C',
    })
  }
  return out
}

// Renderer en portrettmodell til SVG i Simpsons/Warhol-stil. Tar et model-
// objekt fra portraitModel.js, en palett (fra portraitPalettes.js), og
// rotasjons-vinkel rundt Y-aksen.
//
// Hodets silhuett trekkes som en glatt kurve gjennom convex hull av rotert
// hodevertices. Alle indre features projiseres direkte. Stilen er ren
// pop-art: knall fyller, tykke sorte konturer, ingen forsøk på realisme.

import { rotateModel } from './portraitModel.js'
import { defaultPalette } from './portraitPalettes.js'

export function portraitToSvg({
  model,
  rotY = 0,
  viewBoxSize = 400,
  padding = 40,
  palette = null,
} = {}) {
  if (!model) return null
  const pal = palette || defaultPalette()

  const rotated = rotateModel(model, rotY)

  // Beregn ramme for skalering
  const allVerts = collectVertices(rotated)
  const bounds = computeBounds(allVerts)
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  const scale = (viewBoxSize - 2 * padding) / Math.max(w, h, 1e-6)

  function tx(p) {
    return {
      x: padding + (p.X - bounds.minX) * scale,
      y: padding + (p.Y - bounds.minY) * scale,
    }
  }

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" class="w-full h-full">`)
  parts.push(`<rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${pal.bg}"/>`)

  // 1) Hode-silhuett: convex hull av projiserte hodevertices, glattet
  if (rotated.head?.vertices) {
    const projected = rotated.head.vertices.map(tx)
    const hull = convexHull(projected)
    if (hull.length >= 3) {
      const path = smoothClosedPath(hull)
      parts.push(`<path d="${path}" fill="${pal.skin}" stroke="${pal.outline}" stroke-width="3" stroke-linejoin="round"/>`)
    }
  }

  // 2) Hår (over hodets topp)
  if (rotated.hair?.vertices) {
    const proj = rotated.hair.vertices.map(tx)
    const hull = convexHull(proj)
    if (hull.length >= 3) {
      parts.push(`<path d="${smoothClosedPath(hull)}" fill="${pal.hair}" stroke="${pal.outline}" stroke-width="2.5" stroke-linejoin="round"/>`)
    }
  }

  // 3) Skjegg
  if (rotated.beard?.vertices) {
    const proj = rotated.beard.vertices.map(tx)
    const path = smoothClosedPath(proj)
    parts.push(`<path d="${path}" fill="${pal.beard}" stroke="${pal.outline}" stroke-width="2" stroke-linejoin="round"/>`)
  }

  // 4) Eyebrows
  if (rotated.eyebrows?.left && rotated.eyebrows?.right) {
    for (const arc of [rotated.eyebrows.left, rotated.eyebrows.right]) {
      const proj = arc.map(tx)
      const path = smoothOpenPath(proj)
      parts.push(`<path d="${path}" fill="none" stroke="${pal.outline}" stroke-width="3" stroke-linecap="round"/>`)
    }
  }

  // 5) Eyes — hvit oval + sort pupill (Simpsons-style: ingen iris, bare svart prikk)
  if (rotated.eyes?.left && rotated.eyes?.right) {
    for (const eye of [rotated.eyes.left, rotated.eyes.right]) {
      const c = tx(eye.center)
      parts.push(`<ellipse cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" rx="11" ry="7" fill="${pal.eyeWhite}" stroke="${pal.outline}" stroke-width="2.5"/>`)
      parts.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2.5" fill="${pal.pupil}"/>`)
    }
  }

  // 6) Briller (over øyne)
  if (rotated.glasses) {
    const lensR = computeLensRadius(rotated.glasses, scale)
    const ll = tx(rotated.glasses.leftLens.center)
    const rl = tx(rotated.glasses.rightLens.center)
    const bf = tx(rotated.glasses.bridge.from)
    const bt = tx(rotated.glasses.bridge.to)
    parts.push(`<circle cx="${ll.x.toFixed(1)}" cy="${ll.y.toFixed(1)}" r="${lensR}" fill="none" stroke="${pal.glasses}" stroke-width="3"/>`)
    parts.push(`<circle cx="${rl.x.toFixed(1)}" cy="${rl.y.toFixed(1)}" r="${lensR}" fill="none" stroke="${pal.glasses}" stroke-width="3"/>`)
    parts.push(`<line x1="${bf.x.toFixed(1)}" y1="${bf.y.toFixed(1)}" x2="${bt.x.toFixed(1)}" y2="${bt.y.toFixed(1)}" stroke="${pal.glasses}" stroke-width="3" stroke-linecap="round"/>`)
  }

  // 7) Nose: V-formet bane fra bridge til tip + flares
  if (rotated.nose) {
    const b = tx(rotated.nose.bridge)
    const t = tx(rotated.nose.tip)
    const lf = tx(rotated.nose.leftFlare)
    const rf = tx(rotated.nose.rightFlare)
    parts.push(`<path d="M ${b.x.toFixed(1)} ${b.y.toFixed(1)} Q ${t.x.toFixed(1)} ${t.y.toFixed(1)}, ${lf.x.toFixed(1)} ${lf.y.toFixed(1)}" fill="none" stroke="${pal.outline}" stroke-width="2.5" stroke-linecap="round"/>`)
    parts.push(`<path d="M ${t.x.toFixed(1)} ${t.y.toFixed(1)} L ${rf.x.toFixed(1)} ${rf.y.toFixed(1)}" fill="none" stroke="${pal.outline}" stroke-width="2.5" stroke-linecap="round"/>`)
  }

  // 8) Mouth: glatt bue
  if (rotated.mouth) {
    const l = tx(rotated.mouth.left)
    const u = tx(rotated.mouth.upperCenter)
    const r = tx(rotated.mouth.right)
    const d = tx(rotated.mouth.lowerCenter)
    parts.push(`<path d="M ${l.x.toFixed(1)} ${l.y.toFixed(1)} Q ${u.x.toFixed(1)} ${u.y.toFixed(1)}, ${r.x.toFixed(1)} ${r.y.toFixed(1)} Q ${d.x.toFixed(1)} ${d.y.toFixed(1)}, ${l.x.toFixed(1)} ${l.y.toFixed(1)} Z" fill="${pal.mouth}" stroke="${pal.outline}" stroke-width="2.5" stroke-linejoin="round"/>`)
  }

  parts.push('</svg>')
  return parts.join('')
}

// ----- helpers -----

function collectVertices(model) {
  const out = []
  function walk(v) {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      if ('X' in v && 'Y' in v && 'Z' in v) out.push(v)
      else for (const val of Object.values(v)) walk(val)
    }
  }
  walk(model)
  return out
}

function computeBounds(verts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const v of verts) {
    if (v.X < minX) minX = v.X
    if (v.X > maxX) maxX = v.X
    if (v.Y < minY) minY = v.Y
    if (v.Y > maxY) maxY = v.Y
  }
  if (!isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  return { minX, maxX, minY, maxY }
}

// Andrew's monotone chain convex hull. Punkter er { x, y }. Returnerer hull i CCW.
export function convexHull(points) {
  if (points.length < 3) return points.slice()
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)

  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  }

  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

function smoothClosedPath(points) {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  const pts = points
  const n = pts.length
  const startX = (pts[n - 1].x + pts[0].x) / 2
  const startY = (pts[n - 1].y + pts[0].y) / 2
  const segs = [`M ${startX.toFixed(1)} ${startY.toFixed(1)}`]
  for (let i = 0; i < n; i++) {
    const cur = pts[i]
    const next = pts[(i + 1) % n]
    const midX = (cur.x + next.x) / 2
    const midY = (cur.y + next.y) / 2
    segs.push(`Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}, ${midX.toFixed(1)} ${midY.toFixed(1)}`)
  }
  segs.push('Z')
  return segs.join(' ')
}

function smoothOpenPath(points) {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  const segs = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`]
  for (let i = 1; i < points.length - 1; i++) {
    const cur = points[i]
    const next = points[i + 1]
    const midX = (cur.x + next.x) / 2
    const midY = (cur.y + next.y) / 2
    segs.push(`Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}, ${midX.toFixed(1)} ${midY.toFixed(1)}`)
  }
  const last = points[points.length - 1]
  segs.push(`L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`)
  return segs.join(' ')
}

function computeLensRadius(glasses, scale) {
  const dx = glasses.leftLens.center.X - glasses.rightLens.center.X
  const dy = glasses.leftLens.center.Y - glasses.rightLens.center.Y
  const dist3D = Math.hypot(dx, dy)
  return Math.max(8, Math.min(20, dist3D * scale * 0.45))
}

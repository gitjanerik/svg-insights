// Renderer en triangulær mesh som SVG. Tre moduser:
//   'wireframe' — kun trekant-konturer
//   'shaded'    — fylte trekanter med Lambertian + cell-shading + silhuett
//   'both'      — fyll + tynn kant + silhuett
//
// Hver trekant har { indices: [a,b,c], region } der region bestemmer base-farge:
//   skin → palette.skin
//   eyeSocket → veldig mørk variant av skin (gir konkav-effekt)
//   nose → palette.skin (definisjon kommer fra Lambertian)
//   lips → palette.mouth (rød)
//   hair → palette.hair

import { shadeColor } from './portraitPalettes.js'

const LIGHT = (() => {
  const v = [-0.45, -0.55, 0.70]
  const m = Math.hypot(...v)
  return [v[0] / m, v[1] / m, v[2] / m]
})()

function quantizeBrightness(b, levels = 4) {
  const step = 1 / levels
  return Math.floor(b * levels) / levels + step / 2
}

export function rotateY(v, angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad)
  return { X: v.X * c - v.Z * s, Y: v.Y, Z: v.X * s + v.Z * c }
}

export function meshToSvg({
  mesh,
  hair = null,
  rotY = 0,
  viewBoxSize = 400,
  padding = 30,
  palette,
  mode = 'both',
} = {}) {
  if (!mesh) return null

  // Region → base-farge
  const regionColor = {
    skin: palette.skin,
    eyeSocket: shadeColor(palette.skin, 0.12),  // mørk skygge for konkav effekt
    eyeball: palette.eyeWhite,                  // hvit øyeeple
    pupil: palette.pupil,                       // svart pupill
    nose: palette.skin,
    lips: palette.mouth,
    hair: palette.hair,
  }

  const headVerts = mesh.vertices.map(v => rotateY(v, rotY))
  const hairVerts = hair ? hair.vertices.map(v => rotateY(v, rotY)) : []
  const allVerts = [...headVerts, ...hairVerts]
  const bounds = computeBounds(allVerts)
  const sceneW = bounds.maxX - bounds.minX
  const sceneH = bounds.maxY - bounds.minY
  const scale = (viewBoxSize - 2 * padding) / Math.max(sceneW, sceneH, 1e-6)

  function project(v) {
    return {
      x: padding + (v.X - bounds.minX) * scale,
      y: padding + (v.Y - bounds.minY) * scale,
      z: v.Z,
    }
  }
  const headProj = headVerts.map(project)
  const hairProj = hairVerts.map(project)

  function processTriangles(triangles, vertsRotated, vertsProj) {
    const out = []
    for (const tri of triangles) {
      const [iA, iB, iC] = tri.indices
      const a = vertsRotated[iA]
      const b = vertsRotated[iB]
      const c = vertsRotated[iC]
      const e1x = b.X - a.X, e1y = b.Y - a.Y, e1z = b.Z - a.Z
      const e2x = c.X - a.X, e2y = c.Y - a.Y, e2z = c.Z - a.Z
      const nx = e1y * e2z - e1z * e2y
      const ny = e1z * e2x - e1x * e2z
      const nz = e1x * e2y - e1y * e2x
      const nlen = Math.hypot(nx, ny, nz)
      if (nlen < 1e-9) continue
      const nXn = nx / nlen, nYn = ny / nlen, nZn = nz / nlen
      if (nZn < -0.05) continue

      const lit = Math.max(0, nXn * LIGHT[0] + nYn * LIGHT[1] + nZn * LIGHT[2])
      const continuous = 0.30 + 0.70 * lit
      const brightness = quantizeBrightness(continuous, 4)

      const pa = vertsProj[iA]
      const pb = vertsProj[iB]
      const pc = vertsProj[iC]
      const avgZ = (pa.z + pb.z + pc.z) / 3

      const baseColor = regionColor[tri.region] || palette.skin
      out.push({ pa, pb, pc, brightness, avgZ, baseColor, region: tri.region })
    }
    return out
  }

  const headTris = processTriangles(mesh.triangles, headVerts, headProj)
  const hairTris = hair ? processTriangles(hair.triangles, hairVerts, hairProj) : []

  // Painter's: bak-til-front. Trekanter med høyere Z er nære kameraet → tegn sist.
  // Mesh-features (eyeSocket, nose, lips) skal alltid være OVER underliggende skin
  // selv om Z-verdiene tilfeldigvis er like — bump dem litt frem ved sortering.
  const FEATURE_PRIORITY = {
    skin: 0,
    hair: 0,
    nose: 0.05,
    lips: 0.05,
    eyeSocket: 0.05,
    eyeball: 0.10,   // over socket
    pupil: 0.15,     // over eyeball
  }
  const allTris = [...headTris, ...hairTris]
  allTris.sort((a, b) => {
    const za = a.avgZ + (FEATURE_PRIORITY[a.region] || 0)
    const zb = b.avgZ + (FEATURE_PRIORITY[b.region] || 0)
    return za - zb
  })

  const showFill = mode !== 'wireframe'
  const showTriangleStrokes = mode === 'wireframe' || mode === 'both'
  const showSilhouette = mode !== 'wireframe'

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" class="w-full h-full">`)
  parts.push(`<rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${palette.bg}"/>`)

  for (const t of allTris) {
    const points = `${t.pa.x.toFixed(1)},${t.pa.y.toFixed(1)} ${t.pb.x.toFixed(1)},${t.pb.y.toFixed(1)} ${t.pc.x.toFixed(1)},${t.pc.y.toFixed(1)}`
    const fill = showFill ? shadeColor(t.baseColor, t.brightness) : 'none'
    const sw = mode === 'wireframe' ? 0.7 : 0.4
    const strokeAttr = showTriangleStrokes ? ` stroke="${palette.outline}" stroke-width="${sw}"` : ''
    parts.push(`<polygon points="${points}" fill="${fill}"${strokeAttr}/>`)
  }

  // Silhuett — tjukk svart kontur rundt hodet+hår (kun shaded-modi)
  if (showSilhouette) {
    const silhouettePoints = headProj.filter((_, i) => i < mesh.vertices.length - 2)
    const allHullPts = [...silhouettePoints, ...hairProj]
    const hull = convexHull(allHullPts)
    if (hull.length >= 3) {
      const path = closedPolygonPath(hull)
      parts.push(`<path d="${path}" fill="none" stroke="${palette.outline}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`)
    }
  }

  // Øyenbryn beholdes som 2D-overlay (vurderes flyttet til mesh senere)
  if (mode !== 'wireframe' && mesh.features?.leftBrow && mesh.features?.rightBrow) {
    function projF(v) { return project(rotateY(v, rotY)) }
    function browPath(arr) {
      const pts = arr.map(p => projF(p))
      const segs = [`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`]
      for (let i = 1; i < pts.length - 1; i++) {
        const cur = pts[i]
        const next = pts[i + 1]
        const mx = (cur.x + next.x) / 2
        const my = (cur.y + next.y) / 2
        segs.push(`Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}, ${mx.toFixed(1)} ${my.toFixed(1)}`)
      }
      const last = pts[pts.length - 1]
      segs.push(`L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`)
      return segs.join(' ')
    }
    const lbz = rotateY(mesh.features.leftBrow[2], rotY).Z
    const rbz = rotateY(mesh.features.rightBrow[2], rotY).Z
    if (lbz > -0.1) parts.push(`<path d="${browPath(mesh.features.leftBrow)}" fill="none" stroke="${palette.outline}" stroke-width="3" stroke-linecap="round"/>`)
    if (rbz > -0.1) parts.push(`<path d="${browPath(mesh.features.rightBrow)}" fill="none" stroke="${palette.outline}" stroke-width="3" stroke-linecap="round"/>`)
  }

  parts.push('</svg>')
  return parts.join('')
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

function convexHull(points) {
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

function closedPolygonPath(points) {
  if (points.length === 0) return ''
  const segs = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`]
  for (let i = 1; i < points.length; i++) {
    segs.push(`L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`)
  }
  segs.push('Z')
  return segs.join(' ')
}

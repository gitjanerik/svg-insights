// Renderer en triangulær mesh som SVG. Tre moduser:
//   'wireframe' — kun trekant-konturer, ingen fyll
//   'shaded'    — fylte trekanter med Lambertian shading, ingen kant
//   'both'      — fyll + tynn kant (klassisk lavpoly-look)
//
// Bruker painter's algorithm: trekanter sorteres bak-til-front før tegning.
// Backface culling: trekanter som peker bort fra kameraet droppes.

import { shadeColor } from './portraitPalettes.js'

// Lys-retning: oppe-venstre-foran, normalisert (kameraet ser inn i +Z)
const LIGHT = (() => {
  const v = [-0.45, -0.55, 0.70]
  const m = Math.hypot(...v)
  return [v[0] / m, v[1] / m, v[2] / m]
})()

// Cell-shading: kvantiser kontinuerlig brightness (0..1) til diskrete nivåer.
// Gir poster-art-look i stedet for jevn 3D-CG-gradient.
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
  glasses = null,
  beard = null,
  rotY = 0,
  viewBoxSize = 400,
  padding = 30,
  palette,
  mode = 'both',
} = {}) {
  if (!mesh) return null

  // Roter alle vertices rundt Y-aksen
  const headVerts = mesh.vertices.map(v => rotateY(v, rotY))
  const hairVerts = hair ? hair.vertices.map(v => rotateY(v, rotY)) : []

  // Beregn bbox av alle vertices (inkl. hår) for skalering
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

  // Bygg trekant-data: brightness, gjennomsnittsdybde, om synlig
  function processTriangles(triangles, vertsRotated, vertsProj, baseColor, isHair = false) {
    const out = []
    for (const tri of triangles) {
      const a = vertsRotated[tri[0]]
      const b = vertsRotated[tri[1]]
      const c = vertsRotated[tri[2]]
      // Normal via kryssprodukt (e1 × e2)
      const e1x = b.X - a.X, e1y = b.Y - a.Y, e1z = b.Z - a.Z
      const e2x = c.X - a.X, e2y = c.Y - a.Y, e2z = c.Z - a.Z
      const nx = e1y * e2z - e1z * e2y
      const ny = e1z * e2x - e1x * e2z
      const nz = e1x * e2y - e1y * e2x
      const nlen = Math.hypot(nx, ny, nz)
      if (nlen < 1e-9) continue
      const nXn = nx / nlen, nYn = ny / nlen, nZn = nz / nlen

      // Backface culling: kameraet ser fra -Z mot +Z, så normale med Z>0
      // peker fremover (mot oss). Behold de trekantene.
      // Med litt margin slik at trekanter på kanten ikke flimrer.
      if (nZn < -0.05) continue

      // Lambertian — flat shading
      const lit = Math.max(0, nXn * LIGHT[0] + nYn * LIGHT[1] + nZn * LIGHT[2])
      // Ambient + cell-shading (4 nivåer) gir posterized comic-look
      const continuous = 0.30 + 0.70 * lit
      const brightness = quantizeBrightness(continuous, 4)

      const pa = vertsProj[tri[0]]
      const pb = vertsProj[tri[1]]
      const pc = vertsProj[tri[2]]
      const avgZ = (pa.z + pb.z + pc.z) / 3

      out.push({ pa, pb, pc, brightness, avgZ, baseColor, isHair })
    }
    return out
  }

  const headColor = palette.skin
  const hairColor = palette.hair
  const headTris = processTriangles(mesh.triangles, headVerts, headProj, headColor)
  const hairTris = hair ? processTriangles(hair.triangles, hairVerts, hairProj, hairColor, true) : []

  // Painter's: bak-til-front. Større Z = lengre fra kameraet (siden +Z er forover
  // og kameraet er på +Z-side eller ser fra -Z, vi har +Z mot kameraet).
  // Trekanter med høy Z er nære kameraet → tegn sist (på toppen).
  // Lav Z = bak → tegn først.
  const allTris = [...headTris, ...hairTris]
  allTris.sort((a, b) => a.avgZ - b.avgZ)

  const showFill = mode !== 'wireframe'
  // Wireframe: tegn kant pr trekant. Both: tegn kant pr trekant tynnt.
  // Shaded: ingen kant pr trekant (kun silhuett).
  const showTriangleStrokes = mode === 'wireframe' || mode === 'both'
  const showSilhouette = mode !== 'wireframe' // poster-look har silhuett

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

  // Silhuett-outline: tjukk svart kant rundt convex hull av synlige hode-vertices.
  // Gir cartoon/poster-look som kompletterer cell-shadingen.
  if (showSilhouette) {
    const silhouettePoints = headProj.filter((_, i) => {
      // Filtrer ut apex-vertices og hår — vi vil ha hode-omrisset
      return i < mesh.vertices.length - 2
    })
    const hairPts = hairProj
    const allHullPts = [...silhouettePoints, ...hairPts]
    const hull = convexHull(allHullPts)
    if (hull.length >= 3) {
      const path = closedPolygonPath(hull)
      parts.push(`<path d="${path}" fill="none" stroke="${palette.outline}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`)
    }
  }

  // Features (kun hvis ikke wireframe-modus, ellers konkurrerer de visuelt med rutenettet)
  if (mode !== 'wireframe' && mesh.features) {
    const f = mesh.features
    function projF(v) { return project(rotateY(v, rotY)) }

    // Brynkam — to buer
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
    if (f.leftBrow && f.rightBrow) {
      // Bare tegn bryn som er foran (Z > 0 etter rotasjon)
      const lbz = rotateY(f.leftBrow[2], rotY).Z
      const rbz = rotateY(f.rightBrow[2], rotY).Z
      if (lbz > -0.1) parts.push(`<path d="${browPath(f.leftBrow)}" fill="none" stroke="${palette.outline}" stroke-width="2.5" stroke-linecap="round"/>`)
      if (rbz > -0.1) parts.push(`<path d="${browPath(f.rightBrow)}" fill="none" stroke="${palette.outline}" stroke-width="2.5" stroke-linecap="round"/>`)
    }

    // Øyne — store, buetypiske Simpsons-øyne (hvit oval + sort pupill)
    if (f.leftEye && f.rightEye) {
      const lez = rotateY(f.leftEye, rotY).Z
      const rez = rotateY(f.rightEye, rotY).Z
      const eyeRx = 13
      const eyeRy = 9
      if (lez > -0.1) {
        const p = projF(f.leftEye)
        parts.push(`<ellipse cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" rx="${eyeRx}" ry="${eyeRy}" fill="${palette.eyeWhite}" stroke="${palette.outline}" stroke-width="2.5"/>`)
        parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${palette.pupil}"/>`)
      }
      if (rez > -0.1) {
        const p = projF(f.rightEye)
        parts.push(`<ellipse cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" rx="${eyeRx}" ry="${eyeRy}" fill="${palette.eyeWhite}" stroke="${palette.outline}" stroke-width="2.5"/>`)
        parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${palette.pupil}"/>`)
      }
    }

    // Munn — bredere Simpsons-stilisert smil (fylt med palette.mouth)
    if (f.mouthLeft && f.mouthRight && f.mouthCenter) {
      const cz = rotateY(f.mouthCenter, rotY).Z
      if (cz > -0.1) {
        const l = projF(f.mouthLeft)
        const c = projF(f.mouthCenter)
        const r = projF(f.mouthRight)
        // Munn som bue — øvre linje rett, nedre linje krummer ned
        const path = `M ${l.x.toFixed(1)} ${l.y.toFixed(1)} L ${r.x.toFixed(1)} ${r.y.toFixed(1)} Q ${c.x.toFixed(1)} ${(c.y + 8).toFixed(1)}, ${l.x.toFixed(1)} ${l.y.toFixed(1)} Z`
        parts.push(`<path d="${path}" fill="${palette.mouth}" stroke="${palette.outline}" stroke-width="2.5" stroke-linejoin="round"/>`)
      }
    }

    // Briller — to ringer ved øyne hvis detektert
    if (glasses && f.leftEye && f.rightEye) {
      const lez = rotateY(f.leftEye, rotY).Z
      const rez = rotateY(f.rightEye, rotY).Z
      const lp = projF(f.leftEye)
      const rp = projF(f.rightEye)
      const lensR = Math.max(10, Math.min(18, Math.hypot(rp.x - lp.x, rp.y - lp.y) * 0.42))
      if (lez > -0.1) {
        parts.push(`<circle cx="${lp.x.toFixed(1)}" cy="${lp.y.toFixed(1)}" r="${lensR.toFixed(1)}" fill="none" stroke="${palette.glasses}" stroke-width="2.5"/>`)
      }
      if (rez > -0.1) {
        parts.push(`<circle cx="${rp.x.toFixed(1)}" cy="${rp.y.toFixed(1)}" r="${lensR.toFixed(1)}" fill="none" stroke="${palette.glasses}" stroke-width="2.5"/>`)
      }
      // Bro
      if (lez > -0.1 && rez > -0.1) {
        parts.push(`<line x1="${(lp.x + lensR).toFixed(1)}" y1="${lp.y.toFixed(1)}" x2="${(rp.x - lensR).toFixed(1)}" y2="${rp.y.toFixed(1)}" stroke="${palette.glasses}" stroke-width="2.5" stroke-linecap="round"/>`)
      }
    }
  }

  // Skjegg som halvgjennomsiktig overlay på nedre ansikt
  if (beard?.hasBeard && mesh.features && mode !== 'wireframe') {
    const f = mesh.features
    const ml = project(rotateY(f.mouthLeft, rotY))
    const mr = project(rotateY(f.mouthRight, rotY))
    const cz = rotateY(f.mouthCenter, rotY).Z
    if (cz > -0.1) {
      // Enkel skjegg-form: trapes fra munnvikene til hake
      const chinY = ml.y + 35
      const chinW = (mr.x - ml.x) * 0.65
      const cx = (ml.x + mr.x) / 2
      const path = `M ${ml.x.toFixed(1)} ${ml.y.toFixed(1)} L ${(cx - chinW / 2).toFixed(1)} ${chinY.toFixed(1)} Q ${cx.toFixed(1)} ${(chinY + 5).toFixed(1)}, ${(cx + chinW / 2).toFixed(1)} ${chinY.toFixed(1)} L ${mr.x.toFixed(1)} ${mr.y.toFixed(1)} Z`
      parts.push(`<path d="${path}" fill="${palette.beard}" fill-opacity="0.85" stroke="${palette.outline}" stroke-width="1.5"/>`)
    }
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

// Andrew's monotone chain — convex hull i CCW
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

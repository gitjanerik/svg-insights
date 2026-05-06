// Genererer en selvstendig SVG-string fra 3D-trådrammen.
// Konvensjon: kun viewBox (ingen width/height) — samme som imageToSvg.
// Ortografisk projeksjon fra ønsket Y-rotasjon.

export function wireframeToSvg({
  points,
  edges,
  rotY = 0,
  viewBoxSize = 400,
  padding = 30,
  pointColor = '#10b981',
  edgeColor = '#34d399',
  background = null,        // null = transparent
  includePoints = true,
  animateRotation = false,
  scaleCalibration = null,  // { factorMeters: number } eller null
} = {}) {
  if (!points.length) return null

  const c = Math.cos(rotY)
  const s = Math.sin(rotY)

  // Senter scenen og finn skala for å fylle viewBox
  const center = computeCenter(points)
  const projected = points.map(p => projectPoint(p, center, c, s))

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const pp of projected) {
    if (pp.x < minX) minX = pp.x
    if (pp.x > maxX) maxX = pp.x
    if (pp.y < minY) minY = pp.y
    if (pp.y > maxY) maxY = pp.y
  }
  const w = maxX - minX || 1
  const h = maxY - minY || 1
  const scale = (viewBoxSize - 2 * padding) / Math.max(w, h)

  function tx(p) {
    return {
      x: padding + (p.x - minX) * scale,
      y: padding + (p.y - minY) * scale,
      depth: p.depth,
    }
  }

  const screen = projected.map(tx)

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" class="w-full h-full">`)

  if (background) {
    parts.push(`<rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${background}"/>`)
  }

  // Kanter
  if (edges?.length) {
    const edgeStrs = edges.map(e => {
      const a = screen[e.a]
      const b = screen[e.b]
      const avgDepth = (a.depth + b.depth) / 2
      const op = (0.4 + Math.max(0, 0.5 + avgDepth * 0.5) * 0.5).toFixed(2)
      return `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${edgeColor}" stroke-width="0.6" opacity="${op}"/>`
    })
    parts.push(`<g id="edges">${edgeStrs.join('')}</g>`)
  }

  // Punkter
  if (includePoints) {
    const pointStrs = screen.map(p => {
      const op = (0.5 + Math.max(0, 0.5 + p.depth * 0.5) * 0.5).toFixed(2)
      const r = (1 + Math.max(0, 0.5 + p.depth * 0.5)).toFixed(2)
      return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${r}" fill="${pointColor}" opacity="${op}"/>`
    })
    parts.push(`<g id="points">${pointStrs.join('')}</g>`)
  }

  // Skala-tekst i nedre venstre hjørne
  if (scaleCalibration) {
    parts.push(
      `<text x="${padding}" y="${viewBoxSize - 10}" font-family="ui-monospace, monospace" font-size="10" fill="rgba(255,255,255,0.5)">` +
      `Skala: 1 enhet ≈ ${scaleCalibration.factorMeters.toFixed(2)} m</text>`
    )
  }

  // Animert rotasjon (statisk SVG som likevel roterer i nettleseren)
  if (animateRotation) {
    parts.push(
      `<animateTransform attributeName="transform" type="rotate" ` +
      `from="0 ${viewBoxSize / 2} ${viewBoxSize / 2}" ` +
      `to="360 ${viewBoxSize / 2} ${viewBoxSize / 2}" ` +
      `dur="20s" repeatCount="indefinite"/>`
    )
  }

  parts.push('</svg>')
  return parts.join('')
}

function computeCenter(points) {
  let cx = 0, cy = 0, cz = 0
  for (const p of points) {
    cx += p.X
    cy += p.Y
    cz += p.Z
  }
  const n = points.length
  return { X: cx / n, Y: cy / n, Z: cz / n }
}

function projectPoint(p, center, cosY, sinY) {
  const dx = p.X - center.X
  const dy = p.Y - center.Y
  const dz = p.Z - center.Z
  const xr = dx * cosY - dz * sinY
  const zr = dx * sinY + dz * cosY
  return { x: xr, y: dy, depth: zr }
}

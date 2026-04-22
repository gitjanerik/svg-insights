/**
 * canvasGlyphRenderer.js
 *
 * Renders a character using the browser's font engine (with any user-loaded
 * web font as fontFamily) on an HTML canvas, then traces the outline to SVG
 * path data. Automatically fits smooth cubic Béziers through the traced
 * polygon using curvature-adaptive anchor selection.
 */

import { adaptiveSimplify, fitBezierThrough, cornerAwareSimplify } from './curveFit.js'

const CANVAS_SIZE = 512
const FONT_SIZE   = 400
const BIN_THRESHOLD = 170

// Reuse a single offscreen canvas across all glyph renders. Creating 97
// separate 512×512 canvases would eat ~97 MB of RAM on mobile and crash
// the tab.
let _sharedCanvas = null
function getCanvas() {
  if (!_sharedCanvas) {
    _sharedCanvas = document.createElement('canvas')
    _sharedCanvas.width  = CANVAS_SIZE
    _sharedCanvas.height = CANVAS_SIZE
  }
  return _sharedCanvas
}

/**
 * @param {string} char
 * @param {object} metrics        { unitsPerEm, ascender, descender, xHeight, capHeight }
 * @param {string} [fontFamily]   CSS font-family name (already loaded)
 * @param {object} [settings]     { skewDeg, tracking }
 * @returns {{pathD, advanceWidth}|null}
 */
export function generateGlyphFromSystemFont(char, metrics, fontFamily = 'sans-serif', settings = {}) {
  const canvas = getCanvas()
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  ctx.fillStyle = '#000000'
  ctx.font = `${FONT_SIZE}px "${fontFamily}", sans-serif`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign    = 'left'

  const m = ctx.measureText(char)
  const ascent  = m.actualBoundingBoxAscent  || FONT_SIZE * 0.7
  const descent = m.actualBoundingBoxDescent || FONT_SIZE * 0.15
  const left    = m.actualBoundingBoxLeft    || 0
  const right   = m.actualBoundingBoxRight   || m.width

  const glyphW = right + left
  const glyphH = ascent + descent
  if (glyphW < 2 || glyphH < 2) return null

  const padding = 30
  const scale = Math.min(
    (CANVAS_SIZE - padding * 2) / glyphW,
    (CANVAS_SIZE - padding * 2) / glyphH
  )
  const drawX = padding + left * scale
  const drawY = padding + ascent * scale

  ctx.save()
  ctx.translate(drawX, drawY)
  ctx.scale(scale, scale)
  ctx.fillText(char, -left, 0)
  ctx.restore()

  const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  const binary    = binarize(imageData.data, CANVAS_SIZE, CANVAS_SIZE, BIN_THRESHOLD)
  const contours  = traceAllContours(binary, CANVAS_SIZE, CANVAS_SIZE)
  if (!contours.length) return null

  const upm     = metrics.unitsPerEm || 1000
  const asc     = metrics.ascender   ||  800
  const fScale  = asc / (CANVAS_SIZE * 0.7)
  const skewTan = Math.tan(((settings?.skewDeg || 0) * Math.PI) / 180)
  const toFont = p => {
    const fx = p.x * fScale
    const fy = (CANVAS_SIZE - p.y) * fScale
    return { x: Math.round(fx + fy * skewTan), y: Math.round(fy) }
  }

  const parts = []
  for (const pts of contours) {
    if (pts.length < 10) continue
    const anchorIdxs = cornerAwareSimplify(pts)
    if (anchorIdxs.length < 4) continue
    const denseFont = pts.map(toFont)
    const bezierPts = fitBezierThrough(denseFont, anchorIdxs)
    parts.push(subpathToD(bezierPts))
  }
  if (!parts.length) return null

  const advanceWidth = Math.round(glyphW * scale * fScale * 1.05 + (settings?.tracking || 0))
  return { pathD: parts.join(' '), advanceWidth }
}

/**
 * Generate a glyph from a user-supplied photo (already cropped/binarized
 * to a square data URL). Same tracing pipeline, different source image.
 * Returns a Promise because Image() loads asynchronously.
 */
export function traceGlyphFromPhoto(imageDataUrl, metrics, settings = {}) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const size = 512
      const canvas = document.createElement('canvas')
      canvas.width  = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)

      const imageData = ctx.getImageData(0, 0, size, size)
      const binary    = binarize(imageData.data, size, size, BIN_THRESHOLD)
      const contours  = traceAllContours(binary, size, size)
      if (!contours.length) return resolve(null)

      const upm     = metrics.unitsPerEm || 1000
      const asc     = metrics.ascender   ||  800
      const scale   = asc / size
      const skewTan = Math.tan(((settings?.skewDeg || 0) * Math.PI) / 180)
      const toFont  = p => {
        const fx = p.x * scale
        const fy = (size - p.y) * scale
        return { x: Math.round(fx + fy * skewTan), y: Math.round(fy) }
      }

      const parts = []
      for (const pts of contours) {
        if (pts.length < 10) continue
        const idxs = cornerAwareSimplify(pts)
        if (idxs.length < 4) continue
        const bezier = fitBezierThrough(pts.map(toFont), idxs)
        parts.push(subpathToD(bezier))
      }
      if (!parts.length) return resolve(null)
      resolve({
        pathD: parts.join(' '),
        advanceWidth: Math.round(upm * 0.6 + (settings?.tracking || 0)),
      })
    }
    img.onerror = () => resolve(null)
    img.src = imageDataUrl
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Subpath helpers
// ────────────────────────────────────────────────────────────────────────────

function subpathToD(points) {
  if (!points.length) return ''
  const parts = []
  for (const p of points) {
    if (p.type === 'M') parts.push(`M${p.x} ${p.y}`)
    else if (p.type === 'L') parts.push(`L${p.x} ${p.y}`)
    else if (p.type === 'C') parts.push(`C${p.cp1x} ${p.cp1y} ${p.cp2x} ${p.cp2y} ${p.x} ${p.y}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

// ────────────────────────────────────────────────────────────────────────────
// Binarization + contour tracing
// ────────────────────────────────────────────────────────────────────────────

export function binarize(imageData, w, h, threshold = BIN_THRESHOLD) {
  const bin = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    bin[i] = imageData[i * 4] < threshold ? 1 : 0
  }
  return bin
}

// Moore neighbor order (clockwise from east):
// 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE
const MOORE_DX = [1, 1, 0, -1, -1, -1, 0, 1]
const MOORE_DY = [0, 1, 1, 1, 0, -1, -1, -1]

function traceFromPixel(bin, w, h, visited, startX, startY) {
  const pts = []
  let x = startX, y = startY
  let dir = 6  // came from north
  const maxSteps = w * h * 4
  for (let step = 0; step < maxSteps; step++) {
    pts.push({ x, y })
    visited[y * w + x] = 1
    let found = false
    for (let i = 0; i < 8; i++) {
      // Look for next foreground neighbor starting two CCW from current dir
      const nd = (dir + 6 + i) % 8
      const nx = x + MOORE_DX[nd], ny = y + MOORE_DY[nd]
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      if (bin[ny * w + nx]) {
        x = nx; y = ny
        dir = nd
        found = true
        break
      }
    }
    if (!found) break
    if (x === startX && y === startY && pts.length > 2) break
  }
  return pts
}

function signedArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return a / 2
}

function ensureOrientation(pts, clockwise) {
  const a = signedArea(pts)
  if ((clockwise && a < 0) || (!clockwise && a > 0)) {
    return pts.slice().reverse()
  }
  return pts
}

/**
 * Two-pass contour tracer:
 *   Pass 1: outer contours (clockwise) — ink pixels whose left neighbor is background
 *   Pass 2: hole contours (counter-clockwise) — ink pixels that border a non-exterior
 *           background region, identified via exterior flood-fill from image edges.
 *
 * This correctly handles letters with holes like B, O, A, P, D, 0, 6, 8, 9.
 */
export function traceAllContours(bin, w, h) {
  const contours = []

  // Pass 1: outer
  const visitedOuter = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x] || visitedOuter[y * w + x]) continue
      if (x > 0 && bin[y * w + (x - 1)]) continue
      const pts = traceFromPixel(bin, w, h, visitedOuter, x, y)
      if (pts.length >= 10) contours.push(ensureOrientation(pts, true))
    }
  }

  // Pass 2: flood-fill exterior background from edges
  const exterior = new Uint8Array(w * h)
  const stack = []
  for (let x = 0; x < w; x++) {
    if (!bin[x]) { exterior[x] = 1; stack.push(x) }
    const bi = (h - 1) * w + x
    if (!bin[bi]) { exterior[bi] = 1; stack.push(bi) }
  }
  for (let y = 0; y < h; y++) {
    if (!bin[y * w]) { exterior[y * w] = 1; stack.push(y * w) }
    const ri = y * w + (w - 1)
    if (!bin[ri]) { exterior[ri] = 1; stack.push(ri) }
  }
  while (stack.length) {
    const idx = stack.pop()
    const x = idx % w, y = (idx - x) / w
    const ns = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]
    for (const [nx, ny] of ns) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      const ni = ny * w + nx
      if (!bin[ni] && !exterior[ni]) { exterior[ni] = 1; stack.push(ni) }
    }
  }

  // Pass 2: hole contours — ink pixels adjacent to non-exterior background
  const visitedHole = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x] || visitedHole[y * w + x]) continue
      let onHoleBoundary = false
      const ns = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]
      for (const [nx, ny] of ns) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const ni = ny * w + nx
        if (!bin[ni] && !exterior[ni]) { onHoleBoundary = true; break }
      }
      if (!onHoleBoundary) continue
      const pts = traceFromPixel(bin, w, h, visitedHole, x, y)
      if (pts.length >= 10) contours.push(ensureOrientation(pts, false))
    }
  }

  return contours
}

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
  const weight     = settings?.weight  || 400
  const useItalic  = (settings?.italic || 0) >= 0.5
  ctx.font = `${useItalic ? 'italic ' : ''}${weight} ${FONT_SIZE}px "${fontFamily}", sans-serif`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign    = 'left'

  // Calibrate once per (font-family, size): measure a capital 'H' to anchor
  // the baseline and cap-height consistently across all glyphs in the font.
  // Without this, every glyph was being padded-to-fit individually, so an 'i'
  // and a 'M' ended up the same on-screen size.
  const cal = calibrate(ctx, fontFamily)

  // Fixed layout: all glyphs share the same baseline and the same cap-height
  // pixel reference, so proportions between letters are preserved.
  const baselineY = CANVAS_SIZE - 60               // pixels from top
  const capPxRef  = cal.capAscent                  // pixels from baseline

  const m = ctx.measureText(char)
  const leftPad = m.actualBoundingBoxLeft || 0
  // Horizontally centre each glyph in the 512-wide canvas for tracing; the
  // actual advance width is recorded separately and used in the OTF.
  const glyphW  = (m.actualBoundingBoxRight || m.width) + leftPad
  if (glyphW < 1) return null
  const drawX = Math.round((CANVAS_SIZE - glyphW) / 2 + leftPad)

  ctx.fillText(char, drawX, baselineY)

  const imageData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  const binary    = binarize(imageData.data, CANVAS_SIZE, CANVAS_SIZE, BIN_THRESHOLD)
  const contours  = traceAllContours(binary, CANVAS_SIZE, CANVAS_SIZE)
  if (!contours.length) return null

  // Project canvas pixels → font-units so one pixel above the baseline maps
  // to capHeight/capPxRef font-units. This makes 'M' reach capHeight, 'x'
  // reach xHeight, 'p' descend below baseline — naturally and consistently.
  const upm       = metrics.unitsPerEm || 1000
  const capHeight = metrics.capHeight  ||  700
  const fScale    = capHeight / capPxRef
  const skewTan   = Math.tan(((settings?.skewDeg || 0) * Math.PI) / 180)
  const widthMul  = (settings?.widthScale ?? 100) / 100
  const toFont = p => {
    // y in canvas grows downward; flip around baselineY, then scale.
    const fy = (baselineY - p.y) * fScale
    const fx = (p.x - drawX)     * fScale * widthMul
    return { x: Math.round(fx + fy * skewTan), y: Math.round(fy) }
  }

  const rough  = settings?.roughness    || 0
  const wOff   = settings?.weightOffset || 0
  const rand   = seedRand(charCodeSeed(char))

  const parts = []
  for (const pts of contours) {
    if (pts.length < 10) continue
    const anchorIdxs = cornerAwareSimplify(pts)
    if (anchorIdxs.length < 4) continue
    // Flip winding: pixel-space CW → font-space CCW after y-mirror. opentype.js
    // expects TrueType convention (CCW outer, CW holes), so we reverse here.
    const reversed = pts.slice().reverse()
    const reversedIdxs = anchorIdxs.map(i => pts.length - 1 - i).reverse()
    const denseFont = reversed.map(toFont)
    let bezierPts = fitBezierThrough(denseFont, reversedIdxs)
    if (wOff)  bezierPts = applyWeightOffset(bezierPts, wOff)
    if (rough) bezierPts = applyRoughness(bezierPts, rand, rough * 4)
    parts.push(subpathToD(bezierPts))
  }
  if (!parts.length) return null

  // advanceWidth from the glyph's own metrics — not from the shared reference —
  // so narrow letters (i, l, .) remain narrow and wide ones (M, W) remain wide.
  const advanceWidth = Math.round(m.width * fScale * widthMul + (settings?.tracking || 0))
  return { pathD: parts.join(' '), advanceWidth }
}

// ── Calibration cache ────────────────────────────────────────────────────
// Measuring 'H' on every call is wasteful; cache per (fontFamily, FONT_SIZE).
const _calCache = new Map()
function calibrate(ctx, fontFamily) {
  const key = `${fontFamily}@${FONT_SIZE}`
  const cached = _calCache.get(key)
  if (cached) return cached
  const probe = ctx.measureText('H')
  const cal = {
    capAscent: probe.actualBoundingBoxAscent || FONT_SIZE * 0.7,
  }
  _calCache.set(key, cal)
  return cal
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
      const allContours = traceAllContours(binary, size, size)
      if (!allContours.length) {
        return resolve({ pathD: '', advanceWidth: 0, meta: { reason: 'empty', warnings: ['Ingen kontur funnet — er bokstaven mørk nok?'] } })
      }
      const picked = pickGlyphContours(allContours, size, size)
      const contours = picked.kept
      if (!contours.length) {
        return resolve({ pathD: '', advanceWidth: 0, meta: { ...picked.meta, warnings: ['Ingen tydelig glyf funnet i bildet'] } })
      }

      const upm     = metrics.unitsPerEm || 1000
      const asc     = metrics.ascender   ||  800
      const scale   = asc / size
      const skewTan = Math.tan(((settings?.skewDeg || 0) * Math.PI) / 180)
      const widthMul = (settings?.widthScale ?? 100) / 100
      const toFont  = p => {
        const fx = p.x * scale * widthMul
        const fy = (size - p.y) * scale
        return { x: Math.round(fx + fy * skewTan), y: Math.round(fy) }
      }

      const rough = settings?.roughness    || 0
      const wOff  = settings?.weightOffset || 0
      const rand  = seedRand(0xBEEF)

      const parts = []
      for (const pts of contours) {
        if (pts.length < 10) continue
        const idxs = cornerAwareSimplify(pts)
        if (idxs.length < 4) continue
        // Same reversal as system-font tracer — opentype.js expects CCW outer
        const reversed = pts.slice().reverse()
        const reversedIdxs = idxs.map(i => pts.length - 1 - i).reverse()
        let bezier = fitBezierThrough(reversed.map(toFont), reversedIdxs)
        if (wOff)  bezier = applyWeightOffset(bezier, wOff)
        if (rough) bezier = applyRoughness(bezier, rand, rough * 4)
        parts.push(subpathToD(bezier))
      }
      if (!parts.length) {
        return resolve({ pathD: '', advanceWidth: 0, meta: { ...picked.meta, warnings: ['Konturen er for kort til å bli en glyf'] } })
      }
      const warnings = []
      if (picked.meta.otherOuterCount > 0) {
        warnings.push(`${picked.meta.otherOuterCount} annet objekt funnet — bare det største brukes`)
      }
      if (!picked.meta.mainContainsCenter) {
        warnings.push('Hovedformen ligger utenfor midten — sjekk at bokstaven er sentrert')
      }
      if (picked.meta.mainCoverage < 0.05) {
        warnings.push('Bokstaven er ganske liten i bildet — beskjær tettere for bedre detaljer')
      }
      resolve({
        pathD: parts.join(' '),
        advanceWidth: Math.round(upm * 0.6 * widthMul + (settings?.tracking || 0)),
        meta: { ...picked.meta, warnings },
      })
    }
    img.onerror = () => resolve({ pathD: '', advanceWidth: 0, meta: { warnings: ['Klarte ikke lese bildet'] } })
    img.src = imageDataUrl
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Variable-settings helpers (roughness, weight offset)
// ────────────────────────────────────────────────────────────────────────────

// Mulberry32 — small deterministic PRNG so the same glyph + roughness always
// produces the same jitter. Without this, reactive re-renders would shimmer.
function seedRand(seed) {
  let s = seed >>> 0
  return function () {
    s = (s + 0x6D2B79F5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function charCodeSeed(char) {
  let h = 2166136261
  for (let i = 0; i < char.length; i++) {
    h ^= char.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h
}

// Perturb each anchor (and its handles) by a deterministic random offset.
// Amplitude is in font-units; control points move with their anchor so the
// curve smoothness is preserved locally.
function applyRoughness(points, rand, amplitude) {
  for (const p of points) {
    const dx = (rand() * 2 - 1) * amplitude
    const dy = (rand() * 2 - 1) * amplitude
    p.x = Math.round(p.x + dx)
    p.y = Math.round(p.y + dy)
    if (p.type === 'C') {
      p.cp1x = Math.round(p.cp1x + dx)
      p.cp1y = Math.round(p.cp1y + dy)
      p.cp2x = Math.round(p.cp2x + dx)
      p.cp2y = Math.round(p.cp2y + dy)
    }
  }
  return points
}

// Offset a closed contour along its left-normal by `delta` font-units. CCW
// outer contours grow outward (thicker), CW holes shrink inward (also makes
// the glyph look thicker, since holes get smaller). Each anchor's normal is
// approximated from the chord between its two neighbors. cp1 of point i is
// near the previous anchor geometrically, so it's offset using that anchor's
// normal — this keeps the offset consistent across the whole curve.
function applyWeightOffset(points, delta) {
  const n = points.length
  if (n < 3) return points
  const offsets = new Array(n)
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    offsets[i] = { dx: (-ty / len) * delta, dy: (tx / len) * delta }
  }
  for (let i = 0; i < n; i++) {
    const p   = points[i]
    const o   = offsets[i]
    const oPrev = offsets[(i - 1 + n) % n]
    p.x = Math.round(p.x + o.dx)
    p.y = Math.round(p.y + o.dy)
    if (p.type === 'C') {
      p.cp1x = Math.round(p.cp1x + oPrev.dx)
      p.cp1y = Math.round(p.cp1y + oPrev.dy)
      p.cp2x = Math.round(p.cp2x + o.dx)
      p.cp2y = Math.round(p.cp2y + o.dy)
    }
  }
  return points
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
 * Filter raw contours to the most likely glyph + its holes. Drops noise specks,
 * picture-frames, and stray ink the user accidentally captured. Returns both
 * the kept contours (in tracing order: main outer first, then holes) and meta
 * the UI can show as a "glyph found" pre-warning.
 *
 *   - signedArea > 0 in image space (y-down) means the path winds CW visually,
 *     which traceAllContours produces for OUTER boundaries → that's our marker.
 *   - Drop anything < 0.5% of the image (noise) or > 70% (likely the bezel).
 *   - Pick the largest outer that overlaps the image center; warn if there
 *     are sibling outers (multiple objects in frame).
 *   - Holes are kept only when their bbox sits inside the chosen outer.
 */
export function pickGlyphContours(contours, w, h) {
  const imgArea = w * h
  const cx = w / 2, cy = h / 2
  const tagged = contours.map(pts => {
    const a    = Math.abs(signedArea(pts))
    const bb   = bboxOf(pts)
    const isOuter = signedArea(pts) > 0   // ensureOrientation made outers CW visually
    const containsCenter = bb.minX <= cx && bb.maxX >= cx && bb.minY <= cy && bb.maxY >= cy
    return { pts, area: a, bbox: bb, isOuter, containsCenter }
  })

  const filtered = tagged.filter(c => {
    const ratio = c.area / imgArea
    return ratio >= 0.005 && ratio <= 0.7
  })
  if (!filtered.length) {
    return { kept: [], meta: { reason: 'empty', contourCount: tagged.length, droppedCount: tagged.length, warnings: [] } }
  }

  const outers = filtered.filter(c => c.isOuter)
  if (!outers.length) {
    return { kept: [], meta: { reason: 'no-outer', contourCount: tagged.length, droppedCount: tagged.length - filtered.length, warnings: [] } }
  }

  const centerOuters = outers.filter(c => c.containsCenter)
  const main = (centerOuters.length ? centerOuters : outers)
    .slice()
    .sort((a, b) => b.area - a.area)[0]

  const holes = filtered.filter(c => !c.isOuter && bboxInside(c.bbox, main.bbox))

  return {
    kept: [main, ...holes].map(c => c.pts),
    meta: {
      contourCount:       tagged.length,
      keptCount:          1 + holes.length,
      droppedCount:       tagged.length - (1 + holes.length),
      otherOuterCount:    outers.length - 1,
      mainArea:           main.area,
      mainCoverage:       main.area / imgArea,
      mainContainsCenter: main.containsCenter,
      holeCount:          holes.length,
      warnings:           [],
    },
  }
}

function bboxOf(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

function bboxInside(inner, outer) {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX
      && inner.minY >= outer.minY && inner.maxY <= outer.maxY
}

/**
 * Contour tracer that correctly separates outer contours from holes.
 *
 * Algorithm:
 *   1. Flood-fill the exterior background from all image edges → `exterior`.
 *      Any background pixel not in `exterior` is inside a hole.
 *   2. For every unvisited ink pixel that is adjacent to an exterior-
 *      background pixel, trace the contour → it's an OUTER boundary.
 *   3. For every unvisited ink pixel adjacent to a hole-background pixel
 *      (background that is NOT exterior), trace the contour → it's a HOLE.
 *
 * A single pixel can only be on one boundary at a time thanks to `visited`,
 * so we never emit a letter's outer and inner boundary as the same path.
 * Orientation: outer is CW in canvas space (before y-flip), hole is CCW.
 * After the y-flip in the caller these swap, and we reverse in the caller
 * to get TrueType convention.
 */
export function traceAllContours(bin, w, h) {
  const contours = []
  const visited  = new Uint8Array(w * h)

  // Step 1: flood-fill exterior background
  const exterior = new Uint8Array(w * h)
  const stack = []
  const pushEdge = (i) => { if (!bin[i]) { exterior[i] = 1; stack.push(i) } }
  for (let x = 0; x < w; x++) { pushEdge(x); pushEdge((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { pushEdge(y * w); pushEdge(y * w + w - 1) }
  while (stack.length) {
    const idx = stack.pop()
    const x = idx % w, y = (idx - x) / w
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      const ni = ny * w + nx
      if (!bin[ni] && !exterior[ni]) { exterior[ni] = 1; stack.push(ni) }
    }
  }

  // Helper: pixel is on an OUTER boundary if any orthogonal neighbor is
  // an exterior-background pixel (or off-canvas). Equivalent: there's a
  // path to infinity right next to it.
  const onOuter = (x, y) => {
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) return true
      const ni = ny * w + nx
      if (!bin[ni] && exterior[ni]) return true
    }
    return false
  }
  const onHole = (x, y) => {
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      const ni = ny * w + nx
      if (!bin[ni] && !exterior[ni]) return true
    }
    return false
  }

  // Step 2: outer contours — scan top-to-bottom, left-to-right so we always
  // start at the TOP-LEFT-most pixel of each outer contour. That guarantees
  // Moore-neighbor tracing produces clockwise orientation.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!bin[i] || visited[i]) continue
      if (!onOuter(x, y)) continue
      // Ensure leftmost on its row for this contour — if the pixel directly
      // to the left is also ink and already visited via this contour, this
      // isn't the true start, skip.
      if (x > 0 && bin[i - 1]) continue
      const pts = traceFromPixel(bin, w, h, visited, x, y)
      if (pts.length >= 10) contours.push(ensureOrientation(pts, true))
    }
  }

  // Step 3: hole contours — same scan, but now starting pixels are on hole
  // boundaries. traceFromPixel walks along the ink-hole interface.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!bin[i] || visited[i]) continue
      if (!onHole(x, y)) continue
      const pts = traceFromPixel(bin, w, h, visited, x, y)
      // Holes are CCW in canvas space (opposite of outer)
      if (pts.length >= 10) contours.push(ensureOrientation(pts, false))
    }
  }

  return contours
}

/**
 * glyphRenderer.js (node test harness)
 *
 * Node-side port of canvasGlyphRenderer.js using @napi-rs/canvas, so the same
 * pipeline can run headless for automated quality testing.
 */

import { createCanvas } from '@napi-rs/canvas'
import { cornerAwareSimplify, fitBezierThrough } from '../../src/lib/curveFit.js'
import {
  binarize, traceAllContours,
} from '../../src/lib/canvasGlyphRenderer.js'

const CANVAS_SIZE = 512
const FONT_SIZE = 400

export function generateGlyph(char, fontFamily, metrics = { unitsPerEm: 1000, ascender: 800 }) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  ctx.fillStyle = '#000000'
  ctx.font = `${FONT_SIZE}px "${fontFamily}"`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  const m = ctx.measureText(char)
  const ascent = m.actualBoundingBoxAscent || FONT_SIZE * 0.7
  const descent = m.actualBoundingBoxDescent || FONT_SIZE * 0.15
  const left = m.actualBoundingBoxLeft || 0
  const right = m.actualBoundingBoxRight || m.width

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
  const bin = binarize(imageData.data, CANVAS_SIZE, CANVAS_SIZE)
  const contours = traceAllContours(bin, CANVAS_SIZE, CANVAS_SIZE)
  if (!contours.length) return null

  const upm = metrics.unitsPerEm || 1000
  const asc = metrics.ascender || 800
  const fScale = asc / (CANVAS_SIZE * 0.7)
  const toFont = p => ({
    x: Math.round(p.x * fScale),
    y: Math.round((CANVAS_SIZE - p.y) * fScale),
  })

  const parts = []
  const contourInfo = []
  for (const pts of contours) {
    if (pts.length < 10) continue
    const anchorIdxs = cornerAwareSimplify(pts)
    if (anchorIdxs.length < 4) continue
    const denseFont = pts.map(toFont)
    const bezierPts = fitBezierThrough(denseFont, anchorIdxs)
    parts.push(subpathToD(bezierPts))
    contourInfo.push({
      densePts: pts,
      anchorIdxs,
      bezierPts,
      anchorCount: anchorIdxs.length,
      densePtCount: pts.length,
    })
  }

  return {
    pathD: parts.join(' '),
    contours: contourInfo,
    canvasSize: CANVAS_SIZE,
    fontScale: fScale,
  }
}

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

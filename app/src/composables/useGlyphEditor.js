/**
 * useGlyphEditor.js
 *
 * Composable that provides a Bézier path editor state machine per glyph.
 * Handles parsing/building path-D, anchor selection, drag, add/remove,
 * undo/redo, and quick-shape operations (smooth, straighten, simplify,
 * thicker/thinner contour offset).
 *
 * Returns a factory function; call `useGlyphEditor()` once per editor instance
 * (typically in FontEditorView).
 */

import { ref, computed } from 'vue'
import { polygonToBezier } from '../lib/bezierSmoothing.js'

export function useGlyphEditor() {
  const currentChar = ref(null)
  const points      = ref([])        // [{x, y, type, cp1x, cp1y, cp2x, cp2y}]
  const undoStack   = ref([])
  const redoStack   = ref([])
  const selectedIdx = ref(null)      // index of currently-selected anchor (sticky)

  // ── Snapshot helpers ────────────────────────────────────────────────────

  function snapshot() {
    return JSON.stringify(points.value)
  }
  function restore(snap) {
    points.value = JSON.parse(snap)
    if (selectedIdx.value != null && selectedIdx.value >= points.value.length) {
      selectedIdx.value = null
    }
  }
  function pushUndo() {
    undoStack.value.push(snapshot())
    if (undoStack.value.length > 50) undoStack.value.shift()
    redoStack.value = []
  }

  // ── Selection ───────────────────────────────────────────────────────────

  function selectAnchor(idx) {
    if (idx == null || idx < 0 || idx >= points.value.length) {
      selectedIdx.value = null
    } else {
      selectedIdx.value = idx
    }
  }
  function clearSelection() {
    selectedIdx.value = null
  }

  // ── Load/save path ──────────────────────────────────────────────────────

  function loadPath(char, pathD) {
    currentChar.value = char
    points.value = parsePath(pathD)
    undoStack.value = []
    redoStack.value = []
    selectedIdx.value = null
  }
  function toPathD() {
    return buildPathD(points.value)
  }

  // ── Undo/redo ───────────────────────────────────────────────────────────

  function undo() {
    if (!undoStack.value.length) return
    redoStack.value.push(snapshot())
    restore(undoStack.value.pop())
  }
  function redo() {
    if (!redoStack.value.length) return
    undoStack.value.push(snapshot())
    restore(redoStack.value.pop())
  }
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  // ── Drag handlers ───────────────────────────────────────────────────────

  function startDrag() { pushUndo() }

  function dragAnchor(idx, x, y) {
    const p = points.value[idx]
    if (!p) return
    const dx = x - p.x
    const dy = y - p.y
    p.x = x; p.y = y
    // Move attached handles together with the anchor
    if (p.type === 'C') {
      p.cp2x += dx; p.cp2y += dy
    }
    const next = points.value[(idx + 1) % points.value.length]
    if (next && next.type === 'C') {
      next.cp1x += dx; next.cp1y += dy
    }
  }

  function dragCp1(idx, x, y) {
    const p = points.value[idx]
    if (!p || p.type !== 'C') return
    p.cp1x = x; p.cp1y = y
  }

  function dragCp2(idx, x, y) {
    const p = points.value[idx]
    if (!p || p.type !== 'C') return
    p.cp2x = x; p.cp2y = y
  }

  // ── Add/remove anchor ───────────────────────────────────────────────────

  function addPointAfterSelected() {
    if (selectedIdx.value == null) return
    pushUndo()
    const idx = selectedIdx.value
    const a = points.value[idx]
    const b = points.value[(idx + 1) % points.value.length]
    if (!a || !b) return
    const midX = Math.round((a.x + b.x) / 2)
    const midY = Math.round((a.y + b.y) / 2)
    // Insert after idx; match b's type
    const newPt = b.type === 'C'
      ? {
          x: midX, y: midY,
          cp1x: Math.round((a.x + midX) / 2),
          cp1y: Math.round((a.y + midY) / 2),
          cp2x: Math.round((midX + b.x) / 2),
          cp2y: Math.round((midY + b.y) / 2),
          type: 'C',
        }
      : { x: midX, y: midY, type: 'L' }
    points.value.splice(idx + 1, 0, newPt)
    selectedIdx.value = idx + 1
  }

  function removeSelected() {
    if (selectedIdx.value == null) return
    if (points.value.length <= 3) return
    pushUndo()
    const idx = selectedIdx.value
    if (idx === 0) {
      // Removing the M-point would break the path. Promote next point to M.
      const next = points.value[1]
      if (next) next.type = 'M'
    }
    points.value.splice(idx, 1)
    // Select the closest remaining anchor: the next one slid into this slot,
    // unless we removed the last index — then fall back to the previous.
    const newLen = points.value.length
    if (!newLen)              selectedIdx.value = null
    else if (idx >= newLen)   selectedIdx.value = newLen - 1
    else                      selectedIdx.value = idx
  }

  /** Wipe every anchor in the glyph. Undoable. */
  function clearAll() {
    if (!points.value.length) return
    pushUndo()
    points.value = []
    selectedIdx.value = null
  }

  const canAddPoint    = computed(() =>
    selectedIdx.value != null && points.value.length >= 2
  )
  const canRemovePoint = computed(() =>
    selectedIdx.value != null && points.value.length > 3
  )

  // ── Quick-shape operations ──────────────────────────────────────────────

  /** Convert all curves to a smooth Catmull-Rom Bézier path. */
  function makeSmooth() {
    if (points.value.length < 5) return
    pushUndo()
    const anchors = points.value.map(p => ({ x: p.x, y: p.y }))
    const smoothed = polygonToBezier(anchors, 1)
    if (smoothed.length) points.value = smoothed
  }

  /** Convert all curves to straight line segments. */
  function makeStraight() {
    if (points.value.length < 3) return
    pushUndo()
    points.value = points.value.map((p, i) => ({
      x: p.x, y: p.y,
      type: i === 0 ? 'M' : 'L',
    }))
  }

  /** Douglas-Peucker simplification (reduce anchors). */
  function simplify() {
    if (points.value.length < 6) return
    pushUndo()
    const pts = points.value.map(p => ({ x: p.x, y: p.y }))
    const keep = douglasPeucker(pts, computeEpsilon(pts))
    if (keep.length < 3) return
    points.value = keep.map((p, i) => ({
      x: p.x, y: p.y,
      type: i === 0 ? 'M' : 'L',
    }))
  }

  /** Offset every contour along its left-normal — outer (CCW) grows outward,
   *  holes (CW) shrink inward — so the glyph reads like a heavier (thicker) or
   *  lighter (thinner) font weight rather than a uniformly scaled silhouette.
   *  Each subpath is processed independently so an "8" with two holes works. */
  function thicken(delta) {
    if (points.value.length < 3) return
    pushUndo()

    // Find subpath spans (each begins with an M-typed anchor).
    const spans = []
    let cur = 0
    for (let i = 1; i < points.value.length; i++) {
      if (points.value[i].type === 'M') { spans.push([cur, i]); cur = i }
    }
    spans.push([cur, points.value.length])

    for (const [start, end] of spans) {
      const n = end - start
      if (n < 3) continue
      const offsets = new Array(n)
      // Tangent at each anchor from cyclic neighbors within the subpath →
      // left normal × delta. CCW outers move outward, CW holes move inward.
      for (let k = 0; k < n; k++) {
        const prev = points.value[start + ((k - 1 + n) % n)]
        const next = points.value[start + ((k + 1) % n)]
        const tx = next.x - prev.x
        const ty = next.y - prev.y
        const len = Math.hypot(tx, ty) || 1
        offsets[k] = { dx: (-ty / len) * delta, dy: (tx / len) * delta }
      }
      for (let k = 0; k < n; k++) {
        const p     = points.value[start + k]
        const o     = offsets[k]
        const oPrev = offsets[(k - 1 + n) % n]
        p.x = Math.round(p.x + o.dx)
        p.y = Math.round(p.y + o.dy)
        if (p.type === 'C') {
          // cp1 lies near the previous anchor, so it follows that anchor's
          // offset — keeps the curve uniformly thickened along its length.
          p.cp1x = Math.round(p.cp1x + oPrev.dx)
          p.cp1y = Math.round(p.cp1y + oPrev.dy)
          p.cp2x = Math.round(p.cp2x + o.dx)
          p.cp2y = Math.round(p.cp2y + o.dy)
        }
      }
    }
  }

  // ── Douglas-Peucker (used by simplify()) ────────────────────────────────

  function computeEpsilon(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
    }
    return Math.max(2, (Math.max(maxX - minX, maxY - minY) || 100) * 0.015)
  }

  function douglasPeucker(pts, epsilon) {
    if (pts.length < 3) return pts
    const start = 0
    const end = pts.length - 1
    const keep = new Uint8Array(pts.length)
    keep[start] = 1; keep[end] = 1
    const stack = [[start, end]]
    while (stack.length) {
      const [a, b] = stack.pop()
      let maxDist = 0, maxIdx = -1
      for (let i = a + 1; i < b; i++) {
        const d = perpendicularDistance(pts[i], pts[a], pts[b])
        if (d > maxDist) { maxDist = d; maxIdx = i }
      }
      if (maxDist > epsilon && maxIdx >= 0) {
        keep[maxIdx] = 1
        stack.push([a, maxIdx])
        stack.push([maxIdx, b])
      }
    }
    return pts.filter((_, i) => keep[i])
  }

  function perpendicularDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y
    const norm = Math.hypot(dx, dy) || 1
    return Math.abs((dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / norm)
  }

  return {
    currentChar, points, selectedIdx,
    loadPath, toPathD,
    selectAnchor, clearSelection,
    startDrag, dragAnchor, dragCp1, dragCp2,
    addPointAfterSelected, removeSelected, clearAll,
    canAddPoint, canRemovePoint,
    undo, redo, canUndo, canRedo,
    makeSmooth, makeStraight, simplify, thicken,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Path-D parser/builder (handles M, L, C, Q, Z)
// ────────────────────────────────────────────────────────────────────────────

export function parsePath(d) {
  if (!d) return []
  const tokens = d.match(/[MLCQZmlcqz]|[-+]?[0-9]*\.?[0-9]+(?:\.[0-9]+)?/g) || []
  const pts = []
  let i = 0
  let cmd = null
  const num = () => parseFloat(tokens[i++])
  while (i < tokens.length) {
    if (/[MLCQZmlcqz]/.test(tokens[i])) cmd = tokens[i++]
    if (cmd === 'Z' || cmd === 'z') continue
    if (cmd === 'M' || cmd === 'm') {
      pts.push({ x: num(), y: num(), type: 'M' })
    } else if (cmd === 'L' || cmd === 'l') {
      pts.push({ x: num(), y: num(), type: 'L' })
    } else if (cmd === 'C' || cmd === 'c') {
      pts.push({
        cp1x: num(), cp1y: num(),
        cp2x: num(), cp2y: num(),
        x: num(), y: num(),
        type: 'C',
      })
    } else if (cmd === 'Q' || cmd === 'q') {
      pts.push({
        cp1x: num(), cp1y: num(),
        x: num(), y: num(),
        type: 'Q',
      })
    } else {
      i++
    }
  }
  return pts
}

export function buildPathD(points) {
  if (!points.length) return ''
  const parts = []
  for (const p of points) {
    if (p.type === 'M') parts.push(`M${p.x} ${p.y}`)
    else if (p.type === 'L') parts.push(`L${p.x} ${p.y}`)
    else if (p.type === 'C') parts.push(`C${p.cp1x} ${p.cp1y} ${p.cp2x} ${p.cp2y} ${p.x} ${p.y}`)
    else if (p.type === 'Q') parts.push(`Q${p.cp1x} ${p.cp1y} ${p.x} ${p.y}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

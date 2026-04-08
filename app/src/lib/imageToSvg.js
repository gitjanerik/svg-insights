/**
 * Image → SVG line drawing conversion using enhanced multi-scale Canny edge detection.
 *
 * Pipeline:
 *   1.  loadImageToCanvas      — resize to manageable resolution
 *   2.  toGrayscale            — BT.601 luminance
 *   3.  histogramEqualization  — contrast enhancement pre-processing
 *   4.  multiScaleCanny        — combine edges at multiple sigma levels
 *       (gaussianBlur → sobelWithDirection → nonMaxSuppression → hysteresisThreshold) ×N
 *   5.  traceEdgeChains        — direction-aware contour following
 *   6.  bridgeGaps             — connect fragmented edge endpoints
 *   7.  simplifyPath           — Ramer-Douglas-Peucker with configurable epsilon
 *   8.  traceLuminanceContours — interior detail via iso-luminance boundary tracing
 *   9.  generateHatching       — hatching/crosshatch lines for dark regions
 *  10.  detectSkinRegions      — YCbCr skin-tone classification
 *  11.  pathsToSvgD            — polyline or smooth Catmull-Rom→Bezier paths
 *  12.  ensure ≥1000 vectors   — adaptive detail if below target
 */

const MAX_DIM = 600

// ─── Stage 1: Image loading ────────────────────────────────────────

export function loadImageToCanvas(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let w = img.width
      let h = img.height
      const ratio = Math.min(MAX_DIM / w, MAX_DIM / h, 1)
      w = Math.round(w * ratio)
      h = Math.round(h * ratio)

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      resolve({ canvas, ctx, w, h })
    }
    img.onerror = reject
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src)
  })
}

// ─── Stage 2: Grayscale ────────────────────────────────────────────

export function toGrayscale(data, w, h) {
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
  }
  return gray
}

// ─── Stage 3: Separable 5×5 Gaussian blur ──────────────────────────

export function gaussianBlur(gray, w, h, sigma = 1.4) {
  // Build 1D kernel of radius 2 (5 taps)
  const r = 2
  const kernel = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + r] = v
    sum += v
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum

  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = -r; k <= r; k++) {
        const sx = Math.min(Math.max(x + k, 0), w - 1)
        v += gray[y * w + sx] * kernel[k + r]
      }
      tmp[y * w + x] = v
    }
  }

  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = -r; k <= r; k++) {
        const sy = Math.min(Math.max(y + k, 0), h - 1)
        v += tmp[sy * w + x] * kernel[k + r]
      }
      out[y * w + x] = v
    }
  }

  return out
}

// ─── Stage 4: Sobel with gradient direction ────────────────────────

// Direction bins: 0=horizontal(0°), 1=diagonal(45°), 2=vertical(90°), 3=diagonal(135°)
export function sobelWithDirection(gray, w, h) {
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
  const magnitude = new Float32Array(w * h)
  const direction = new Uint8Array(w * h)

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sx = 0, sy = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const v = gray[(y + ky) * w + (x + kx)]
          const ki = (ky + 1) * 3 + (kx + 1)
          sx += v * gx[ki]
          sy += v * gy[ki]
        }
      }

      const idx = y * w + x
      magnitude[idx] = Math.sqrt(sx * sx + sy * sy)

      // Quantize angle to 4 bins
      let angle = Math.atan2(sy, sx) // -PI to PI
      if (angle < 0) angle += Math.PI // 0 to PI

      // Map to bins: 0°±22.5° or 180°±22.5° → bin 0
      //              45°±22.5° → bin 1
      //              90°±22.5° → bin 2
      //              135°±22.5° → bin 3
      const deg = (angle * 180) / Math.PI
      if (deg < 22.5 || deg >= 157.5) {
        direction[idx] = 0
      } else if (deg < 67.5) {
        direction[idx] = 1
      } else if (deg < 112.5) {
        direction[idx] = 2
      } else {
        direction[idx] = 3
      }
    }
  }

  return { magnitude, direction }
}

// ─── Stage 5: Non-maximum suppression ──────────────────────────────

export function nonMaxSuppression(magnitude, direction, w, h) {
  const out = new Float32Array(w * h)

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x
      const mag = magnitude[idx]
      if (mag === 0) continue

      const dir = direction[idx]
      let n1 = 0, n2 = 0

      switch (dir) {
        case 0: // Horizontal gradient → compare left/right
          n1 = magnitude[idx - 1]
          n2 = magnitude[idx + 1]
          break
        case 1: // 45° gradient → compare top-right/bottom-left
          n1 = magnitude[(y - 1) * w + (x + 1)]
          n2 = magnitude[(y + 1) * w + (x - 1)]
          break
        case 2: // Vertical gradient → compare top/bottom
          n1 = magnitude[(y - 1) * w + x]
          n2 = magnitude[(y + 1) * w + x]
          break
        case 3: // 135° gradient → compare top-left/bottom-right
          n1 = magnitude[(y - 1) * w + (x - 1)]
          n2 = magnitude[(y + 1) * w + (x + 1)]
          break
      }

      // Keep only local maxima along gradient direction
      out[idx] = (mag >= n1 && mag >= n2) ? mag : 0
    }
  }

  return out
}

// ─── Stage 6: Hysteresis thresholding with BFS ─────────────────────

export function hysteresisThreshold(thinEdges, w, h, sensitivity = 0.55) {
  // Find max magnitude for threshold computation
  let max = 0
  for (let i = 0; i < thinEdges.length; i++) {
    if (thinEdges[i] > max) max = thinEdges[i]
  }

  if (max === 0) return new Uint8Array(w * h)

  // High sensitivity = lower thresholds = more edges
  const highThreshold = max * (1 - sensitivity)
  const lowThreshold = highThreshold * 0.4

  // Classify: 0=suppressed, 1=weak, 2=strong
  const classified = new Uint8Array(w * h)
  for (let i = 0; i < thinEdges.length; i++) {
    if (thinEdges[i] >= highThreshold) {
      classified[i] = 2
    } else if (thinEdges[i] >= lowThreshold) {
      classified[i] = 1
    }
  }

  // BFS from all strong pixels — promote connected weak pixels to strong
  const queue = []
  for (let i = 0; i < classified.length; i++) {
    if (classified[i] === 2) queue.push(i)
  }

  const dx = [-1, 0, 1, -1, 1, -1, 0, 1]
  const dy = [-1, -1, -1, 0, 0, 1, 1, 1]

  while (queue.length > 0) {
    const idx = queue.shift()
    const x = idx % w
    const y = (idx - x) / w

    for (let d = 0; d < 8; d++) {
      const nx = x + dx[d]
      const ny = y + dy[d]
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const ni = ny * w + nx
        if (classified[ni] === 1) {
          classified[ni] = 2 // Promote weak → strong
          queue.push(ni)
        }
      }
    }
  }

  // Final binary: only strong (promoted or original) pixels survive
  const binary = new Uint8Array(w * h)
  for (let i = 0; i < classified.length; i++) {
    binary[i] = classified[i] === 2 ? 1 : 0
  }

  return binary
}

// ─── Stage 7: Direction-aware edge chain tracing ───────────────────

export function traceEdgeChains(binary, direction, w, h, minLength = 2) {
  const visited = new Uint8Array(w * h)
  const chains = []

  // 8-connected neighbor offsets
  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]
  // Angle of each direction offset (radians)
  const dirAngles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4,
    Math.PI, -3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4]

  function traceDirection(startX, startY, prevAngle) {
    const points = []
    let cx = startX, cy = startY
    let currentAngle = prevAngle

    while (true) {
      const ci = cy * w + cx
      if (visited[ci]) break
      visited[ci] = 1
      points.push([cx, cy])

      // Find best next neighbor: prefer direction continuity
      let bestD = -1
      let bestScore = -2

      for (let d = 0; d < 8; d++) {
        const nx = cx + dx[d]
        const ny = cy + dy[d]
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const ni = ny * w + nx
        if (!binary[ni] || visited[ni]) continue

        // Score = cos(neighborAngle - currentAngle), prefer continuation
        const score = Math.cos(dirAngles[d] - currentAngle)
        if (score > bestScore) {
          bestScore = score
          bestD = d
        }
      }

      if (bestD === -1) break

      currentAngle = dirAngles[bestD]
      cx = cx + dx[bestD]
      cy = cy + dy[bestD]
    }

    return points
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x
      if (!binary[idx] || visited[idx]) continue

      // Determine initial direction from gradient (edge runs perpendicular)
      const dir = direction[idx]
      const edgeAngle = (dir * Math.PI) / 4 + Math.PI / 2 // perpendicular to gradient

      // Trace forward
      const forward = traceDirection(x, y, edgeAngle)

      // Unvisit the seed so backward trace can start from it
      if (forward.length > 0) {
        visited[y * w + x] = 0
      }

      // Trace backward
      const backward = traceDirection(x, y, edgeAngle + Math.PI)

      // Combine: backward (reversed, skip duplicate seed) + forward
      let chain
      if (backward.length > 1) {
        chain = backward.reverse().concat(forward.slice(1))
      } else {
        chain = forward
      }

      if (chain.length >= minLength) {
        chains.push(chain)
      }
    }
  }

  return chains
}

// ─── Stage 8: Bridge small gaps between chain endpoints ────────────

export function bridgeGaps(chains, maxGap = 3) {
  if (chains.length < 2) return chains

  const maxGapSq = maxGap * maxGap

  // Build endpoint index
  const endpoints = [] // { chainIdx, end: 'start'|'end', x, y }
  for (let i = 0; i < chains.length; i++) {
    const c = chains[i]
    if (c.length < 2) continue
    endpoints.push({ ci: i, end: 'start', x: c[0][0], y: c[0][1] })
    endpoints.push({ ci: i, end: 'end', x: c[c.length - 1][0], y: c[c.length - 1][1] })
  }

  const merged = new Set()
  const result = []

  for (let i = 0; i < endpoints.length; i++) {
    const a = endpoints[i]
    if (merged.has(a.ci)) continue

    let bestJ = -1
    let bestDistSq = maxGapSq + 1

    for (let j = i + 1; j < endpoints.length; j++) {
      const b = endpoints[j]
      if (b.ci === a.ci || merged.has(b.ci)) continue

      const dSq = (a.x - b.x) ** 2 + (a.y - b.y) ** 2
      if (dSq < bestDistSq) {
        bestDistSq = dSq
        bestJ = j
      }
    }

    if (bestJ !== -1 && bestDistSq <= maxGapSq) {
      const b = endpoints[bestJ]
      const chainA = chains[a.ci]
      const chainB = chains[b.ci]

      // Orient chains so the close endpoints are adjacent
      let partA = a.end === 'end' ? chainA : [...chainA].reverse()
      let partB = b.end === 'start' ? chainB : [...chainB].reverse()

      result.push([...partA, ...partB])
      merged.add(a.ci)
      merged.add(b.ci)
    }
  }

  // Add unmerged chains
  for (let i = 0; i < chains.length; i++) {
    if (!merged.has(i)) {
      result.push(chains[i])
    }
  }

  return result
}

// ─── Stage 9: RDP line simplification ──────────────────────────────

export function simplifyPath(points, epsilon = 0.8) {
  if (points.length <= 2) return points

  let maxDist = 0
  let maxIdx = 0
  const [sx, sy] = points[0]
  const [ex, ey] = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i][0], points[i][1], sx, sy, ex, ey)
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPath(points.slice(0, maxIdx + 1), epsilon)
    const right = simplifyPath(points.slice(maxIdx), epsilon)
    return left.slice(0, -1).concat(right)
  }

  return [points[0], points[points.length - 1]]
}

function pointLineDistance(px, py, lx1, ly1, lx2, ly2) {
  const dx = lx2 - lx1
  const dy = ly2 - ly1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return Math.sqrt((px - lx1) ** 2 + (py - ly1) ** 2)
  return Math.abs(dy * px - dx * py + lx2 * ly1 - ly2 * lx1) / len
}

// ─── Stage 10: SVG path generation with optional Bezier smoothing ──

export function pathsToSvgD(paths, smooth = true) {
  return paths.map(pts => {
    if (pts.length < 2) return ''

    if (!smooth || pts.length < 4) {
      // Simple polyline
      let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
      for (let i = 1; i < pts.length; i++) {
        d += ` L${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`
      }
      return d
    }

    // Catmull-Rom → cubic Bezier
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`

    // First segment: straight line to point 1
    d += ` L${pts[1][0].toFixed(1)},${pts[1][1].toFixed(1)}`

    // Middle segments: Catmull-Rom interpolation
    for (let i = 1; i < pts.length - 2; i++) {
      const p0 = pts[i - 1]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[i + 2]

      // Control point 1: P1 + (P2 - P0) / 6
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6
      // Control point 2: P2 - (P3 - P1) / 6
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6

      d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
    }

    // Last segment: straight line to final point
    const last = pts[pts.length - 1]
    d += ` L${last[0].toFixed(1)},${last[1].toFixed(1)}`

    return d
  }).filter(d => d.length > 0)
}

// ─── Stage 11: Histogram equalization (contrast enhancement) ──────

export function histogramEqualization(gray, w, h) {
  const bins = 256
  const hist = new Uint32Array(bins)

  for (let i = 0; i < w * h; i++) {
    hist[Math.min(255, Math.max(0, Math.round(gray[i])))]++
  }

  // Cumulative distribution function
  const cdf = new Uint32Array(bins)
  cdf[0] = hist[0]
  for (let i = 1; i < bins; i++) cdf[i] = cdf[i - 1] + hist[i]

  // First non-zero CDF value
  let cdfMin = 0
  for (let i = 0; i < bins; i++) {
    if (cdf[i] > 0) { cdfMin = cdf[i]; break }
  }

  const total = w * h
  if (total === cdfMin) return new Float32Array(gray) // uniform image

  const scale = 255 / (total - cdfMin)
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const v = Math.min(255, Math.max(0, Math.round(gray[i])))
    out[i] = Math.round((cdf[v] - cdfMin) * scale)
  }
  return out
}

// ─── Stage 12: Multi-scale Canny ──────────────────────────────────

export function multiScaleCanny(gray, w, h, sensitivity = 0.55, sigmas = [0.7, 1.4, 2.8]) {
  const merged = new Uint8Array(w * h)
  const mergedDirection = new Uint8Array(w * h)

  for (const sigma of sigmas) {
    const blurred = gaussianBlur(gray, w, h, sigma)
    const { magnitude, direction } = sobelWithDirection(blurred, w, h)
    const thin = nonMaxSuppression(magnitude, direction, w, h)
    const binary = hysteresisThreshold(thin, w, h, sensitivity)

    for (let i = 0; i < w * h; i++) {
      if (binary[i] && !merged[i]) {
        merged[i] = 1
        mergedDirection[i] = direction[i]
      }
    }
  }

  return { binary: merged, direction: mergedDirection }
}

// ─── Stage 13: Luminance contour tracing ──────────────────────────

export function traceLuminanceContours(gray, w, h, levels = [40, 80, 120, 160, 200]) {
  const allChains = []

  // Compute gradient direction for chain tracing
  const { direction } = sobelWithDirection(gray, w, h)

  for (const level of levels) {
    // Find boundary pixels: above-threshold pixels adjacent to below-threshold
    const boundary = new Uint8Array(w * h)

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x
        if (gray[idx] < level) continue

        if (gray[idx - 1] < level || gray[idx + 1] < level ||
            gray[(y - 1) * w + x] < level || gray[(y + 1) * w + x] < level) {
          boundary[idx] = 1
        }
      }
    }

    const chains = traceEdgeChains(boundary, direction, w, h, 8)
    allChains.push(...chains)
  }

  return allChains
}

// ─── Stage 14: Hatching / crosshatch for dark regions ─────────────

export function generateHatching(gray, w, h, darkThreshold = 80, spacing = 4) {
  const paths = []

  // Horizontal hatching lines
  for (let y = spacing; y < h - spacing; y += spacing) {
    let run = []
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] < darkThreshold) {
        run.push([x, y])
      } else {
        if (run.length >= 6) paths.push(run)
        run = []
      }
    }
    if (run.length >= 6) paths.push(run)
  }

  // Diagonal crosshatch (45° ↘) for very dark regions
  const veryDark = darkThreshold * 0.5
  for (let start = -h; start < w; start += spacing * 2) {
    let run = []
    for (let d = 0; d < w + h; d++) {
      const x = start + d
      const y = d
      if (x >= 0 && x < w && y >= 0 && y < h) {
        if (gray[y * w + x] < veryDark) {
          run.push([x, y])
        } else {
          if (run.length >= 6) paths.push(run)
          run = []
        }
      }
    }
    if (run.length >= 6) paths.push(run)
  }

  // Diagonal crosshatch (135° ↙) for very dark regions
  for (let start = 0; start < w + h; start += spacing * 2) {
    let run = []
    for (let d = 0; d < w + h; d++) {
      const x = start - d
      const y = d
      if (x >= 0 && x < w && y >= 0 && y < h) {
        if (gray[y * w + x] < veryDark) {
          run.push([x, y])
        } else {
          if (run.length >= 6) paths.push(run)
          run = []
        }
      }
    }
    if (run.length >= 6) paths.push(run)
  }

  return paths
}

// ─── Stage 15: Skin-tone detection (YCbCr) ────────────────────────

export function detectSkinRegions(data, w, h) {
  const mask = new Uint8Array(w * h)

  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    const r = data[o], g = data[o + 1], b = data[o + 2]

    // RGB → YCbCr
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b

    // Empirical skin-tone thresholds
    if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && y > 80) {
      mask[i] = 1
    }
  }

  return mask
}

// ─── Stage 16: Skin bounding box ──────────────────────────────────

export function findSkinBoundingBox(mask, w, h) {
  let minX = w, maxX = 0, minY = h, maxY = 0
  let count = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        count++
      }
    }
  }

  // Require at least 5% of image area to be skin-toned
  if (count / (w * h) < 0.05) return null

  return { minX, maxX, minY, maxY, coverage: count / (w * h) }
}

// ─── Orchestrator ──────────────────────────────────────────────────

/**
 * Full pipeline: image source → SVG string.
 *
 * @param {string|File|Blob} src - Image source
 * @param {Object} options
 * @param {number} options.sensitivity  - 0.0–1.0, higher = more edges (default 0.55)
 * @param {number} options.sigma        - Gaussian blur sigma (default 1.4)
 * @param {boolean} options.smooth      - Use Bezier curves (default true)
 * @param {boolean} options.bridging    - Bridge small gaps (default true)
 * @param {number} options.minPathLength - Min edge chain length in pixels (default 2)
 */
export async function imageToSvg(src, options = {}) {
  const {
    sensitivity = 0.55,
    sigma = 1.4,
    smooth = true,
    bridging = true,
    minPathLength = 2,
  } = options

  // Derived: higher sensitivity → lower epsilon (preserve more detail)
  const epsilon = 2.0 - sensitivity * 1.5

  const { ctx, w, h } = await loadImageToCanvas(src)
  const imageData = ctx.getImageData(0, 0, w, h)

  // Stage 2: Grayscale
  const gray = toGrayscale(imageData.data, w, h)

  // Stage 3: Histogram equalization (contrast enhancement)
  const enhanced = histogramEqualization(gray, w, h)

  // Stage 4: Multi-scale Canny edge detection
  const { binary, direction } = multiScaleCanny(enhanced, w, h, sensitivity)

  // Stage 5: Trace edge chains
  let chains = traceEdgeChains(binary, direction, w, h, minPathLength)

  // Stage 6: Bridge gaps
  if (bridging) {
    chains = bridgeGaps(chains)
  }

  // Stage 7: Simplify edge chains
  let edgePaths = chains
    .map(c => simplifyPath(c, epsilon))
    .filter(c => c.length >= 2)

  // Stage 8: Luminance contours for interior detail
  const contourLevels = [40, 80, 120, 160, 200]
  let contourChains = traceLuminanceContours(enhanced, w, h, contourLevels)
  let contourPaths = contourChains
    .map(c => simplifyPath(c, epsilon * 1.5))
    .filter(c => c.length >= 2)

  // Stage 9: Hatching for dark regions
  let hatchPaths = generateHatching(enhanced, w, h)

  // Stage 10: Ensure minimum 1000 vectors
  let totalPaths = edgePaths.length + contourPaths.length + hatchPaths.length
  if (totalPaths < 1000) {
    // Add extra contour levels
    const extraLevels = [20, 60, 100, 140, 180, 220]
    const extraContours = traceLuminanceContours(enhanced, w, h, extraLevels)
    const extraPaths = extraContours
      .map(c => simplifyPath(c, epsilon * 0.8))
      .filter(c => c.length >= 2)
    contourPaths.push(...extraPaths)

    // Add finer hatching
    const fineHatch = generateHatching(enhanced, w, h, 100, 3)
    hatchPaths.push(...fineHatch)

    totalPaths = edgePaths.length + contourPaths.length + hatchPaths.length
  }

  // Stage 12: Generate SVG path strings
  const edgeSvgD = pathsToSvgD(edgePaths, smooth)
  const contourSvgD = pathsToSvgD(contourPaths, smooth)
  const hatchSvgD = pathsToSvgD(hatchPaths, false)

  // Build grouped SVG
  const edgeEls = edgeSvgD
    .map(d => `    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`)
    .join('\n')

  const contourEls = contourSvgD
    .map(d => `    <path d="${d}" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`)
    .join('\n')

  const hatchEls = hatchSvgD
    .map(d => `    <path d="${d}" fill="none" stroke="currentColor" stroke-width="0.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`)
    .join('\n')

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" class="w-full h-full">`,
    `  <g class="edges">`,
    edgeEls,
    `  </g>`,
    `  <g class="contours" opacity="0.5">`,
    contourEls,
    `  </g>`,
    `  <g class="hatching" opacity="0.35">`,
    hatchEls,
    `  </g>`,
    `</svg>`,
  ].filter(Boolean).join('\n')

  return { svg, width: w, height: h, pathCount: totalPaths }
}

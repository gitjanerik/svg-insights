import { describe, it, expect } from 'vitest'
import {
  toGrayscale,
  gaussianBlur,
  sobelWithDirection,
  nonMaxSuppression,
  hysteresisThreshold,
  traceEdgeChains,
  bridgeGaps,
  simplifyPath,
  pathsToSvgD,
  histogramEqualization,
  multiScaleCanny,
  traceLuminanceContours,
  generateHatching,
  detectSkinRegions,
  findSkinBoundingBox,
} from './imageToSvg.js'

// ─── Helpers ────────────────────────────────────────────────────────

/** Create a fake RGBA buffer from grayscale values */
function grayToRgba(grayValues, w, h) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const v = grayValues[i]
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  return data
}

/** Create a flat array of zeros */
function zeros(w, h) {
  return new Float32Array(w * h)
}

// ─── Stage 2: toGrayscale ──────────────────────────────────────────

describe('toGrayscale', () => {
  it('converts RGBA to luminance', () => {
    // 2x1 image: pixel 0 = white, pixel 1 = black
    const data = new Uint8ClampedArray([
      255, 255, 255, 255,  // white
      0, 0, 0, 255,        // black
    ])
    const gray = toGrayscale(data, 2, 1)
    expect(gray[0]).toBeCloseTo(255, 0)
    expect(gray[1]).toBeCloseTo(0, 0)
  })

  it('weights RGB channels according to BT.601', () => {
    // Pure red pixel
    const data = new Uint8ClampedArray([255, 0, 0, 255])
    const gray = toGrayscale(data, 1, 1)
    expect(gray[0]).toBeCloseTo(0.299 * 255, 0)
  })
})

// ─── Stage 3: gaussianBlur ─────────────────────────────────────────

describe('gaussianBlur', () => {
  it('spreads a single bright pixel to neighbors', () => {
    const w = 7, h = 7
    const gray = zeros(w, h)
    gray[3 * w + 3] = 255 // center pixel bright

    const blurred = gaussianBlur(gray, w, h, 1.4)

    // Center should still be brightest
    expect(blurred[3 * w + 3]).toBeGreaterThan(0)
    // Neighbors should have received some energy
    expect(blurred[3 * w + 2]).toBeGreaterThan(0)
    expect(blurred[2 * w + 3]).toBeGreaterThan(0)
    // Center should be less than original (energy spread)
    expect(blurred[3 * w + 3]).toBeLessThan(255)
  })

  it('preserves a uniform image', () => {
    const w = 5, h = 5
    const gray = new Float32Array(w * h).fill(128)
    const blurred = gaussianBlur(gray, w, h, 1.0)

    // All pixels should remain ~128
    for (let i = 0; i < w * h; i++) {
      expect(blurred[i]).toBeCloseTo(128, 0)
    }
  })

  it('respects sigma parameter — larger sigma = more spread', () => {
    const w = 9, h = 9
    const gray = zeros(w, h)
    gray[4 * w + 4] = 255

    const narrow = gaussianBlur(gray, w, h, 0.5)
    const wide = gaussianBlur(gray, w, h, 2.0)

    // With wider sigma, center should be dimmer (more spread)
    expect(wide[4 * w + 4]).toBeLessThan(narrow[4 * w + 4])
    // With wider sigma, far pixels should be brighter
    expect(wide[4 * w + 2]).toBeGreaterThan(narrow[4 * w + 2])
  })
})

// ─── Stage 4: sobelWithDirection ───────────────────────────────────

describe('sobelWithDirection', () => {
  it('detects a vertical edge', () => {
    // 5x5 image: left half dark, right half bright
    const w = 5, h = 5
    const gray = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        gray[y * w + x] = x < 3 ? 0 : 255
      }
    }

    const { magnitude, direction } = sobelWithDirection(gray, w, h)
    // The edge should be at x=2 (boundary)
    const edgeIdx = 2 * w + 2 // y=2, x=2
    expect(magnitude[edgeIdx]).toBeGreaterThan(0)

    // Gradient is horizontal (pointing right) for a vertical edge → direction bin 0
    expect(direction[edgeIdx]).toBe(0)
  })

  it('detects a horizontal edge', () => {
    // 5x5 image: top half dark, bottom half bright
    const w = 5, h = 5
    const gray = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        gray[y * w + x] = y < 3 ? 0 : 255
      }
    }

    const { magnitude, direction } = sobelWithDirection(gray, w, h)
    const edgeIdx = 2 * w + 2
    expect(magnitude[edgeIdx]).toBeGreaterThan(0)
    // Gradient is vertical → direction bin 2
    expect(direction[edgeIdx]).toBe(2)
  })

  it('returns zero magnitude for a uniform image', () => {
    const w = 5, h = 5
    const gray = new Float32Array(w * h).fill(128)
    const { magnitude } = sobelWithDirection(gray, w, h)

    for (let i = 0; i < w * h; i++) {
      expect(magnitude[i]).toBe(0)
    }
  })
})

// ─── Stage 5: nonMaxSuppression ────────────────────────────────────

describe('nonMaxSuppression', () => {
  it('thins a 3px-wide horizontal band to 1px', () => {
    // 5x5, horizontal band at rows 1-3
    const w = 5, h = 5
    const magnitude = new Float32Array(w * h)
    const direction = new Uint8Array(w * h)

    // Band: rows 1, 2, 3 all have magnitude, row 2 is strongest
    for (let x = 1; x < w - 1; x++) {
      magnitude[1 * w + x] = 50
      magnitude[2 * w + x] = 100 // strongest
      magnitude[3 * w + x] = 50
      // Gradient direction = vertical (bin 2), so NMS compares top/bottom
      direction[1 * w + x] = 2
      direction[2 * w + x] = 2
      direction[3 * w + x] = 2
    }

    const thin = nonMaxSuppression(magnitude, direction, w, h)

    // Center row should survive (local max along vertical)
    for (let x = 1; x < w - 1; x++) {
      expect(thin[2 * w + x]).toBe(100)
      // Adjacent rows should be suppressed
      expect(thin[1 * w + x]).toBe(0)
      expect(thin[3 * w + x]).toBe(0)
    }
  })

  it('preserves isolated edge pixels', () => {
    const w = 5, h = 5
    const magnitude = zeros(w, h)
    const direction = new Uint8Array(w * h)
    magnitude[2 * w + 2] = 100
    direction[2 * w + 2] = 0 // horizontal gradient → check left/right

    const thin = nonMaxSuppression(magnitude, direction, w, h)
    expect(thin[2 * w + 2]).toBe(100) // no neighbors to compare → survives
  })
})

// ─── Stage 6: hysteresisThreshold ──────────────────────────────────

describe('hysteresisThreshold', () => {
  it('keeps strong pixels', () => {
    const w = 5, h = 5
    const edges = zeros(w, h)
    edges[2 * w + 2] = 100

    const binary = hysteresisThreshold(edges, w, h, 0.5)
    expect(binary[2 * w + 2]).toBe(1)
  })

  it('promotes weak pixels connected to strong pixels', () => {
    const w = 5, h = 5
    const edges = zeros(w, h)
    edges[2 * w + 2] = 100 // strong
    edges[2 * w + 3] = 30  // weak (above low threshold, below high)

    const binary = hysteresisThreshold(edges, w, h, 0.5)
    // Both should survive: strong + connected weak
    expect(binary[2 * w + 2]).toBe(1)
    expect(binary[2 * w + 3]).toBe(1)
  })

  it('removes isolated weak pixels', () => {
    const w = 7, h = 7
    const edges = zeros(w, h)
    edges[1 * w + 1] = 100 // strong in corner
    edges[5 * w + 5] = 30  // weak, far from any strong

    const binary = hysteresisThreshold(edges, w, h, 0.5)
    expect(binary[1 * w + 1]).toBe(1)
    expect(binary[5 * w + 5]).toBe(0)
  })

  it('returns empty for zero-magnitude input', () => {
    const w = 5, h = 5
    const edges = zeros(w, h)
    const binary = hysteresisThreshold(edges, w, h, 0.5)
    for (let i = 0; i < w * h; i++) {
      expect(binary[i]).toBe(0)
    }
  })

  it('higher sensitivity produces more edge pixels', () => {
    const w = 10, h = 10
    const edges = new Float32Array(w * h)
    // Create a gradient of edge strengths
    for (let i = 0; i < w * h; i++) {
      edges[i] = (i / (w * h)) * 100
    }

    const lowSens = hysteresisThreshold(edges, w, h, 0.3)
    const highSens = hysteresisThreshold(edges, w, h, 0.8)

    const countLow = lowSens.reduce((s, v) => s + v, 0)
    const countHigh = highSens.reduce((s, v) => s + v, 0)
    expect(countHigh).toBeGreaterThanOrEqual(countLow)
  })
})

// ─── Stage 7: traceEdgeChains ──────────────────────────────────────

describe('traceEdgeChains', () => {
  it('traces a horizontal line of edge pixels', () => {
    const w = 10, h = 5
    const binary = new Uint8Array(w * h)
    const direction = new Uint8Array(w * h)

    // Horizontal line at row 2
    for (let x = 2; x <= 7; x++) {
      binary[2 * w + x] = 1
      direction[2 * w + x] = 2 // vertical gradient → horizontal edge
    }

    const chains = traceEdgeChains(binary, direction, w, h, 2)
    expect(chains.length).toBeGreaterThanOrEqual(1)

    // Total points across all chains should cover most of the line
    const totalPoints = chains.reduce((s, c) => s + c.length, 0)
    expect(totalPoints).toBeGreaterThanOrEqual(4)
  })

  it('traces an L-shaped edge', () => {
    const w = 10, h = 10
    const binary = new Uint8Array(w * h)
    const direction = new Uint8Array(w * h)

    // Horizontal segment
    for (let x = 2; x <= 6; x++) {
      binary[3 * w + x] = 1
      direction[3 * w + x] = 2
    }
    // Vertical segment connected at (6,3)
    for (let y = 3; y <= 7; y++) {
      binary[y * w + 6] = 1
      direction[y * w + 6] = 0
    }

    const chains = traceEdgeChains(binary, direction, w, h, 2)
    const totalPoints = chains.reduce((s, c) => s + c.length, 0)
    // Should trace most of the L shape
    expect(totalPoints).toBeGreaterThanOrEqual(7)
  })

  it('respects minLength — discards short chains', () => {
    const w = 10, h = 5
    const binary = new Uint8Array(w * h)
    const direction = new Uint8Array(w * h)

    // Single isolated pixel
    binary[2 * w + 5] = 1

    const chains = traceEdgeChains(binary, direction, w, h, 2)
    // Single pixel = length 1, should be discarded with minLength=2
    expect(chains.length).toBe(0)
  })
})

// ─── Stage 8: bridgeGaps ──────────────────────────────────────────

describe('bridgeGaps', () => {
  it('merges two chains with close endpoints', () => {
    const chains = [
      [[0, 0], [1, 0], [2, 0]],
      [[4, 0], [5, 0], [6, 0]], // gap of 2px from chain 0 end
    ]
    const result = bridgeGaps(chains, 3)
    // Should merge into 1 chain
    expect(result.length).toBe(1)
    expect(result[0].length).toBe(6)
  })

  it('does not merge chains beyond maxGap', () => {
    const chains = [
      [[0, 0], [1, 0]],
      [[10, 0], [11, 0]], // gap of 9px
    ]
    const result = bridgeGaps(chains, 3)
    expect(result.length).toBe(2)
  })

  it('returns empty for empty input', () => {
    expect(bridgeGaps([], 3)).toEqual([])
  })
})

// ─── Stage 9: simplifyPath ─────────────────────────────────────────

describe('simplifyPath', () => {
  it('keeps endpoints of a 2-point path', () => {
    const points = [[0, 0], [10, 10]]
    const result = simplifyPath(points, 1.0)
    expect(result).toEqual([[0, 0], [10, 10]])
  })

  it('removes collinear intermediate points', () => {
    // 5 points on a straight line
    const points = [[0, 0], [2, 2], [4, 4], [6, 6], [8, 8]]
    const result = simplifyPath(points, 0.5)
    // Should reduce to just endpoints
    expect(result).toEqual([[0, 0], [8, 8]])
  })

  it('keeps a sharp corner point', () => {
    // L-shape: → then ↓
    const points = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]]
    const result = simplifyPath(points, 0.5)
    // Should keep the corner at (10, 0)
    const hasCorner = result.some(p => p[0] === 10 && p[1] === 0)
    expect(hasCorner).toBe(true)
  })

  it('smaller epsilon preserves more points', () => {
    // Slightly curved path
    const points = [[0, 0], [3, 1], [6, 0], [9, 1], [12, 0]]
    const coarse = simplifyPath(points, 2.0)
    const fine = simplifyPath(points, 0.3)
    expect(fine.length).toBeGreaterThanOrEqual(coarse.length)
  })
})

// ─── Stage 10: pathsToSvgD ─────────────────────────────────────────

describe('pathsToSvgD', () => {
  it('generates M/L commands for short paths (no smooth)', () => {
    const paths = [[[0, 0], [10, 10], [20, 5]]]
    const result = pathsToSvgD(paths, false)
    expect(result.length).toBe(1)
    expect(result[0]).toMatch(/^M0\.0,0\.0 L10\.0,10\.0 L20\.0,5\.0$/)
  })

  it('generates Bezier C commands for longer smooth paths', () => {
    const paths = [[[0, 0], [5, 3], [10, 0], [15, 3], [20, 0]]]
    const result = pathsToSvgD(paths, true)
    expect(result.length).toBe(1)
    expect(result[0]).toContain('C') // Should have cubic Bezier
    expect(result[0]).toMatch(/^M/)  // Starts with M
  })

  it('falls back to L commands for paths with < 4 points even when smooth=true', () => {
    const paths = [[[0, 0], [10, 10], [20, 5]]]
    const result = pathsToSvgD(paths, true)
    expect(result[0]).not.toContain('C')
    expect(result[0]).toContain('L')
  })

  it('filters out empty paths', () => {
    const paths = [[[0, 0]]] // single point
    const result = pathsToSvgD(paths, false)
    expect(result.length).toBe(0)
  })

  it('handles multiple paths', () => {
    const paths = [
      [[0, 0], [10, 10]],
      [[20, 20], [30, 30]],
    ]
    const result = pathsToSvgD(paths, false)
    expect(result.length).toBe(2)
  })
})

// ─── Stage 11: histogramEqualization ──────────────────────────────

describe('histogramEqualization', () => {
  it('stretches low-contrast image to full range', () => {
    const w = 10, h = 10
    const gray = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) gray[i] = 100 + (i / (w * h)) * 50

    const eq = histogramEqualization(gray, w, h)

    let min = 255, max = 0
    for (let i = 0; i < w * h; i++) {
      if (eq[i] < min) min = eq[i]
      if (eq[i] > max) max = eq[i]
    }
    expect(max - min).toBeGreaterThan(200)
  })

  it('preserves uniform image (all pixels stay equal)', () => {
    const w = 5, h = 5
    const gray = new Float32Array(w * h).fill(128)
    const eq = histogramEqualization(gray, w, h)
    const first = eq[0]
    for (let i = 1; i < w * h; i++) {
      expect(eq[i]).toBe(first)
    }
  })

  it('outputs values in 0–255 range', () => {
    const w = 8, h = 8
    const gray = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) gray[i] = (i / (w * h)) * 255
    const eq = histogramEqualization(gray, w, h)
    for (let i = 0; i < w * h; i++) {
      expect(eq[i]).toBeGreaterThanOrEqual(0)
      expect(eq[i]).toBeLessThanOrEqual(255)
    }
  })

  it('preserves monotonic ordering', () => {
    const w = 16, h = 1
    const gray = new Float32Array(w)
    for (let i = 0; i < w; i++) gray[i] = i * 16
    const eq = histogramEqualization(gray, w, h)
    for (let i = 1; i < w; i++) {
      expect(eq[i]).toBeGreaterThanOrEqual(eq[i - 1])
    }
  })
})

// ─── Stage 12: multiScaleCanny ────────────────────────────────────

describe('multiScaleCanny', () => {
  it('detects edges and returns matching binary/direction arrays', () => {
    const w = 20, h = 20
    const gray = new Float32Array(w * h)
    // Vertical edge at x=10
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        gray[y * w + x] = x < 10 ? 0 : 255
      }
    }

    const { binary, direction } = multiScaleCanny(gray, w, h, 0.5)
    expect(binary.length).toBe(w * h)
    expect(direction.length).toBe(w * h)

    const edgeCount = binary.reduce((s, v) => s + v, 0)
    expect(edgeCount).toBeGreaterThan(0)
  })

  it('finds more edges than single-scale at same sensitivity', () => {
    const w = 30, h = 30
    const gray = new Float32Array(w * h)
    // Image with both sharp and gradual edges
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        gray[y * w + x] = ((x + y) % 8 < 4) ? 50 : 200
      }
    }

    const { binary: multi } = multiScaleCanny(gray, w, h, 0.5, [0.7, 1.4, 2.8])
    const multiCount = multi.reduce((s, v) => s + v, 0)

    // Single scale
    const blurred = gaussianBlur(gray, w, h, 1.4)
    const { magnitude, direction } = sobelWithDirection(blurred, w, h)
    const thin = nonMaxSuppression(magnitude, direction, w, h)
    const singleBinary = hysteresisThreshold(thin, w, h, 0.5)
    const singleCount = singleBinary.reduce((s, v) => s + v, 0)

    expect(multiCount).toBeGreaterThanOrEqual(singleCount)
  })

  it('returns empty for uniform image', () => {
    const w = 10, h = 10
    const gray = new Float32Array(w * h).fill(128)
    const { binary } = multiScaleCanny(gray, w, h, 0.5)
    const count = binary.reduce((s, v) => s + v, 0)
    expect(count).toBe(0)
  })
})

// ─── Stage 13: traceLuminanceContours ─────────────────────────────

describe('traceLuminanceContours', () => {
  it('traces contours at brightness boundaries', () => {
    // Bright circle in dark background
    const w = 30, h = 30
    const gray = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dist = Math.sqrt((x - 15) ** 2 + (y - 15) ** 2)
        gray[y * w + x] = dist < 8 ? 200 : 30
      }
    }

    const chains = traceLuminanceContours(gray, w, h, [100])
    expect(chains.length).toBeGreaterThan(0)
    const totalPoints = chains.reduce((s, c) => s + c.length, 0)
    expect(totalPoints).toBeGreaterThan(10)
  })

  it('returns more contours with more levels', () => {
    const w = 30, h = 30
    const gray = new Float32Array(w * h)
    // Gradient image
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        gray[y * w + x] = (x / w) * 255
      }
    }

    const fewLevels = traceLuminanceContours(gray, w, h, [128])
    const manyLevels = traceLuminanceContours(gray, w, h, [64, 128, 192])
    expect(manyLevels.length).toBeGreaterThanOrEqual(fewLevels.length)
  })

  it('returns empty for uniform image', () => {
    const w = 10, h = 10
    const gray = new Float32Array(w * h).fill(128)
    const chains = traceLuminanceContours(gray, w, h, [100])
    expect(chains.length).toBe(0)
  })
})

// ─── Stage 14: generateHatching ───────────────────────────────────

describe('generateHatching', () => {
  it('produces hatching lines for dark regions', () => {
    const w = 40, h = 40
    const gray = new Float32Array(w * h).fill(30) // all dark

    const paths = generateHatching(gray, w, h, 80, 4)
    expect(paths.length).toBeGreaterThan(0)
  })

  it('produces no hatching for bright regions', () => {
    const w = 40, h = 40
    const gray = new Float32Array(w * h).fill(200) // all bright

    const paths = generateHatching(gray, w, h, 80, 4)
    expect(paths.length).toBe(0)
  })

  it('includes both horizontal and diagonal lines for very dark regions', () => {
    const w = 50, h = 50
    const gray = new Float32Array(w * h).fill(15) // very dark

    const paths = generateHatching(gray, w, h, 80, 4)

    // Check for horizontal paths (all points share same y)
    const hasHorizontal = paths.some(p => p.length > 1 && p.every(pt => pt[1] === p[0][1]))
    // Check for diagonal paths (points have varying y)
    const hasDiagonal = paths.some(p => p.length > 1 && !p.every(pt => pt[1] === p[0][1]))
    expect(hasHorizontal).toBe(true)
    expect(hasDiagonal).toBe(true)
  })

  it('respects spacing parameter', () => {
    const w = 40, h = 40
    const gray = new Float32Array(w * h).fill(30)

    const sparse = generateHatching(gray, w, h, 80, 8)
    const dense = generateHatching(gray, w, h, 80, 3)
    expect(dense.length).toBeGreaterThan(sparse.length)
  })
})

// ─── Stage 15: detectSkinRegions ──────────────────────────────────

describe('detectSkinRegions', () => {
  it('detects skin-toned pixels', () => {
    const w = 5, h = 5
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      // Typical skin tone: R~200, G~150, B~120
      data[o] = 200
      data[o + 1] = 150
      data[o + 2] = 120
      data[o + 3] = 255
    }

    const mask = detectSkinRegions(data, w, h)
    const skinCount = mask.reduce((s, v) => s + v, 0)
    expect(skinCount).toBeGreaterThan(0)
  })

  it('rejects blue pixels as non-skin', () => {
    const w = 5, h = 5
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      data[o] = 0
      data[o + 1] = 0
      data[o + 2] = 255
      data[o + 3] = 255
    }

    const mask = detectSkinRegions(data, w, h)
    const skinCount = mask.reduce((s, v) => s + v, 0)
    expect(skinCount).toBe(0)
  })

  it('rejects green pixels as non-skin', () => {
    const w = 5, h = 5
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      data[o] = 0
      data[o + 1] = 200
      data[o + 2] = 0
      data[o + 3] = 255
    }

    const mask = detectSkinRegions(data, w, h)
    expect(mask.reduce((s, v) => s + v, 0)).toBe(0)
  })

  it('detects darker skin tones', () => {
    const w = 5, h = 5
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      // Darker skin tone
      data[o] = 160
      data[o + 1] = 110
      data[o + 2] = 80
      data[o + 3] = 255
    }

    const mask = detectSkinRegions(data, w, h)
    const skinCount = mask.reduce((s, v) => s + v, 0)
    expect(skinCount).toBeGreaterThan(0)
  })

  it('returns correct-length mask', () => {
    const w = 10, h = 8
    const data = new Uint8ClampedArray(w * h * 4)
    const mask = detectSkinRegions(data, w, h)
    expect(mask.length).toBe(w * h)
  })
})

// ─── Stage 16: findSkinBoundingBox ────────────────────────────────

describe('findSkinBoundingBox', () => {
  it('returns bounding box for sufficient skin coverage', () => {
    const w = 20, h = 20
    const mask = new Uint8Array(w * h)
    // Fill center area (100 pixels = 25% of 400)
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) {
        mask[y * w + x] = 1
      }
    }

    const box = findSkinBoundingBox(mask, w, h)
    expect(box).not.toBeNull()
    expect(box.minX).toBe(5)
    expect(box.maxX).toBe(14)
    expect(box.minY).toBe(5)
    expect(box.maxY).toBe(14)
    expect(box.coverage).toBe(0.25)
  })

  it('returns null for insufficient skin coverage (<5%)', () => {
    const w = 100, h = 100
    const mask = new Uint8Array(w * h)
    // Only 3 pixels — well below 5% of 10000
    mask[50 * 100 + 50] = 1
    mask[50 * 100 + 51] = 1
    mask[50 * 100 + 52] = 1

    const box = findSkinBoundingBox(mask, w, h)
    expect(box).toBeNull()
  })

  it('returns null for empty mask', () => {
    const w = 10, h = 10
    const mask = new Uint8Array(w * h)
    expect(findSkinBoundingBox(mask, w, h)).toBeNull()
  })

  it('computes correct coverage ratio', () => {
    const w = 10, h = 10
    const mask = new Uint8Array(w * h)
    // Fill 10 pixels = 10%
    for (let i = 0; i < 10; i++) mask[i] = 1

    const box = findSkinBoundingBox(mask, w, h)
    expect(box).not.toBeNull()
    expect(box.coverage).toBeCloseTo(0.1, 2)
  })
})

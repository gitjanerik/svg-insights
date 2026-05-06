import { describe, it, expect } from 'vitest'
import { generateStipplePoints, rgbaToDensity } from './voronoiStippling.js'

function makeImage(w, h, fill = [200, 200, 200]) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = fill[0]
    rgba[i + 1] = fill[1]
    rgba[i + 2] = fill[2]
    rgba[i + 3] = 255
  }
  return rgba
}

function fillRect(rgba, w, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      rgba[i] = color[0]
      rgba[i + 1] = color[1]
      rgba[i + 2] = color[2]
    }
  }
}

describe('rgbaToDensity', () => {
  it('mørke piksler får høy tetthet', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255]) // svart
    const d = rgbaToDensity(rgba, 1, 1)
    expect(d[0]).toBeGreaterThan(0.9)
  })

  it('lyse piksler får lav tetthet (men ikke null)', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255])
    const d = rgbaToDensity(rgba, 1, 1)
    expect(d[0]).toBeGreaterThan(0)
    expect(d[0]).toBeLessThan(0.1)
  })
})

describe('generateStipplePoints', () => {
  it('genererer omtrent ønsket antall punkter', () => {
    const w = 40, h = 40
    const rgba = makeImage(w, h, [100, 100, 100])
    const points = generateStipplePoints(rgba, w, h, { numPoints: 100, iterations: 2 })
    expect(points.length).toBeGreaterThan(80)
    expect(points.length).toBeLessThanOrEqual(100)
  })

  it('alle punkter er innenfor bildet', () => {
    const w = 40, h = 40
    const rgba = makeImage(w, h, [100, 100, 100])
    const points = generateStipplePoints(rgba, w, h, { numPoints: 50, iterations: 3 })
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(w)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(h)
    }
  })

  it('punkter konsentrerer seg i mørke områder', () => {
    const w = 60, h = 60
    const rgba = makeImage(w, h, [240, 240, 240]) // lys bakgrunn
    fillRect(rgba, w, 10, 10, 30, 30, [0, 0, 0]) // mørkt rektangel i øvre venstre
    const points = generateStipplePoints(rgba, w, h, { numPoints: 100, iterations: 6, seed: 42 })
    // De fleste punktene skal havne i den mørke regionen
    let inDark = 0
    for (const p of points) {
      if (p.x >= 10 && p.x < 30 && p.y >= 10 && p.y < 30) inDark++
    }
    expect(inDark / points.length).toBeGreaterThan(0.5)
  })

  it('returnerer per-punkt weight basert på lokal density', () => {
    const w = 40, h = 40
    const rgba = makeImage(w, h, [100, 100, 100])
    const points = generateStipplePoints(rgba, w, h, { numPoints: 30, iterations: 2 })
    for (const p of points) {
      expect(p.weight).toBeGreaterThan(0)
      expect(p.weight).toBeLessThanOrEqual(1)
    }
  })

  it('deterministisk ved samme seed', () => {
    const w = 30, h = 30
    const rgba = makeImage(w, h, [120, 120, 120])
    const a = generateStipplePoints(rgba, w, h, { numPoints: 20, iterations: 2, seed: 999 })
    const b = generateStipplePoints(rgba, w, h, { numPoints: 20, iterations: 2, seed: 999 })
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBeCloseTo(b[i].x, 5)
      expect(a[i].y).toBeCloseTo(b[i].y, 5)
    }
  })

  it('kaller onProgress under iterasjonene', () => {
    const w = 30, h = 30
    const rgba = makeImage(w, h, [120, 120, 120])
    const progressValues = []
    generateStipplePoints(rgba, w, h, {
      numPoints: 20,
      iterations: 3,
      onProgress: p => progressValues.push(p),
    })
    expect(progressValues.length).toBeGreaterThan(2)
    expect(progressValues[0]).toBeLessThan(progressValues[progressValues.length - 1])
    expect(progressValues[progressValues.length - 1]).toBeCloseTo(1, 1)
  })
})

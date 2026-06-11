import { describe, it, expect } from 'vitest'
import {
  sampleElevation,
  sampleGradient,
  findHighestPoint,
  cropDem,
  packDem,
  unpackDem,
} from './demSampling.js'

// Helper: bygger en DEM med 4×4-grid og pixelWidth = 10m.
//   col=0 col=1 col=2 col=3
//   row 0:    [v0,  v1,  v2,  v3]   (svgY=0..10)
//   row 1:    [...]                 (svgY=10..20)
//   row 2:    [...]
//   row 3:    [...]
function makeDem(values, opts = {}) {
  const cols = opts.cols ?? 4
  const rows = opts.rows ?? 4
  return {
    data: new Float32Array(values),
    cols,
    rows,
    transform: {
      originX: 0,
      originY: 0,
      pixelWidth: opts.pixelWidth ?? 10,
      pixelHeight: opts.pixelHeight ?? 10,
    },
    noData: -9999,
  }
}

describe('sampleElevation', () => {
  it('returns exact grid value at integer cell centers', () => {
    const dem = makeDem([
      0, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 10, 11,
      12, 13, 14, 15,
    ])
    // col=0, row=0 → svg(0,0) = 0
    expect(sampleElevation(dem, 0, 0)).toBe(0)
    // col=2, row=1 → svg(20,10) = 6
    expect(sampleElevation(dem, 20, 10)).toBe(6)
    // col=3, row=3 → svg(30,30) = 15
    expect(sampleElevation(dem, 30, 30)).toBe(15)
  })

  it('bilinear-interpolates between grid points', () => {
    // 2×2 with values 0,10,20,30 — midt mellom (col=0.5, row=0.5) skal gi 15
    const dem = makeDem([
      0, 10,
      20, 30,
    ], { cols: 2, rows: 2 })
    expect(sampleElevation(dem, 5, 5)).toBeCloseTo(15, 6)
    // 1/4 av veien fra 0 mot 10 = 2.5
    expect(sampleElevation(dem, 2.5, 0)).toBeCloseTo(2.5, 6)
    // 1/4 av veien fra 0 mot 20 = 5
    expect(sampleElevation(dem, 0, 2.5)).toBeCloseTo(5, 6)
  })

  it('returns NaN for out-of-bounds coords', () => {
    const dem = makeDem([0, 1, 2, 3], { cols: 2, rows: 2 })
    expect(sampleElevation(dem, -1, 0)).toBeNaN()
    expect(sampleElevation(dem, 0, -1)).toBeNaN()
    expect(sampleElevation(dem, 100, 0)).toBeNaN()
    expect(sampleElevation(dem, 0, 100)).toBeNaN()
  })

  it('returns NaN if any of the 4 corners is noData', () => {
    const dem = makeDem([
      0, -9999,
      20, 30,
    ], { cols: 2, rows: 2 })
    expect(sampleElevation(dem, 5, 5)).toBeNaN()
  })
})

describe('sampleGradient', () => {
  it('returns zero gradient on flat terrain', () => {
    const dem = makeDem(new Array(16).fill(100))
    const g = sampleGradient(dem, 15, 15)
    expect(g.dzdx).toBe(0)
    expect(g.dzdy).toBe(0)
  })

  it('detects positive x-gradient on east-facing slope', () => {
    // Hver kolonne stiger 10m: col 0=0, col 1=10, col 2=20, col 3=30
    const dem = makeDem([
      0, 10, 20, 30,
      0, 10, 20, 30,
      0, 10, 20, 30,
      0, 10, 20, 30,
    ])
    const g = sampleGradient(dem, 15, 15)
    // dzdx = 10m endring per 10m = 1.0
    expect(g.dzdx).toBeCloseTo(1.0, 5)
    expect(g.dzdy).toBeCloseTo(0, 5)
  })

  it('detects positive y-gradient on south-facing slope', () => {
    // Hver rad stiger 10m
    const dem = makeDem([
      0, 0, 0, 0,
      10, 10, 10, 10,
      20, 20, 20, 20,
      30, 30, 30, 30,
    ])
    const g = sampleGradient(dem, 15, 15)
    expect(g.dzdx).toBeCloseTo(0, 5)
    expect(g.dzdy).toBeCloseTo(1.0, 5)
  })

  it('points toward the peak on a hill', () => {
    // 6×6 symmetrisk topp i sentrum. Sample øst for senter → gradient skal
    // peke vestover (negativ dzdx) siden terrenget faller mot øst.
    const dem = makeDem([
      0,  2,  4,  4,  2, 0,
      2,  6,  8,  8,  6, 2,
      4,  8, 10, 10,  8, 4,
      4,  8, 10, 10,  8, 4,
      2,  6,  8,  8,  6, 2,
      0,  2,  4,  4,  2, 0,
    ], { cols: 6, rows: 6 })
    // Sentrum er ved svg(30,30). Sample litt øst (svg=40,30).
    const g = sampleGradient(dem, 40, 30)
    expect(g.dzdx).toBeLessThan(0)
  })
})

describe('findHighestPoint', () => {
  it('locates the maximum cell center', () => {
    const dem = makeDem([
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 99, // toppen er nederst-høyre (col=3, row=3)
    ])
    const peak = findHighestPoint(dem)
    expect(peak).not.toBeNull()
    expect(peak.elevation).toBe(99)
    // Cell-senter: (3+0.5)*10 = 35
    expect(peak.svgX).toBe(35)
    expect(peak.svgY).toBe(35)
  })

  it('ignores noData values', () => {
    const dem = makeDem([
      1, 2,
      -9999, 3, // -9999 er ikke høyeste (3 er det)
    ], { cols: 2, rows: 2 })
    const peak = findHighestPoint(dem)
    expect(peak.elevation).toBe(3)
  })

  it('returns null if all values are noData', () => {
    const dem = makeDem([-9999, -9999, -9999, -9999], { cols: 2, rows: 2 })
    expect(findHighestPoint(dem)).toBeNull()
  })
})

describe('cropDem', () => {
  // 4×4-grid, pixelWidth=10 → 40×40 m kart.
  const full = makeDem([
    0, 1, 2, 3,
    4, 5, 6, 7,
    8, 9, 10, 11,
    12, 13, 14, 15,
  ])

  it('extracts a centered 2×2 sub-grid with its own origin', () => {
    // Sentrert 20×20 m kvadrat → offset (10,10), 2×2 celler fra (col1,row1).
    const sub = cropDem(full, 10, 10, 20)
    expect(sub.cols).toBe(2)
    expect(sub.rows).toBe(2)
    expect(Array.from(sub.data)).toEqual([5, 6, 9, 10])
    // sample(0,0) på utklippet == sample(10,10) på kilden == 5.
    expect(sampleElevation(sub, 0, 0)).toBe(5)
    expect(sampleElevation(full, 10, 10)).toBe(5)
  })

  it('keeps pixel size so meter-coords still map correctly', () => {
    const sub = cropDem(full, 10, 10, 20)
    expect(sub.transform.pixelWidth).toBe(10)
    expect(sub.transform.pixelHeight).toBe(10)
    // sample(10,10) på utklippet == sample(20,20) på kilden == 10.
    expect(sampleElevation(sub, 10, 10)).toBe(10)
  })

  it('clamps the window to the grid extent', () => {
    // Be om mer enn kartet rommer → klippes til tilgjengelige celler.
    const sub = cropDem(full, 20, 20, 100)
    expect(sub.cols).toBe(2)
    expect(sub.rows).toBe(2)
    expect(Array.from(sub.data)).toEqual([10, 11, 14, 15])
  })

  it('returns the source DEM unchanged when the window degenerates', () => {
    expect(cropDem(full, 40, 40, 10)).toBe(full)
  })
})

describe('packDem / unpackDem', () => {
  it('roundtrips DEM via ArrayBuffer', () => {
    const original = makeDem([0, 10, 20, 30], { cols: 2, rows: 2 })
    const packed = packDem(original)
    expect(packed.buffer).toBeInstanceOf(ArrayBuffer)
    const restored = unpackDem(packed)
    expect(restored.cols).toBe(original.cols)
    expect(restored.rows).toBe(original.rows)
    expect(restored.transform.pixelWidth).toBe(original.transform.pixelWidth)
    expect(Array.from(restored.data)).toEqual(Array.from(original.data))
  })
})

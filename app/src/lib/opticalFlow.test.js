import { describe, it, expect } from 'vitest'
import { trackFeature, trackFeatures, buildTracks } from './opticalFlow.js'

// Hjelper: lag et bilde med en bløt blob (Gaussian-aktig) sentrert på (cx, cy).
// Gir en glatt intensitet-overgang med god gradient — egnet for LK.
function gaussianBlob(w, h, cx, cy, sigma = 4) {
  const luma = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      const dy = y - cy
      luma[y * w + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
    }
  }
  return luma
}

function makeFrame(w, h, luma) {
  return { width: w, height: h, luma }
}

describe('trackFeature', () => {
  it('finner null-bevegelse mellom identiske bilder', () => {
    const w = 40, h = 40
    const luma = gaussianBlob(w, h, 20, 20, 5)
    const r = trackFeature(luma, luma, w, h, 20, 20)
    expect(r.ok).toBe(true)
    expect(Math.abs(r.x - 20)).toBeLessThan(0.1)
    expect(Math.abs(r.y - 20)).toBeLessThan(0.1)
  })

  it('rekonstruerer en sub-pixel translasjon', () => {
    const w = 50, h = 50
    const prev = gaussianBlob(w, h, 25, 25, 5)
    const curr = gaussianBlob(w, h, 26.5, 24.3, 5)
    const r = trackFeature(prev, curr, w, h, 25, 25, { patchRadius: 6, maxIter: 6 })
    expect(r.ok).toBe(true)
    expect(r.x).toBeCloseTo(26.5, 0) // innen 1 pixel
    expect(r.y).toBeCloseTo(24.3, 0)
  })

  it('returnerer ok=false når patchen mangler gradient', () => {
    const w = 30, h = 30
    const flat = new Float32Array(w * h).fill(0.5)
    const r = trackFeature(flat, flat, w, h, 15, 15)
    expect(r.ok).toBe(false)
  })
})

describe('trackFeatures', () => {
  it('sporer en liste features mellom to frames', () => {
    const w = 60, h = 60
    const prev = gaussianBlob(w, h, 30, 30, 5)
    const curr = gaussianBlob(w, h, 32, 30, 5)
    const features = [{ x: 30, y: 30 }]
    const tracked = trackFeatures(makeFrame(w, h, prev), makeFrame(w, h, curr), features, { patchRadius: 6 })
    expect(tracked.length).toBe(1)
    expect(tracked[0].x).toBeCloseTo(32, 0)
  })
})

describe('buildTracks', () => {
  it('bygger tracks gjennom flere frames', () => {
    const w = 80, h = 80
    const frames = []
    // Blob som beveger seg 1 pixel pr frame i x-retning
    for (let i = 0; i < 5; i++) {
      frames.push(makeFrame(w, h, gaussianBlob(w, h, 30 + i, 40, 5)))
    }
    const tracks = buildTracks(frames, [{ x: 30, y: 40 }], { patchRadius: 6 })
    expect(tracks.length).toBe(1)
    expect(tracks[0].points.length).toBe(5)
    const last = tracks[0].points[4]
    expect(last.x).toBeCloseTo(34, 0)
    expect(last.y).toBeCloseTo(40, 0)
  })

  it('dropper tracks som mister konvergens', () => {
    const w = 80, h = 80
    const frames = [
      makeFrame(w, h, gaussianBlob(w, h, 40, 40, 5)),
      makeFrame(w, h, new Float32Array(w * h).fill(0.5)), // helt flat — ingen tracking mulig
    ]
    // Streng residual-terskel slik at tracking-feilen er deterministisk:
    const tracks = buildTracks(frames, [{ x: 40, y: 40 }], { patchRadius: 6, maxResidual: 0.02 })
    expect(tracks[0].points.length).toBe(1)
    expect(tracks[0].alive).toBe(false)
  })
})

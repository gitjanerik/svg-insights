import { describe, it, expect } from 'vitest'
import {
  computeGradients,
  harrisResponse,
  nonMaxSuppression,
  detectFeatures,
} from './featureDetection.js'

// Hjelper: lag et flatt grått bilde (uten features)
function flatImage(w, h, value = 0.5) {
  const luma = new Float32Array(w * h)
  for (let i = 0; i < luma.length; i++) luma[i] = value
  return luma
}

// Hjelper: lag et bilde med ett tydelig hjørne (en mørk firkant på lys bakgrunn)
function imageWithCorner(w, h, cx, cy, size = 10) {
  const luma = flatImage(w, h, 1.0)
  for (let y = cy; y < cy + size && y < h; y++) {
    for (let x = cx; x < cx + size && x < w; x++) {
      luma[y * w + x] = 0.0
    }
  }
  return luma
}

describe('computeGradients', () => {
  it('returnerer null-gradienter for et flatt bilde', () => {
    const luma = flatImage(20, 20)
    const { Ix, Iy } = computeGradients(luma, 20, 20)
    for (let i = 0; i < Ix.length; i++) {
      expect(Ix[i]).toBe(0)
      expect(Iy[i]).toBe(0)
    }
  })

  it('finner horisontal gradient ved en vertikal kant', () => {
    const w = 10, h = 10
    const luma = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        luma[y * w + x] = x < 5 ? 0 : 1
      }
    }
    const { Ix, Iy } = computeGradients(luma, w, h)
    // Iy skal være ca. 0 (ingen vertikal endring), Ix skal være sterk ved x=4..5
    expect(Math.abs(Iy[5 * w + 4])).toBeLessThan(0.01)
    expect(Ix[5 * w + 4]).toBeGreaterThan(0.4)
  })
})

describe('detectFeatures', () => {
  it('finner ingen features i et flatt bilde', () => {
    const luma = flatImage(40, 40)
    const features = detectFeatures(luma, 40, 40)
    expect(features.length).toBe(0)
  })

  it('finner et hjørne på en firkant', () => {
    const w = 60, h = 60
    const luma = imageWithCorner(w, h, 20, 20, 15)
    const features = detectFeatures(luma, w, h, { maxFeatures: 10, nmsRadius: 4, margin: 5 })
    // En firkant har 4 hjørner — vi bør finne minst 2 av dem (avhengig av margin og NMS)
    expect(features.length).toBeGreaterThanOrEqual(2)
    expect(features.length).toBeLessThanOrEqual(4)
  })

  it('respekterer maxFeatures', () => {
    const w = 60, h = 60
    const luma = imageWithCorner(w, h, 20, 20, 15)
    const features = detectFeatures(luma, w, h, { maxFeatures: 2, nmsRadius: 4, margin: 5 })
    expect(features.length).toBeLessThanOrEqual(2)
  })
})

describe('nonMaxSuppression', () => {
  it('filtrerer bort verdier under terskel', () => {
    const w = 10, h = 10
    const response = new Float32Array(w * h)
    response[5 * w + 5] = 0.001
    const peaks = nonMaxSuppression(response, w, h, { radius: 2, threshold: 0.1 })
    expect(peaks.length).toBe(0)
  })

  it('returnerer kun lokale maks', () => {
    const w = 20, h = 20
    const response = new Float32Array(w * h)
    response[5 * w + 5] = 1.0
    response[5 * w + 6] = 0.5 // mindre, skal undertrykkes
    response[15 * w + 15] = 0.8
    const peaks = nonMaxSuppression(response, w, h, { radius: 3, threshold: 0.1 })
    expect(peaks.length).toBe(2)
    expect(peaks.find(p => p.x === 5 && p.y === 5)).toBeDefined()
    expect(peaks.find(p => p.x === 15 && p.y === 15)).toBeDefined()
  })
})

describe('harrisResponse', () => {
  it('gir høyere respons ved hjørner enn ved kanter', () => {
    const w = 30, h = 30
    // Bilde med ett hjørne
    const luma = imageWithCorner(w, h, 10, 10, 8)
    const { Ix, Iy } = computeGradients(luma, w, h)
    const response = harrisResponse(Ix, Iy, w, h)
    // Respons ved hjørnet (rundt (10, 10)) skal være positiv og betydelig
    let cornerMax = 0
    for (let y = 8; y < 13; y++) {
      for (let x = 8; x < 13; x++) {
        cornerMax = Math.max(cornerMax, response[y * w + x])
      }
    }
    // Respons midt på en kant (rundt (10, 14) — på toppkanten av firkanten)
    let edgeMax = 0
    for (let x = 13; x < 17; x++) {
      edgeMax = Math.max(edgeMax, response[10 * w + x])
    }
    expect(cornerMax).toBeGreaterThan(edgeMax)
  })
})

import { describe, it, expect } from 'vitest'
import { wireframeToSvg } from './wireframeToSvg.js'

describe('wireframeToSvg', () => {
  it('returnerer null for tom punktsky', () => {
    expect(wireframeToSvg({ points: [], edges: [] })).toBeNull()
  })

  it('genererer SVG med viewBox men uten width/height', () => {
    const points = [
      { X: 0, Y: 0, Z: 0 },
      { X: 1, Y: 1, Z: 1 },
    ]
    const edges = [{ a: 0, b: 1, length: 1 }]
    const svg = wireframeToSvg({ points, edges })
    expect(svg).toContain('viewBox=')
    expect(svg).not.toMatch(/\swidth=/)
    expect(svg).not.toMatch(/\sheight=/)
  })

  it('inkluderer både linjer og sirkler som standard', () => {
    const points = [
      { X: 0, Y: 0, Z: 0 },
      { X: 1, Y: 1, Z: 1 },
    ]
    const edges = [{ a: 0, b: 1, length: 1 }]
    const svg = wireframeToSvg({ points, edges })
    expect(svg).toContain('<line')
    expect(svg).toContain('<circle')
  })

  it('utelater punkter når includePoints=false', () => {
    const points = [
      { X: 0, Y: 0, Z: 0 },
      { X: 1, Y: 1, Z: 1 },
    ]
    const edges = [{ a: 0, b: 1, length: 1 }]
    const svg = wireframeToSvg({ points, edges, includePoints: false })
    expect(svg).not.toContain('<circle')
    expect(svg).toContain('<line')
  })

  it('inkluderer animateTransform når animateRotation=true', () => {
    const points = [
      { X: 0, Y: 0, Z: 0 },
      { X: 1, Y: 1, Z: 1 },
    ]
    const svg = wireframeToSvg({ points, edges: [], animateRotation: true })
    expect(svg).toContain('animateTransform')
    expect(svg).toContain('repeatCount="indefinite"')
  })

  it('inkluderer skala-tekst når kalibrering er gitt', () => {
    const points = [
      { X: 0, Y: 0, Z: 0 },
      { X: 1, Y: 1, Z: 1 },
    ]
    const svg = wireframeToSvg({
      points,
      edges: [],
      scaleCalibration: { factorMeters: 0.42 },
    })
    expect(svg).toContain('Skala: 1 enhet ≈ 0.42 m')
  })
})

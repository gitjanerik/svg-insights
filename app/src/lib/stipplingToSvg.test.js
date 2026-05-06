import { describe, it, expect } from 'vitest'
import { stipplingToSvg } from './stipplingToSvg.js'

const palette = {
  bg: '#FF6B9D',
  outline: '#000000',
}

const samplePoints = [
  { x: 10, y: 10, weight: 0.2 },
  { x: 50, y: 30, weight: 0.8 },
  { x: 80, y: 90, weight: 0.5 },
]

describe('stipplingToSvg', () => {
  it('returnerer null for tom punktliste', () => {
    expect(stipplingToSvg({ points: [], width: 100, height: 100, palette })).toBeNull()
    expect(stipplingToSvg({ points: null, width: 100, height: 100, palette })).toBeNull()
  })

  it('genererer SVG med viewBox og bakgrunn', () => {
    const svg = stipplingToSvg({ points: samplePoints, width: 100, height: 100, palette })
    expect(svg).toContain('viewBox="0 0 100 100"')
    expect(svg).toContain('fill="#FF6B9D"') // bg
  })

  it('genererer en sirkel pr punkt i stippling-modus', () => {
    const svg = stipplingToSvg({ points: samplePoints, width: 100, height: 100, palette, mode: 'stippling' })
    const circles = svg.match(/<circle/g) || []
    expect(circles.length).toBe(3)
  })

  it('halftone-modus varierer sirkel-radius med weight', () => {
    const svg = stipplingToSvg({ points: samplePoints, width: 100, height: 100, palette, mode: 'halftone' })
    // Skal ha minst tre sirkler med forskjellige r-verdier
    const radii = [...svg.matchAll(/r="([\d.]+)"/g)].map(m => parseFloat(m[1]))
    const uniqueRadii = new Set(radii.map(r => r.toFixed(2)))
    expect(uniqueRadii.size).toBeGreaterThanOrEqual(3)
  })

  it('hybrid-modus tegner overlay-prikker for høy weight', () => {
    const svg = stipplingToSvg({ points: samplePoints, width: 100, height: 100, palette, mode: 'hybrid' })
    const circles = svg.match(/<circle/g) || []
    // Base-laget = 3 prikker, pluss minst 1 overlay (weight=0.8 > 0.55)
    expect(circles.length).toBeGreaterThanOrEqual(4)
  })

  it('bruker palettens outline-farge på prikkene', () => {
    const customPalette = { bg: '#000', outline: '#FFD400' }
    const svg = stipplingToSvg({ points: samplePoints, width: 100, height: 100, palette: customPalette })
    expect(svg).toContain('fill="#FFD400"')
  })
})

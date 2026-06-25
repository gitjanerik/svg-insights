import { describe, it, expect } from 'vitest'
import { buildReliefBands } from './reliefBands.js'

// Lag et syntetisk shade-raster (computeHillshade-form): RGBA der R=G=B=lyshet.
// En diagonal rampe 0..255 gir flere distinkte bånd.
function rampShade(cols, rows) {
  const rgba = new Uint8ClampedArray(cols * rows * 4)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = Math.round(((c + r) / (cols + rows - 2)) * 255)
      const o = (r * cols + c) * 4
      rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255
    }
  }
  return { rgba, cols, rows }
}

describe('buildReliefBands', () => {
  const shade = rampShade(40, 40)
  const opts = { bands: 5, blend: 'multiply', widthM: 1000, heightM: 1000 }

  it('produserer inntil `bands` bånd, hver med gyldig path', () => {
    const bands = buildReliefBands(shade, opts)
    expect(bands.length).toBeGreaterThan(0)
    expect(bands.length).toBeLessThanOrEqual(5)
    for (const b of bands) {
      expect(typeof b.d).toBe('string')
      expect(b.d.startsWith('M')).toBe(true)
      expect(b.fillOpacity).toBeGreaterThan(0)
      expect(b.fillOpacity).toBeLessThanOrEqual(1)
    }
  })

  it('bånd 0 dekker hele kartet (rektangel) og er mørkest i multiply', () => {
    const bands = buildReliefBands(shade, opts)
    expect(bands[0].d).toContain('M0,0L1000,0L1000,1000L0,1000Z')
    expect(bands[0].fill).toBe('#000000')
    // Mørkest først: alfa synker med båndindeks i multiply-modus.
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].fillOpacity).toBeLessThan(bands[i - 1].fillOpacity)
    }
  })

  it('screen-modus gir hvitt overlegg med stigende alfa', () => {
    const bands = buildReliefBands(shade, { ...opts, blend: 'screen' })
    for (const b of bands) expect(b.fill).toBe('#ffffff')
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].fillOpacity).toBeGreaterThan(bands[i - 1].fillOpacity)
    }
  })

  it('skalerer koordinater til meter-rommet (widthM/heightM)', () => {
    const bands = buildReliefBands(shade, { ...opts, widthM: 2000, heightM: 500 })
    expect(bands[0].d).toContain('M0,0L2000,0L2000,500L0,500Z')
  })
})

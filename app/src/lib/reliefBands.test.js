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

  it('bånd 0 er mørkest i multiply, og alfa synker med båndindeks', () => {
    const bands = buildReliefBands(shade, opts)
    expect(bands[0].fill).toBe('#000000')
    // Mørkest først: alfa synker med båndindeks i multiply-modus.
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].fillOpacity).toBeLessThan(bands[i - 1].fillOpacity)
    }
  })

  it('fyller IKKE hjørnene på flatt/lyst terreng (ingen hjørne-trekant-artefakt)', () => {
    // Regresjon for den vedvarende hjørne-trekant-feilen: på terreng der hele
    // rasteret er lyst (skygge ≫ terskel) skal det mørkeste båndet (0) være tomt
    // i hjørnene. Tidligere ga ulik glatting av to hele-raster-rammer fire mørke
    // trekanter; nå emitteres ramme-ringer som ett eksakt rektangel som kanselleres.
    const flat = (() => {
      const c = 60, r = 60, rgba = new Uint8ClampedArray(c * r * 4)
      for (let i = 0; i < c * r; i++) { const v = 190; const o = i * 4; rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255 }
      return { rgba, cols: c, rows: r }
    })()
    const bands = buildReliefBands(flat, { bands: 5, blend: 'multiply', widthM: 1000, heightM: 1000 })
    // punkt-i-polygon (even-odd) over alle subpaths
    const inPath = (d, px, py) => {
      let inside = false
      for (const s of d.split('M').filter(Boolean)) {
        const pts = ('M' + s).replace(/Z/g, '').slice(1).split('L').map((p) => p.split(',').map(Number))
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i]; const [xj, yj] = pts[j]
          if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
        }
      }
      return inside
    }
    for (const [x, y] of [[15, 15], [985, 15], [15, 985], [985, 985]]) {
      expect(inPath(bands[0].d, x, y)).toBe(false)
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
    // Ramp-shaden dekker hele rasteret → region-ringene når ut mot kant-meterne.
    const allD = bands.map((b) => b.d).join('')
    const xs = [...allD.matchAll(/[ML](\d+(?:\.\d+)?),/g)].map((m) => parseFloat(m[1]))
    const ys = [...allD.matchAll(/,(\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]))
    expect(Math.max(...xs)).toBeGreaterThan(1500)   // nær widthM=2000
    expect(Math.max(...xs)).toBeLessThanOrEqual(2000)
    expect(Math.max(...ys)).toBeGreaterThan(400)    // nær heightM=500
    expect(Math.max(...ys)).toBeLessThanOrEqual(500)
  })
})

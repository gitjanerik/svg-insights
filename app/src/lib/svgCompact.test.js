// v12.0.17 — SVG-slanking fase 1: heltalls-konturer, kompakt whitespace og
// 307-dybdefyll via CSS-klasse. Bygger et lite syntetisk kart og asserter på
// output-strengen (samme mønster som mapBuilder.bbox.test.js — ingen DOM).
import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'
import { syntheticDEM } from './dem.js'

const bbox = { south: 59, north: 59.05, west: 10, east: 10.09 }

function dem() {
  return syntheticDEM(600, 600, { originX: 0, originY: 0, pixelWidth: 10, pixelHeight: 10 },
    [{ x: 3000, y: 3000, h: 400, sigma: 60 }], 0)
}

const { svg } = buildSvg([], bbox, { dem: dem(), contourIntervalM: 20 })

describe('heltalls-koordinater for konturer (v12.0.17)', () => {
  it('kontur-d-attributter har ingen desimaler', () => {
    const konturPaths = [...svg.matchAll(/<g[^>]*data-iso="10[12]"[^>]*>([\s\S]*?)<\/g>/g)]
      .flatMap(m => [...m[1].matchAll(/ d="([^"]+)"/g)].map(x => x[1]))
    expect(konturPaths.length).toBeGreaterThan(0)
    for (const d of konturPaths) {
      expect(d).not.toMatch(/\d\.\d/)
    }
  })
})

describe('kompakt output (v12.0.17)', () => {
  it('default: ingen innrykk foran elementer, men fortsatt én per linje', () => {
    expect(svg).not.toMatch(/\n +</)
    expect(svg).toContain('\n<g')
  })
  it('options.pretty beholder innrykk for debugging', () => {
    const pretty = buildSvg([], bbox, { dem: dem(), contourIntervalM: 20, pretty: true }).svg
    expect(pretty).toMatch(/\n +</)
  })
})

describe('307-dybdefyll via CSS-klasse (v12.0.17)', () => {
  it('dybdepolygoner får class="dyp-N" i stedet for inline fill-style', () => {
    const ll = (pairs) => pairs.map(([lat, lon]) => ({ lat, lon }))
    const depth = {
      type: 'way', id: 2, _source: 'sjokart',
      tags: { sjokart: 'dybdeareal', minDybde: '0', maxDybde: '2' },
      geometry: ll([[59.905, 10.765], [59.915, 10.765], [59.915, 10.775], [59.905, 10.775], [59.905, 10.765]]),
    }
    const marBbox = { south: 59.90, north: 59.92, west: 10.74, east: 10.78 }
    const out = buildSvg([depth], marBbox, { useReal: false }).svg
    const m = /<g[^>]*data-iso="307"[^>]*>([\s\S]*?)<\/g>/.exec(out)
    expect(m).toBeTruthy()
    expect(m[1]).toContain('class="dyp-1"')
    expect(m[1]).toContain('data-dybde="1"')
    expect(m[1]).not.toContain('style="fill')
    // CSS-regelen for klassen emitteres når 307 er i bruk
    expect(out).toContain('[data-iso="307"] path.dyp-1 { fill: var(--iso-depth-1')
  })
})

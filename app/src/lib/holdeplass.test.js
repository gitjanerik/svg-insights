import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'
import { classifyToIsom, buildIsomDefs, isomCatalog } from './symbolizer.js'

// ISOM-derivert 560: buss-/tog-holdeplass. Klassifisering + rendering.
// Brukes av «nærmeste holdeplass»-snarveien i kart-søket.

const bbox = { south: 59.0, west: 10.0, north: 59.05, east: 10.1 }
const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags })

describe('classifyToIsom — holdeplass (560)', () => {
  const cases = [
    [{ highway: 'bus_stop' }, '560'],
    [{ railway: 'station' }, '560'],
    [{ railway: 'halt' }, '560'],
    [{ railway: 'tram_stop' }, '560'],
    [{ public_transport: 'station' }, '560'],
  ]
  for (const [tags, code] of cases) {
    it(`${JSON.stringify(tags)} → ${code}`, () => {
      expect(classifyToIsom({ type: 'node', tags })).toEqual({ code, cat: 'point' })
    })
  }
})

describe('isomCatalog — holdeplass-symbol', () => {
  it('holdeplass finnes som point-symbol og registreres', () => {
    expect(isomCatalog.pointSymbols.holdeplass).toBeTruthy()
    const { symbolIds } = buildIsomDefs(isomCatalog)
    expect(symbolIds.get('holdeplass')).toBe('iso-sym-holdeplass')
  })
})

describe('buildSvg — holdeplass rendres', () => {
  it('bus_stop-node → data-layer="holdeplass" med upright <use>', () => {
    const stop = node(1, 59.025, 10.05, { highway: 'bus_stop', name: 'Torget' })
    const { svg, counts } = buildSvg([stop], bbox, {})
    expect(counts.holdeplass).toBe(1)
    expect(svg).toContain('data-layer="holdeplass"')
    expect(svg).toContain('data-iso="560"')
    // Symbolet skal være rotasjons-stabilt (data-upright) og bære navnet for chip-en
    const m = svg.match(/<g data-layer="holdeplass"[^>]*>([\s\S]*?)<\/g>\s*<\/g>/)
    expect(m).toBeTruthy()
    expect(m[1]).toContain('data-upright="1"')
    expect(m[1]).toContain('data-name="Torget"')
    expect(m[1]).toContain('href="#iso-sym-holdeplass"')
  })
})

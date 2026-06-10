import { describe, it, expect } from 'vitest'
import { ringsToWkt, ringsToBboxWkt, parseSpeciesFacet } from './gbifSpecies.js'

describe('ringsToWkt', () => {
  it('bygger en lukket CCW POLYGON fra en CW-ring', () => {
    // CW-ring (med klokka i lon/lat): GBIF vil ha CCW → skal reverseres.
    const cw = [[0, 0], [0, 1], [1, 1], [1, 0]]
    const wkt = ringsToWkt([cw])
    expect(wkt).toMatch(/^POLYGON\(\(/)
    expect(wkt.endsWith('))')).toBe(true)
    // Lukket: første og siste koordinat like.
    const coords = wkt.slice('POLYGON(('.length, -2).split(', ')
    expect(coords[0]).toBe(coords[coords.length - 1])
    // CW-ringen reverseres til CCW → [1,0] blir start, [1,1] blir andre punkt.
    expect(coords[0]).toBe('1 0')
    expect(coords[1]).toBe('1 1')
  })

  it('beholder en allerede CCW-ring', () => {
    const ccw = [[0, 0], [1, 0], [1, 1], [0, 1]]
    const coords = ringsToWkt([ccw]).slice('POLYGON(('.length, -2).split(', ')
    expect(coords[1]).toBe('1 0')
  })

  it('desimerer ned til maks punktantall', () => {
    const big = []
    for (let i = 0; i < 1000; i++) big.push([i * 0.001, Math.sin(i) * 0.001])
    const coords = ringsToWkt([big], 50).slice('POLYGON(('.length, -2).split(', ')
    // <= maxPoints (+1 for lukking)
    expect(coords.length).toBeLessThanOrEqual(51)
  })

  it('returnerer null for ugyldige ringer', () => {
    expect(ringsToWkt([])).toBeNull()
    expect(ringsToWkt([[[0, 0], [1, 1]]])).toBeNull()
    expect(ringsToWkt(null)).toBeNull()
  })
})

describe('ringsToBboxWkt', () => {
  it('omslutter alle ringer i en rektangel-WKT', () => {
    const wkt = ringsToBboxWkt([[[1, 2], [3, 2], [3, 5], [1, 5]]])
    expect(wkt).toBe('POLYGON((1 2, 3 2, 3 5, 1 5, 1 2))')
  })
  it('returnerer null uten gyldige punkter', () => {
    expect(ringsToBboxWkt([])).toBeNull()
  })
})

describe('parseSpeciesFacet', () => {
  it('teller distinkte arter og henter ut speciesKeys fra facet', () => {
    const json = { facets: [{ field: 'SPECIES_KEY', counts: [{ name: '1', count: 9 }, { name: '2', count: 3 }] }] }
    expect(parseSpeciesFacet(json)).toEqual({ speciesCount: 2, capped: false, keys: [1, 2] })
  })
  it('flagger capped når facet treffer grensen (500)', () => {
    const counts = Array.from({ length: 500 }, (_, i) => ({ name: String(i), count: 1 }))
    expect(parseSpeciesFacet({ facets: [{ field: 'speciesKey', counts }] }).capped).toBe(true)
  })
  it('håndterer manglende facet', () => {
    expect(parseSpeciesFacet({})).toEqual({ speciesCount: 0, capped: false, keys: [] })
  })
})

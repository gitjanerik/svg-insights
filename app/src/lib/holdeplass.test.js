import { describe, it, expect } from 'vitest'
import { buildSvg, clusterHoldeplasser, HOLDEPLASS_MIN_SEP_M } from './mapBuilder.js'
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

describe('clusterHoldeplasser — tett klynge tynnes til midterste', () => {
  // Meter → grader rundt lat ~59 (ekvirektangulær, samme som metersBetween).
  const lat0 = 59.025
  const M_PER_DEG_LAT = 111195
  const m2dLat = (m) => m / M_PER_DEG_LAT
  const m2dLon = (m) => m / (M_PER_DEG_LAT * Math.cos(lat0 * Math.PI / 180))
  // Node `i` plassert `m` meter øst for et basispunkt (langs «samme gate»).
  const eastNode = (id, m, tags = { highway: 'bus_stop' }) =>
    node(id, lat0, 10.05 + m2dLon(m), tags)

  it('to noder < 25 m fra hverandre → kun én beholdes', () => {
    const reps = clusterHoldeplasser([eastNode(1, 0), eastNode(2, 15)])
    expect(reps).toHaveLength(1)
  })

  it('to noder ≥ 25 m fra hverandre → begge beholdes (f.eks. hver side av jernbane)', () => {
    const reps = clusterHoldeplasser([eastNode(1, 0), eastNode(2, 30)])
    expect(reps).toHaveLength(2)
  })

  it('tett terminal-klynge (5 lommer à 5 m) → den midterste representanten', () => {
    const cluster = [0, 5, 10, 15, 20].map((m, i) => eastNode(i + 1, m))
    const reps = clusterHoldeplasser(cluster)
    expect(reps).toHaveLength(1)
    expect(reps[0].id).toBe(3) // midten (tyngdepunkt ≈ 10 m)
  })

  it('to separate terminaler 200 m fra hverandre → én representant hver', () => {
    const a = [0, 10, 20].map((m, i) => eastNode(i + 1, m))
    const b = [200, 210, 220].map((m, i) => eastNode(i + 10, m))
    const reps = clusterHoldeplasser([...a, ...b])
    expect(reps).toHaveLength(2)
  })

  it('tom/enkelt-input håndteres', () => {
    expect(clusterHoldeplasser([])).toEqual([])
    expect(clusterHoldeplasser([eastNode(1, 0)])).toHaveLength(1)
  })

  it('terskelen er 25 m', () => {
    expect(HOLDEPLASS_MIN_SEP_M).toBe(25)
  })
})

describe('buildSvg — holdeplass-klynge rendres som ett symbol', () => {
  it('terminal med flere lomme-noder < 50 m → kun ett holdeplass-symbol', () => {
    const lat0 = 59.025
    const m2dLon = (m) => m / (111195 * Math.cos(lat0 * Math.PI / 180))
    const stops = [0, 12, 24, 36].map((m, i) =>
      node(i + 1, lat0, 10.05 + m2dLon(m), { highway: 'bus_stop', name: 'Asker' })
    )
    const { svg } = buildSvg(stops, bbox, {})
    const uses = (svg.match(/href="#iso-sym-holdeplass"/g) || []).length
    expect(uses).toBe(1)
  })
})

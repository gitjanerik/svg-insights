import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'
import { isMaritimeNameFeature, isMaritimeNameOnlyNode } from './symbolizer.js'

// «Vi har ingen navn i sjøen» — sjønavn-laget (data-layer="sjo-navn").
// Geografiske navn i/ved sjøen: bukt/vik (natural=bay), nes (natural=cape),
// sund (natural=strait), grunne (natural=shoal), holme/øy (place=islet/island),
// skjær (seamark:type=rock). Default PÅ, eget marint lag.

const bbox = { south: 59.0, west: 10.0, north: 59.05, east: 10.1 }
const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags })
const ring = (lat0, lon0, lat1, lon1) => [
  { lat: lat0, lon: lon0 }, { lat: lat0, lon: lon1 },
  { lat: lat1, lon: lon1 }, { lat: lat1, lon: lon0 }, { lat: lat0, lon: lon0 },
]

describe('isMaritimeNameFeature', () => {
  const yes = [
    { natural: 'bay' }, { natural: 'cape' }, { natural: 'strait' },
    { natural: 'shoal' }, { natural: 'reef' }, { natural: 'peninsula' },
    { place: 'islet' }, { place: 'island' }, { 'seamark:type': 'rock' },
  ]
  for (const t of yes) {
    it(`${JSON.stringify(t)} → true`, () => expect(isMaritimeNameFeature(t)).toBe(true))
  }
  const no = [{ natural: 'water' }, { place: 'village' }, { highway: 'path' }, {}]
  for (const t of no) {
    it(`${JSON.stringify(t)} → false`, () => expect(isMaritimeNameFeature(t)).toBe(false))
  }
})

describe('isMaritimeNameOnlyNode — sjømerke beholder symbol', () => {
  it('bukt-node er navn-only (ingen eget symbol)', () => {
    expect(isMaritimeNameOnlyNode({ natural: 'bay' })).toBe(true)
  })
  it('skjær (seamark:type=rock) er IKKE navn-only — beholder 211-symbolet', () => {
    expect(isMaritimeNameOnlyNode({ 'seamark:type': 'rock' })).toBe(false)
  })
})

describe('buildSvg — sjønavn-laget', () => {
  it('renderer alltid en sjo-navn-gruppe (default PÅ via MapView)', () => {
    const { svg } = buildSvg([], bbox, {})
    expect(svg).toContain('data-layer="sjo-navn"')
  })

  it('navngitt bukt-node gir en sjønavn-etikett, ikke en tom vann-/sted-bucket', () => {
    const bukt = node(1, 59.025, 10.05, { natural: 'bay', name: 'Vesle bukta' })
    const { svg } = buildSvg([bukt], bbox, {})
    const seaG = svg.match(/<g data-layer="sjo-navn">[\s\S]*?<\/g>/)[0]
    expect(seaG).toContain('Vesle bukta')
    expect(seaG).toContain('data-label="vann-navn"')
    // node-bukt skal ikke bli et generelt stedsnavn
    expect(svg).not.toMatch(/data-label="stedsnavn"[^>]*>Vesle bukta/)
  })

  it('place=islet-node (holme) og place=island-node (øy) gir sjønavn', () => {
    const holme = node(2, 59.02, 10.03, { place: 'islet', name: 'Litjholmen' })
    const oy = node(3, 59.03, 10.06, { place: 'island', name: 'Storøya' })
    const { svg } = buildSvg([holme, oy], bbox, {})
    const seaG = svg.match(/<g data-layer="sjo-navn">[\s\S]*?<\/g>/)[0]
    expect(seaG).toContain('Litjholmen')
    expect(seaG).toContain('Storøya')
  })

  it('place=islet-WAY beholder 001 land-overlay OG får navn i sjo-navn', () => {
    const holmeWay = {
      type: 'way', id: 10,
      tags: { place: 'islet', name: 'Skjærholmen' },
      geometry: ring(59.02, 10.02, 59.025, 10.03),
    }
    const { svg } = buildSvg([holmeWay], bbox, {})
    expect(svg).toContain('data-iso="001"')           // geometri-overlay beholdt
    const seaG = svg.match(/<g data-layer="sjo-navn">[\s\S]*?<\/g>/)[0]
    expect(seaG).toContain('Skjærholmen')             // navnet i sjønavn-laget
  })

  it('navngitt skjær (seamark:type=rock) beholder 211-symbolet OG får navn', () => {
    const skjaer = node(4, 59.025, 10.05, { 'seamark:type': 'rock', name: 'Blindskjæret' })
    const { svg } = buildSvg([skjaer], bbox, {})
    // 211-symbolet rendres i sjø-POI-passet
    expect(svg).toContain('data-iso="211"')
    const seaG = svg.match(/<g data-layer="sjo-navn">[\s\S]*?<\/g>/)[0]
    expect(seaG).toContain('Blindskjæret')
  })

  it('unavngitte maritime features gir ingen sjønavn-etikett', () => {
    const anon = node(5, 59.025, 10.05, { natural: 'shoal' })
    const { svg } = buildSvg([anon], bbox, {})
    const seaG = svg.match(/<g data-layer="sjo-navn">([\s\S]*?)<\/g>/)[1]
    expect(seaG.trim()).toBe('')
  })
})

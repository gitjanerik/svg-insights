import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'
import { classifyToIsom } from './symbolizer.js'

const bbox = { south: 59.0, west: 10.0, north: 59.05, east: 10.1 }
const ringGeom = (lat0, lon0, lat1, lon1) => [
  { lat: lat0, lon: lon0 }, { lat: lat0, lon: lon1 },
  { lat: lat1, lon: lon1 }, { lat: lat1, lon: lon0 }, { lat: lat0, lon: lon0 },
]
const n50Sea = {
  type: 'way', id: 1,
  tags: { natural: 'water', water: 'sea', salt: 'yes' },
  geometry: ringGeom(59.0, 10.05, 59.05, 10.1),
  _source: 'n50',
}

describe('classifyToIsom — 551/552 marine areal', () => {
  it('havnestruktur → 551', () => {
    expect(classifyToIsom({ type: 'way', tags: { sjokart: 'havnestruktur' } }))
      .toEqual({ code: '551', cat: 'water' })
  })
  it('fareområde → 552', () => {
    expect(classifyToIsom({ type: 'way', tags: { sjokart: 'fareomraade' } }))
      .toEqual({ code: '552', cat: 'water' })
  })
})

describe('buildSvg — 551/552 rendres', () => {
  it('kai/molo (551) og fareområde (552) får data-iso-grupper', () => {
    const kai = {
      type: 'way', id: 10, tags: { sjokart: 'havnestruktur' },
      geometry: ringGeom(59.02, 10.06, 59.025, 10.065), _source: 'sjokart',
    }
    const fare = {
      type: 'way', id: 11, tags: { sjokart: 'fareomraade' },
      geometry: ringGeom(59.03, 10.07, 59.04, 10.08), _source: 'sjokart',
    }
    const { svg } = buildSvg([n50Sea, kai, fare], bbox, {})
    expect(svg).toContain('data-iso="551"')
    expect(svg).toContain('data-iso="552"')
  })

  it('551-pier forenkles til maks 5 hjørner (konveks form)', () => {
    // Forvridd / selv-kryssende ring (typisk Sjøkart-WFS kai-geometri) med
    // mange hjørner → skal kollapses til en konveks form med ≤ 5 punkter.
    const pier = {
      type: 'way', id: 12, tags: { sjokart: 'havnestruktur' },
      geometry: [
        { lat: 59.020, lon: 10.060 }, { lat: 59.0205, lon: 10.0615 },
        { lat: 59.0202, lon: 10.0608 }, { lat: 59.021, lon: 10.063 },
        { lat: 59.0207, lon: 10.0612 }, { lat: 59.0215, lon: 10.0625 },
        { lat: 59.022, lon: 10.060 }, { lat: 59.0212, lon: 10.0605 },
        { lat: 59.020, lon: 10.060 },
      ],
      _source: 'sjokart',
    }
    const { svg } = buildSvg([n50Sea, pier], bbox, {})
    // Finn 551-gruppe-elementet (ikke CSS-regelen) og tell hjørner i path-d
    const m = svg.match(/<g data-layer="[^"]*" data-iso="551">([\s\S]*?)<\/g>/)
    expect(m).toBeTruthy()
    const dMatch = m[1].match(/ d="([^"]+)"/)
    expect(dMatch).toBeTruthy()
    const verts = (dMatch[1].match(/[ML]/g) || []).length
    expect(verts).toBeGreaterThanOrEqual(3)
    expect(verts).toBeLessThanOrEqual(5)
  })
})

describe('buildSvg — skjulte detalj-lag (inset-only)', () => {
  it('dybdepunkt → skjult dybde-tall-lag med data-detail', () => {
    const sounding = {
      type: 'node', id: 20, lat: 59.025, lon: 10.07,
      tags: { sjokart: 'dybdepunkt', dybde: '3.5' }, _source: 'sjokart',
    }
    const { svg } = buildSvg([n50Sea, sounding], bbox, {})
    expect(svg).toContain('data-layer="dybdepunkt"')
    expect(svg).toContain('data-detail="1"')
    expect(svg).toContain('display:none')
    expect(svg).toContain('data-label="dybde-tall"')
    expect(svg).toContain('>3.5<')
  })
  it('dybdekontur (306) → skjult dybdekurve-lag', () => {
    const kurve = {
      type: 'way', id: 21,
      tags: { sjokart: 'dybdekontur', dybde: '5' },
      geometry: [
        { lat: 59.01, lon: 10.06 }, { lat: 59.02, lon: 10.065 },
        { lat: 59.03, lon: 10.06 },
      ],
      _source: 'sjokart',
    }
    const { svg } = buildSvg([n50Sea, kurve], bbox, {})
    expect(svg).toContain('data-layer="dybdekurve"')
    expect(svg).toContain('data-detail="1"')
  })
  it('store dybder vises som heltall', () => {
    const sounding = {
      type: 'node', id: 22, lat: 59.025, lon: 10.07,
      tags: { sjokart: 'dybdepunkt', dybde: '42.7' }, _source: 'sjokart',
    }
    const { svg } = buildSvg([n50Sea, sounding], bbox, {})
    expect(svg).toContain('>43<')
  })
})

describe('buildSvg — Fase 1b land-mask / øy-overlay', () => {
  it('med autoritativ N50-sjø beholdes øy-overlay (001) — N50 mangler hull', () => {
    const island = {
      type: 'way', id: 30, tags: { place: 'island', name: 'Testøya' },
      geometry: ringGeom(59.02, 10.07, 59.03, 10.08), _source: 'osm',
    }
    const { svg } = buildSvg([n50Sea, island], bbox, {})
    // N50-kilde (ikke DEM) → overlay beholdes som sikkerhet
    expect(svg).toContain('data-iso="001"')
  })
  it('land-mask finnes når det er sjø', () => {
    const { svg } = buildSvg([n50Sea], bbox, {})
    expect(svg).toContain('id="land-mask"')
  })
})

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

  const pier551Path = (geometry) => {
    const pier = {
      type: 'way', id: 12, tags: { sjokart: 'havnestruktur' },
      geometry, _source: 'sjokart',
    }
    const { svg } = buildSvg([n50Sea, pier], bbox, {})
    // Finn 551-gruppe-elementet (ikke CSS-regelen) og hent path-d
    const m = svg.match(/<g data-layer="[^"]*" data-iso="551">([\s\S]*?)<\/g>/)
    expect(m).toBeTruthy()
    const dMatch = m[1].match(/ d="([^"]+)"/)
    expect(dMatch).toBeTruthy()
    return dMatch[1]
  }

  it('551-pier med støy forenkles til maks 6 hjørner', () => {
    // Mange-punkts ring med støy på rette strekk → ≤ 6 hjørner.
    const d = pier551Path([
      { lat: 59.020, lon: 10.060 }, { lat: 59.0205, lon: 10.0615 },
      { lat: 59.0202, lon: 10.0608 }, { lat: 59.021, lon: 10.063 },
      { lat: 59.0207, lon: 10.0612 }, { lat: 59.0215, lon: 10.0625 },
      { lat: 59.022, lon: 10.060 }, { lat: 59.0212, lon: 10.0605 },
      { lat: 59.020, lon: 10.060 },
    ])
    const verts = (d.match(/[ML]/g) || []).length
    expect(verts).toBeGreaterThanOrEqual(3)
    expect(verts).toBeLessThanOrEqual(6)
  })

  it('lineær molo (åpen LineString) strekes, fylles ikke (ingen wedge)', () => {
    // En åpen molo-linje skal IKKE lukkes med Z og fylles — det ga før en
    // diger grå trekant fra siste til første punkt. Nå: strek (fill:none).
    const molo = {
      type: 'way', id: 13, tags: { sjokart: 'havnestruktur', subtype: 'molo' },
      // Åpen linje (første ≠ siste punkt) som strekker seg ut i sjøen.
      geometry: [
        { lat: 59.020, lon: 10.060 }, { lat: 59.022, lon: 10.062 },
        { lat: 59.024, lon: 10.061 },
      ],
      _source: 'sjokart',
    }
    const { svg } = buildSvg([n50Sea, molo], bbox, {})
    const m = svg.match(/<g data-layer="[^"]*" data-iso="551">([\s\S]*?)<\/g>/)
    expect(m).toBeTruthy()
    const path = m[1].match(/<path[^>]*>/)[0]
    expect(path).toContain('fill:none')
    expect(path).toContain('stroke:#6b6b6b')
    // Ingen Z (ikke lukket) → ingen fylt wedge.
    expect(path.match(/ d="([^"]+)"/)[1]).not.toContain('Z')
  })

  it('551 får eget data-layer="kai" (egen toggle, ikke sjo-poi)', () => {
    const kai = {
      type: 'way', id: 14, tags: { sjokart: 'havnestruktur' },
      geometry: ringGeom(59.02, 10.06, 59.025, 10.065), _source: 'sjokart',
    }
    const { svg } = buildSvg([n50Sea, kai], bbox, {})
    expect(svg).toContain('data-layer="kai" data-iso="551"')
  })

  it('L-formet molo beholder knekken (konkavt 6-hjørne, ikke konveks)', () => {
    // L-form: et tydelig konkavt hjørne. Skal bevares (6 hjørner), ikke
    // kollapses til konveks firkant.
    const d = pier551Path([
      { lat: 59.0200, lon: 10.0600 }, { lat: 59.0200, lon: 10.0640 },
      { lat: 59.0210, lon: 10.0640 }, { lat: 59.0210, lon: 10.0615 },
      { lat: 59.0230, lon: 10.0615 }, { lat: 59.0230, lon: 10.0600 },
      { lat: 59.0200, lon: 10.0600 },
    ])
    const verts = (d.match(/[ML]/g) || []).length
    expect(verts).toBe(6)
    // Verifiser at formen er konkav (ikke konveks): minst ett kryssprodukt
    // har motsatt fortegn av de andre langs ringen.
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number)
    const ring = []
    for (let i = 0; i < nums.length; i += 2) ring.push([nums[i], nums[i + 1]])
    let pos = 0, neg = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length]
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
      if (cross > 0) pos++; else if (cross < 0) neg++
    }
    expect(pos).toBeGreaterThan(0)
    expect(neg).toBeGreaterThan(0)
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

describe('buildSvg — grid-tynning av dybdepunkt (grunneste vinner)', () => {
  const sounding = (id, lat, lon, dybde) => ({
    type: 'node', id, lat, lon,
    tags: { sjokart: 'dybdepunkt', dybde: String(dybde) }, _source: 'sjokart',
  })
  it('to punkt i samme 120 m-celle → kun det grunneste emitteres', () => {
    // ~20 m fra hverandre (0.0002° lat ≈ 22 m) — samme fine celle.
    const { svg } = buildSvg([
      n50Sea,
      sounding(40, 59.0250, 10.07, 8.2),
      sounding(41, 59.0252, 10.07, 3.1),
    ], bbox, {})
    expect(svg).toContain('>3.1<')
    expect(svg).not.toContain('>8.2<')
  })
  it('grov-cellevinner umerket, øvrige fine punkt får data-fine', () => {
    // ~220 m fra hverandre (0.002° lat) — ulike fine celler (120 m), men
    // trolig samme grove celle (480 m): nøyaktig én av dem skal være umerket.
    const { svg } = buildSvg([
      n50Sea,
      sounding(42, 59.0250, 10.07, 2.5),
      sounding(43, 59.0270, 10.07, 15.3),
    ], bbox, {})
    expect(svg).toContain('>2.5<')
    expect(svg).toContain('>15<')
    const fineCount = (svg.match(/<text[^>]*data-fine="1"/g) ?? []).length
    const totalCount = (svg.match(/<text[^>]*data-label="dybde-tall"/g) ?? []).length
    expect(totalCount).toBe(2)
    expect(fineCount).toBe(1)
    // Grunneste vinner grov-cellen → 15 m-punktet er det fine.
    expect(svg).toMatch(/data-fine="1"[^>]*>15</)
  })
})

describe('buildSvg — natural=bay/strait fylles ikke over autoritativ sjø', () => {
  const bayRelation = {
    type: 'relation', id: 50, tags: { natural: 'bay', name: 'Korsvika' },
    members: [{
      type: 'way', role: 'outer',
      geometry: ringGeom(59.01, 10.06, 59.03, 10.08),
    }],
  }
  it('lukket bukt-relasjon males IKKE når N50-sjø finnes (Korsvika-tilfellet)', () => {
    const { svg } = buildSvg([n50Sea, bayRelation], bbox, {})
    // Navnet skal fortsatt finnes (sjo-navn/vann-label), men ingen
    // fylt 303-path med data-name="Korsvika".
    expect(svg).not.toMatch(/<path[^>]*data-name="Korsvika"/)
    expect(svg).toContain('Korsvika')
  })
  it('uten autoritativ sjø beholdes bukt-fyllet som eneste blå flate', () => {
    const { svg } = buildSvg([bayRelation], bbox, {})
    expect(svg).toMatch(/<path[^>]*data-name="Korsvika"/)
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
  it('ingen land-mask — vann skjuler terreng via painter\'s order (v9.3.34)', () => {
    // Maskeringen er fjernet: det opake vann-fyllet males OPPÅ terreng-detalj
    // (z-order), så ingen <mask> trengs. Vann-laget skal fortsatt finnes.
    const { svg } = buildSvg([n50Sea], bbox, {})
    expect(svg).not.toContain('id="land-mask"')
    expect(svg).not.toContain('mask="url(')
    expect(svg).toContain('data-layer="vann"')
  })
})

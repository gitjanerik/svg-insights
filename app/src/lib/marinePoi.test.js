import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'
import { classifyToIsom, buildIsomDefs, isomCatalog } from './symbolizer.js'

// Fase 3: marine / padle-POI. Klassifisering + rendering + topologisk filter.

const bbox = { south: 59.0, west: 10.0, north: 59.05, east: 10.1 }
const ringGeom = (lat0, lon0, lat1, lon1) => [
  { lat: lat0, lon: lon0 }, { lat: lat0, lon: lon1 },
  { lat: lat1, lon: lon1 }, { lat: lat1, lon: lon0 }, { lat: lat0, lon: lon0 },
]
const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags })

describe('classifyToIsom — marine/padle-POI', () => {
  const cases = [
    [{ man_made: 'lighthouse' }, '533'],
    [{ 'seamark:type': 'light_minor' }, '533'],
    [{ 'seamark:type': 'buoy_lateral', 'seamark:buoy_lateral:category': 'port' }, '540'],
    [{ 'seamark:type': 'buoy_lateral', 'seamark:buoy_lateral:category': 'starboard' }, '541'],
    [{ 'seamark:type': 'beacon_cardinal' }, '542'],
    [{ 'seamark:type': 'rock' }, '211'],
    [{ 'seamark:type': 'beacon_isolated_danger' }, '543'],
    [{ leisure: 'marina' }, '553'],
    [{ leisure: 'slipway' }, '550'],
    [{ amenity: 'toilets' }, '554'],
    [{ amenity: 'drinking_water' }, '555'],
    [{ sjokart: 'slipp' }, '550'],
  ]
  for (const [tags, code] of cases) {
    it(`${JSON.stringify(tags)} → ${code}`, () => {
      const cls = classifyToIsom({ type: 'node', tags })
      expect(cls).toEqual({ code, cat: 'point' })
    })
  }
})

describe('classifyToIsom — strand (v9.3.37: areal, ikke punkt)', () => {
  it('natural=beach → 556 som areal (cat manmade), ikke point', () => {
    const cls = classifyToIsom({ type: 'way', tags: { natural: 'beach' } })
    expect(cls).toEqual({ code: '556', cat: 'manmade' })
  })
})

describe('buildSvg — strand rendres som sand-areal (eget lag)', () => {
  it('natural=beach gir et strand-lag med data-iso=556 og sand-pattern', () => {
    const beach = {
      type: 'way', id: 200,
      tags: { natural: 'beach' },
      geometry: ringGeom(59.02, 10.02, 59.03, 10.04),
    }
    const { svg } = buildSvg([beach], bbox, {})
    expect(svg).toContain('data-layer="strand"')
    expect(svg).toContain('data-iso="556"')
    // sand-stippel-pattern må være referert og definert
    expect(svg).toContain('iso-pat-strand-sand')
    // det gamle punkt-ikonet skal IKKE finnes lenger
    expect(svg).not.toContain('iso-sym-strand')
  })
})

describe('isomCatalog — nye Fase 3-symboler er definert og bygges', () => {
  it('anker / wc / drikkevann finnes som point-symboler', () => {
    expect(isomCatalog.pointSymbols.anker).toBeTruthy()
    expect(isomCatalog.pointSymbols.wc).toBeTruthy()
    expect(isomCatalog.pointSymbols.drikkevann).toBeTruthy()
  })
  it('buildIsomDefs registrerer symbol-id-er for de nye', () => {
    const { symbolIds } = buildIsomDefs(isomCatalog)
    expect(symbolIds.get('anker')).toBeTruthy()
    expect(symbolIds.get('wc')).toBeTruthy()
    expect(symbolIds.get('drikkevann')).toBeTruthy()
  })
  it('WC-symbolet emitterer <text>WC', () => {
    const { symbolDefs } = buildIsomDefs(isomCatalog)
    expect(symbolDefs.get('wc')).toContain('>WC<')
  })
})

describe('buildSvg — marine POI rendres', () => {
  it('marina/toalett/drikkevann gir et sjo-poi-lag med <use>', () => {
    const els = [
      node(1, 59.02, 10.03, { leisure: 'marina' }),
      node(2, 59.03, 10.04, { amenity: 'toilets' }),
      node(3, 59.025, 10.05, { amenity: 'drinking_water' }),
    ]
    const { svg } = buildSvg(els, bbox, {})
    expect(svg).toContain('data-layer="sjo-poi"')
    expect(svg).toContain('data-iso="553"')
    expect(svg).toContain('data-iso="554"')
    expect(svg).toContain('data-iso="555"')
  })
})

describe('buildSvg — Marker ∈ Water filter for skjær', () => {
  // N50-sjø dekker østre halvdel (lon 10.05–10.1). Et skjær i sjøen beholdes
  // rent; et «skjær» på land (vest) rendres FLAGGET (data-uncertain) — v11.0.49:
  // et skjær er en fare, så det dempes og merkes «posisjon usikker» i stedet
  // for å slettes stille (et slettet skjær er farligere enn ett tegnet litt feil).
  const n50Sea = {
    type: 'way', id: 100,
    tags: { natural: 'water', water: 'sea', salt: 'yes' },
    geometry: ringGeom(59.0, 10.05, 59.05, 10.1),
    _source: 'n50',
  }
  const skjaerInSea = node(101, 59.025, 10.07, { 'seamark:type': 'rock' })
  const skjaerOnLand = node(102, 59.025, 10.02, { 'seamark:type': 'rock' })

  it('skjær i sjøen rendres rent (data-iso=211, ikke flagget)', () => {
    const { svg } = buildSvg([n50Sea, skjaerInSea], bbox, {})
    expect(svg).toContain('data-iso="211"')
    // skjæret i sjøen skal IKKE være merket usikkert
    expect(/data-iso="211"[^>]*data-uncertain/.test(svg)).toBe(false)
  })
  it('skjær på land rendres FLAGGET (data-uncertain), ikke slettet', () => {
    const { svg } = buildSvg([n50Sea, skjaerOnLand], bbox, {})
    expect(svg).toContain('data-iso="211"')
    expect(svg).toContain('data-uncertain="1"')
  })
  it('uten kyst-modell beholdes skjær uansett (gating)', () => {
    const { svg } = buildSvg([skjaerOnLand], bbox, {})
    expect(svg).toContain('data-iso="211"')
  })
})

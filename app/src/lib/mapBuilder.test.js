import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'

// Integrasjonstester for Fase 1: single coastline + topologisk klipping av
// dybdeareal (307). Vi unngår DEM-koordinat-justering ved å la N50-sjøen
// definere den autoritative kysten — både N50-ringen og 307-arealene
// projiseres gjennom samme project(), så koordinatrommet er identisk.

const bbox = { south: 59.0, west: 10.0, north: 59.05, east: 10.1 }

const ring = (lat0, lon0, lat1, lon1) => [
  { lat: lat0, lon: lon0 },
  { lat: lat0, lon: lon1 },
  { lat: lat1, lon: lon1 },
  { lat: lat1, lon: lon0 },
  { lat: lat0, lon: lon0 },
]

// N50 Havflate som dekker ØSTRE halvdel (lon 10.05–10.1).
const n50Sea = {
  type: 'way', id: 1,
  tags: { natural: 'water', water: 'sea', salt: 'yes' },
  geometry: ring(59.0, 10.05, 59.05, 10.1),
  _source: 'n50',
}

// Dybdeareal i sjøen (øst). avgD = 3 → data-dybde="3".
const depthInSea = {
  type: 'way', id: 2,
  tags: { sjokart: 'dybdeareal', minDybde: '2', maxDybde: '4' },
  geometry: ring(59.01, 10.06, 59.04, 10.08),
  _source: 'sjokart',
}

// Dybdeareal som feilaktig ligger på land (vest, utenfor N50-sjøen).
// avgD = 99 → data-dybde="99". Skal klippes bort (DepthArea ∩ Land = 0).
const depthOnLand = {
  type: 'way', id: 3,
  tags: { sjokart: 'dybdeareal', minDybde: '98', maxDybde: '100' },
  geometry: ring(59.01, 10.01, 59.04, 10.03),
  _source: 'sjokart',
}

describe('buildSvg — Fase 1 single coastline / dybde-klipping', () => {
  it('beholder dybdeareal som ligger i sjøen', () => {
    const { svg } = buildSvg([n50Sea, depthInSea], bbox, {})
    expect(svg).toContain('data-iso="307"')
    expect(svg).toContain('data-dybde="3"')
  })

  it('klipper bort dybdeareal som ligger på land', () => {
    const { svg } = buildSvg([n50Sea, depthOnLand], bbox, {})
    // Land-dybden (data-dybde="99") skal være droppet helt
    expect(svg).not.toContain('data-dybde="99"')
  })

  it('beholder sjø-dybde og dropper land-dybde samtidig', () => {
    const { svg } = buildSvg([n50Sea, depthInSea, depthOnLand], bbox, {})
    expect(svg).toContain('data-dybde="3"')
    expect(svg).not.toContain('data-dybde="99"')
  })

  it('uten kyst-modell (ingen sjø) renderes dybdeareal urørt — gating/ingen regresjon', () => {
    // Ingen N50-sjø, ingen DEM → hasAuthoritativeSea = false. Da skal
    // 307 rendres som før, også «på land»-arealet (vi har ingen kyst å
    // klippe mot, og skal ikke gjette).
    const { svg } = buildSvg([depthOnLand], bbox, {})
    expect(svg).toContain('data-dybde="99"')
  })
})

describe('land-mask — overlappende vann gir separate paths (ingen evenodd-hull)', () => {
  // To OVERLAPPENDE vann-polygoner som IKKE slås sammen av unionByName (ulik
  // kilde/navn — etterligner N50 + OSM for samme innsjø, Tyrifjorden). Med én
  // sammenslått evenodd-path ville overlappet kansellere → hull i masken →
  // konturer lekker over vann. Fiksen emitterer én svart path PER polygon, så
  // de union-er (svart + svart = svart) i stedet.
  const lakeOsm = {
    type: 'way', id: 10, tags: { natural: 'water', name: 'Tyrifjorden' },
    geometry: ring(59.01, 10.02, 59.04, 10.07),
  }
  const lakeN50 = {
    type: 'way', id: 11, tags: { natural: 'water' }, _source: 'n50',
    geometry: ring(59.015, 10.03, 59.045, 10.08),
  }

  it('emitterer én svart mask-path per vann-polygon (overlapp kansellerer ikke)', () => {
    const { svg } = buildSvg([lakeOsm, lakeN50], bbox, {})
    const maskMatch = svg.match(/<mask id="land-mask"[\s\S]*?<\/mask>/)
    expect(maskMatch).toBeTruthy()
    const blackPaths = maskMatch[0].match(/<path[^>]*fill="black"/g) ?? []
    expect(blackPaths.length).toBe(2)
  })
})

import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'
import { syntheticDEM } from './dem.js'
import { wgs84ToUtm32 } from './utm.js'

// Syntetisk DEM (Gaussisk topp i midten) som dekker kartets UTM-utstrekning, så
// buildContours gir høydekurver innenfor kart-rammen. demProject er identitet,
// så DEM-world-koord (origin 0, gridToWorld = col*res) = kart-meter-rommet.
function synthDemForBbox(b) {
  const sw = wgs84ToUtm32(b.south, b.west)
  const ne = wgs84ToUtm32(b.north, b.east)
  const widthM = Math.abs(ne.e - sw.e)
  const heightM = Math.abs(ne.n - sw.n)
  return syntheticDEM(widthM, heightM,
    { originX: 0, originY: 0, pixelWidth: 50, pixelHeight: 50 },
    [{ x: widthM / 2, y: heightM / 2, h: 220, sigma: Math.min(widthM, heightM) / 4 }], 50)
}

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

describe('painter\'s order — vann males OPPÅ terreng, ingen land-mask', () => {
  // To overlappende vann-polygoner fra ulike kilder (etterligner N50 + OSM for
  // samme innsjø, Tyrifjorden). Robusthets-kravet: konturer/stupkanter skjules
  // av det OPAKE vann-fyllet via z-order, ikke av en <mask>. Derfor: ingen
  // land-mask i SVG-en, og kontur-laget skal stå FØR vann-laget i kilden (males
  // først → vann males over det).
  const lakeOsm = {
    type: 'way', id: 10, tags: { natural: 'water', name: 'Tyrifjorden' },
    geometry: ring(59.01, 10.02, 59.04, 10.07),
  }
  const lakeN50 = {
    type: 'way', id: 11, tags: { natural: 'water' }, _source: 'n50',
    geometry: ring(59.015, 10.03, 59.045, 10.08),
  }

  it('emitterer ingen land-mask (maskeringen er fjernet)', () => {
    const { svg } = buildSvg([lakeOsm, lakeN50], bbox, {})
    expect(svg).not.toContain('land-mask')
    expect(svg).not.toContain('mask="url(')
  })

  it('maler konturer FØR vann (painter\'s order) når begge finnes', () => {
    // Syntetisk DEM gir konturer; vann fra polygonene over. Konturlaget skal
    // forekomme tidligere i kilden enn vann-laget, så det opake vannet dekker
    // konturer som strekker seg ut over innsjøen.
    const { svg } = buildSvg([lakeOsm, lakeN50], bbox, { dem: synthDemForBbox(bbox) })
    // Anker på <g data-layer=…> (kun i body; CSS bruker [data-iso] selektorer).
    const contourIdx = svg.indexOf('<g data-layer="kontur"')
    const waterIdx = svg.indexOf('<g data-layer="vann"')
    expect(contourIdx).toBeGreaterThanOrEqual(0)
    expect(waterIdx).toBeGreaterThanOrEqual(0)
    expect(contourIdx).toBeLessThan(waterIdx)
  })
})

describe('vektor-vann er autoritativt over DEM-sjø (steg 2)', () => {
  // DEM med vestre halvdel = 0 m (rører kart-kanten → buildSeaFromDem ser «sjø»),
  // østre halvdel = 80 m. En vektor-innsjø som dekker vestre halvdel skal TRUMFE:
  // DEM-sjøen trekkes bort (ingen 303/teal/trappetrinn), innsjøen rendres som
  // ekte ferskvann (301). Etterligner Tyrifjorden lest som ~0 m i DTM.
  function demWithWestSea(b) {
    const sw = wgs84ToUtm32(b.south, b.west)
    const ne = wgs84ToUtm32(b.north, b.east)
    const widthM = Math.abs(ne.e - sw.e)
    const heightM = Math.abs(ne.n - sw.n)
    const res = 50
    const cols = Math.round(widthM / res)
    const rows = Math.round(heightM / res)
    const data = new Float32Array(cols * rows)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) data[r * cols + c] = c < cols / 2 ? 0 : 80
    }
    return { data, cols, rows, transform: { originX: 0, originY: 0, pixelWidth: res, pixelHeight: res }, noData: -9999, resolution: res }
  }
  // Innsjø som dekker mer enn vestre halvdel (lon 10.0–10.06 ⊃ DEM-sjøen ved lon<10.05).
  const westLake = {
    type: 'way', id: 50, tags: { natural: 'water', name: 'Testvatn' },
    geometry: ring(59.0, 10.0, 59.05, 10.06),
  }

  it('DEM-sjø under en vektor-innsjø trekkes bort, innsjøen rendres som 301', () => {
    const { svg } = buildSvg([westLake], bbox, { dem: demWithWestSea(bbox), skipDemSea: false })
    expect(svg).not.toContain('data-src="dem-sea"')   // falsk DEM-sjø fjernet
    expect(svg).toContain('data-iso="301"')            // innsjøen som ekte ferskvann
  })

  it('uten overlappende ferskvann beholdes DEM-sjøen (kyst-fallback urørt)', () => {
    const { svg } = buildSvg([], bbox, { dem: demWithWestSea(bbox), skipDemSea: false })
    expect(svg).toContain('data-src="dem-sea"')        // ekte kyst-sjø overlever
  })
})

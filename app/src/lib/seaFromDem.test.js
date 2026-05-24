import { describe, it, expect } from 'vitest'
import { buildSeaFromDem } from './seaFromDem.js'

function makeDem({ cols, rows, fill, pixelM = 10 }) {
  const data = new Float32Array(cols * rows)
  for (let i = 0; i < data.length; i++) data[i] = fill(i % cols, Math.floor(i / cols))
  return {
    data, cols, rows, noData: -9999,
    transform: { originX: 0, originY: 0, pixelWidth: pixelM, pixelHeight: pixelM },
  }
}

describe('buildSeaFromDem', () => {
  it('returnerer ingen polygoner når DEM kun er land', () => {
    const dem = makeDem({ cols: 20, rows: 20, fill: () => 100 })
    const { polygons } = buildSeaFromDem(dem)
    expect(polygons).toHaveLength(0)
  })

  it('returnerer sjø-polygon for nedre halvdel når DEM har lav høyde der', () => {
    const dem = makeDem({ cols: 20, rows: 20, fill: (x, y) => (y >= 10 ? 0 : 100) })
    const { polygons } = buildSeaFromDem(dem)
    expect(polygons.length).toBeGreaterThan(0)
    const outer = polygons[0][0]
    expect(outer.length).toBeGreaterThanOrEqual(4)
    // Outer ring skal dekke nedre halvdel: maxY ≈ rows * pixelHeight = 200, minY ≈ 100
    const ys = outer.map(p => p[1])
    expect(Math.max(...ys)).toBeGreaterThan(150)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(90)
  })

  it('filtrerer ut innsjø-pseudo-sjø som ikke berører bbox-kanten', () => {
    // Lite lav-elevasjon-område i midten av bbox = innsjø/tjern.
    // Skal IKKE returneres som sjø-polygon med default requireBoundaryTouch.
    const dem = makeDem({
      cols: 30, rows: 30,
      fill: (x, y) => (x >= 10 && x <= 20 && y >= 10 && y <= 20 ? 0 : 100),
    })
    const { polygons } = buildSeaFromDem(dem)
    expect(polygons).toHaveLength(0)
  })

  it('beholder innsjø-pseudo-sjø når requireBoundaryTouch=false', () => {
    const dem = makeDem({
      cols: 30, rows: 30,
      fill: (x, y) => (x >= 10 && x <= 20 && y >= 10 && y <= 20 ? 0 : 100),
    })
    const { polygons } = buildSeaFromDem(dem, { requireBoundaryTouch: false })
    expect(polygons.length).toBeGreaterThan(0)
  })

  it('behandler noData som land (ikke sjø)', () => {
    // Hele bbox er noData → skal ikke generere sjø
    const dem = makeDem({ cols: 20, rows: 20, fill: () => -9999 })
    const { polygons } = buildSeaFromDem(dem)
    expect(polygons).toHaveLength(0)
  })

  it('respekterer minAreaM2-terskel', () => {
    // Lite sjø-område (2x2 piksler = 400 m² ved 10m piksler) skal filtreres bort
    // med default minAreaM2 = 2000
    const dem = makeDem({ cols: 20, rows: 20, fill: (x, y) => (x < 2 && y < 2 ? 0 : 100) })
    const { polygons } = buildSeaFromDem(dem)
    expect(polygons).toHaveLength(0)
  })

  it('detekterer øy i havet som inner ring (hull)', () => {
    // Hele bbox er sjø unntatt et lite firkantet øy-område i midten
    const dem = makeDem({
      cols: 30, rows: 30,
      fill: (x, y) => (x >= 12 && x <= 18 && y >= 12 && y <= 18 ? 50 : 0),
    })
    const { polygons } = buildSeaFromDem(dem)
    expect(polygons.length).toBeGreaterThan(0)
    // Forventet: én polygon med outer (hele bbox) + inner (øya)
    const hasHole = polygons.some(p => p.length >= 2)
    expect(hasHole).toBe(true)
  })
})

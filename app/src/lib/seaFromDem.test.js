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

  it('legger sjø/land-kanten MIDT i celle-gapet, ikke inntil sjø-cella (v12.1.53)', () => {
    // Sjø (0 m) i kolonne 0–4, bratt land (5 m) i kolonne 5–9, 20 m celler.
    // Celle-sentre: siste sjø @ 90 m, første land @ 110 m. Uklippet felt la
    // krysningen ved 92 m (10 % ut i gapet — land åt nesten hele gapet);
    // klippet felt skal legge den ved midtpunktet 100 m.
    const dem = makeDem({ cols: 10, rows: 10, pixelM: 20, fill: (x) => (x <= 4 ? 0 : 5) })
    const { polygons } = buildSeaFromDem(dem, { simplifyM: 0, minAreaM2: 0 })
    expect(polygons.length).toBeGreaterThan(0)
    let maxX = -Infinity
    for (const rings of polygons) for (const [x] of rings[0]) if (x > maxX) maxX = x
    expect(maxX).toBeGreaterThan(98)
    expect(maxX).toBeLessThan(102)
  })

  it('celler mellom terskel og 2×terskel beholder proporsjonal kant-plassering', () => {
    // Land på 0.8 m (under 2×terskel = 1.0): krysning 0→0.8 ved 0.5 → t=0.625
    // → x = 90 + 0.625·20 = 102.5 m. Klippingen skal IKKE flytte denne.
    const dem = makeDem({ cols: 10, rows: 10, pixelM: 20, fill: (x) => (x <= 4 ? 0 : 0.8) })
    const { polygons } = buildSeaFromDem(dem, { simplifyM: 0, minAreaM2: 0 })
    expect(polygons.length).toBeGreaterThan(0)
    let maxX = -Infinity
    for (const rings of polygons) for (const [x] of rings[0]) if (x > maxX) maxX = x
    expect(maxX).toBeGreaterThan(101)
    expect(maxX).toBeLessThan(104)
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

describe('void-celler forbundet med havflaten (Grønnsund-fiksen)', () => {
  // 30×30 @ 10 m: sjø (0 m) øverst og nederst, land (100 m) i midten, og en
  // smal nord–sør-korridor som forbinder de to sjø-flatene. Korridoren
  // simulerer et sund der Kartverket-WCS ga noData og Terrarium fylte inn
  // grov global LANDhøyde (voidMask = 1, data = fylt verdi).
  function soundDem({ corridorValue = 5, withMask = true } = {}) {
    const cols = 30, rows = 30
    const data = new Float32Array(cols * rows)
    const voidMask = new Uint8Array(cols * rows)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        if (y <= 4 || y >= 25) data[i] = 0
        else if (x >= 13 && x <= 16) { data[i] = corridorValue; voidMask[i] = 1 }
        else data[i] = 100
      }
    }
    const dem = {
      data, cols, rows, noData: -9999,
      transform: { originX: 0, originY: 0, pixelWidth: 10, pixelHeight: 10 },
    }
    if (withMask) dem.voidMask = voidMask
    return dem
  }
  // Én sammenhengende sjø-polygon som dekker både nord- og sør-flaten?
  const spansBothSides = (polygons) => polygons.some(p => {
    const ys = p[0].map(pt => pt[1])
    return Math.min(...ys) < 60 && Math.max(...ys) > 240
  })

  it('åpner sundet: Terrarium-fylt void-korridor forbundet med havflaten blir sjø', () => {
    const { polygons } = buildSeaFromDem(soundDem())
    expect(spansBothSides(polygons)).toBe(true)
  })

  it('uten voidMask er fylte korridor-verdier land (sundet lukket)', () => {
    const { polygons } = buildSeaFromDem(soundDem({ withMask: false }))
    expect(polygons.length).toBeGreaterThan(0)
    expect(spansBothSides(polygons)).toBe(false)
  })

  it('flommer ikke gjennom fylte voids med høy landhøyde (grensekart-scenario)', () => {
    // Terrarium fylte korridoren med 80 m (ekte utenlandsk terreng) —
    // over voidSeaMaxM (30) → flommen stopper, sundet forblir lukket.
    const { polygons } = buildSeaFromDem(soundDem({ corridorValue: 80 }))
    expect(polygons.length).toBeGreaterThan(0)
    expect(spansBothSides(polygons)).toBe(false)
  })

  it('rå noData-korridor (u-fylt DEM, ingen maske) åpnes også', () => {
    const { polygons } = buildSeaFromDem(soundDem({ corridorValue: -9999, withMask: false }))
    expect(spansBothSides(polygons)).toBe(true)
  })

  it('void-felt uten havflate-forbindelse forblir land', () => {
    // Sjø kun nederst; et Terrarium-fylt void-felt oppe ved bbox-kanten er
    // IKKE grid-forbundet med havflaten → skal ikke bli sjø selv om det
    // berører kanten.
    const cols = 30, rows = 30
    const data = new Float32Array(cols * rows)
    const voidMask = new Uint8Array(cols * rows)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        if (y >= 25) data[i] = 0
        else if (y <= 3 && x >= 8 && x <= 16) { data[i] = 5; voidMask[i] = 1 }
        else data[i] = 100
      }
    }
    const dem = {
      data, cols, rows, noData: -9999, voidMask,
      transform: { originX: 0, originY: 0, pixelWidth: 10, pixelHeight: 10 },
    }
    const { polygons } = buildSeaFromDem(dem)
    expect(polygons.length).toBeGreaterThan(0)
    // Bare sør-sjøen — ingen polygon oppe ved void-feltet
    for (const p of polygons) {
      const ys = p[0].map(pt => pt[1])
      expect(Math.min(...ys)).toBeGreaterThan(200)
    }
  })
})

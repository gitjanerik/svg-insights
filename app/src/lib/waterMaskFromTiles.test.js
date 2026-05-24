import { describe, it, expect } from 'vitest'
import { isWaterPixel, finalizeMaskToPolygons, polygonsToOsmLikeWays } from './waterMaskFromTiles.js'

describe('isWaterPixel', () => {
  it('klassifiserer Norgeskart sjø-blå som vann', () => {
    // Norgeskart standard sjø-blå ≈ #a8c4dd
    expect(isWaterPixel(0xa8, 0xc4, 0xdd)).toBe(true)
    // Norgeskart standard innsjø-blå ≈ #b6daee
    expect(isWaterPixel(0xb6, 0xda, 0xee)).toBe(true)
    // Mørkere fjord-blå ≈ #8fb8d4
    expect(isWaterPixel(0x8f, 0xb8, 0xd4)).toBe(true)
  })

  it('ekskluderer hvit/papir-bakgrunn', () => {
    expect(isWaterPixel(255, 255, 255)).toBe(false)
    expect(isWaterPixel(248, 248, 240)).toBe(false)  // papir-kremgul
  })

  it('ekskluderer skog-grønn', () => {
    expect(isWaterPixel(0x8a, 0xc0, 0x88)).toBe(false)  // Norgeskart skog
    expect(isWaterPixel(0xb5, 0xd9, 0xa7)).toBe(false)  // lys-skog
  })

  it('ekskluderer vei-rød/oransje', () => {
    expect(isWaterPixel(0xe6, 0x6a, 0x40)).toBe(false)  // riksvei-rød
    expect(isWaterPixel(0xf5, 0xb3, 0x7c)).toBe(false)  // sekundærvei-oransje
  })

  it('ekskluderer bygg-grå og urbant bymønster', () => {
    expect(isWaterPixel(0xc8, 0xc8, 0xc8)).toBe(false)  // grå
    expect(isWaterPixel(0xb5, 0xb5, 0xb8)).toBe(false)  // urbant
    expect(isWaterPixel(0xe0, 0xc8, 0xb0)).toBe(false)  // beige
  })

  it('ekskluderer kontur-brun', () => {
    expect(isWaterPixel(0xa5, 0x76, 0x4a)).toBe(false)
  })

  it('ekskluderer mørke skygger', () => {
    expect(isWaterPixel(40, 50, 70)).toBe(false)  // veldig mørk blå-grå
  })
})

describe('finalizeMaskToPolygons', () => {
  // En 10×10 grid med en 4×4 vann-firkant i midten
  function makeMask(cols, rows, fill) {
    const m = new Uint8Array(cols * rows)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        m[y * cols + x] = fill(x, y) ? 1 : 0
      }
    }
    return m
  }

  // Bbox over et lite Norge-område for å sikre realistisk projeksjon
  const bbox = { south: 59.80, west: 10.40, north: 59.85, east: 10.50 }

  it('returnerer innsjø-polygon når vann ikke berører kant', () => {
    const cols = 20, rows = 20
    const mask = makeMask(cols, rows, (x, y) => x >= 8 && x <= 12 && y >= 8 && y <= 12)
    const { polygons } = finalizeMaskToPolygons({
      mask, canvasW: cols, canvasH: rows, tlX: 0, tlY: 0, zoom: 14,
      bbox, minAreaM2: 1, simplifyM: 0.5,
    })
    expect(polygons.length).toBeGreaterThan(0)
    expect(polygons[0].type).toBe('lake')
  })

  it('klassifiserer som sjø når vann berører kant', () => {
    const cols = 20, rows = 20
    // Hele vestre halvdel er vann
    const mask = makeMask(cols, rows, (x, y) => x < 10)
    const { polygons } = finalizeMaskToPolygons({
      mask, canvasW: cols, canvasH: rows, tlX: 0, tlY: 0, zoom: 14,
      bbox, minAreaM2: 1, simplifyM: 0.5,
    })
    expect(polygons.length).toBeGreaterThan(0)
    expect(polygons[0].type).toBe('sea')
  })

  it('returnerer tom array for ingen vann', () => {
    const cols = 20, rows = 20
    const mask = new Uint8Array(cols * rows)  // alle nuller
    const { polygons } = finalizeMaskToPolygons({
      mask, canvasW: cols, canvasH: rows, tlX: 0, tlY: 0, zoom: 14,
      bbox, minAreaM2: 1, simplifyM: 0.5,
    })
    expect(polygons).toHaveLength(0)
  })
})

describe('polygonsToOsmLikeWays', () => {
  it('produserer merged-water-element for sjø med saltvann-tags', () => {
    const polys = [{
      type: 'sea',
      rings: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]],
    }]
    const out = polygonsToOsmLikeWays(polys)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('merged-water')
    expect(out[0].tags.natural).toBe('water')
    expect(out[0].tags.salt).toBe('yes')
    expect(out[0]._mergedRings).toHaveLength(1)
    expect(out[0]._mergedRings[0]).toHaveLength(1) // 1 outer ring, ingen holes
  })

  it('produserer merged-water-element for innsjø uten salt-tag', () => {
    const polys = [{
      type: 'lake',
      rings: [[[10, 10], [50, 10], [50, 50], [10, 50], [10, 10]]],
    }]
    const out = polygonsToOsmLikeWays(polys)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('merged-water')
    expect(out[0].tags.natural).toBe('water')
    expect(out[0].tags.salt).toBeUndefined()
  })

  it('bevarer hole-relasjon: outer + inner ring blir SAMME merged-polygon', () => {
    const polys = [{
      type: 'lake',
      rings: [
        [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],   // outer
        [[20, 20], [40, 20], [40, 40], [20, 40], [20, 20]], // hole (øy)
      ],
    }]
    const out = polygonsToOsmLikeWays(polys)
    expect(out).toHaveLength(1)
    // Én merged-water-element med ÉN polygon som har 2 ringer (outer + hole).
    // Rendring bruker fill-rule="evenodd" så hullet faktisk blir hull.
    expect(out[0]._mergedRings).toHaveLength(1)
    expect(out[0]._mergedRings[0]).toHaveLength(2)
  })

  it('grupperer flere sjø- og innsjø-polygoner i to elementer', () => {
    const polys = [
      { type: 'sea', rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
      { type: 'sea', rings: [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]] },
      { type: 'lake', rings: [[[40, 40], [50, 40], [50, 50], [40, 50], [40, 40]]] },
    ]
    const out = polygonsToOsmLikeWays(polys)
    expect(out).toHaveLength(2)
    const sea = out.find(e => e.tags.salt === 'yes')
    const lake = out.find(e => e.tags.salt === undefined)
    expect(sea._mergedRings).toHaveLength(2)
    expect(lake._mergedRings).toHaveLength(1)
  })
})

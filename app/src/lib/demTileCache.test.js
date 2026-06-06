import { describe, it, expect } from 'vitest'
import {
  snapUtmBboxToGrid, tilesCovering, boundingBoxOfTiles,
  copyGridInto, assembleDem, sliceIntoTiles, TILE_M,
} from './demTileCache.js'

const NO_DATA = -9999

// Deterministisk «høyde» fra verdens-koordinat (heltall, eksakt i Float32).
const val = (worldE, worldN) => worldE + worldN * 10

// Bygg en region-grid (rad 0 = nord) over en flis-justert bbox.
function makeRegion(mb, res) {
  const cols = Math.round((mb.maxE - mb.minE) / res)
  const rows = Math.round((mb.maxN - mb.minN) / res)
  const data = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const worldN = mb.maxN - (r + 0.5) * res
    for (let c = 0; c < cols; c++) {
      const worldE = mb.minE + (c + 0.5) * res
      data[r * cols + c] = val(worldE, worldN)
    }
  }
  return { minE: mb.minE, maxN: mb.maxN, res, cols, rows, data }
}

describe('snapUtmBboxToGrid', () => {
  it('snapper ut til multipla av res', () => {
    const snapped = snapUtmBboxToGrid({ minE: 1003, minN: 2007, maxE: 2998, maxN: 3991 }, 10)
    expect(snapped).toEqual({ minE: 1000, minN: 2000, maxE: 3000, maxN: 4000 })
  })
  it('lar allerede-justerte kanter være i fred', () => {
    const b = { minE: 1000, minN: 2000, maxE: 3000, maxN: 4000 }
    expect(snapUtmBboxToGrid(b, 20)).toEqual(b)
  })
})

describe('tilesCovering', () => {
  it('lister flisene som dekker en bbox', () => {
    const tiles = tilesCovering({ minE: 1000, minN: 2000, maxE: 3000, maxN: 4000 }, 1000)
    expect(tiles).toHaveLength(4)
    expect(tiles.map(t => `${t.col}/${t.row}`).sort())
      .toEqual(['1/2', '1/3', '2/2', '2/3'])
  })
  it('teller ikke en flis som bbox bare så vidt tangerer på maks-kanten', () => {
    // bbox slutter eksakt på 2000 → skal IKKE dra inn flis-kolonne 2
    const tiles = tilesCovering({ minE: 1000, minN: 0, maxE: 2000, maxN: 1000 }, 1000)
    expect(tiles.map(t => `${t.col}/${t.row}`)).toEqual(['1/0'])
  })
})

describe('boundingBoxOfTiles', () => {
  it('omslutter alle fliser', () => {
    const tiles = tilesCovering({ minE: 1000, minN: 2000, maxE: 3000, maxN: 4000 }, 1000)
    expect(boundingBoxOfTiles(tiles)).toEqual({ minE: 1000, minN: 2000, maxE: 3000, maxN: 4000 })
  })
})

describe('slice → assemble round-trip', () => {
  const res = 10
  const mb = { minE: 1000, minN: 2000, maxE: 3000, maxN: 4000 }  // 2×2 fliser

  it('rekonstruerer regionen bit-eksakt fra fliser (samme extent)', () => {
    const region = makeRegion(mb, res)
    const tiles = sliceIntoTiles(region, mb, res, TILE_M)
    expect(tiles).toHaveLength(4)
    // Speil readTiles: legg på maxN slik cachen ville gjort.
    const sources = tiles.map(t => ({
      minE: t.minE, maxN: t.minN + t.rows * res, res, cols: t.cols, rows: t.rows, data: t.data,
    }))
    const dem = assembleDem(sources, mb, res)
    expect(dem.cols).toBe(region.cols)
    expect(dem.rows).toBe(region.rows)
    expect(Array.from(dem.data)).toEqual(Array.from(region.data))
  })

  it('fyller kun overlappet ved forskjøvet mål-extent, resten NO_DATA', () => {
    const region = makeRegion(mb, res)
    // Forskjøvet snappet extent: overlapper region i [1500..3000]×[2500..4000]
    const target = { minE: 1500, minN: 2500, maxE: 3500, maxN: 4500 }
    const dem = assembleDem([region], target, res)

    // En celle inne i overlappet (sør for region-nord ved tr=60) skal matche
    // region-formelen.
    const tc = 10, tr = 60
    const worldE = target.minE + (tc + 0.5) * res
    const worldN = target.maxN - (tr + 0.5) * res
    expect(worldE).toBeLessThan(mb.maxE)
    expect(worldN).toBeLessThan(mb.maxN)
    expect(worldN).toBeGreaterThan(mb.minN)
    expect(dem.data[tr * dem.cols + tc]).toBe(val(worldE, worldN))

    // Øvre-høyre hjørne ligger UTENFOR region (E>3000, N>4000) → NO_DATA.
    expect(dem.data[0 * dem.cols + (dem.cols - 1)]).toBe(NO_DATA)
  })
})

describe('copyGridInto', () => {
  it('respekterer mål-grenser uten å skrive utenfor', () => {
    const res = 10
    const target = { minE: 0, maxN: 100, res, cols: 10, rows: 10, data: new Float32Array(100).fill(NO_DATA) }
    // Kilde som delvis stikker utenfor mål mot øst.
    const src = { minE: 50, maxN: 100, res, cols: 10, rows: 10, data: new Float32Array(100).fill(7) }
    copyGridInto(target, src)
    // Kolonner 5–9 i mål skal være 7, 0–4 uberørt (NO_DATA).
    expect(target.data[0]).toBe(NO_DATA)
    expect(target.data[5]).toBe(7)
    expect(target.data[9]).toBe(7)
  })
})

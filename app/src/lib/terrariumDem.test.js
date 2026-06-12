import { describe, it, expect } from 'vitest'
import {
  terrariumElevation,
  decodeTerrariumRGBA,
  chooseTerrariumZoom,
  lonToGlobalPx,
  latToGlobalPx,
  makeSampler,
  detectTerrariumTrigger,
  fillDemCells,
} from './terrariumDem.js'

describe('terrariumElevation', () => {
  it('dekoder 0 m som offset 32768 (R=128,G=0,B=0)', () => {
    // (128*256 + 0 + 0) - 32768 = 0
    expect(terrariumElevation(128, 0, 0)).toBe(0)
  })
  it('dekoder positive høyder', () => {
    // 600 m: (128*256 + 600) - 32768 = 600
    expect(terrariumElevation(128, 600 % 256, 0)).toBeCloseTo(600 % 256, 5)
    // mer realistisk: 600 = 32768+600 = 33368 → R=130, G=88 (130*256+88=33368)
    expect(terrariumElevation(130, 88, 0)).toBe(600)
  })
  it('dekoder negative høyder (under havflaten)', () => {
    // -10 m: 32758 = 127*256 + 246 → R=127, G=246
    expect(terrariumElevation(127, 246, 0)).toBe(-10)
  })
})

describe('decodeTerrariumRGBA', () => {
  it('dekoder en 2x2 RGBA-buffer', () => {
    const px = 2
    const rgba = new Uint8ClampedArray(px * px * 4)
    // alle piksler = 0 m (128,0,0)
    for (let j = 0; j < rgba.length; j += 4) { rgba[j] = 128; rgba[j + 1] = 0; rgba[j + 2] = 0; rgba[j + 3] = 255 }
    const out = decodeTerrariumRGBA(rgba, px)
    expect(out.length).toBe(4)
    expect([...out]).toEqual([0, 0, 0, 0])
  })
})

describe('chooseTerrariumZoom', () => {
  it('velger høyere zoom for finere oppløsning', () => {
    const z10 = chooseTerrariumZoom(65, 10)
    const z20 = chooseTerrariumZoom(65, 20)
    expect(z10).toBeGreaterThan(z20)
  })
  it('klamper til [8,14]', () => {
    expect(chooseTerrariumZoom(65, 0.01)).toBeLessThanOrEqual(14)
    expect(chooseTerrariumZoom(65, 100000)).toBeGreaterThanOrEqual(8)
  })
})

describe('global piksel-math', () => {
  it('lon 0 / lat 0 ligger i sentrum av pyramiden', () => {
    const z = 4
    const mid = (2 ** z) * 256 / 2
    expect(lonToGlobalPx(0, z)).toBeCloseTo(mid, 5)
    expect(latToGlobalPx(0, z)).toBeCloseTo(mid, 5)
  })
  it('lengre øst → større x, lengre nord → mindre y', () => {
    expect(lonToGlobalPx(14, 12)).toBeGreaterThan(lonToGlobalPx(13, 12))
    expect(latToGlobalPx(65, 12)).toBeLessThan(latToGlobalPx(64, 12))
  })
})

describe('makeSampler', () => {
  it('returnerer null når flisen mangler', () => {
    const sample = makeSampler(new Map(), 12)
    expect(sample(65, 14)).toBeNull()
  })
  it('slår opp en lastet flis', () => {
    const z = 12
    const tx = Math.floor(lonToGlobalPx(14, z) / 256)
    const ty = Math.floor(latToGlobalPx(65, z) / 256)
    const tile = new Float32Array(256 * 256).fill(777)
    const sample = makeSampler(new Map([[`${z}/${tx}/${ty}`, tile]]), z)
    expect(sample(65, 14)).toBe(777)
  })
})

// Hjelper: bygg et lite DEM. transform.pixelHeight positiv, rad 0 = nord.
function makeDem(values, cols, rows, noData = -9999) {
  return {
    data: Float32Array.from(values),
    cols, rows,
    transform: { originX: 0, originY: 0, pixelWidth: 20, pixelHeight: 20 },
    noData,
    resolution: 20,
    source: 'test',
  }
}
const UTM = { minE: 0, minN: 0, maxE: 40, maxN: 40 } // 2x2 @ 20 m

describe('detectTerrariumTrigger', () => {
  it('full-dekning høyland → ingen trigger (byte-identisk)', () => {
    const dem = makeDem([600, 610, 620, 605], 2, 2)
    expect(detectTerrariumTrigger(dem).trigger).toBe(false)
  })
  it('noData til stede → trigger', () => {
    const dem = makeDem([600, -9999, 620, 605], 2, 2)
    const r = detectTerrariumTrigger(dem)
    expect(r.hasNoData).toBe(true)
    expect(r.trigger).toBe(true)
  })
  it('stort ~0 m-felt mot høyt terreng (klippe) → trigger', () => {
    // 50 % på 0 m, resten høyt → nearZeroFrac 0.5 > 0.02 og maxV 600 > 120
    const dem = makeDem([600, 0, 0, 0], 2, 2)
    expect(detectTerrariumTrigger(dem).trigger).toBe(true)
  })
})

describe('fillDemCells', () => {
  it('bytter noData-celler med sampler-verdi', () => {
    const dem = makeDem([600, -9999, 620, 605], 2, 2)
    const { dem: out, filled, replaced } = fillDemCells(dem, UTM, () => 500)
    expect(filled).toBe(true)
    expect(replaced).toBe(1)
    expect(out.data[1]).toBe(500)
    expect(out.data[0]).toBe(600) // ekte celle urørt
    expect(out.source).toContain('Terrarium')
  })
  it('bytter 0 m-klippe-celle når Terrarium er klart høyere', () => {
    const dem = makeDem([600, 0, 620, 605], 2, 2)
    const { dem: out, replaced } = fillDemCells(dem, UTM, () => 590)
    expect(replaced).toBe(1)
    expect(out.data[1]).toBe(590)
  })
  it('rører IKKE ekte 0 m (sjø) når Terrarium også er ~0', () => {
    const dem = makeDem([600, 0, 620, 605], 2, 2)
    const { dem: out, filled } = fillDemCells(dem, UTM, () => 0)
    // gap 0-0 < 30 → ikke byttet, ingen endring
    expect(filled).toBe(false)
    expect(out).toBe(dem) // referanse-identisk
  })
  it('returnerer samme dem-objekt når ingenting byttes', () => {
    const dem = makeDem([600, 610, 620, 605], 2, 2)
    const { dem: out, filled } = fillDemCells(dem, UTM, () => 100)
    expect(filled).toBe(false)
    expect(out).toBe(dem)
  })
  it('hopper over celler der sampleren gir null', () => {
    const dem = makeDem([600, -9999, 620, 605], 2, 2)
    const { filled, replaced } = fillDemCells(dem, UTM, () => null)
    expect(filled).toBe(false)
    expect(replaced).toBe(0)
  })
})

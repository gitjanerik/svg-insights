import { describe, it, expect } from 'vitest'
import { deflateSync } from 'node:zlib'
import {
  terrariumElevation,
  decodeTerrariumRGBA,
  decodeTerrariumPixels,
  unfilterScanlines,
  decodePng,
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

describe('unfilterScanlines', () => {
  // 2x2 RGB, kjente piksler: (10,20,30) (40,50,60) / (70,80,90) (100,110,120)
  const flat = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]

  it('filter 0 (None) er identitet', () => {
    const raw = Uint8Array.from([0, ...flat.slice(0, 6), 0, ...flat.slice(6)])
    expect([...unfilterScanlines(raw, 2, 2, 3)]).toEqual(flat)
  })
  it('filter 1 (Sub) rekonstruerer fra venstre nabo', () => {
    // rad: [10,20,30, 30,30,30] med Sub → andre piksel lagres som diff
    const raw = Uint8Array.from([1, 10, 20, 30, 30, 30, 30])
    expect([...unfilterScanlines(raw, 2, 1, 3)]).toEqual([10, 20, 30, 40, 50, 60])
  })
  it('filter 2 (Up) rekonstruerer fra raden over', () => {
    const raw = Uint8Array.from([0, 10, 20, 30, 2, 60, 60, 60])
    expect([...unfilterScanlines(raw, 1, 2, 3)]).toEqual([10, 20, 30, 70, 80, 90])
  })
  it('filter 3 (Average) og 4 (Paeth) rekonstruerer kjente verdier', () => {
    // Average: x = raw + floor((a+b)/2); rad2 px1: a=0,b=10 → raw=70-5=65
    const avg = Uint8Array.from([0, 10, 20, 30, 3, 65, 70, 75])
    expect([...unfilterScanlines(avg, 1, 2, 3)]).toEqual([10, 20, 30, 70, 80, 90])
    // Paeth: rad2 px1: a=0,b=10,c=0 → predictor=b=10 → raw=70-10=60
    const paeth = Uint8Array.from([0, 10, 20, 30, 4, 60, 60, 60])
    expect([...unfilterScanlines(paeth, 1, 2, 3)]).toEqual([10, 20, 30, 70, 80, 90])
  })
})

// Bygg en minimal ekte PNG (8-bit, ikke-interlaced) med node:zlib.
// Dekoderen verifiserer ikke CRC, så CRC-feltene kan stå som nuller.
function buildPng(width, height, channels, pixels) {
  const colorType = channels === 3 ? 2 : 6
  const stride = width * channels
  const raw = new Uint8Array(height * (1 + stride))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0 // filter None
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1)
  }
  const idat = deflateSync(raw)
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length)
    new DataView(out.buffer).setUint32(0, data.length)
    out[4] = type.charCodeAt(0); out[5] = type.charCodeAt(1)
    out[6] = type.charCodeAt(2); out[7] = type.charCodeAt(3)
    out.set(data, 8)
    return out
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width); dv.setUint32(4, height)
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((s, p) => s + p.length, 0)
  const png = new Uint8Array(total)
  let p = 0
  for (const part of parts) { png.set(part, p); p += part.length }
  return png
}

describe('decodePng round-trip', () => {
  it('dekoder en RGB-PNG bit-eksakt', async () => {
    const pixels = Uint8Array.from([130, 88, 0, 128, 0, 0, 127, 246, 0, 131, 144, 128])
    const png = buildPng(2, 2, 3, pixels)
    const out = await decodePng(png)
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    expect(out.channels).toBe(3)
    expect([...out.pixels]).toEqual([...pixels])
    // og videre til høyder: 600, 0, -10, 912.5
    const elev = decodeTerrariumPixels(out.pixels, 3, 4)
    expect([...elev]).toEqual([600, 0, -10, 912.5])
  })
  it('dekoder en RGBA-PNG', async () => {
    const pixels = Uint8Array.from([130, 88, 0, 255, 128, 0, 0, 255])
    const out = await decodePng(buildPng(2, 1, 4, pixels))
    expect(out.channels).toBe(4)
    expect([...decodeTerrariumPixels(out.pixels, 4, 2)]).toEqual([600, 0])
  })
  it('kaster på ikke-PNG', async () => {
    await expect(decodePng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow('ikke PNG')
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
  it('bevarer void-masken (hvilke celler som var noData FØR fylling)', () => {
    const dem = makeDem([600, -9999, 620, -9999], 2, 2)
    const { dem: out } = fillDemCells(dem, UTM, () => 500)
    expect(out.voidMask).toBeInstanceOf(Uint8Array)
    expect([...out.voidMask]).toEqual([0, 1, 0, 1])
    // De fylte verdiene er der fortsatt — masken endrer ikke data
    expect(out.data[1]).toBe(500)
    expect(out.data[3]).toBe(500)
  })
  it('uendret DEM (ingenting byttet) har ingen void-maske', () => {
    const dem = makeDem([600, 610, 620, 605], 2, 2)
    const { dem: out } = fillDemCells(dem, UTM, () => 100)
    expect(out.voidMask).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import {
  cumulativeDistances, ascentDescent, buildRouteProfile,
  sampleElevationsFromDem, niceEleDomain, profileToPathData, distanceTicks,
} from './routeElevation.js'
import { wgs84ToUtm32, utm32ToWgs84 } from './utm.js'

// n punkter nordover fra 60°N — 0.009° lat ≈ 1000 m pr steg.
function lineNorth(n, eleFn = () => undefined) {
  return Array.from({ length: n }, (_, i) => [10, 60 + i * 0.009, eleFn(i)])
}

describe('cumulativeDistances', () => {
  it('summerer haversine-avstander langs punktene', () => {
    const d = cumulativeDistances(lineNorth(3))
    expect(d[0]).toBe(0)
    expect(d[1]).toBeGreaterThan(950)
    expect(d[1]).toBeLessThan(1050)
    expect(d[2]).toBeCloseTo(2 * d[1], 6)
  })
})

describe('ascentDescent', () => {
  it('akkumulerer med hysterese — småbølger under terskelen teller ikke', () => {
    expect(ascentDescent([0, 10, 9, 11, 30], 2)).toEqual({ ascentM: 30, descentM: 0 })
    expect(ascentDescent([100, 99.5, 100.4, 99.8, 100.1], 2)).toEqual({ ascentM: 0, descentM: 0 })
    expect(ascentDescent([50, 20, 45], 2)).toEqual({ ascentM: 25, descentM: 30 })
  })
})

describe('buildRouteProfile', () => {
  it('returnerer null når høydedekningen er under terskelen', () => {
    expect(buildRouteProfile(lineNorth(10))).toBeNull()
    const halvparten = lineNorth(10, (i) => (i < 5 ? 100 : undefined))
    expect(buildRouteProfile(halvparten)).toBeNull()
  })
  it('bygger profil med stats fra en jevn stigning', () => {
    const p = buildRouteProfile(lineNorth(21, (i) => 100 + i * 10))
    expect(p).not.toBeNull()
    expect(p.samples.length).toBe(21)
    expect(p.lengthM).toBeGreaterThan(19000)
    expect(p.minEle).toBeGreaterThanOrEqual(100)
    expect(p.maxEle).toBeLessThanOrEqual(300)
    // Glatting flater endene litt — men hoveddelen av 200 m stigning skal stå.
    expect(p.ascentM).toBeGreaterThanOrEqual(180)
    expect(p.descentM).toBe(0)
  })
  it('interpolerer enkelthull og tåler nodata-verdier', () => {
    const p = buildRouteProfile(lineNorth(10, (i) => (i === 4 ? -9999 : 200)))
    expect(p).not.toBeNull()
    expect(p.minEle).toBeCloseTo(200, 5)
    expect(p.maxEle).toBeCloseTo(200, 5)
  })
  it('nedsampler lange ruter men beholder ekstremer og endepunkter', () => {
    const n = 3000
    const p = buildRouteProfile(
      Array.from({ length: n }, (_, i) => [10 + i * 0.0002, 60, 100 + 50 * Math.sin((i / n) * 8 * Math.PI)]),
      { maxSamples: 200 },
    )
    expect(p.samples.length).toBeLessThanOrEqual(204)
    expect(p.samples[0].dM).toBe(0)
    expect(p.samples[p.samples.length - 1].dM).toBeCloseTo(p.lengthM, 6)
    expect(p.maxEle).toBeGreaterThan(148)
    expect(p.minEle).toBeLessThan(52)
  })
  it('merker samples med underlag fra segmenter', () => {
    const p = buildRouteProfile(lineNorth(10, () => 100), {
      segments: [
        { fromIdx: 0, toIdx: 4, gravel: true },
        { fromIdx: 4, toIdx: 9, gravel: false },
      ],
    })
    expect(p.samples[0].gravel).toBe(true)
    expect(p.samples[9].gravel).toBe(false)
  })
})

describe('sampleElevationsFromDem', () => {
  // 2×2-grid rundt et kjent UTM-punkt: [0 10 / 20 30], 50 m celler.
  const u = wgs84ToUtm32(60, 10)
  const utmBbox = { minE: u.e, maxE: u.e + 100, minN: u.n - 100, maxN: u.n }
  const dem = {
    data: Float32Array.from([0, 10, 20, 30]),
    cols: 2, rows: 2,
    transform: { originX: 0, originY: 0, pixelWidth: 50, pixelHeight: 50 },
    noData: -9999,
  }
  it('bilineær-sampler midt i griddet', () => {
    const midt = utm32ToWgs84(u.e + 25, u.n - 25)   // celle-senter (0.5, 0.5)
    const [pt] = sampleElevationsFromDem([[midt.lon, midt.lat]], dem, utmBbox)
    expect(pt[2]).toBeCloseTo(15, 0)
  })
  it('gir NaN utenfor dekningen', () => {
    const utenfor = utm32ToWgs84(u.e + 5000, u.n)
    const [pt] = sampleElevationsFromDem([[utenfor.lon, utenfor.lat]], dem, utmBbox)
    expect(Number.isNaN(pt[2])).toBe(true)
  })
})

describe('niceEleDomain', () => {
  it('runder til 5 m og håndhever minste spenn', () => {
    const d = niceEleDomain(3, 12)
    expect(Math.abs(d.floor % 5)).toBe(0)
    expect(Math.abs(d.ceil % 5)).toBe(0)
    expect(d.floor).toBeLessThanOrEqual(3)
    expect(d.ceil).toBeGreaterThanOrEqual(12)
    expect(d.ceil - d.floor).toBeGreaterThanOrEqual(40)
  })
  it('beholder store spenn urørt utover rundingen', () => {
    const d = niceEleDomain(102, 843)
    expect(d.floor).toBe(100)
    expect(d.ceil).toBe(845)
  })
})

describe('profileToPathData', () => {
  const profile = buildRouteProfile(lineNorth(10, (i) => 100 + i), {
    segments: [
      { fromIdx: 0, toIdx: 5, gravel: true },
      { fromIdx: 5, toIdx: 9, gravel: false },
    ],
  })
  const box = { x0: 30, y0: 10, w: 300, h: 100 }
  it('deler linja i underlags-runs med delt grensepunkt', () => {
    const g = profileToPathData(profile, box)
    expect(g.runs.length).toBe(2)
    expect(g.runs[0].gravel).toBe(true)
    expect(g.runs[1].gravel).toBe(false)
    const sisteGrus = g.runs[0].d.split(' L').at(-1)
    expect(g.runs[1].d.startsWith('M' + sisteGrus)).toBe(true)
  })
  it('lukker flate-pathen mot grunnlinja', () => {
    const g = profileToPathData(profile, box)
    expect(g.areaD.startsWith('M')).toBe(true)
    expect(g.areaD.endsWith('Z')).toBe(true)
    expect(g.areaD).toContain(` ${(box.y0 + box.h).toFixed(1)} `)
  })
  it('skalerer x/y inn i boksen', () => {
    const g = profileToPathData(profile, box)
    expect(g.xOf(0)).toBe(box.x0)
    expect(g.xOf(profile.lengthM)).toBeCloseTo(box.x0 + box.w, 6)
    expect(g.yOf(g.eleFloor)).toBeCloseTo(box.y0 + box.h, 6)
    expect(g.yOf(g.eleCeil)).toBeCloseTo(box.y0, 6)
  })
})

describe('distanceTicks', () => {
  it('velger pent steg som gir maks ~6 ticks', () => {
    expect(distanceTicks(4000)).toEqual([0, 1, 2, 3, 4])
    expect(distanceTicks(22000)).toEqual([0, 5, 10, 15, 20])
    expect(distanceTicks(0)).toEqual([])
  })
})

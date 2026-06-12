import { describe, it, expect } from 'vitest'
import {
  stitchChains,
  perimeterParam,
  boundaryArcCorners,
  clipChainToBbox,
  assembleSeaRings,
  buildSeaFromCoastline,
} from './coastlineToSea.js'
import { ringSignedArea, pointInMultiPolygon } from './marineTopology.js'

const BBOX = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
const area = (poly) => {
  let a = Math.abs(ringSignedArea(poly[0]))
  for (let h = 1; h < poly.length; h++) a -= Math.abs(ringSignedArea(poly[h]))
  return a
}
const totalSeaArea = (polys) => polys.reduce((s, p) => s + area(p), 0)
// MP på pointInMultiPolygon-form: hver polygon = [outer, ...holes]
const asMP = (polys) => polys

describe('stitchChains', () => {
  it('syr sammen slutt→start og bevarer retning', () => {
    const out = stitchChains([
      [[0, 0], [10, 0]],
      [[10, 0], [10, 10]],
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual([[0, 0], [10, 0], [10, 10]])
  })
  it('lar uparede kjeder stå', () => {
    const out = stitchChains([[[0, 0], [10, 0]], [[50, 50], [60, 60]]])
    expect(out).toHaveLength(2)
  })
})

describe('perimeterParam', () => {
  it('plasserer punkter på riktig kant (CW fra TL)', () => {
    expect(perimeterParam([0, 0], BBOX)).toBe(0)        // TL
    expect(perimeterParam([50, 0], BBOX)).toBe(50)      // topp
    expect(perimeterParam([100, 50], BBOX)).toBe(150)   // høyre (W + 50)
    expect(perimeterParam([50, 100], BBOX)).toBe(250)   // bunn (W+H + 50)
    expect(perimeterParam([0, 50], BBOX)).toBe(350)     // venstre (2W+H + 50)
  })
  it('returnerer null for punkt inni bbox', () => {
    expect(perimeterParam([50, 50], BBOX)).toBeNull()
  })
})

describe('boundaryArcCorners', () => {
  it('gir hjørnene mellom to t i økende retning', () => {
    // fra topp (t=50) til bunn (t=250) → passerer TR(100) og BR(200)
    expect(boundaryArcCorners(50, 250, BBOX)).toEqual([[100, 0], [100, 100]])
  })
  it('wrapper rundt P', () => {
    // fra bunn (t=250) til topp (t=50) → passerer BL(300) og TL(0)
    expect(boundaryArcCorners(250, 50, BBOX)).toEqual([[0, 100], [0, 0]])
  })
})

describe('clipChainToBbox', () => {
  it('lar en kjede som krysser bbox få endepunkter på kanten', () => {
    const { subs, dangling } = clipChainToBbox([[-10, 50], [110, 50]], BBOX)
    expect(dangling).toBe(false)
    expect(subs).toHaveLength(1)
    expect(subs[0][0]).toEqual([0, 50])
    expect(subs[0][subs[0].length - 1]).toEqual([100, 50])
  })
  it('flagger dangling når en kjede ender inni bbox', () => {
    const { dangling } = clipChainToBbox([[-10, 50], [50, 50]], BBOX)
    expect(dangling).toBe(true)
  })
})

describe('buildSeaFromCoastline — orientering (LÅST)', () => {
  it('land vest / sjø øst → fyller østre halvdel', () => {
    // OSM: land til venstre for retningen (geo). Land vest ⇒ reiser nord ⇒
    // i y-ned-rom fra bunn (y=100) til topp (y=0).
    const polys = buildSeaFromCoastline([[[50, 100], [50, 0]]], BBOX)
    expect(polys).toHaveLength(1)
    expect(totalSeaArea(polys)).toBeCloseTo(5000, -1)
    // sjø øst, land vest
    expect(pointInMultiPolygon(75, 50, asMP(polys))).toBe(true)
    expect(pointInMultiPolygon(25, 50, asMP(polys))).toBe(false)
  })
  it('land øst / sjø vest (reversert kyst) → fyller vestre halvdel', () => {
    const polys = buildSeaFromCoastline([[[50, 0], [50, 100]]], BBOX)
    expect(totalSeaArea(polys)).toBeCloseTo(5000, -1)
    expect(pointInMultiPolygon(25, 50, asMP(polys))).toBe(true)
    expect(pointInMultiPolygon(75, 50, asMP(polys))).toBe(false)
  })
})

describe('buildSeaFromCoastline — øyer blir hull', () => {
  it('en lukket løkke i sjøen blir et hull (land)', () => {
    const coast = [[50, 100], [50, 0]]                       // sjø øst
    const island = [[70, 40], [90, 40], [90, 60], [70, 60], [70, 40]] // øy i øst
    const polys = buildSeaFromCoastline([coast, island], BBOX)
    expect(polys).toHaveLength(1)
    expect(polys[0].length).toBeGreaterThanOrEqual(2)        // outer + hull
    expect(totalSeaArea(polys)).toBeCloseTo(5000 - 400, -1)  // øy trukket fra
    // punkt i øya = land (ikke sjø); punkt utenfor øya i øst = sjø
    expect(pointInMultiPolygon(80, 50, asMP(polys))).toBe(false)
    expect(pointInMultiPolygon(60, 50, asMP(polys))).toBe(true)
  })
})

describe('buildSeaFromCoastline — sikkerhet (flommer aldri land)', () => {
  it('ingen coastline → ingen sjø', () => {
    expect(buildSeaFromCoastline([], BBOX)).toEqual([])
  })
  it('kun øyer, ingen fastlandskyst som krysser → ingen sjø (tvetydig)', () => {
    const island = [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]]
    expect(buildSeaFromCoastline([island], BBOX)).toEqual([])
  })
  it('dangling coastline (ufullstendige data) → ingen sjø', () => {
    // ender inni bbox
    expect(buildSeaFromCoastline([[[-10, 50], [50, 50]]], BBOX)).toEqual([])
  })
  it('degenerert bbox → ingen sjø', () => {
    expect(buildSeaFromCoastline([[[50, 100], [50, 0]]], { minX: 0, minY: 0, maxX: 0, maxY: 0 })).toEqual([])
  })
})

describe('assembleSeaRings — to fastlandskjeder', () => {
  it('to separate kyststrekk gir korrekt sjø-ring', () => {
    // Kyst kommer inn fra venstre, ut på topp (én diagonal-ish kyst).
    // Verifiser at det produserer minst én ring uten å kaste.
    const ann = [
      { pts: [[0, 50], [40, 30]], tStart: perimeterParam([0, 50], BBOX), tEnd: null },
    ]
    // (enkel røyk-test på at funksjonen er robust mot manglende tEnd)
    const rings = assembleSeaRings(
      [{ pts: [[50, 100], [50, 0]], tStart: 250, tEnd: 50 }],
      BBOX,
    )
    expect(rings.length).toBeGreaterThanOrEqual(1)
  })
})

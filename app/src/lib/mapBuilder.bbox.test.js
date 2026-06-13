import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'
import { syntheticDEM } from './dem.js'
import { CELL_M } from './spatialBucket.js'

// v10.2.9 — romlig bucketing + data-bbox-emisjon.
// Bygger et lite syntetisk kart og regex-asserter på output-strengen
// (samme mønster som mapBuilder.progressive.test.js — ingen DOM).

// ~5.5×5.6 km bbox (flere CELL_M-celler i begge retninger).
const bbox = { south: 59, north: 59.05, west: 10, east: 10.09 }

function dem() {
  return syntheticDEM(600, 600, { originX: 0, originY: 0, pixelWidth: 10, pixelHeight: 10 },
    [{ x: 3000, y: 3000, h: 400, sigma: 60 }], 0)
}

// Lukket kvadrat-polygon (~sizeDeg på hver led) med sørvest-hjørne (lat, lon).
function squareWay(id, lat, lon, sizeDeg, tags) {
  return {
    type: 'way', id, tags,
    geometry: [
      { lat, lon },
      { lat, lon: lon + sizeDeg },
      { lat: lat + sizeDeg, lon: lon + sizeDeg },
      { lat: lat + sizeDeg, lon },
      { lat, lon },
    ],
  }
}

function lineWay(id, lat, lon, dLat, dLon, tags) {
  return {
    type: 'way', id, tags,
    geometry: [
      { lat, lon },
      { lat: lat + dLat / 2, lon: lon + dLon / 2 },
      { lat: lat + dLat, lon: lon + dLon },
    ],
  }
}

// Trekk ut alle <path …>-tags inne i ALLE <g data-iso="CODE">…</g>-grupper.
// (Veier med casing-pattern emitteres som to grupper per kode: ett casing-
// pass og ett overlay-pass — se roadLayers i mapBuilder.)
function pathsInIso(svg, code) {
  const out = []
  for (const m of svg.matchAll(new RegExp(`<g[^>]*data-iso="${code}"[^>]*>([\\s\\S]*?)</g>`, 'g'))) {
    for (const p of m[1].matchAll(/<path[^>]*>/g)) out.push(p[0])
  }
  return out
}

function bboxOf(pathTag) {
  const m = /data-bbox="([^"]+)"/.exec(pathTag)
  if (!m) return null
  const [minX, minY, maxX, maxY] = m[1].split(',').map(Number)
  return { minX, minY, maxX, maxY }
}

// To skog-polygoner (~220 m kant) plassert >2 celler fra hverandre, en
// hovedvei på tvers og et navngitt vann.
const elements = [
  squareWay(1, 59.002, 10.002, 0.002, { natural: 'wood' }),
  squareWay(2, 59.040, 10.075, 0.002, { natural: 'wood' }),
  // _source='n50' → «i Norge» så vannet rendres (svensk vann-tømming gjelder
  // bare kart UTEN N50/NVE-data); denne testen handler om data-bbox-bucketing.
  { ...squareWay(3, 59.020, 10.040, 0.002, { natural: 'water', name: 'Testvatnet' }), _source: 'n50' },
  lineWay(4, 59.005, 10.005, 0.03, 0.06, { highway: 'secondary' }),
]

const { svg } = buildSvg(elements, bbox, { dem: dem(), contourIntervalM: 20 })

describe('buildSvg romlig bucketing + data-bbox (v10.2.9)', () => {
  it('to skog-polygoner langt fra hverandre → to bucket-paths med ikke-overlappende data-bbox', () => {
    const paths = pathsInIso(svg, '406')
    expect(paths.length).toBe(2)
    const [a, b] = paths.map(bboxOf)
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    const disjoint = a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY
    expect(disjoint).toBe(true)
    // Avstanden mellom polygonene er > 2 celler.
    const cxA = (a.minX + a.maxX) / 2, cxB = (b.minX + b.maxX) / 2
    expect(Math.abs(cxA - cxB)).toBeGreaterThan(2 * CELL_M)
  })

  it('path-koordinatene ligger innenfor sin deklarerte data-bbox', () => {
    for (const p of pathsInIso(svg, '406')) {
      const bb = bboxOf(p)
      const d = /d="([^"]+)"/.exec(p)[1]
      for (const m of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
        const x = Number(m[1]), y = Number(m[2])
        expect(x).toBeGreaterThanOrEqual(bb.minX - 0.1)
        expect(x).toBeLessThanOrEqual(bb.maxX + 0.1)
        expect(y).toBeGreaterThanOrEqual(bb.minY - 0.1)
        expect(y).toBeLessThanOrEqual(bb.maxY + 0.1)
      }
    }
  })

  it('vei-casing og overlay-tvilling deler identisk data-bbox (culles sammen)', () => {
    const paths = pathsInIso(svg, '502')
    const casings = paths.filter(p => !p.includes('class="overlay"'))
    const overlays = paths.filter(p => p.includes('class="overlay"'))
    expect(casings.length).toBeGreaterThan(0)
    expect(casings.length).toBe(overlays.length)
    const key = (p) => /data-bbox="([^"]+)"/.exec(p)?.[1]
    expect(casings.map(key).sort()).toEqual(overlays.map(key).sort())
    expect(casings.every(p => key(p))).toBe(true)
  })

  it('navngitt vann forblir standalone med data-name OG får data-bbox', () => {
    const m = svg.match(/<path[^>]*data-name="Testvatnet"[^>]*>/)
    expect(m).toBeTruthy()
    expect(bboxOf(m[0])).toBeTruthy()
  })

  it('kontur-paths bærer data-bbox', () => {
    // Den syntetiske test-DEM-en produserer kun index-konturer (102); minor-
    // konturene (101) faller for min-lengde-filteret. Asserter på de som finnes.
    const paths = [...pathsInIso(svg, '101'), ...pathsInIso(svg, '102')]
    expect(paths.length).toBeGreaterThan(0)
    for (const p of paths) {
      const bb = bboxOf(p)
      expect(bb).toBeTruthy()
      expect([bb.minX, bb.minY, bb.maxX, bb.maxY].every(Number.isFinite)).toBe(true)
    }
  })

  it('alle paths i polygon-/linje-lag bærer data-bbox med 4 endelige tall', () => {
    for (const code of ['406', '301', '502']) {
      for (const p of pathsInIso(svg, code)) {
        const bb = bboxOf(p)
        expect(bb, `path uten data-bbox i ${code}: ${p.slice(0, 120)}`).toBeTruthy()
        expect([bb.minX, bb.minY, bb.maxX, bb.maxY].every(Number.isFinite)).toBe(true)
      }
    }
  })
})

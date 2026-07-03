import { describe, it, expect } from 'vitest'
import {
  buildGravelQuery, classifyGravelWay, extractGravelWays,
  bboxContains, padBbox, GRAVEL_SURFACES, isMotorAccessible,
} from './gravelOverlay.js'

const BBOX = { south: 60.1, west: 11.2, north: 60.3, east: 11.6 }

describe('buildGravelQuery', () => {
  it('har bbox i S,W,N,E-rekkefølge og begge union-greiner', () => {
    const q = buildGravelQuery(BBOX)
    expect(q).toContain('[bbox:60.1,11.2,60.3,11.6]')
    expect(q).toContain(`"surface"~"^(${GRAVEL_SURFACES.join('|')})$"`)
    expect(q).toContain('way["highway"="track"][!"surface"]["tracktype"!~"^grade1$"]')
    expect(q).toContain('out geom;')
    expect(q).toContain('[timeout:25]')
  })
})

describe('classifyGravelWay', () => {
  it('eksplisitt grus-familie → surfaced', () => {
    expect(classifyGravelWay({ highway: 'unclassified', surface: 'gravel' })).toBe('surfaced')
    expect(classifyGravelWay({ highway: 'tertiary', surface: 'compacted' })).toBe('surfaced')
    expect(classifyGravelWay({ highway: 'track', surface: 'dirt' })).toBe('surfaced')
  })
  it('track uten surface → assumed; grade1 ekskluderes', () => {
    expect(classifyGravelWay({ highway: 'track' })).toBe('assumed')
    expect(classifyGravelWay({ highway: 'track', tracktype: 'grade3' })).toBe('assumed')
    expect(classifyGravelWay({ highway: 'track', tracktype: 'grade1' })).toBe(null)
  })
  it('asfalt og umerkede vanlige veier → null', () => {
    expect(classifyGravelWay({ highway: 'unclassified', surface: 'asphalt' })).toBe(null)
    expect(classifyGravelWay({ highway: 'residential' })).toBe(null)
    expect(classifyGravelWay({ highway: 'path', surface: 'gravel' })).toBe(null)
  })
  it('enrich-callback overstyrer OSM-heuristikken begge veier', () => {
    expect(classifyGravelWay({ highway: 'residential' }, { enrich: () => 'surfaced' })).toBe('surfaced')
    expect(classifyGravelWay({ highway: 'track' }, { enrich: () => 'paved' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track' }, { enrich: () => null })).toBe('assumed')
  })
  it('ulovlig motorisert ferdsel → null (også med grus-surface og enrich)', () => {
    expect(classifyGravelWay({ highway: 'track', surface: 'gravel', motor_vehicle: 'no' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', access: 'private' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', motor_vehicle: 'agricultural;forestry' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', vehicle: 'no' }, { enrich: () => 'surfaced' })).toBe(null)
  })
  it('gang/sykkelvei-heuristikk: foot/bicycle=designated uten motor-access → null (alle veityper)', () => {
    expect(classifyGravelWay({ highway: 'track', surface: 'gravel', foot: 'designated' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', bicycle: 'designated' })).toBe(null)
    expect(classifyGravelWay({ highway: 'unclassified', surface: 'gravel', bicycle: 'designated' })).toBe(null)
    expect(classifyGravelWay({ highway: 'service', surface: 'compacted', foot: 'designated' })).toBe(null)
    expect(classifyGravelWay({ highway: 'track', surface: 'gravel', foot: 'designated', motor_vehicle: 'yes' })).toBe('surfaced')
  })
})

describe('isMotorAccessible', () => {
  it('default (ingen access-tags) → true', () => {
    expect(isMotorAccessible({ highway: 'track' })).toBe(true)
    expect(isMotorAccessible({})).toBe(true)
  })
  it('mest spesifikke tag vinner', () => {
    expect(isMotorAccessible({ access: 'no', motor_vehicle: 'yes' })).toBe(true)
    expect(isMotorAccessible({ access: 'yes', motor_vehicle: 'no' })).toBe(false)
    expect(isMotorAccessible({ motor_vehicle: 'no', motorcycle: 'yes' })).toBe(true)
  })
  it('destination er lovlig', () => {
    expect(isMotorAccessible({ motor_vehicle: 'destination' })).toBe(true)
    expect(isMotorAccessible({ access: 'destination' })).toBe(true)
  })
})

describe('extractGravelWays', () => {
  const fixture = {
    elements: [
      { type: 'way', id: 1, tags: { highway: 'track' },
        geometry: [{ lat: 60.1, lon: 11.2 }, { lat: 60.11, lon: 11.21 }] },
      { type: 'way', id: 2, tags: { highway: 'unclassified', surface: 'gravel' },
        geometry: [{ lat: 60.2, lon: 11.3 }, { lat: 60.21, lon: 11.31 }, { lat: 60.22, lon: 11.32 }] },
      { type: 'way', id: 3, tags: { highway: 'track' } },                      // mangler geometri → droppes
      { type: 'node', id: 4, lat: 60.1, lon: 11.2 },                           // ikke way → droppes
      { type: 'way', id: 5, tags: { highway: 'track', tracktype: 'grade1' },
        geometry: [{ lat: 60.3, lon: 11.4 }, { lat: 60.31, lon: 11.41 }] },    // grade1 → droppes
    ],
  }
  it('trekker ut riktige ways med [lon,lat]-punkter og kind', () => {
    const ways = extractGravelWays(fixture)
    expect(ways.map((w) => w.id)).toEqual([1, 2])
    expect(ways[0].kind).toBe('assumed')
    expect(ways[1].kind).toBe('surfaced')
    expect(ways[1].points[0]).toEqual([11.3, 60.2])
    expect(ways[1].points).toHaveLength(3)
  })
  it('tåler tomt/manglende svar', () => {
    expect(extractGravelWays({})).toEqual([])
    expect(extractGravelWays(null)).toEqual([])
  })
})

describe('bbox-primitiver', () => {
  it('bboxContains', () => {
    const outer = padBbox(BBOX, 1.5)
    expect(bboxContains(outer, BBOX)).toBe(true)
    expect(bboxContains(BBOX, outer)).toBe(false)
    expect(bboxContains(null, BBOX)).toBe(false)
  })
  it('padBbox beholder senteret og skalerer utstrekningen', () => {
    const p = padBbox(BBOX, 2)
    expect((p.north + p.south) / 2).toBeCloseTo((BBOX.north + BBOX.south) / 2, 10)
    expect(p.north - p.south).toBeCloseTo((BBOX.north - BBOX.south) * 2, 10)
    expect(p.east - p.west).toBeCloseTo((BBOX.east - BBOX.west) * 2, 10)
  })
})

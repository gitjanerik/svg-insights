import { describe, it, expect } from 'vitest'
import { parseNearestPlace, haversineM } from './wikiPlace.js'

describe('haversineM', () => {
  it('gir ~0 for samme punkt', () => {
    expect(haversineM(59.9, 10.3, 59.9, 10.3)).toBeCloseTo(0, 5)
  })
  it('måler en kjent kort avstand (~1 km nord)', () => {
    // 0.009° breddegrad ≈ 1 km.
    const d = haversineM(59.9, 10.3, 59.909, 10.3)
    expect(d).toBeGreaterThan(950)
    expect(d).toBeLessThan(1050)
  })
})

describe('parseNearestPlace', () => {
  const lat = 59.91, lon = 10.30

  it('velger artikkelen med lavest index (nærmest) og regner avstand', () => {
    const json = { query: { pages: [
      { index: 2, title: 'Sylling', extract: 'Sylling er et tettsted i Lier.',
        coordinates: [{ lat: 59.92, lon: 10.31 }], fullurl: 'https://no.wikipedia.org/wiki/Sylling' },
      { index: 1, title: 'Holsfjorden', extract: 'Holsfjorden er en del av Tyrifjorden.',
        coordinates: [{ lat: 59.911, lon: 10.301 }], fullurl: 'https://no.wikipedia.org/wiki/Holsfjorden' },
    ] } }
    const r = parseNearestPlace(json, lat, lon)
    expect(r.title).toBe('Holsfjorden')
    expect(r.url).toBe('https://no.wikipedia.org/wiki/Holsfjorden')
    expect(r.distanceM).toBeGreaterThanOrEqual(0)
    expect(r.distanceM).toBeLessThan(300)
  })

  it('hopper over nærmeste uten ingress til fordel for neste med ingress', () => {
    const json = { query: { pages: [
      { index: 1, title: 'Tom side', extract: '   ',
        coordinates: [{ lat: 59.911, lon: 10.301 }], fullurl: 'u1' },
      { index: 2, title: 'Med fakta', extract: 'En fjelltopp i nærheten.',
        coordinates: [{ lat: 59.92, lon: 10.31 }], fullurl: 'u2' },
    ] } }
    const r = parseNearestPlace(json, lat, lon)
    expect(r.title).toBe('Med fakta')
  })

  it('kutter lang ingress til en kort blurb', () => {
    const long = 'Setning en. ' + 'ord '.repeat(200)
    const json = { query: { pages: [
      { index: 1, title: 'Langtekst', extract: long,
        coordinates: [{ lat: 59.911, lon: 10.301 }], fullurl: 'u' },
    ] } }
    const r = parseNearestPlace(json, lat, lon)
    expect(r.extract.length).toBeLessThanOrEqual(285)
  })

  it('returnerer null for tomt/ugyldig svar', () => {
    expect(parseNearestPlace({}, lat, lon)).toBeNull()
    expect(parseNearestPlace({ query: { pages: [] } }, lat, lon)).toBeNull()
    expect(parseNearestPlace({ query: { pages: [{ missing: true, title: 'X' }] } }, lat, lon)).toBeNull()
  })

  it('takler manglende koordinater (distanceM = null)', () => {
    const json = { query: { pages: [
      { index: 1, title: 'Uten koord', extract: 'Fakta.', fullurl: 'u' },
    ] } }
    const r = parseNearestPlace(json, lat, lon)
    expect(r.distanceM).toBeNull()
    expect(r.title).toBe('Uten koord')
  })
})

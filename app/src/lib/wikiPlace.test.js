import { describe, it, expect } from 'vitest'
import { parseNearestPlace, parseNamedNearest, placeNameMatches, haversineM } from './wikiPlace.js'

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

  it('hopper over flertydige (disambiguation) sider', () => {
    const json = { query: { pages: [
      { index: 1, title: 'Glitre', pageprops: { disambiguation: '' },
        coordinates: [{ lat: 59.911, lon: 10.301 }], fullurl: 'd' },
      { index: 2, title: 'Glitre (innsjø)', extract: 'En innsjø.',
        coordinates: [{ lat: 59.92, lon: 10.31 }], fullurl: 'u' },
    ] } }
    const r = parseNearestPlace(json, lat, lon)
    expect(r.title).toBe('Glitre (innsjø)')
  })
})

describe('placeNameMatches', () => {
  it('matcher bestemt/ubestemt form for innsjøer (Bondivannet ~ Bondivann)', () => {
    expect(placeNameMatches('Bondivannet', 'Bondivann')).toBe(true)
    expect(placeNameMatches('Storvatnet', 'Storvatn')).toBe(true)
    expect(placeNameMatches('Langtjernet', 'Langtjern')).toBe(true)
    expect(placeNameMatches('Fjellet', 'Fjell')).toBe(true)
  })
  it('matcher terreng-/vann-ord i ulike former', () => {
    expect(placeNameMatches('Svartputten', 'Svartputt')).toBe(true)
    expect(placeNameMatches('Storpytt', 'Storputten')).toBe(true)
    expect(placeNameMatches('Bondisjøen', 'Bondisjø')).toBe(true)
    expect(placeNameMatches('Bjørnemyra', 'Bjørnemyr')).toBe(true)
    expect(placeNameMatches('Bjørnemyren', 'Bjørnemyra')).toBe(true)
    expect(placeNameMatches('Storbekken', 'Storbekk')).toBe(true)
    expect(placeNameMatches('Storelva', 'Storelv')).toBe(true)
    expect(placeNameMatches('Storelven', 'Storelva')).toBe(true)
    expect(placeNameMatches('Langtjønna', 'Langtjern')).toBe(true)
  })
  it('matcher parentes-disambiguering (Glitre ~ Glitre (innsjø))', () => {
    expect(placeNameMatches('Glitre', 'Glitre (innsjø)')).toBe(true)
  })
  it('avviser urelaterte navn', () => {
    expect(placeNameMatches('Bondivannet', 'Bondi skole')).toBe(false)
    expect(placeNameMatches('Glitre', 'Svarvestolen')).toBe(false)
  })
})

describe('parseNamedNearest', () => {
  const lat = 59.86, lon = 10.06

  it('velger tittel-matchende innen rekkevidde, disambiguerer på avstand', () => {
    // To «Glitre»-innsjøer; vi står ved den ene.
    const json = { query: { pages: [
      { title: 'Glitre (innsjø)', extract: 'Innsjø i Finnemarka.',
        coordinates: [{ lat: 59.865, lon: 10.065 }], fullurl: 'finnemarka' },
      { title: 'Glitre (Nittedal)', extract: 'Innsjø ved Oslo.',
        coordinates: [{ lat: 60.10, lon: 10.90 }], fullurl: 'nittedal' },
    ] } }
    const r = parseNamedNearest(json, lat, lon, 'Glitre')
    expect(r.url).toBe('finnemarka')
  })

  it('matcher bestemt form mot ubestemt artikkel (Bondivannet → Bondivann)', () => {
    const json = { query: { pages: [
      { title: 'Bondivann', extract: 'Innsjø i Asker.',
        coordinates: [{ lat: 59.8185, lon: 10.436 }], fullurl: 'bondivann' },
      { title: 'Bondi skole (Asker)', extract: 'En barneskole.',
        coordinates: [{ lat: 59.823, lon: 10.44 }], fullurl: 'skole' },
    ] } }
    const r = parseNamedNearest(json, 59.81806, 10.43574, 'Bondivannet')
    expect(r.title).toBe('Bondivann')
  })

  it('godtar et entydig ugeotagget navne-treff (best effort)', () => {
    const json = { query: { pages: [
      { title: 'Bondivann', extract: 'Innsjø.', fullurl: 'b' },
    ] } }
    const r = parseNamedNearest(json, 59.81806, 10.43574, 'Bondivannet')
    expect(r.title).toBe('Bondivann')
    expect(r.distanceM).toBeNull()
  })

  it('avviser når flere ugeotaggede kandidater er flertydige', () => {
    const json = { query: { pages: [
      { title: 'Glitre (innsjø)', extract: 'a', fullurl: 'a' },
      { title: 'Glitre (Nittedal)', extract: 'b', fullurl: 'b' },
    ] } }
    expect(parseNamedNearest(json, lat, lon, 'Glitre')).toBeNull()
  })

  it('avviser geotaggede treff utenfor maks-avstand', () => {
    const json = { query: { pages: [
      { title: 'Glitre (innsjø)', extract: 'langt unna',
        coordinates: [{ lat: 61.0, lon: 11.0 }], fullurl: 'fjern' },
    ] } }
    // Eneste kandidat, men >8 km unna og geotagget → ikke entydig-ugeotagget-regel.
    expect(parseNamedNearest(json, lat, lon, 'Glitre')).toBeNull()
  })
})

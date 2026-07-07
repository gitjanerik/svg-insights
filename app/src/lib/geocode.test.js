import { describe, it, expect } from 'vitest'
import { geocodePlace, normalizeNominatim, shortNameFor } from './geocode.js'

const sample = {
  place_id: 123,
  display_name: 'Vardåsen, Asker, Akershus, Norge',
  name: 'Vardåsen',
  type: 'peak',
  importance: 0.42,
  lat: '59.8135',
  lon: '10.4145',
  boundingbox: ['59.81', '59.82', '10.41', '10.42'],
  address: { municipality: 'Asker' },
}

function fakeFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    return { ok, status, json: async () => payload }
  }
  fn.calls = calls
  return fn
}

describe('shortNameFor', () => {
  it('kombinerer navn og tettsted', () => {
    expect(shortNameFor(sample)).toBe('Vardåsen, Asker')
  })
  it('faller tilbake til display_name-ledd uten navn/adresse', () => {
    expect(shortNameFor({ display_name: 'A, B, C', address: {} })).toBe('A, B')
  })
})

describe('normalizeNominatim', () => {
  it('parser tall og bbox', () => {
    const n = normalizeNominatim(sample)
    expect(n.lat).toBeCloseTo(59.8135)
    expect(n.lon).toBeCloseTo(10.4145)
    expect(n.bbox).toEqual([59.81, 59.82, 10.41, 10.42])
    expect(n.id).toBe(123)
  })
})

describe('geocodePlace', () => {
  it('returnerer normaliserte treff', async () => {
    const fetchImpl = fakeFetch([sample])
    const out = await geocodePlace('Vardåsen Asker', { fetchImpl })
    expect(out).toHaveLength(1)
    expect(out[0].shortName).toBe('Vardåsen, Asker')
    expect(out[0].lat).toBeCloseTo(59.8135)
  })

  it('sender countrycodes og q i forespørselen', async () => {
    const fetchImpl = fakeFetch([])
    await geocodePlace('Oslo', { fetchImpl, countryCode: 'no' })
    const url = fetchImpl.calls[0].url
    expect(url).toContain('countrycodes=no')
    expect(url).toContain('q=Oslo')
    expect(url).toContain('format=jsonv2')
  })

  it('returnerer tom liste for for korte søk uten å kalle fetch', async () => {
    const fetchImpl = fakeFetch([sample])
    expect(await geocodePlace('a', { fetchImpl })).toEqual([])
    expect(fetchImpl.calls).toHaveLength(0)
  })

  it('kaster ved ikke-ok svar', async () => {
    const fetchImpl = fakeFetch([], { ok: false, status: 429 })
    await expect(geocodePlace('Oslo', { fetchImpl })).rejects.toThrow('Nominatim 429')
  })
})

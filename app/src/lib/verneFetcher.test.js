import { describe, it, expect } from 'vitest'
import {
  extractAreaFromAttributes,
  parseVernedato,
  pickAreaFromIdentify,
} from './verneFetcher.js'

describe('parseVernedato', () => {
  it('parser epoch-ms (tall) til ISO-dato', () => {
    // 1993-06-25
    const ms = Date.UTC(1993, 5, 25)
    expect(parseVernedato(ms)).toBe('1993-06-25')
  })
  it('parser epoch-ms-streng', () => {
    const ms = String(Date.UTC(2001, 0, 1))
    expect(parseVernedato(ms)).toBe('2001-01-01')
  })
  it('beholder ISO-dato', () => {
    expect(parseVernedato('1980-12-19T00:00:00Z')).toBe('1980-12-19')
  })
  it('konverterer dd.mm.yyyy til ISO', () => {
    expect(parseVernedato('25.06.1993')).toBe('1993-06-25')
  })
  it('returnerer null for null-aktige verdier', () => {
    expect(parseVernedato(null)).toBeNull()
    expect(parseVernedato('<Null>')).toBeNull()
    expect(parseVernedato('')).toBeNull()
  })
})

describe('extractAreaFromAttributes', () => {
  it('plukker navn/verneform/vernedato/forvaltning + bygger faktaark-URL fra ID', () => {
    const area = extractAreaFromAttributes({
      navn: 'Nordmarka naturreservat',
      verneform: 'Naturreservat',
      vernedato: Date.UTC(1993, 5, 25),
      forvaltningsmyndighet: 'Statsforvalteren i Oslo og Viken',
      vid: 'VV00002467',
      arealdaa: '4500',
    })
    expect(area).toMatchObject({
      navn: 'Nordmarka naturreservat',
      verneform: 'Naturreservat',
      vernedato: '1993-06-25',
      forvaltning: 'Statsforvalteren i Oslo og Viken',
      id: 'VV00002467',
    })
    expect(area.faktaarkUrl).toContain('id=VV00002467')
    // 4500 daa = 4.5 km²
    expect(area.arealKm2).toBeCloseTo(4.5, 5)
  })

  it('konverterer Shape__Area (m²) til km²', () => {
    const area = extractAreaFromAttributes({ navn: 'Test', Shape__Area: 2_000_000 })
    expect(area.arealKm2).toBeCloseTo(2, 5)
  })

  it('returnerer null uten navn (ikke en ekte record)', () => {
    expect(extractAreaFromAttributes({ verneform: 'Naturreservat' })).toBeNull()
    expect(extractAreaFromAttributes(null)).toBeNull()
  })
})

describe('pickAreaFromIdentify', () => {
  it('tar første treff med navn og fester ringer (rings) på', () => {
    const json = {
      results: [
        { attributes: { object: 'no-name' } },
        {
          attributes: { navn: 'Femundsmarka nasjonalpark', verneform: 'Nasjonalpark' },
          geometry: { rings: [[[11, 62], [11.1, 62], [11.1, 62.1], [11, 62.1], [11, 62]]] },
        },
      ],
    }
    const area = pickAreaFromIdentify(json)
    expect(area.navn).toBe('Femundsmarka nasjonalpark')
    expect(area.rings).toHaveLength(1)
    expect(area.rings[0][0]).toEqual([11, 62])
  })

  it('returnerer null når ingen treff har navn', () => {
    expect(pickAreaFromIdentify({ results: [{ attributes: {} }] })).toBeNull()
    expect(pickAreaFromIdentify({})).toBeNull()
  })
})

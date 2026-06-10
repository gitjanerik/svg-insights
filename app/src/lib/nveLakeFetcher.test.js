import { describe, it, expect } from 'vitest'
import { extractLakeFromAttributes, pickLakeFromIdentify } from './nveLakeFetcher.js'

describe('extractLakeFromAttributes — NVE innsjøhøyde', () => {
  it('plukker hoyde + navn fra typiske NVE-felt', () => {
    const lake = extractLakeFromAttributes({ OBJECTID: 12, navn: 'Mjøsa', hoyde: 123 })
    expect(lake).toEqual({ hoyde: 123, navn: 'Mjøsa' })
  })

  it('tåler alternativt feltnavn (hoyde_moh) og string-tall med komma', () => {
    const lake = extractLakeFromAttributes({ name: 'Tyrifjorden', hoyde_moh: '62,9' })
    expect(lake.navn).toBe('Tyrifjorden')
    expect(lake.hoyde).toBeCloseTo(62.9, 5)
  })

  it('returnerer null når ingen høyde finnes', () => {
    expect(extractLakeFromAttributes({ navn: 'Uten høyde' })).toBeNull()
  })

  it('avviser nodata-sentinler (-9999, -999, -1) som høyde', () => {
    expect(extractLakeFromAttributes({ navn: 'X', hoyde: -9999 })).toBeNull()
    expect(extractLakeFromAttributes({ navn: 'X', hoyde: -1 })).toBeNull()
  })

  it('avviser urealistiske høyder (over Norges høyeste punkt)', () => {
    // En innsjø-ID feiltolket som høyde må ikke vises som moh.
    expect(extractLakeFromAttributes({ navn: 'X', hoyde: 90125 })).toBeNull()
  })

  it('aksepterer høyde uten navn (navn=null)', () => {
    const lake = extractLakeFromAttributes({ hoyde: 4 })
    expect(lake).toEqual({ hoyde: 4, navn: null })
  })

  it('behandler «Null»/«<Null>» som tomt navn', () => {
    const lake = extractLakeFromAttributes({ navn: '<Null>', hoyde: 200 })
    expect(lake).toEqual({ hoyde: 200, navn: null })
  })

  it('returnerer null for tomt/ugyldig input', () => {
    expect(extractLakeFromAttributes(null)).toBeNull()
    expect(extractLakeFromAttributes('x')).toBeNull()
  })
})

describe('pickLakeFromIdentify — ArcGIS identify-respons', () => {
  it('velger første treff med gyldig høyde', () => {
    const json = {
      results: [
        { layerId: 0, layerName: 'Annet', attributes: { foo: 'bar' } },
        { layerId: 3, layerName: 'Innsjø', attributes: { navn: 'Mjøsa', hoyde: 123 } },
      ],
    }
    expect(pickLakeFromIdentify(json)).toEqual({ hoyde: 123, navn: 'Mjøsa' })
  })

  it('returnerer null når ingen resultater har høyde', () => {
    expect(pickLakeFromIdentify({ results: [{ attributes: { navn: 'X' } }] })).toBeNull()
    expect(pickLakeFromIdentify({ results: [] })).toBeNull()
    expect(pickLakeFromIdentify({})).toBeNull()
  })
})

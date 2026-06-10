import { describe, it, expect } from 'vitest'
import { extractLakeFromAttributes, pickLakeFromIdentify } from './nveLakeFetcher.js'

describe('extractLakeFromAttributes — NVE innsjø-data', () => {
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

  it('avviser nodata-sentinler (-9999, -999, -1, 0) som høyde', () => {
    expect(extractLakeFromAttributes({ navn: 'X', hoyde: -9999 })).toBeNull()
    expect(extractLakeFromAttributes({ navn: 'X', hoyde: -1 })).toBeNull()
    expect(extractLakeFromAttributes({ navn: 'X', hoyde: 0 })).toBeNull()
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

  it('plukker maks- og middeldyp (bathymetri) når oppmålt', () => {
    const lake = extractLakeFromAttributes({
      navn: 'Mjøsa', hoyde: 123, maksdyp: 453, middeldyp: 153,
    })
    expect(lake.maxDybde).toBe(453)
    expect(lake.midDybde).toBe(153)
  })

  it('skiller maksdyp fra middeldyp (riktig felt til riktig nøkkel)', () => {
    const lake = extractLakeFromAttributes({ hoyde: 100, max_djup: 30, mid_djup: 12 })
    expect(lake.maxDybde).toBe(30)
    expect(lake.midDybde).toBe(12)
  })

  it('avviser urealistisk dyp (over Norges dypeste innsjø + margin)', () => {
    const lake = extractLakeFromAttributes({ hoyde: 100, maksdyp: 9999 })
    expect(lake.maxDybde).toBeUndefined()
  })

  it('utelater dyp/areal/volum-felt som mangler (uoppmålt innsjø)', () => {
    const lake = extractLakeFromAttributes({ hoyde: 88, navn: 'Lite tjern' })
    expect(lake).toEqual({ hoyde: 88, navn: 'Lite tjern' })
  })

  it('leser areal i km² direkte, og konverterer m² → km²', () => {
    expect(extractLakeFromAttributes({ hoyde: 123, areal_km2: 369 }).arealKm2).toBeCloseTo(369, 3)
    // Stor verdi uten km2 i navnet tolkes som m² og konverteres.
    expect(extractLakeFromAttributes({ hoyde: 123, areal: 369000000 }).arealKm2).toBeCloseTo(369, 3)
  })

  it('leser volum (mill. m³)', () => {
    const lake = extractLakeFromAttributes({ hoyde: 123, volum_mill_m3: 56000 })
    expect(lake.volumMillM3).toBe(56000)
  })

  it('markerer regulert magasin via magasinNr (+ navn)', () => {
    const lake = extractLakeFromAttributes({ hoyde: 500, magasinNr: 42, magasinNavn: 'Blåsjø' })
    expect(lake.magasin).toEqual({ nr: 42, navn: 'Blåsjø' })
  })

  it('magasinNr = 0 betyr uregulert (ingen magasin-felt)', () => {
    const lake = extractLakeFromAttributes({ hoyde: 300, magasinNr: 0 })
    expect(lake.magasin).toBeUndefined()
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

  it('slår sammen felt på tvers av lag (høyde på ett lag, dyp på et annet)', () => {
    const json = {
      results: [
        { layerName: 'Innsjø', attributes: { navn: 'Mjøsa', hoyde: 123 } },
        { layerName: 'Dybdedata', attributes: { maksdyp: 453, middeldyp: 153 } },
      ],
    }
    const lake = pickLakeFromIdentify(json)
    expect(lake).toEqual({ hoyde: 123, navn: 'Mjøsa', maxDybde: 453, midDybde: 153 })
  })

  it('returnerer null når ingen resultater har høyde', () => {
    expect(pickLakeFromIdentify({ results: [{ attributes: { navn: 'X' } }] })).toBeNull()
    expect(pickLakeFromIdentify({ results: [] })).toBeNull()
    expect(pickLakeFromIdentify({})).toBeNull()
  })
})

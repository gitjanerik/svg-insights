import { describe, it, expect } from 'vitest'
import { extractLakeFromAttributes, pickLakeFromIdentify, esriPolygonToRelation, nveIdentifyToWater } from './nveLakeFetcher.js'

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

describe('esriPolygonToRelation — NVE innsjø-flate → OSM-relation', () => {
  // Esri-konvensjon: ytre ring CW (negativt shoelace i lon/lat), hull CCW.
  const outerCW = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]      // klokka → outer
  const innerCCW = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]] // mot klokka → hull

  it('lager en natural=water-relation med _source=nve fra én ytre ring', () => {
    const el = esriPolygonToRelation({ rings: [outerCW] }, { navn: 'Røssvatnet' }, '7')
    expect(el.type).toBe('relation')
    expect(el.id).toBe('nve-7')
    expect(el._source).toBe('nve')
    expect(el.tags).toEqual({ natural: 'water', name: 'Røssvatnet' })
    expect(el.members).toHaveLength(1)
    expect(el.members[0].role).toBe('outer')
    // [lon,lat] → {lat,lon}
    expect(el.members[0].geometry[1]).toEqual({ lat: 1, lon: 0 })
  })

  it('klassifiserer hull (CCW) som inner og ytre (CW) som outer', () => {
    const el = esriPolygonToRelation({ rings: [outerCW, innerCCW] }, {}, '0')
    const roles = el.members.map(m => m.role)
    expect(roles).toContain('outer')
    expect(roles).toContain('inner')
    expect(el.tags.name).toBeUndefined()
  })

  it('returnerer null for tom/ugyldig geometri', () => {
    expect(esriPolygonToRelation({}, {}, '0')).toBeNull()
    expect(esriPolygonToRelation({ rings: [] }, {}, '0')).toBeNull()
    expect(esriPolygonToRelation({ rings: [[[0, 0], [1, 1]]] }, {}, '0')).toBeNull() // < 4 pkt
  })
})

describe('nveIdentifyToWater — identify-respons → vann-elementer', () => {
  it('beholder kun polygon-resultater (dropper linjer/punkt)', () => {
    const json = {
      results: [
        { layerName: 'Innsjø', geometry: { rings: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] }, attributes: { navn: 'A' } },
        { layerName: 'Dybdekontur', geometry: { paths: [[[0, 0], [1, 1]]] }, attributes: {} },     // linje
        { layerName: 'Dybdepunkt', geometry: { x: 0.5, y: 0.5 }, attributes: {} },                  // punkt
        { layerName: 'Magasin', geometry: { rings: [[[2, 2], [2, 3], [3, 3], [3, 2], [2, 2]]] }, attributes: { magnavn: 'B' } },
      ],
    }
    const els = nveIdentifyToWater(json)
    expect(els).toHaveLength(2)
    expect(els.every(e => e.tags.natural === 'water' && e._source === 'nve')).toBe(true)
  })

  it('returnerer tom array for tom/ugyldig respons', () => {
    expect(nveIdentifyToWater({})).toEqual([])
    expect(nveIdentifyToWater({ results: [] })).toEqual([])
    expect(nveIdentifyToWater(null)).toEqual([])
  })

  it('dedup-er samme innsjø som returneres fra flere lag (samme vatnLnr)', () => {
    // identify med layers:'all' gir samme innsjø fra både høyde- og dyp-laget.
    // Uten dedup blir det to overlappende polygoner → fyllet kanselleres i
    // buildSvgs evenodd-merge for navnløse vann (blått omriss, ingen flate).
    const ring = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]
    const json = {
      results: [
        { layerName: 'Innsjø', geometry: { rings: [ring] }, attributes: { vatnLnr: 42, hoyde: 162 } },
        { layerName: 'Dybdedata', geometry: { rings: [ring] }, attributes: { vatnLnr: 42, maksdyp: 3 } },
      ],
    }
    expect(nveIdentifyToWater(json)).toHaveLength(1)
  })

  it('dedup-er på form-signatur når vatnLnr mangler (navnløst tjern)', () => {
    const ring = [[10, 60], [10, 60.001], [10.002, 60.001], [10.002, 60], [10, 60]]
    // Litt ulik generalisering pr lag (ekstra punkt), men samme omriss → dedup.
    const ringGeneralized = [[10, 60], [10, 60.0005], [10, 60.001], [10.002, 60.001], [10.002, 60], [10, 60]]
    const json = {
      results: [
        { layerName: 'Innsjø', geometry: { rings: [ring] }, attributes: { hoyde: 216 } },
        { layerName: 'Innsjø (generalisert)', geometry: { rings: [ringGeneralized] }, attributes: {} },
      ],
    }
    expect(nveIdentifyToWater(json)).toHaveLength(1)
  })

  it('dedup-er samme innsjø selv når et lag flytter et ekstrempunkt litt (form stabil)', () => {
    // Regresjonen Ulvenvann-tilfellet avdekket: per-lag-generalisering flytter
    // ÉT ekstrempunkt nok til at en bbox-hjørne-signatur (kvantisert ~11 m)
    // ga to ulike nøkler → dedup bommet → evenodd-merge kansellerte fyllet.
    // Areal-vektet sentroid + areal er nær uendret av ett flyttet punkt → dedup.
    const ring = [[10, 60], [10, 60.01], [10.02, 60.01], [10.02, 60], [10, 60]]
    // Samme innsjø, men ett hjørne dratt ~20 m utover i det andre laget.
    const ringShifted = [[10, 60], [10, 60.0102], [10.0202, 60.0101], [10.02, 60], [10, 60]]
    const json = {
      results: [
        { layerName: 'Innsjø', geometry: { rings: [ring] }, attributes: { hoyde: 188 } },
        { layerName: 'Innsjø dyp', geometry: { rings: [ringShifted] }, attributes: {} },
      ],
    }
    expect(nveIdentifyToWater(json)).toHaveLength(1)
  })

  it('beholder navnet når et duplikat-lag har det selv om det første ikke har', () => {
    const ring = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]
    const json = {
      results: [
        { layerName: 'Innsjø', geometry: { rings: [ring] }, attributes: { vatnLnr: 7 } },
        { layerName: 'Innsjø navn', geometry: { rings: [ring] }, attributes: { vatnLnr: 7, navn: 'Suoidnejávri' } },
      ],
    }
    const els = nveIdentifyToWater(json)
    expect(els).toHaveLength(1)
    expect(els[0].tags.name).toBe('Suoidnejávri')
  })

  it('beholder distinkte innsjøer (ulik geometri) som separate elementer', () => {
    const a = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]
    const b = [[5, 5], [5, 6], [6, 6], [6, 5], [5, 5]]
    const json = {
      results: [
        { layerName: 'Innsjø', geometry: { rings: [a] }, attributes: { hoyde: 161 } },
        { layerName: 'Innsjø', geometry: { rings: [b] }, attributes: { hoyde: 262 } },
      ],
    }
    expect(nveIdentifyToWater(json)).toHaveLength(2)
  })
})

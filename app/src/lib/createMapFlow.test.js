import { describe, it, expect } from 'vitest'
import { filterOsmWaterElements } from './createMapFlow.js'

// Regresjon: brede elver (Drammenselva, tagget natural=water+water=river) skal
// IKKE forsvinne når NVE/N50 returnerer ferskvann. NVE/N50 leverer kun innsjø-
// flater, aldri elveløp — så et elve-areal som droppes erstattes av ingenting,
// og kartet sitter igjen med kun den hårtynne waterway=river-senterlinja (304).
const el = (tags) => ({ type: 'way', id: 1, tags })

// En lukket ring (lon/lat) rundt et lite område ved (10, 60) — brukes som NVE-
// innsjø-dekning. Et OSM-vann-element med sentroide her regnes som NVE-dekket.
const NVE_RING = [[10, 60], [10, 60.01], [10.01, 60.01], [10.01, 60], [10, 60]]
const ringGeom = (lon0, lat0, lon1, lat1) => [
  { lat: lat0, lon: lon0 }, { lat: lat0, lon: lon1 },
  { lat: lat1, lon: lon1 }, { lat: lat1, lon: lon0 }, { lat: lat0, lon: lon0 },
]
// OSM-innsjø MED geometri inne i NVE-ringen / langt unna.
const lakeInsideNve = (tags) => ({ type: 'way', id: 2, tags, geometry: ringGeom(10.002, 60.002, 10.008, 60.008) })
const lakeOutsideNve = (tags) => ({ type: 'way', id: 3, tags, geometry: ringGeom(11.0, 59.0, 11.01, 59.01) })

describe('filterOsmWaterElements — elve-flater overlever autoritativt ferskvann', () => {
  const flagsWithNve = { n50HasSea: false, n50HasFreshwater: false, nveLakeRings: [NVE_RING] }
  const flagsWithN50 = { n50HasSea: true, n50HasFreshwater: true, nveLakeRings: null }

  it('navngitt elve-flate (Drammenselva) beholdes når NVE har innsjøer', () => {
    const river = el({ natural: 'water', water: 'river', name: 'Drammenselva' })
    expect(filterOsmWaterElements([river], flagsWithNve)).toEqual([river])
  })

  it('UNAVNGITT elve-flate beholdes når N50 har ferskvann', () => {
    const river = el({ natural: 'water', water: 'river' })
    expect(filterOsmWaterElements([river], flagsWithN50)).toEqual([river])
  })

  it('waterway=riverbank-areal beholdes selv med NVE-innsjøer', () => {
    const bank = el({ waterway: 'riverbank' })
    expect(filterOsmWaterElements([bank], flagsWithNve)).toEqual([bank])
  })

  it('innsjø-flate undertrykkes når NVE dekker den (mistagget flom-innsjø)', () => {
    const lake = lakeInsideNve({ natural: 'water', name: 'Røssvatnet' })
    expect(filterOsmWaterElements([lake], flagsWithNve)).toEqual([])
  })

  it('innsjø NVE IKKE dekker beholdes (Ulvenvatnet-fiks — NVE-respons ufullstendig)', () => {
    // Selv om NVE returnerte ANDRE innsjøer, skal en innsjø utenfor enhver
    // NVE-ring ikke forsvinne. Tidligere ble ALT OSM-ferskvann droppet straks
    // NVE returnerte noe → innsjøer NVE bommet på forsvant helt.
    const lake = lakeOutsideNve({ natural: 'water', name: 'Ulvenvatnet' })
    expect(filterOsmWaterElements([lake], flagsWithNve)).toEqual([lake])
  })

  it('navnløst tjern NVE ikke dekker beholdes når N50 mangler ferskvann', () => {
    const tjern = lakeOutsideNve({ natural: 'water' })
    expect(filterOsmWaterElements([tjern], flagsWithNve)).toEqual([tjern])
  })

  it('saltvann undertrykkes når N50 har sjø, men beholdes ellers', () => {
    const sea = el({ natural: 'water', salt: 'yes' })
    expect(filterOsmWaterElements([sea], { n50HasSea: true })).toEqual([])
    expect(filterOsmWaterElements([sea], { n50HasSea: false })).toEqual([sea])
  })

  it('uten autoritative kilder (nettleser/CORS-feil) beholdes ALT OSM-vann', () => {
    const els = [
      el({ natural: 'water', water: 'river', name: 'Drammenselva' }),
      el({ natural: 'water', name: 'Tyrifjorden' }),
      el({ waterway: 'stream' }),
      el({ highway: 'path' }),
    ]
    expect(filterOsmWaterElements(els, {})).toEqual(els)
  })

  it('bekke-LINJE undertrykkes kun når N50 har ferskvann', () => {
    const stream = el({ waterway: 'stream' })
    expect(filterOsmWaterElements([stream], { n50HasFreshwater: true })).toEqual([])
    expect(filterOsmWaterElements([stream], { n50HasFreshwater: false })).toEqual([stream])
  })

  it('ikke-vann-elementer passerer uberørt', () => {
    const road = el({ highway: 'residential' })
    expect(filterOsmWaterElements([road], flagsWithNve)).toEqual([road])
  })
})

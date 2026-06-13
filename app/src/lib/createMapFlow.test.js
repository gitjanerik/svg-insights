import { describe, it, expect } from 'vitest'
import { filterOsmWaterElements } from './createMapFlow.js'

// Regresjon: brede elver (Drammenselva, tagget natural=water+water=river) skal
// IKKE forsvinne når NVE/N50 returnerer ferskvann. NVE/N50 leverer kun innsjø-
// flater, aldri elveløp — så et elve-areal som droppes erstattes av ingenting,
// og kartet sitter igjen med kun den hårtynne waterway=river-senterlinja (304).
const el = (tags) => ({ type: 'way', id: 1, tags })

describe('filterOsmWaterElements — elve-flater overlever autoritativt ferskvann', () => {
  const flagsWithNve = { n50HasSea: false, n50HasFreshwater: false, nveHasLakes: true }
  const flagsWithN50 = { n50HasSea: true, n50HasFreshwater: true, nveHasLakes: false }

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

  it('innsjø-flate undertrykkes når NVE er autoritativ (uendret oppførsel)', () => {
    const lake = el({ natural: 'water', name: 'Røssvatnet' })
    expect(filterOsmWaterElements([lake], flagsWithNve)).toEqual([])
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

import { describe, it, expect } from 'vitest'
import {
  haversineKm, findNearestStation, latestObservation,
  PARAM_WATER_LEVEL, PARAM_WATER_TEMP,
} from './nveHydApi.js'

describe('haversineKm', () => {
  it('gir ~0 for samme punkt', () => {
    expect(haversineKm(60.75, 10.85, 60.75, 10.85)).toBeCloseTo(0, 5)
  })
  it('måler en kjent avstand grovt riktig (~1.11 km pr 0.01° lat)', () => {
    expect(haversineKm(60.0, 10.0, 60.01, 10.0)).toBeCloseTo(1.111, 1)
  })
})

describe('findNearestStation', () => {
  const lvl = (extra) => ({ seriesList: [{ parameter: PARAM_WATER_LEVEL }], ...extra })

  it('velger nærmeste stasjon som måler parameteren', () => {
    const stations = [
      lvl({ stationId: 'A', stationName: 'Fjern', latitude: 60.80, longitude: 10.85 }),
      lvl({ stationId: 'B', stationName: 'Nær', latitude: 60.751, longitude: 10.851 }),
    ]
    const m = findNearestStation(stations, 60.75, 10.85, { parameter: PARAM_WATER_LEVEL })
    expect(m.station.stationId).toBe('B')
  })

  it('hopper over stasjoner uten parameteren', () => {
    const stations = [
      { stationId: 'T', latitude: 60.751, longitude: 10.851, seriesList: [{ parameter: PARAM_WATER_TEMP }] },
      lvl({ stationId: 'L', latitude: 60.76, longitude: 10.86 }),
    ]
    const m = findNearestStation(stations, 60.75, 10.85, { parameter: PARAM_WATER_LEVEL })
    expect(m.station.stationId).toBe('L')
  })

  it('returnerer null når alt er utenfor maxKm', () => {
    const stations = [lvl({ stationId: 'X', latitude: 61.5, longitude: 11.9 })]
    expect(findNearestStation(stations, 60.75, 10.85, { maxKm: 12 })).toBeNull()
  })

  it('foretrekker stasjon med masl som matcher innsjøhøyde (ikke elve-stasjon nær ved)', () => {
    const stations = [
      // Nærmest, men feil høyde (elv i dalbunnen ~5 moh).
      lvl({ stationId: 'ELV', latitude: 60.7505, longitude: 10.8505, masl: 5 }),
      // Litt lenger unna, men på innsjøflata (~123 moh).
      lvl({ stationId: 'INNSJO', latitude: 60.755, longitude: 10.855, masl: 123 }),
    ]
    const m = findNearestStation(stations, 60.75, 10.85, { lakeHoyde: 123, maslTolM: 6 })
    expect(m.station.stationId).toBe('INNSJO')
  })

  it('faller tilbake til avstand når masl er ukjent', () => {
    const stations = [
      lvl({ stationId: 'A', latitude: 60.751, longitude: 10.851 }),
      lvl({ stationId: 'B', latitude: 60.80, longitude: 10.90 }),
    ]
    const m = findNearestStation(stations, 60.75, 10.85, { lakeHoyde: 123 })
    expect(m.station.stationId).toBe('A')
  })
})

describe('latestObservation', () => {
  it('plukker nyeste gyldige punkt på tvers av serier', () => {
    const json = {
      data: [{
        observations: [
          { time: '2026-06-10T06:00:00Z', value: 122.8 },
          { time: '2026-06-10T08:00:00Z', value: 123.1 },
          { time: '2026-06-10T07:00:00Z', value: 123.0 },
        ],
      }],
    }
    expect(latestObservation(json)).toEqual({ time: '2026-06-10T08:00:00Z', value: 123.1 })
  })

  it('hopper over ikke-numeriske verdier', () => {
    const json = { data: [{ observations: [
      { time: '2026-06-10T08:00:00Z', value: null },
      { time: '2026-06-10T07:00:00Z', value: 12.4 },
    ] }] }
    expect(latestObservation(json)).toEqual({ time: '2026-06-10T07:00:00Z', value: 12.4 })
  })

  it('returnerer null for tom/ugyldig respons', () => {
    expect(latestObservation({ data: [] })).toBeNull()
    expect(latestObservation({})).toBeNull()
    expect(latestObservation(null)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import {
  enrichRoute, distanceToRoute, samplePointsAlong, routeBboxWgs84, dedupeByName, bboxToRing,
} from './routeEnrichment.js'
import { collectRedListed } from './redListNo.js'

describe('geometri-hjelpere', () => {
  it('distanceToRoute gir avstand + posisjon langs ruten', () => {
    const route = [[0, 0], [1000, 0]]
    const { distM, alongM } = distanceToRoute([500, 50], route)
    expect(distM).toBeCloseTo(50, 1)
    expect(alongM).toBeCloseTo(500, 0)
  })

  it('samplePointsAlong beholder endepunktene og gir stigende posisjon', () => {
    const pts = samplePointsAlong([[0, 0], [1000, 0]], 300, 10)
    expect(pts[0][0]).toBeCloseTo(0)
    expect(pts[pts.length - 1][0]).toBeCloseTo(1000)
    for (let i = 1; i < pts.length; i++) expect(pts[i][2]).toBeGreaterThan(pts[i - 1][2])
  })

  it('routeBboxWgs84 utvider med buffer', () => {
    const bb = routeBboxWgs84([[10, 59], [10.01, 59.01]], 150)
    expect(bb.south).toBeLessThan(59)
    expect(bb.north).toBeGreaterThan(59.01)
    expect(bb.west).toBeLessThan(10)
  })

  it('bboxToRing gir en lukket ring', () => {
    const ring = bboxToRing({ south: 1, west: 2, north: 3, east: 4 })
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(ring).toHaveLength(5)
  })

  it('dedupeByName fjerner dubletter på navn', () => {
    const out = dedupeByName([{ navn: 'A' }, { navn: 'a' }, { navn: 'B' }])
    expect(out.map(x => x.navn)).toEqual(['A', 'B'])
  })
})

// Lineær koordinat-mapping for testene: SVG (x,y) ↔ grader (lon=x/1000, lat=y/1000).
const toWgs84 = (x, y) => ({ lon: x / 1000, lat: y / 1000 })
const toSvg = (lat, lon) => ({ x: lon * 1000, y: lat * 1000 })

describe('enrichRoute', () => {
  const route = [[0, 0], [1000, 0]] // rett østover, 1000 m

  const fetchers = {
    fetchFredaKulturminner: async () => ([
      { navn: 'Nær', lat: 0.05, lon: 0.5, vernetype: 'Automatisk fredet', kategori: 'automatisk', kommune: 'X', link: null },
      { navn: 'Fjern', lat: 0.5, lon: 0.5, vernetype: 'Vedtaksfredet', kategori: 'vedtak', kommune: 'X', link: null },
    ]),
    fetchProtectedArea: async () => ({ navn: 'Testreservat', verneform: 'Naturreservat', arealKm2: 2.5, vernedato: '1980-01-01', forvaltning: 'SNO', faktaarkUrl: null }),
    fetchSpeciesSummary: async () => ({ observationCount: 42, speciesCount: 3, speciesCapped: false, speciesKeys: [10, 11, 12] }),
  }
  const redListLookup = {
    10: { c: 'EN', s: 'Sci ten', n: 'norsk ti', g: 'Fugler' },
    12: { c: 'VU', s: 'Sci tolv', n: 'norsk tolv', g: 'Planter' },
  }

  it('beholder kulturminner innen buffer, dropper de fjerne, sortert langs ruten', async () => {
    const r = await enrichRoute(route, { toWgs84, toSvg, bufferM: 150, fetchers, collectRedListed, redListLookup })
    expect(r.kulturminner).toHaveLength(1)
    expect(r.kulturminner[0].navn).toBe('Nær')
    expect(r.kulturminner[0].avstandM).toBeCloseTo(50, 0)
    expect(r.kilder.kulturminne).toBe(true)
  })

  it('dedupliserer verneområder langs ruten', async () => {
    const r = await enrichRoute(route, { toWgs84, toSvg, fetchers, collectRedListed, redListLookup })
    expect(r.reservater).toHaveLength(1)
    expect(r.reservater[0].navn).toBe('Testreservat')
    expect(r.kilder.vern).toBe(true)
  })

  it('teller rødlistede arter mot norsk rødliste-oppslag', async () => {
    const r = await enrichRoute(route, { toWgs84, toSvg, fetchers, collectRedListed, redListLookup })
    expect(r.arter.observasjoner).toBe(42)
    expect(r.arter.rodliste.antall).toBe(2)
    expect(r.arter.rodliste.perKategori.EN).toBe(1)
    expect(r.arter.rodliste.perKategori.VU).toBe(1)
  })

  it('svelger feil i en enkeltkilde (graceful) — resten fortsetter', async () => {
    const broken = {
      ...fetchers,
      fetchFredaKulturminner: async () => { throw new Error('WFS nede') },
    }
    const r = await enrichRoute(route, { toWgs84, toSvg, fetchers: broken, collectRedListed, redListLookup })
    expect(r.kulturminner).toEqual([])
    expect(r.kilder.kulturminne).toBe(false)
    expect(r.arter).not.toBeNull()          // arter-kilden gikk fint
    expect(r.kilder.arter).toBe(true)
  })

  it('rødliste er null når oppslaget mangler (dvale)', async () => {
    const r = await enrichRoute(route, { toWgs84, toSvg, fetchers, collectRedListed, redListLookup: null })
    expect(r.arter.rodliste).toBeNull()
  })
})

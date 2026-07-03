// v12.0.17: listMaps leser fra det lette 'meta'-storet i stedet for å
// deserialisere alle fulle records (multi-MB SVG-strenger) på hver
// hjemskjerm-last. projectMetaEntry er projeksjonen som holdes i sync ved
// hver saveMap — kontrakten låses her (IndexedDB selv testes ikke i jsdom-løs
// vitest; 'maps'-storet forblir source of truth og meta er gjenoppbyggbart).
import { describe, it, expect } from 'vitest'
import { projectMetaEntry, generateGravelRouteId } from './mapStorage.js'

const entry = {
  id: 'kart_abc123',
  navn: 'Testkart',
  bbox: { south: 59, north: 59.1, west: 10, east: 10.1 },
  center: { lat: 59.05, lon: 10.05 },
  halfKm: 4,
  equidistanceM: 20,
  opprettet: 1750000000000,
  isAuto: false,
  svg: '<svg>'.padEnd(5000, 'x'),
  dem: { buffer: new ArrayBuffer(1600) },
  annotations: [{ id: 'a1' }],
  tracks: [{ id: 't1', points: [] }],
  trackStyle: 'rød',
}

describe('projectMetaEntry — lett liste-projeksjon', () => {
  const meta = projectMetaEntry(entry)

  it('stripper de tunge/voksende feltene', () => {
    expect(meta.svg).toBeUndefined()
    expect(meta.dem).toBeUndefined()
    expect(meta.annotations).toBeUndefined()
    expect(meta.tracks).toBeUndefined()
    expect(meta.trackStyle).toBeUndefined()
  })

  it('beregner sizeBytes (svg-lengde + dem-buffer) og hasDem', () => {
    expect(meta.sizeBytes).toBe(5000 + 1600)
    expect(meta.hasDem).toBe(true)
  })

  it('bevarer liste-feltene', () => {
    expect(meta.id).toBe('kart_abc123')
    expect(meta.navn).toBe('Testkart')
    expect(meta.bbox).toEqual(entry.bbox)
    expect(meta.halfKm).toBe(4)
    expect(meta.equidistanceM).toBe(20)
    expect(meta.opprettet).toBe(1750000000000)
    expect(meta.isAuto).toBe(false)
  })

  it('tåler entry uten svg/dem', () => {
    const m = projectMetaEntry({ id: 'x', navn: 'y', opprettet: 1 })
    expect(m.sizeBytes).toBe(0)
    expect(m.hasDem).toBe(false)
  })
})

describe('generateGravelRouteId', () => {
  it('gir grus_-prefiks og unike id-er', () => {
    const a = generateGravelRouteId()
    const b = generateGravelRouteId()
    expect(a).toMatch(/^grus_[a-z0-9]+$/)
    expect(a).not.toBe(b)
  })
})

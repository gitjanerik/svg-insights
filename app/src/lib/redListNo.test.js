import { describe, it, expect } from 'vitest'
import { countRedListed, collectRedListed } from './redListNo.js'

describe('countRedListed', () => {
  const lookup = { 1001: 'CR', 1002: 'EN', 1003: 'VU', 1004: 'NT', 1005: 'EN' }

  it('teller rødlistede arter og fordeler på kategori', () => {
    const res = countRedListed([1001, 1002, 1005, 9999], lookup)
    expect(res.count).toBe(3)
    expect(res.byCategory).toEqual({ CR: 1, EN: 2, VU: 0, NT: 0 })
  })

  it('teller også med beriket objekt-format', () => {
    const rich = { 1001: { c: 'CR', s: 'Aaa', g: 'Fugler' }, 1002: { c: 'EN', s: 'Bbb', g: 'Sopper' } }
    const res = countRedListed([1001, 1002, 9999], rich)
    expect(res.count).toBe(2)
    expect(res.byCategory).toEqual({ CR: 1, EN: 1, VU: 0, NT: 0 })
  })

  it('ignorerer arter som ikke er i lista', () => {
    expect(countRedListed([42, 43], lookup).count).toBe(0)
  })

  it('matcher på tvers av tall/streng-nøkler', () => {
    // speciesKeys er tall, lookup-nøkler er objekt-strenger — JS slår opp likt.
    expect(countRedListed([1003], lookup).byCategory.VU).toBe(1)
  })

  it('robust mot tomt/ugyldig input', () => {
    expect(countRedListed([], lookup)).toEqual({ count: 0, byCategory: { CR: 0, EN: 0, VU: 0, NT: 0 } })
    expect(countRedListed(null, lookup).count).toBe(0)
    expect(countRedListed([1001], null).count).toBe(0)
  })
})

describe('collectRedListed', () => {
  const rich = {
    1001: { c: 'CR', s: 'Picus canus', n: 'gråspett', g: 'Fugler' },
    1002: { c: 'EN', s: 'Bombus distinguendus', n: 'kløverhumle', g: 'Vepser' },
    1003: { c: 'EN', s: 'Some lichen', g: 'Laver' }, // uten norsk navn
  }

  it('returnerer artsliste med navn og gruppe fra beriket bundel', () => {
    const res = collectRedListed([1001, 1002, 1003, 9999], rich)
    expect(res.count).toBe(3)
    expect(res.byCategory).toEqual({ CR: 1, EN: 2, VU: 0, NT: 0 })
    expect(res.species).toContainEqual({ key: 1001, category: 'CR', sci: 'Picus canus', vern: 'gråspett', group: 'Fugler' })
    expect(res.species.find((s) => s.key === 1003).vern).toBe('') // mangler norsk navn → tom
  })

  it('teller fra gammelt flatt format men gir tom artsliste (degradering)', () => {
    const flat = { 1001: 'CR', 1002: 'EN' }
    const res = collectRedListed([1001, 1002], flat)
    expect(res.count).toBe(2)
    expect(res.species).toEqual([])
  })
})

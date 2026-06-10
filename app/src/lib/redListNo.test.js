import { describe, it, expect } from 'vitest'
import { countRedListed } from './redListNo.js'

describe('countRedListed', () => {
  const lookup = { 1001: 'CR', 1002: 'EN', 1003: 'VU', 1004: 'NT', 1005: 'EN' }

  it('teller rødlistede arter og fordeler på kategori', () => {
    const res = countRedListed([1001, 1002, 1005, 9999], lookup)
    expect(res.count).toBe(3)
    expect(res.byCategory).toEqual({ CR: 1, EN: 2, VU: 0, NT: 0 })
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

import { describe, it, expect } from 'vitest'
import {
  extractNaturtypeFromAttributes,
  pickNaturtypesFromIdentify,
} from './naturtypeFetcher.js'

describe('extractNaturtypeFromAttributes', () => {
  it('plukker naturtype/utforming/verdi/tilstand/navn', () => {
    const nt = extractNaturtypeFromAttributes({
      Naturtype: 'Slåttemark',
      Utforming: 'Frisk fattigeng',
      Verdi: 'Svært høy kvalitet',
      Tilstand: 'God',
      områdenavn: 'Storenga',
      NaturtypeId: 'BN00012345',
    })
    expect(nt).toMatchObject({
      naturtype: 'Slåttemark',
      utforming: 'Frisk fattigeng',
      verdi: 'Svært høy kvalitet',
      tilstand: 'God',
      navn: 'Storenga',
      id: 'BN00012345',
    })
  })

  it('krever et naturtype-navn (anker) — ellers null', () => {
    expect(extractNaturtypeFromAttributes({ Utforming: 'noe', Verdi: 'Høy' })).toBeNull()
    expect(extractNaturtypeFromAttributes(null)).toBeNull()
  })

  it('faller tilbake til sammensatt id når ingen id-felt finnes', () => {
    const nt = extractNaturtypeFromAttributes({ naturtype: 'Rikmyr', utforming: 'Kalkrik' })
    expect(nt.id).toBe('Rikmyr|Kalkrik')
    expect(nt.verdi).toBeNull()
  })

  it('behandler null-aktige strenger som fravær', () => {
    const nt = extractNaturtypeFromAttributes({ naturtype: 'Gammelskog', verdi: '<Null>', tilstand: '-' })
    expect(nt.verdi).toBeNull()
    expect(nt.tilstand).toBeNull()
  })
})

describe('pickNaturtypesFromIdentify', () => {
  const json = {
    results: [
      { attributes: { Naturtype: 'Slåttemark', NaturtypeId: 'A1', Verdi: 'Høy' } },
      { attributes: { Naturtype: 'Slåttemark', NaturtypeId: 'A1', Verdi: 'Høy' } }, // duplikat
      { attributes: { Naturtype: 'Rikmyr', NaturtypeId: 'B2', Verdi: 'Moderat' } },
      { attributes: { Kommune: 'Oslo' } }, // ingen naturtype → hoppes over
    ],
  }

  it('dedupliserer på id og hopper over poster uten naturtype', () => {
    const items = pickNaturtypesFromIdentify(json)
    expect(items.map((n) => n.id)).toEqual(['A1', 'B2'])
  })

  it('begrenser til max treff', () => {
    expect(pickNaturtypesFromIdentify(json, 1)).toHaveLength(1)
  })

  it('returnerer tom liste for tom/ugyldig respons', () => {
    expect(pickNaturtypesFromIdentify(null)).toEqual([])
    expect(pickNaturtypesFromIdentify({ results: [] })).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import { tileDistance, selectTilesToEvict } from './tileCache.js'

const at = (id, lat, lon) => ({ id, center: { lat, lon } })

describe('tileDistance', () => {
  it('er 0 for samme punkt', () => {
    expect(tileDistance({ lat: 59.9, lon: 10.7 }, { lat: 59.9, lon: 10.7 })).toBe(0)
  })

  it('vokser monotont med avstand', () => {
    const c = { lat: 59.9, lon: 10.7 }
    const near = tileDistance(c, { lat: 59.91, lon: 10.7 })
    const far = tileDistance(c, { lat: 60.0, lon: 10.7 })
    expect(far).toBeGreaterThan(near)
  })

  it('returnerer Infinity ved manglende senter', () => {
    expect(tileDistance(null, { lat: 1, lon: 2 })).toBe(Infinity)
    expect(tileDistance({ lat: 1, lon: 2 }, undefined)).toBe(Infinity)
    expect(tileDistance({ lon: 2 }, { lat: 1, lon: 2 })).toBe(Infinity)
  })
})

describe('selectTilesToEvict', () => {
  const center = { lat: 59.90, lon: 10.70 }

  it('sletter ingenting når antallet er på/under cap', () => {
    const tiles = [at('a', 59.90, 10.70), at('b', 59.91, 10.71)]
    expect(selectTilesToEvict(tiles, center, 2)).toEqual([])
    expect(selectTilesToEvict(tiles, center, 5)).toEqual([])
  })

  it('sletter de fjerneste flisene først', () => {
    const tiles = [
      at('near', 59.90, 10.70),   // = senter
      at('mid', 59.93, 10.70),
      at('far', 60.05, 10.70),    // lengst unna
    ]
    // cap = 2 → 1 skal slettes: den fjerneste («far»)
    expect(selectTilesToEvict(tiles, center, 2)).toEqual(['far'])
  })

  it('sletter flere når cachen er langt over cap, fjerneste-først', () => {
    const tiles = [
      at('a', 59.90, 10.70),
      at('b', 59.92, 10.70),
      at('c', 59.95, 10.70),
      at('d', 60.10, 10.70),  // fjernest
    ]
    // cap = 2 → 2 slettes: de to fjerneste (d, c) i den rekkefølgen
    expect(selectTilesToEvict(tiles, center, 2)).toEqual(['d', 'c'])
  })

  it('beskytter aldri-slett-id-er selv om de er fjernest', () => {
    const tiles = [
      at('near', 59.90, 10.70),
      at('mid', 59.93, 10.70),
      at('far', 60.05, 10.70),
    ]
    // cap = 2, men «far» er beskyttet → nest-fjerneste («mid») slettes i stedet
    expect(selectTilesToEvict(tiles, center, 2, ['far'])).toEqual(['mid'])
  })

  it('overskrider ikke ved å slette beskyttede fliser', () => {
    const tiles = [at('a', 59.90, 10.70), at('b', 59.95, 10.70), at('c', 60.05, 10.70)]
    // cap = 1 ⇒ vil slette 2, men a+b beskyttet ⇒ kun «c» kan slettes
    expect(selectTilesToEvict(tiles, center, 1, ['a', 'b'])).toEqual(['c'])
  })

  it('tåler manglende senter på en flis (behandles som fjernest)', () => {
    const tiles = [
      at('near', 59.90, 10.70),
      { id: 'broken' },           // mangler center → Infinity-avstand
      at('mid', 59.93, 10.70),
    ]
    expect(selectTilesToEvict(tiles, center, 2)).toEqual(['broken'])
  })

  it('returnerer [] for ugyldig input', () => {
    expect(selectTilesToEvict(null, center, 2)).toEqual([])
    expect(selectTilesToEvict(undefined, center, 2)).toEqual([])
  })
})

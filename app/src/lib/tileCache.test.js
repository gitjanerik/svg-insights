import { describe, it, expect } from 'vitest'
import { tileDistance, selectTilesToEvict, tileOffset, rectOverlapFraction, tilesAreGridCompatible } from './tileCache.js'

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

describe('tileOffset', () => {
  it('en nabo rett øst plasseres én bredde til høyre, samme y', () => {
    // aktiv: minE=1000, maxN=5000, 500 m bred. nabo rett øst: minE=1500, maxN=5000.
    const active = { minE: 1000, maxN: 5000 }
    const ghost = { minE: 1500, maxN: 5000 }
    expect(tileOffset(active, ghost)).toEqual({ dx: 500, dy: 0 })
  })

  it('en nabo rett nord plasseres over (negativ y) pga speilet akse', () => {
    // nabo nord har høyere maxN → mindre y (oppover på skjermen)
    const active = { minE: 1000, maxN: 5000 }
    const ghost = { minE: 1000, maxN: 5500 }
    expect(tileOffset(active, ghost)).toEqual({ dx: 0, dy: -500 })
  })

  it('en nabo sør får positiv y (nedover)', () => {
    const active = { minE: 1000, maxN: 5000 }
    const ghost = { minE: 1000, maxN: 4500 }
    expect(tileOffset(active, ghost)).toEqual({ dx: 0, dy: 500 })
  })

  it('returnerer null ved manglende koordinater', () => {
    expect(tileOffset(null, { minE: 1, maxN: 2 })).toBeNull()
    expect(tileOffset({ minE: 1, maxN: 2 }, { minE: 1 })).toBeNull()
  })
})

describe('tilesAreGridCompatible', () => {
  // aktiv flis: origo (1000, 4000), 500×600 m
  const active = { minE: 1000, minN: 4000, widthM: 500, heightM: 600 }

  it('godtar nabo rett øst (på gitteret, samme størrelse)', () => {
    expect(tilesAreGridCompatible(active, { minE: 1500, minN: 4000, widthM: 500, heightM: 600 })).toBe(true)
  })

  it('godtar diagonal nabo på gitteret', () => {
    expect(tilesAreGridCompatible(active, { minE: 1500, minN: 4600, widthM: 500, heightM: 600 })).toBe(true)
  })

  it('godtar nabo vest/sør (negativt offset)', () => {
    expect(tilesAreGridCompatible(active, { minE: 500, minN: 4000, widthM: 500, heightM: 600 })).toBe(true)
    expect(tilesAreGridCompatible(active, { minE: 1000, minN: 3400, widthM: 500, heightM: 600 })).toBe(true)
  })

  it('godtar float-rest innen toleranse (wrap-around)', () => {
    // delta = 999.6 ≈ 2*500 - 0.4 → wrap-around-restavstand 0.4 ≤ 1
    expect(tilesAreGridCompatible(active, { minE: 1999.6, minN: 4000, widthM: 500, heightM: 600 })).toBe(true)
  })

  it('avviser ulik størrelse (bredde/høyde utenfor toleranse)', () => {
    expect(tilesAreGridCompatible(active, { minE: 1500, minN: 4000, widthM: 550, heightM: 600 })).toBe(false)
    expect(tilesAreGridCompatible(active, { minE: 1500, minN: 4000, widthM: 500, heightM: 650 })).toBe(false)
  })

  it('avviser samme størrelse men utenfor gitteret', () => {
    // forskjøvet en halv flis i øst → ikke på gitteret
    expect(tilesAreGridCompatible(active, { minE: 1250, minN: 4000, widthM: 500, heightM: 600 })).toBe(false)
  })

  it('avviser null / 0-størrelse input', () => {
    expect(tilesAreGridCompatible(null, active)).toBe(false)
    expect(tilesAreGridCompatible(active, null)).toBe(false)
    expect(tilesAreGridCompatible({ minE: 0, minN: 0, widthM: 0, heightM: 600 }, active)).toBe(false)
    expect(tilesAreGridCompatible(active, { minE: 1500, minN: 4000, widthM: 0, heightM: 600 })).toBe(false)
  })
})

describe('rectOverlapFraction', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 }

  it('er 0 for abuttende (ikke-overlappende) rektangler', () => {
    expect(rectOverlapFraction(a, { x: 100, y: 0, w: 100, h: 100 })).toBe(0)
  })

  it('er 1 for identiske rektangler', () => {
    expect(rectOverlapFraction(a, { x: 0, y: 0, w: 100, h: 100 })).toBe(1)
  })

  it('regner riktig delvis overlapp', () => {
    // b dekker høyre halvdel av a → 50 %
    expect(rectOverlapFraction(a, { x: 50, y: 0, w: 100, h: 100 })).toBeCloseTo(0.5)
    // forskjøvet både x og y med 50 → 25 % overlapp
    expect(rectOverlapFraction(a, { x: 50, y: 50, w: 100, h: 100 })).toBeCloseTo(0.25)
  })

  it('er 0 for ugyldig/0-areal input', () => {
    expect(rectOverlapFraction(null, a)).toBe(0)
    expect(rectOverlapFraction({ x: 0, y: 0, w: 0, h: 100 }, a)).toBe(0)
  })
})

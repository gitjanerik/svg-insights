import { describe, it, expect } from 'vitest'
import { tileSize, tileKey, neighborTiles, TileLRU } from './tileGrid.js'

// 3×3-fliskart (v9.3.40): geometrien som plasserer de 8 naboflisene rundt
// midt-flisen. Må være EKSAKT tilstøtende (ingen overlapp/glipe) og ha riktig
// SVG-meter-offset (nord opp ⇒ nordlig nabo har negativ y).

const center = { minE: 600000, maxE: 601000, minN: 6600000, maxN: 6601000 } // 1×1 km

describe('tileSize / tileKey', () => {
  it('tileSize gir bredde/høyde i meter', () => {
    expect(tileSize(center)).toEqual({ w: 1000, h: 1000 })
  })
  it('tileKey er stabil for samme utsnitt og unik per flis', () => {
    const k = tileKey(center)
    expect(k).toBe(tileKey({ ...center }))
    // nabo én flis øst har annen nøkkel
    const east = { minE: 601000, maxE: 602000, minN: 6600000, maxN: 6601000 }
    expect(tileKey(east)).not.toBe(k)
  })
})

describe('neighborTiles', () => {
  const ns = neighborTiles(center)

  it('gir nøyaktig 8 naboer (ikke midt-flisen selv)', () => {
    expect(ns).toHaveLength(8)
    expect(ns.some(n => n.dx === 0 && n.dy === 0)).toBe(false)
  })

  it('naboene er eksakt tilstøtende, samme størrelse', () => {
    for (const n of ns) {
      expect(tileSize(n.utmBbox)).toEqual({ w: 1000, h: 1000 })
      expect(n.utmBbox.minE).toBe(600000 + n.dx * 1000)
      expect(n.utmBbox.minN).toBe(6600000 + n.dy * 1000)
    }
  })

  it('offset: øst-nabo +1000 x, nord-nabo −1000 y (nord opp)', () => {
    const east = ns.find(n => n.dx === 1 && n.dy === 0)
    expect(east.offsetM).toEqual({ x: 1000, y: 0 })
    const north = ns.find(n => n.dx === 0 && n.dy === 1)
    expect(north.offsetM).toEqual({ x: 0, y: -1000 })
    const south = ns.find(n => n.dx === 0 && n.dy === -1)
    expect(south.offsetM).toEqual({ x: 0, y: 1000 })
    const sw = ns.find(n => n.dx === -1 && n.dy === -1)
    expect(sw.offsetM).toEqual({ x: -1000, y: 1000 })
  })

  it('hver nabo har en WGS84-bbox med riktig orientering', () => {
    for (const n of ns) {
      expect(n.bbox.north).toBeGreaterThan(n.bbox.south)
      expect(n.bbox.east).toBeGreaterThan(n.bbox.west)
    }
  })
})

describe('TileLRU', () => {
  it('skyver ut eldste når kapasitet overskrides', () => {
    const lru = new TileLRU(3)
    expect(lru.set('a', 1)).toBeNull()
    expect(lru.set('b', 2)).toBeNull()
    expect(lru.set('c', 3)).toBeNull()
    const evicted = lru.set('d', 4)        // 'a' er eldst
    expect(evicted).toEqual({ key: 'a', value: 1 })
    expect(lru.has('a')).toBe(false)
    expect(lru.size).toBe(3)
  })

  it('get markerer som nylig brukt (unngår utskyving)', () => {
    const lru = new TileLRU(3)
    lru.set('a', 1); lru.set('b', 2); lru.set('c', 3)
    lru.get('a')                            // 'a' nå nyligst → 'b' er eldst
    const evicted = lru.set('d', 4)
    expect(evicted.key).toBe('b')
    expect(lru.has('a')).toBe(true)
  })
})

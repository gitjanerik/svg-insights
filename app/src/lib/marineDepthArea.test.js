import { describe, it, expect } from 'vitest'
import { buildSvg } from './mapBuilder.js'
import { sjokartToElements } from './sjokartFetcher.js'

// Regresjon (Holmen/Drammen): Sjøkart-dybdeareal (307) skal vise elvevann med
// dybde på BEGGE sider av en øy. Tidligere ble 307 klippet mot den DEM-deriverte
// sjøen (areal ≤ 0,5 m som rører kartkanten) — elvekanaler over havnivå falt
// utenfor og ble kappet bort, så bare beige land + flytende dybde-tall sto igjen.
// Nå rendres 307 med Sjøkarts egen geometri (øy-hull bevart), uten DEM-klipping.
const bbox = { south: 59.90, north: 59.92, west: 10.74, east: 10.78 }
const ll = (pairs) => pairs.map(([lat, lon]) => ({ lat, lon }))
// N50-sjø i VESTRE halvdel → setter authoritativeSea (vest).
const n50Sea = {
  type: 'way', id: 1, _source: 'n50', tags: { natural: 'water', salt: 'yes' },
  geometry: ll([[59.90, 10.74], [59.92, 10.74], [59.92, 10.76], [59.90, 10.76], [59.90, 10.74]]),
}

describe('Sjøkart dybdeareal (307) klippes ikke lenger bort over elvekanaler', () => {
  it('307-areal i ØST (utenfor DEM/N50-sjø) rendres med dybdefarge', () => {
    const depth = {
      type: 'way', id: 2, _source: 'sjokart',
      tags: { sjokart: 'dybdeareal', minDybde: '2', maxDybde: '5' },
      geometry: ll([[59.905, 10.765], [59.915, 10.765], [59.915, 10.775], [59.905, 10.775], [59.905, 10.765]]),
    }
    const { svg } = buildSvg([n50Sea, depth], bbox, { useReal: false })
    const m = svg.match(/<g data-layer="vann" data-iso="307">([\s\S]*?)<\/g>/)
    expect(m).toBeTruthy()
    expect(/<path/.test(m[1])).toBe(true)
    expect(svg).toContain('data-dybde')   // per-polygon dybdefarge bevart
  })

  it('dybdeareal med øy-hull rendres som path med hull (fill-rule evenodd)', () => {
    // Ett dybdeareal som omslutter en øy: outer + ett hull.
    const outer = [[10.0, 59.0], [10.1, 59.0], [10.1, 59.1], [10.0, 59.1], [10.0, 59.0]]
    const hole = [[10.04, 59.04], [10.06, 59.04], [10.06, 59.06], [10.04, 59.06], [10.04, 59.04]]
    const els = sjokartToElements({
      dybdeareal: [{ geometry: { type: 'Polygon', coordinates: [outer, hole] },
                     properties: { minimumsdybde: 2, maksimumsdybde: 5 } }],
    })
    const big = { south: 58.9, north: 59.2, west: 9.9, east: 10.2 }
    const { svg } = buildSvg(els, big, { useReal: false })
    const m = svg.match(/<g data-layer="vann" data-iso="307">([\s\S]*?)<\/g>/)
    expect(m).toBeTruthy()
    // To subpaths (outer + hull) = to «M…»-kommandoer i samme path.
    const path = m[1].match(/d="([^"]*)"/)
    expect(path).toBeTruthy()
    const moveCount = (path[1].match(/M/g) || []).length
    expect(moveCount).toBe(2)                  // outer + hull
    expect(m[1]).toContain('fill-rule="evenodd"')
  })
})

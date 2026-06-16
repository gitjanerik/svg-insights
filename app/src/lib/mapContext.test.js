import { describe, it, expect } from 'vitest'
import {
  pointToSegmentDist,
  pointToPolylineDist,
  findNearestPlace,
} from './mapContext.js'

describe('pointToSegmentDist', () => {
  it('måler perpendikulær avstand til segmentet', () => {
    // Segment langs x-aksen fra (0,0) til (10,0); punkt rett over midten.
    expect(pointToSegmentDist(5, 3, 0, 0, 10, 0)).toBeCloseTo(3)
  })

  it('klamper til endepunkt når projeksjonen faller utenfor segmentet', () => {
    // Punkt til venstre for start → nærmeste punkt er (0,0).
    expect(pointToSegmentDist(-4, 0, 0, 0, 10, 0)).toBeCloseTo(4)
    // Punkt til høyre for slutt → nærmeste punkt er (10,0).
    expect(pointToSegmentDist(13, 0, 0, 0, 10, 0)).toBeCloseTo(3)
  })

  it('degenerert segment (a == b) gir avstand til punktet', () => {
    expect(pointToSegmentDist(3, 4, 0, 0, 0, 0)).toBeCloseTo(5)
  })
})

describe('pointToPolylineDist', () => {
  const line = [[0, 0], [10, 0], [10, 10]]

  it('finner nærmeste segment i en flersegments-linje', () => {
    // Nær det vertikale segmentet (10,0)-(10,10).
    expect(pointToPolylineDist(12, 5, line)).toBeCloseTo(2)
    // Nær det horisontale segmentet (0,0)-(10,0).
    expect(pointToPolylineDist(5, 1, line)).toBeCloseTo(1)
  })

  it('punkt på linjen gir ~0', () => {
    expect(pointToPolylineDist(10, 5, line)).toBeCloseTo(0)
  })

  it('tom/ugyldig input gir Infinity', () => {
    expect(pointToPolylineDist(0, 0, [])).toBe(Infinity)
    expect(pointToPolylineDist(0, 0, null)).toBe(Infinity)
  })

  it('enkelt-punkt-linje gir avstand til punktet', () => {
    expect(pointToPolylineDist(3, 4, [[0, 0]])).toBeCloseTo(5)
  })
})

describe('findNearestPlace', () => {
  const index = [
    { name: 'Toppen', kind: 'peak', x: 100, y: 100 },
    { name: 'Drammenselva', kind: 'omrade', x: 500, y: 500 },
    { name: 'Innsjø uten navn', kind: 'vann-omrade', x: 12, y: 12 },
  ]

  it('returnerer nærmeste ekte sted med avstand', () => {
    const r = findNearestPlace(index, 110, 110)
    expect(r.name).toBe('Toppen')
    expect(r.distM).toBeCloseTo(Math.hypot(10, 10))
  })

  it('hopper over syntetiske vann-omrade-entries', () => {
    // Punktet er nærmest «Innsjø uten navn» (vann-omrade), men den skal skippes.
    const r = findNearestPlace(index, 12, 12)
    expect(r.name).not.toBe('Innsjø uten navn')
  })

  it('tom indeks gir null', () => {
    expect(findNearestPlace([], 0, 0)).toBeNull()
  })
})

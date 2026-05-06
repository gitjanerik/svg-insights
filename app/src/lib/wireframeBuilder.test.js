import { describe, it, expect } from 'vitest'
import { buildWireframe, distance3D } from './wireframeBuilder.js'

describe('distance3D', () => {
  it('beregner euklidsk avstand', () => {
    expect(distance3D({ X: 0, Y: 0, Z: 0 }, { X: 3, Y: 4, Z: 0 })).toBe(5)
  })
})

describe('buildWireframe', () => {
  it('returnerer tom liste for under 2 punkter', () => {
    expect(buildWireframe([])).toEqual([])
    expect(buildWireframe([{ X: 0, Y: 0, Z: 0 }])).toEqual([])
  })

  it('lager k-NN-kanter for et lite cluster', () => {
    const points = [
      { X: 0, Y: 0, Z: 0 },
      { X: 1, Y: 0, Z: 0 },
      { X: 0, Y: 1, Z: 0 },
      { X: 1, Y: 1, Z: 0 },
    ]
    const edges = buildWireframe(points, { k: 2 })
    // Forventet: hver node forbundet til 2 nærmeste, dedup → ~4-5 kanter
    expect(edges.length).toBeGreaterThan(2)
    expect(edges.length).toBeLessThanOrEqual(6)
    // Alle kanter har gyldige indekser
    for (const e of edges) {
      expect(e.a).toBeGreaterThanOrEqual(0)
      expect(e.a).toBeLessThan(4)
      expect(e.b).toBeGreaterThanOrEqual(0)
      expect(e.b).toBeLessThan(4)
      expect(e.a).not.toBe(e.b)
    }
  })

  it('filtrerer outlier-kanter (langt fra median)', () => {
    // Cluster på origo + ett ekstremt langt-borte punkt
    const points = [
      { X: 0, Y: 0, Z: 0 },
      { X: 1, Y: 0, Z: 0 },
      { X: 0, Y: 1, Z: 0 },
      { X: 1, Y: 1, Z: 0 },
      { X: 100, Y: 100, Z: 100 }, // outlier
    ]
    const edges = buildWireframe(points, { k: 2, maxEdgeFactor: 1.8 })
    // Kanter til outlier-punktet (index 4) skal være borte
    for (const e of edges) {
      expect(e.a).not.toBe(4)
      expect(e.b).not.toBe(4)
    }
  })

  it('dedupliserer kanter (a-b og b-a er samme)', () => {
    const points = [
      { X: 0, Y: 0, Z: 0 },
      { X: 1, Y: 0, Z: 0 },
    ]
    const edges = buildWireframe(points, { k: 5 })
    expect(edges.length).toBe(1)
  })
})

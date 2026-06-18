import { describe, it, expect } from 'vitest'
import { buildRoutingGraph, kShortestRoutes } from './routing.js'

// Lite rutenett i SVG-meter-rom (coordinates allerede projisert).
// Et 2x2-grid med ekstra diagonal-snarvei, alt som ISOM 505 (sti):
//
//   A(0,0) ── B(100,0) ── C(200,0)
//     │          │           │
//   D(0,100) ─ E(100,100) ─ F(200,100)
//
// pluss en lengre omvei via G(100,-100) mellom B og E.
function gridFeatures() {
  const seg = (coords) => ({ coordinates: coords, isomCode: '505' })
  return [
    seg([[0, 0], [100, 0]]),       // A-B
    seg([[100, 0], [200, 0]]),     // B-C
    seg([[0, 0], [0, 100]]),       // A-D
    seg([[100, 0], [100, 100]]),   // B-E
    seg([[200, 0], [200, 100]]),   // C-F
    seg([[0, 100], [100, 100]]),   // D-E
    seg([[100, 100], [200, 100]]), // E-F
    // Omvei B → G → E (300 m vs 100 m direkte)
    seg([[100, 0], [100, -100]]),
    seg([[100, -100], [200, -100]]),
    seg([[200, -100], [200, 100]]),
  ]
}

describe('buildRoutingGraph', () => {
  it('bygger noder og kanter fra features', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    expect(rg.nodes).toBeGreaterThan(5)
    expect(rg.edges).toBeGreaterThan(5)
  })

  it('snapper sammenfallende endepunkter til samme node', () => {
    // To segmenter som deler punkt (100,0) skal gi ÉN node der.
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0]], isomCode: '505' },
      { coordinates: [[100, 0], [100, 100]], isomCode: '505' },
    ], { snapM: 2 })
    expect(rg.nodes).toBe(3)
  })

  it('finner korteste rute A→C', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const a = rg.nodeAt([0, 0])
    const c = rg.nodeAt([200, 0])
    const r = rg.route(a, c)
    expect(r).not.toBeNull()
    expect(r.lengthM).toBeCloseTo(200, 1)
    expect(r.coordinates[0]).toEqual([0, 0])
    expect(r.coordinates.at(-1)).toEqual([200, 0])
  })

  it('returnerer null for frakoblede komponenter', () => {
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0]], isomCode: '505' },
      { coordinates: [[500, 500], [600, 500]], isomCode: '505' },
    ], { snapM: 2 })
    const a = rg.nodeAt([0, 0])
    const b = rg.nodeAt([600, 500])
    expect(rg.route(a, b)).toBeNull()
  })

  it('ignorerer features uten routbar isomCode', () => {
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0]], isomCode: '101' }, // kontur — ikke routbar
    ], { snapM: 2 })
    expect(rg.nodes).toBe(0)
    expect(rg.edges).toBe(0)
  })
})

describe('nearestNode', () => {
  it('snapper et vilkårlig punkt til nærmeste node', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const hit = rg.nearestNode([95, 5]) // nær B(100,0)
    expect(hit).not.toBeNull()
    expect(hit.pos).toEqual([100, 0])
    expect(hit.distM).toBeCloseTo(Math.hypot(5, 5), 1)
  })

  it('finner node selv når den ligger langt utenfor søkevinduet', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const hit = rg.nearestNode([5000, 5000])
    expect(hit).not.toBeNull()
    // Nærmeste hjørne er F(200,100)
    expect(hit.pos).toEqual([200, 100])
  })

  it('returnerer null for tom graf', () => {
    const rg = buildRoutingGraph([], { snapM: 2 })
    expect(rg.nearestNode([0, 0])).toBeNull()
  })
})

describe('kShortestRoutes', () => {
  it('gir minst én rute og inkluderer korteste', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const b = rg.nodeAt([100, 0])
    const e = rg.nodeAt([100, 100])
    const routes = kShortestRoutes(rg, b, e, { k: 3 })
    expect(routes.length).toBeGreaterThanOrEqual(1)
    expect(routes[0].lengthM).toBeCloseTo(100, 1) // direkte B-E
  })

  it('finner distinkte alternativer når de finnes', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const b = rg.nodeAt([100, 0])
    const e = rg.nodeAt([100, 100])
    // maxLengthRatio høyt her: denne testen verifiserer distinkthet-mekanismen,
    // ikke æresrunde-cap-en (grid-ets eneste omvei B→E er ~5× korteste).
    const routes = kShortestRoutes(rg, b, e, { k: 3, penalty: 5, minShare: 0.5, maxLengthRatio: 100 })
    // Direkte (100 m) + en omvei skal være mulig
    expect(routes.length).toBeGreaterThanOrEqual(2)
    // Sortert kortest først
    for (let i = 1; i < routes.length; i++) {
      expect(routes[i].lengthM).toBeGreaterThanOrEqual(routes[i - 1].lengthM)
    }
  })

  it('restaurerer kant-cost etter beregning', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const b = rg.nodeAt([100, 0])
    const e = rg.nodeAt([100, 100])
    const costsBefore = []
    rg.graph.forEachEdge((edge) => costsBefore.push(rg.graph.getEdgeAttribute(edge, 'cost')))
    kShortestRoutes(rg, b, e, { k: 3, penalty: 5 })
    const costsAfter = []
    rg.graph.forEachEdge((edge) => costsAfter.push(rg.graph.getEdgeAttribute(edge, 'cost')))
    expect(costsAfter).toEqual(costsBefore)
  })

  it('returnerer tom liste for ugyldige noder', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    expect(kShortestRoutes(rg, null, 'n0', {})).toEqual([])
    expect(kShortestRoutes(rg, 'nope', 'n0', {})).toEqual([])
  })

  it('foretrekker skogsbilvei framfor en kortere småveg (priorisering)', () => {
    // A(0,0) → B(200,0). Småveg (503) rett fram 200 m, skogsbilvei (504) som
    // omvei ~280 m. rg.route (kost-optimal) skal velge skogsbilveien tross
    // lengre, fordi 280×1.6=448 < 200×2.6=520. Isolerer priortering fra lengde.
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0], [200, 0]], isomCode: '503' },          // småveg rett fram 200
      { coordinates: [[0, 0], [0, 40], [200, 40], [200, 0]], isomCode: '504' }, // skogsbilvei omvei ~280
    ], { snapM: 2 })
    const r = rg.route(rg.nodeAt([0, 0]), rg.nodeAt([200, 0]))
    expect(r.lengthM).toBeGreaterThan(200) // valgte skogsbilvei-omveien
  })

  it('foretrekker en litt lengre sti framfor en kortere kjørevei', () => {
    // Sti (505) omvei ~280 m vs hovedvei (502) rett fram 200 m. Natur-
    // prioriteringen gjør stien billigst (280×1.0=280 < 200×3.4=680).
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [0, 40], [200, 40], [200, 0]], isomCode: '505' }, // sti omvei ~280
      { coordinates: [[0, 0], [100, 0], [200, 0]], isomCode: '502' },           // hovedvei rett fram 200
    ], { snapM: 2 })
    const r = rg.route(rg.nodeAt([0, 0]), rg.nodeAt([200, 0]))
    expect(r.lengthM).toBeGreaterThan(200) // valgte stien, tross lengre
  })

  it('utelater uforholdsmessig lange omveier (æresrunde-cap)', () => {
    // A(0,0) → B(100,0): direkte 100 m, pluss en lang æresrunde-loop (~520 m).
    const seg = (coords) => ({ coordinates: coords, isomCode: '505' })
    const rg = buildRoutingGraph([
      seg([[0, 0], [100, 0]]),                                   // direkte 100
      // lang æresrunde ~520 m (delt node i begge ender)
      seg([[0, 0], [-100, 0], [-100, -200], [200, -200], [200, 0], [100, 0]]),
    ], { snapM: 2 })
    const a = rg.nodeAt([0, 0])
    const b = rg.nodeAt([100, 0])

    // Med standard cap (1.8) skal den lange loopen (~5× korteste) aldri tas med.
    const capped = kShortestRoutes(rg, a, b, { k: 3, minShare: 0.1 })
    expect(capped.length).toBeGreaterThanOrEqual(1)
    expect(capped[0].lengthM).toBeCloseTo(100, 0)
    for (const r of capped) {
      expect(r.lengthM).toBeLessThanOrEqual(100 * 1.8 + 0.01)
    }

    // Uten cap (svært høy ratio) skal den lange loopen kunne dukke opp.
    const uncapped = kShortestRoutes(rg, a, b, { k: 3, minShare: 0.1, maxLengthRatio: 100 })
    expect(Math.max(...uncapped.map(r => r.lengthM))).toBeGreaterThan(100 * 1.8)
  })
})

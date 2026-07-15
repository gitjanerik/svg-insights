import { describe, it, expect } from 'vitest'
import { buildRoutingGraph, kShortestRoutes, planRoutes, planRoutesThrough, planLoop, projectPointOnSegment } from './routing.js'

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

  it('foretrekker skogsbilvei framfor småveg som mild tie-breaker (liten omvei)', () => {
    // A(0,0) → B(200,0). Småveg (503) rett fram 200 m, skogsbilvei (504) som
    // LITEN omvei ~216 m. Flate-forskjellen er nå en mild tie-breaker, så
    // skogsbilveien vinner kun fordi den knapt er lengre: 216×1.15≈248 <
    // 200×1.3=260. (Var en stor omvei før v11.0.27 — nå ville den tapt.)
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0], [200, 0]], isomCode: '503' },         // småveg rett fram 200
      { coordinates: [[0, 0], [0, 8], [200, 8], [200, 0]], isomCode: '504' }, // skogsbilvei omvei ~216
    ], { snapM: 2 })
    const r = rg.route(rg.nodeAt([0, 0]), rg.nodeAt([200, 0]))
    expect(r.lengthM).toBeGreaterThan(200) // valgte skogsbilvei-omveien (knapt lengre)
  })

  it('velger kortere småveg framfor en stor skogsbilvei-omvei (kortest teller mest)', () => {
    // Samme som over, men skogsbilvei-omveien er nå STOR (~280 m). Etter
    // v11.0.27 dominerer avstand: 200×1.3=260 < 280×1.15=322, så den korte
    // småvegen velges. Før (504=1.6, 503=2.6) vant den lange skogsbilveien.
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0], [200, 0]], isomCode: '503' },          // småveg rett fram 200
      { coordinates: [[0, 0], [0, 40], [200, 40], [200, 0]], isomCode: '504' }, // skogsbilvei omvei ~280
    ], { snapM: 2 })
    const r = rg.route(rg.nodeAt([0, 0]), rg.nodeAt([200, 0]))
    expect(r.lengthM).toBeCloseTo(200, 0) // valgte den korte småvegen
  })

  it('foretrekker en litt lengre sti framfor en kortere kjørevei', () => {
    // Sti (505) omvei ~280 m vs hovedvei (502) rett fram 200 m. Sti-vs-vei-
    // prioriteringen er beholdt: 280×1.0=280 < 200×1.5=300, så stien vinner
    // tross lengre. (Marginen er mindre enn før — det er meningen.)
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [0, 40], [200, 40], [200, 0]], isomCode: '505' }, // sti omvei ~280
      { coordinates: [[0, 0], [100, 0], [200, 0]], isomCode: '502' },           // hovedvei rett fram 200
    ], { snapM: 2 })
    const r = rg.route(rg.nodeAt([0, 0]), rg.nodeAt([200, 0]))
    expect(r.lengthM).toBeGreaterThan(200) // valgte stien, tross lengre
  })

  it('tar en kort, direkte rute med vei-stump framfor en lang ren-sti-omvei (Verkensvannet)', () => {
    // Regresjon for v11.0.27. A(0,0) → B(400,0):
    //   Direkte: sti 0–100, hovedvei-stump 100–200, sti 200–400  (400 m totalt)
    //   Omvei:   ren sti A → sør → B                              (620 m totalt)
    // Med gammelt bånd (502=3.4) kostet den korte vei-stumpen mer enn en hel
    // æresrunde på sti (100+340+200=640 > 620), så stifinneren svingte unna
    // skogsbilvei-/vei-stumpen og tok den lange omveien — akkurat som ingen
    // rute tok skogsbilvei-stumpen ved Verkensvannet. Nå dominerer avstand:
    // 100+150+200=450 < 620, så den korte direkte ruta velges.
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0]], isomCode: '505' },              // sti
      { coordinates: [[100, 0], [200, 0]], isomCode: '502' },            // vei-stump
      { coordinates: [[200, 0], [300, 0], [400, 0]], isomCode: '505' },  // sti
      { coordinates: [[0, 0], [0, 110], [400, 110], [400, 0]], isomCode: '505' }, // ren-sti-omvei ~620
    ], { snapM: 2 })
    const r = rg.route(rg.nodeAt([0, 0]), rg.nodeAt([400, 0]))
    expect(r.lengthM).toBeLessThan(500) // valgte den korte direkte ruta (~400), ikke 620-omveien
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

describe('planRoutes', () => {
  it('garanterer den kortest mulige ruta selv når den går på «dyrere» underlag', () => {
    // A(0,0) → B(400,0). Kort direkte rute (400 m) går via en hovedvei-stump
    // (502, dyr flate); ren-sti-omvei (505) er lengre (620 m). Den
    // flate-vektede ruta kan velge sti-omveien, men planRoutes skal ALLTID
    // også tilby den korteste (400 m) — uavhengig av flate.
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0]], isomCode: '505' },
      { coordinates: [[100, 0], [200, 0]], isomCode: '502' },             // dyr vei-stump
      { coordinates: [[200, 0], [300, 0], [400, 0]], isomCode: '505' },
      { coordinates: [[0, 0], [0, 110], [400, 110], [400, 0]], isomCode: '505' }, // sti-omvei ~620
    ], { snapM: 2 })
    const routes = planRoutes(rg, rg.nodeAt([0, 0]), rg.nodeAt([400, 0]), { k: 3 })

    const shortest = routes.find(r => r.shortest)
    expect(shortest).toBeTruthy()
    expect(shortest.lengthM).toBeCloseTo(400, 0)       // tok vei-stumpen — kortest
    expect(routes[0]).toBe(shortest)                   // sortert kortest først
    // Korteste ruta skal aldri mangle, uansett flate.
    expect(Math.min(...routes.map(r => r.lengthM))).toBeCloseTo(400, 0)
  })

  it('dedupliserer når korteste og den vektede ruta er den samme', () => {
    // Bare én vei mellom A og B → korteste == eneste vektede rute. Skal ikke
    // dukke opp to ganger.
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0], [200, 0]], isomCode: '505' },
    ], { snapM: 2 })
    const routes = planRoutes(rg, rg.nodeAt([0, 0]), rg.nodeAt([200, 0]), { k: 3 })
    expect(routes.length).toBe(1)
    expect(routes[0].shortest).toBe(true)
  })

  it('returnerer tom liste for ugyldige noder', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    expect(planRoutes(rg, null, 'n0', {})).toEqual([])
  })

  it('«kortest mulig» bruker IKKE motorvei selv om den er kortest', () => {
    // Motorvei (501) rett fram 200 m vs sti-omvei (505) ~280 m. Den korteste
    // ruta skal ta sti-omveien, ikke motorveien. Ingen offert rute skal
    // overhodet bruke motorvei.
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0], [200, 0]], isomCode: '501' },          // motorvei 200
      { coordinates: [[0, 0], [0, 40], [200, 40], [200, 0]], isomCode: '505' }, // sti-omvei ~280
    ], { snapM: 2 })
    const routes = planRoutes(rg, rg.nodeAt([0, 0]), rg.nodeAt([200, 0]), { k: 3 })
    const shortest = routes.find(r => r.shortest)
    expect(shortest).toBeTruthy()
    expect(shortest.lengthM).toBeGreaterThan(200) // tok sti-omveien, ikke motorvei
    // Ingen offert rute er ~200 m (= motorvei-ruta).
    expect(routes.every(r => r.lengthM > 200)).toBe(true)
  })
})

describe('planRoutesThrough (via-punkter)', () => {
  it('uten via-punkter er identisk med planRoutes', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const a = rg.nodeAt([0, 0]), c = rg.nodeAt([200, 0])
    const via = planRoutesThrough(rg, [a, c])
    const direct = planRoutes(rg, a, c)
    expect(via[0].lengthM).toBeCloseTo(direct[0].lengthM, 1)
  })

  it('tvinger ruten innom via-punktet', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const a = rg.nodeAt([0, 0]), e = rg.nodeAt([100, 100]), c = rg.nodeAt([200, 0])
    const routes = planRoutesThrough(rg, [a, e, c])
    expect(routes.length).toBeGreaterThanOrEqual(1)
    // Lengre enn direkte 200 (opp til E(100,100) og ned igjen) og passerer E.
    expect(routes[0].lengthM).toBeGreaterThan(200)
    expect(routes[0].coordinates.some(([x, y]) => x === 100 && y === 100)).toBe(true)
  })

  it('støtter flere via-punkter i rekkefølge', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const a = rg.nodeAt([0, 0]), d = rg.nodeAt([0, 100]), f = rg.nodeAt([200, 100]), c = rg.nodeAt([200, 0])
    const routes = planRoutesThrough(rg, [a, d, f, c])
    expect(routes.length).toBeGreaterThanOrEqual(1)
    const coords = routes[0].coordinates
    expect(coords.some(([x, y]) => x === 0 && y === 100)).toBe(true)   // via D
    expect(coords.some(([x, y]) => x === 200 && y === 100)).toBe(true) // via F
  })

  it('returnerer tom liste når et via-ledd er frakoblet', () => {
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0]], isomCode: '505' },
      { coordinates: [[500, 500], [600, 500]], isomCode: '505' }, // isolert
    ], { snapM: 2 })
    const a = rg.nodeAt([0, 0]), iso = rg.nodeAt([600, 500]), b = rg.nodeAt([100, 0])
    expect(planRoutesThrough(rg, [a, iso, b])).toEqual([])
  })
})

describe('planLoop (rundtur)', () => {
  it('lager en ekte sløyfe: ut én side, hjem den andre', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const b = rg.nodeAt([100, 0])       // origo
    const f = rg.nodeAt([200, 100])     // vendepunkt
    const loops = planLoop(rg, b, [f], { k: 3 })
    expect(loops.length).toBeGreaterThanOrEqual(1)
    const first = loops[0]
    expect(first.loop).toBe(true)
    expect(first.shortest).toBe(true)
    // Start og slutt i origo
    expect(first.coordinates[0]).toEqual([100, 0])
    expect(first.coordinates.at(-1)).toEqual([100, 0])
    // Innom vendepunktet F
    expect(first.coordinates.some(([x, y]) => x === 200 && y === 100)).toBe(true)
    // Ekte runde: bruker BÅDE C(200,0) og E(100,100) — dvs. ut én side, hjem
    // den andre, ikke tur/retur langs samme kant.
    expect(first.coordinates.some(([x, y]) => x === 200 && y === 0)).toBe(true)
    expect(first.coordinates.some(([x, y]) => x === 100 && y === 100)).toBe(true)
    // Uttur (B→…→F, 200 m) + hjemvei (F→…→B, 200 m) = 400 m
    expect(first.lengthM).toBeCloseTo(400, 0)
  })

  it('retracer utturen når vendepunktet er en blindvei (tur/retur)', () => {
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0]], isomCode: '505' },        // A-B
      { coordinates: [[100, 0], [100, -100]], isomCode: '505' },   // B-P blindvei
    ], { snapM: 2 })
    const b = rg.nodeAt([100, 0])
    const p = rg.nodeAt([100, -100])
    const loops = planLoop(rg, b, [p], { k: 3 })
    expect(loops.length).toBe(1)
    expect(loops[0].lengthM).toBeCloseTo(200, 0) // B→P→B
    expect(loops[0].coordinates[0]).toEqual([100, 0])
    expect(loops[0].coordinates.at(-1)).toEqual([100, 0])
  })

  it('sender aldri rundturen ut på motorvei (501)', () => {
    // Sti direkte A→B, og en motorvei-omvei som eneste distinkte alternativ.
    // Rundturen skal da retrace stien, ikke ta motorveien.
    const rg = buildRoutingGraph([
      { coordinates: [[0, 0], [100, 0], [200, 0]], isomCode: '505' },            // sti direkte
      { coordinates: [[0, 0], [0, -80], [200, -80], [200, 0]], isomCode: '501' }, // motorvei-omvei
    ], { snapM: 2 })
    const a = rg.nodeAt([0, 0])
    const bv = rg.nodeAt([200, 0])
    const loops = planLoop(rg, a, [bv], { k: 3 })
    expect(loops.length).toBeGreaterThanOrEqual(1)
    for (const l of loops) {
      expect(l.coordinates.every(([, y]) => y !== -80)).toBe(true) // ingen motorvei-punkter
    }
  })

  it('restaurerer kant-cost etter beregning', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const b = rg.nodeAt([100, 0]), f = rg.nodeAt([200, 100])
    const before = []
    rg.graph.forEachEdge((e) => before.push(rg.graph.getEdgeAttribute(e, 'cost')))
    planLoop(rg, b, [f], { k: 3 })
    const after = []
    rg.graph.forEachEdge((e) => after.push(rg.graph.getEdgeAttribute(e, 'cost')))
    expect(after).toEqual(before)
  })

  it('returnerer tom liste uten origo eller uten vendepunkt', () => {
    const rg = buildRoutingGraph(gridFeatures(), { snapM: 2 })
    const b = rg.nodeAt([100, 0]), f = rg.nodeAt([200, 100])
    expect(planLoop(rg, null, [f], {})).toEqual([])
    expect(planLoop(rg, b, [], {})).toEqual([])
  })
})

describe('projectPointOnSegment', () => {
  it('projiserer et punkt ned på et segment', () => {
    const r = projectPointOnSegment([5, 3], [0, 0], [10, 0])
    expect(r.point).toEqual([5, 0])
    expect(r.t).toBeCloseTo(0.5)
    expect(r.dist).toBeCloseTo(3)
  })

  it('klemmer t til [0,1] når punktet ligger utenfor segmentet', () => {
    const r = projectPointOnSegment([-5, 4], [0, 0], [10, 0])
    expect(r.t).toBe(0)
    expect(r.point).toEqual([0, 0])
  })
})

describe('broing av dangler / T-kryss', () => {
  it('kobler en stub som ender midt på et annet segment (T-kryss)', () => {
    // Gjennomgående sti [0,0]→[200,0] UTEN node ved x=100. Stub [100,15]→
    // [100,40] ender 15 m fra den gjennomgående stien — et T-kryss midt på et
    // segment, der det ikke finnes noen node å snappe til.
    const features = [
      { coordinates: [[0, 0], [200, 0]], isomCode: '505' },
      { coordinates: [[100, 15], [100, 40]], isomCode: '505' },
    ]
    // Uten broing: stuben er en frakoblet komponent → ingen rute.
    const without = buildRoutingGraph(features, { snapM: 2, bridgeM: 0 })
    const a0 = without.nearestNode([0, 0]).id
    const stub0 = without.nearestNode([100, 40]).id
    expect(without.route(stub0, a0)).toBeNull()

    // Med broing: stub-enden broes til segmentet (splittes ved [100,0]).
    const bridged = buildRoutingGraph(features, { snapM: 2, bridgeM: 20 })
    const a1 = bridged.nearestNode([0, 0]).id
    const stub1 = bridged.nearestNode([100, 40]).id
    const r = bridged.route(stub1, a1)
    expect(r).not.toBeNull()
    expect(r.coordinates.at(-1)).toEqual([0, 0])
  })

  it('broer en liten gap mellom to sti-ender (forenklings-drift)', () => {
    // To stier som «skulle» møttes, men endene står 8 m fra hverandre etter
    // forenkling. snapM=2 slår dem ikke sammen; bridgeM=12 broer gapet.
    const features = [
      { coordinates: [[0, 0], [100, 0]], isomCode: '505' },
      { coordinates: [[108, 0], [200, 0]], isomCode: '505' },
    ]
    const without = buildRoutingGraph(features, { snapM: 2, bridgeM: 0 })
    expect(without.route(without.nearestNode([0, 0]).id, without.nearestNode([200, 0]).id)).toBeNull()

    const bridged = buildRoutingGraph(features, { snapM: 2, bridgeM: 12 })
    expect(bridged.route(bridged.nearestNode([0, 0]).id, bridged.nearestNode([200, 0]).id)).not.toBeNull()
  })

  it('kobler et frakoblet fragment til hovednettet med componentBridgeM (Bondivann-tilfellet)', () => {
    // Hovednett [0,0]→[200,0] og en isolert stump [265,0]→[300,0] som ligger
    // 65 m fra hovednettets endepunkt — for langt for dangle-broen (12 m), men
    // innen componentBridgeM. Et startpunkt på stumpen skal nå nå hovednettet.
    const features = [
      { coordinates: [[0, 0], [100, 0], [200, 0]], isomCode: '505' },
      { coordinates: [[265, 0], [300, 0]], isomCode: '505' },
    ]
    const without = buildRoutingGraph(features, { snapM: 2 })
    expect(without.route(without.nearestNode([300, 0]).id, without.nearestNode([0, 0]).id)).toBeNull()

    const bridged = buildRoutingGraph(features, { snapM: 2, componentBridgeM: 80 })
    const r = bridged.route(bridged.nearestNode([300, 0]).id, bridged.nearestNode([0, 0]).id)
    expect(r).not.toBeNull()
    expect(r.coordinates[0]).toEqual([300, 0])
    expect(r.coordinates.at(-1)).toEqual([0, 0])
  })

  it('componentBridgeM broer IKKE komponenter som ligger lenger unna enn toleransen', () => {
    // Samme oppsett, men stumpen ligger 120 m unna (> 80 m tol) → forblir
    // frakoblet. Sikrer at vi ikke syr sammen nett over store gap.
    const features = [
      { coordinates: [[0, 0], [200, 0]], isomCode: '505' },
      { coordinates: [[320, 0], [400, 0]], isomCode: '505' },
    ]
    const rg = buildRoutingGraph(features, { snapM: 2, componentBridgeM: 80 })
    expect(rg.route(rg.nearestNode([400, 0]).id, rg.nearestNode([0, 0]).id)).toBeNull()
  })

  it('componentBridgeM lager ikke intern snarvei i en allerede sammenhengende komponent', () => {
    // U-formet sti der de to endene ligger 20 m fra hverandre men er koblet
    // gjennom bunnen. componentBridgeM skal IKKE snarveie over åpningen (samme
    // komponent) — ruten må fortsatt gå rundt.
    const features = [
      { coordinates: [[0, 0], [0, 100], [100, 100], [100, 0]], isomCode: '505' },
    ]
    const rg = buildRoutingGraph(features, { snapM: 2, componentBridgeM: 80 })
    const r = rg.route(rg.nearestNode([0, 0]).id, rg.nearestNode([100, 0]).id)
    expect(r).not.toBeNull()
    expect(r.lengthM).toBeCloseTo(300, 0) // hele veien rundt, ingen 20 m-snarvei
  })

  it('lager ikke falskt kryss der to gjennomgående stier krysser uten node (bro/kulvert)', () => {
    // Sti A går vannrett, sti B loddrett; de krysser ved (100,0) midt på begge
    // segmentene, men ingen av dem har en node der, og ingen dangle er i
    // nærheten av krysset (alle ender ligger ≥50 m unna). Da skal de IKKE
    // kobles — det modellerer en sti som går i bro/kulvert over en annen.
    const features = [
      { coordinates: [[0, 0], [200, 0]], isomCode: '505' },     // A vannrett
      { coordinates: [[100, -50], [100, 50]], isomCode: '505' }, // B loddrett (krysser midt på A)
    ]
    const rg = buildRoutingGraph(features, { snapM: 2, bridgeM: 12 })
    expect(rg.route(rg.nearestNode([0, 0]).id, rg.nearestNode([100, 50]).id)).toBeNull()
  })
})

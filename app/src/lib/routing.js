// Routing-graph fra OSM/N50-features. Bygger en undirected graf der
// noder er koordinater snappet på 2m toleranse, og kanter er sti-/vei-
// segmenter med vekt = lengde × ISOM-kostnadsfaktor.
//
// Brukes til løypeplanlegging (Dijkstra fra graphology-shortest-path).
//
// API:
//   buildRoutingGraph(features, options) → { graph, nodeAt, projectToSvg }
//   findRoute(graph, fromPos, toPos) → { coordinates, lengthM, costM }

import Graph from 'graphology'
import { dijkstra } from 'graphology-shortest-path'
import RBush from 'rbush'
import { polylineLength } from './pathUtils.js'

// Kostnadsfaktor pr ISOM-kode. Større = mindre attraktiv som rute.
//
// PRIORITERING (v11.0.27): «kortest mulig» skal telle høyere enn «sti over
// vei». Vi beholder rekkefølgen fra mest til minst foretrukket —
//   Sti (505/506/507) → Skogsbilvei (504) → Småveg (503) → Veg (502/501)
// — men STRAMMER båndet kraftig. Tidligere (v11.0.13) lå natur-korridoren
// på ≤1.6 og kjørevei på 2.6–4.0; det HOPPET gjorde at en kort, direkte
// rute som måtte ta en liten vei-/skogsbilvei-stump tapte mot en mye lengre
// ren-sti-omvei (kostnaden av vei-stumpen oversteg en hel æresrunde på sti).
// Det var nettopp dette som skjedde ved Verkensvannet: ingen rute tok
// skogsbilvei-stumpen, alle svingte østover. Nå er forskjellen mellom
// klassene en mild tie-breaker (maks ~1.7× fra sti til motorvei), så
// avstand dominerer: en litt lengre sti slår fortsatt en kortere kjørevei,
// men en stor omvei på sti taper mot en kort, direkte rute med litt vei.
const ISOM_COST = {
  '505': 1.0,                              // sti — godt løp (mest foretrukket)
  '506': 1.05,                             // sti — uklar
  '507': 1.12,                             // stitråkk — vanskelig, men fortsatt sti
  '504': 1.15,                             // skogsbilvei
  '509': 1.0,                              // bro — nøytral (nødvendig kryssing)
  '503': 1.3,                              // småveg (tertiary/residential/service)
  '502': 1.5,                              // hovedvei
  '501': 1.7,                              // motorvei — minst foretrukket å gå
}

/**
 * @typedef {Object} RoutingGraph
 * @property {Graph} graph
 * @property {(pos: [number,number], toleranceM?: number) => string|null} nodeAt
 * @property {(from: string, to: string) => RouteResult} route
 */

/**
 * Bygg routing-graph fra et sett ISOM-klassifiserte features.
 * Features må ha `geometry: [{lat,lon},...]` (OSM-aktig) eller
 * `coordinates: [[x,y],...]` i UTM, og `isomCode`.
 *
 * @param {Array} features
 * @param {{ snapM?: number, projectFn?: Function }} opts
 * @returns {RoutingGraph}
 */
export function buildRoutingGraph(features, opts = {}) {
  const { snapM = 2, projectFn } = opts
  const g = new Graph({ multi: false, type: 'undirected' })
  const nodeIndex = new RBush()

  function getOrCreateNode(pos) {
    const hits = nodeIndex.search({
      minX: pos[0] - snapM, minY: pos[1] - snapM,
      maxX: pos[0] + snapM, maxY: pos[1] + snapM,
    })
    if (hits[0]) return hits[0].id
    const id = `n${g.order}`
    g.addNode(id, { pos })
    nodeIndex.insert({
      id, pos,
      minX: pos[0], minY: pos[1], maxX: pos[0], maxY: pos[1],
    })
    return id
  }

  let edges = 0
  for (const f of features) {
    const code = f.isomCode ?? f.tags?.isomCode
    if (!code) continue
    const cost = ISOM_COST[code]
    if (cost == null) continue       // ikke routbar
    let coords = f.coordinates
    if (!coords && f.geometry && projectFn) {
      coords = f.geometry.map(p => projectFn(p.lat, p.lon))
    }
    if (!coords || coords.length < 2) continue
    let prev = getOrCreateNode(coords[0])
    for (let i = 1; i < coords.length; i++) {
      const here = getOrCreateNode(coords[i])
      if (prev === here) continue
      const seg = [coords[i - 1], coords[i]]
      const length = polylineLength(seg)
      if (length === 0) continue
      if (!g.hasEdge(prev, here)) {
        g.addEdge(prev, here, { length, cost: length * cost, isomCode: code })
        edges++
      }
      prev = here
    }
  }

  function nodeAt(pos, tol = snapM) {
    const hits = nodeIndex.search({
      minX: pos[0] - tol, minY: pos[1] - tol,
      maxX: pos[0] + tol, maxY: pos[1] + tol,
    })
    return hits[0]?.id ?? null
  }

  // Nærmeste node UANSETT avstand. Brukervalgte start/mål-punkter ligger
  // sjelden på en sti-node, så vi snapper dem til grafen. rbush-søk med
  // voksende vindu; faller tilbake til lineær scan hvis grafen er glissen.
  function nearestNode(pos) {
    if (g.order === 0) return null
    let best = null, bestD = Infinity
    let r = Math.max(snapM, 8)
    for (let tries = 0; tries < 12 && !best; tries++) {
      const hits = nodeIndex.search({
        minX: pos[0] - r, minY: pos[1] - r,
        maxX: pos[0] + r, maxY: pos[1] + r,
      })
      for (const h of hits) {
        const dx = h.pos[0] - pos[0], dy = h.pos[1] - pos[1]
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; best = h }
      }
      r *= 2
    }
    if (!best) {
      g.forEachNode((id, attr) => {
        const dx = attr.pos[0] - pos[0], dy = attr.pos[1] - pos[1]
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; best = { id, pos: attr.pos } }
      })
    }
    return best ? { id: best.id, pos: best.pos, distM: Math.sqrt(bestD) } : null
  }

  function route(fromId, toId) {
    if (!fromId || !toId || !g.hasNode(fromId) || !g.hasNode(toId)) return null
    const path = dijkstra.bidirectional(g, fromId, toId, 'cost')
    if (!path) return null
    const coords = path.map(id => g.getNodeAttribute(id, 'pos'))
    const lengthM = polylineLength(coords)
    let costM = 0
    for (let i = 0; i + 1 < path.length; i++) {
      costM += g.getEdgeAttribute(path[i], path[i + 1], 'cost')
    }
    return { coordinates: coords, lengthM, costM, nodeIds: path }
  }

  return { graph: g, nodeAt, nearestNode, route, edges, nodes: g.order }
}

// Sett med kant-id'er en rute bruker (undirected — graphology gir samme
// edge-id uansett retning).
function routeEdgeSet(graph, nodeIds) {
  const set = new Set()
  for (let i = 0; i + 1 < nodeIds.length; i++) {
    const e = graph.edge(nodeIds[i], nodeIds[i + 1])
    if (e != null) set.add(e)
  }
  return set
}

function shareOf(aSet, bSet) {
  if (!aSet.size) return 0
  let common = 0
  for (const e of aSet) if (bSet.has(e)) common++
  return common / aSet.size
}

/**
 * 1–k alternative ruter A→B via edge-penalty-metoden: finn korteste,
 * straff dens kanter, finn neste, osv. Nye ruter beholdes kun hvis de er
 * tilstrekkelig forskjellige (deler < `minShare` av kantene med en allerede
 * valgt rute) OG ikke uforholdsmessig lange (≤ `maxLengthRatio` × korteste
 * rute). Alle cost-mutasjoner reverseres til slutt.
 *
 * `maxLengthRatio` finnes fordi edge-penalty-metoden, etter at de korte
 * rutene er straffet, gjerne presser den k-te ruta ut på en absurd omvei
 * («æresrunde» — f.eks. 9 km der korteste er 4 km) bare for å være distinkt
 * nok. Slike ruter ville ingen valgt; vi dropper dem heller og returnerer
 * færre alternativer. 1.8 = en omvei på opptil +80 % godtas, mer ikke.
 *
 * @param {ReturnType<typeof buildRoutingGraph>} rg
 * @param {string} fromId
 * @param {string} toId
 * @param {{ k?: number, penalty?: number, minShare?: number, maxLengthRatio?: number }} opts
 * @returns {Array<{coordinates:Array<[number,number]>, lengthM:number, costM:number, nodeIds:string[]}>}
 *          sortert på lengthM stigende
 */
export function kShortestRoutes(rg, fromId, toId, opts = {}) {
  const { k = 3, penalty = 2.5, minShare = 0.6, maxLengthRatio = 1.8 } = opts
  const { graph: g, route } = rg
  if (!fromId || !toId || !g.hasNode(fromId) || !g.hasNode(toId)) return []

  const chosen = []
  const chosenSets = []
  const penalized = new Map()   // edgeId → original cost
  const maxAttempts = k * 4
  let shortestLen = Infinity    // settes av første (= globalt korteste) rute

  try {
    for (let attempt = 0; attempt < maxAttempts && chosen.length < k; attempt++) {
      const r = route(fromId, toId)
      if (!r) break
      if (r.lengthM < shortestLen) shortestLen = r.lengthM
      const eset = routeEdgeSet(g, r.nodeIds)
      const tooSimilar = chosenSets.some(s => shareOf(eset, s) >= minShare)
      // Korteste ruta godtas alltid; alternativer kun hvis de ikke er en
      // uforholdsmessig lang omvei.
      const tooLong = chosen.length > 0 && r.lengthM > shortestLen * maxLengthRatio
      if (!tooSimilar && !tooLong) {
        chosen.push(r)
        chosenSets.push(eset)
      }
      // Straff denne rutens kanter slik at neste søk vrir unna.
      for (const e of eset) {
        if (!penalized.has(e)) penalized.set(e, g.getEdgeAttribute(e, 'cost'))
        g.setEdgeAttribute(e, 'cost', g.getEdgeAttribute(e, 'cost') * penalty)
      }
    }
  } finally {
    for (const [e, cost] of penalized) g.setEdgeAttribute(e, 'cost', cost)
  }

  chosen.sort((a, b) => a.lengthM - b.lengthM)
  return chosen
}

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
const ISOM_COST = {
  '501': 1.0, '502': 1.1, '503': 1.3,    // veier — raske
  '504': 1.5,                              // skogsbilvei
  '505': 1.6,                              // sti — godt løp
  '506': 2.2,                              // sti — uklar
  '507': 3.5,                              // stitråkk — vanskelig
  '509': 1.0,                              // bro
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

  return { graph: g, nodeAt, route, edges, nodes: g.order }
}

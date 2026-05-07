// Klassifisering av bygninger til "tett bebyggelse" (ISOM 522, pattern-fyll)
// vs "spredte" (ISOM 521, individuelle).
//
// Algoritme:
//  1. Bygg R-tree spatial index over bygnings-bbox-er
//  2. Bruk Union-Find for å gruppere bygninger som er innenfor
//     `neighborRadiusM` (15m default) av hverandre — transitivt
//  3. Grupper med ≥ minClusterSize medlemmer er bymasse-kandidater
//  4. For bymasse: union av buffer'ede bbox-rektangler gir én eller
//     flere multipolygoner som dekker tette urbane områder
//  5. Spredte bygninger forblir som individuelle features

import polygonClipping from 'polygon-clipping'
import RBush from 'rbush'

function bboxOf(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

class UnionFind {
  constructor(n) {
    this.parent = new Array(n)
    this.rank = new Array(n).fill(0)
    for (let i = 0; i < n; i++) this.parent[i] = i
  }
  find(x) {
    let root = x
    while (this.parent[root] !== root) root = this.parent[root]
    // Path compression
    while (this.parent[x] !== root) {
      const next = this.parent[x]
      this.parent[x] = root
      x = next
    }
    return root
  }
  union(x, y) {
    const rx = this.find(x), ry = this.find(y)
    if (rx === ry) return
    if (this.rank[rx] < this.rank[ry]) this.parent[rx] = ry
    else if (this.rank[rx] > this.rank[ry]) this.parent[ry] = rx
    else { this.parent[ry] = rx; this.rank[rx]++ }
  }
}

/**
 * Lager en bbox-rektangel utvidet med bufferM (for union).
 */
function bufferedBboxRect(ring, bufferM) {
  const b = bboxOf(ring)
  return [[
    [b.minX - bufferM, b.minY - bufferM],
    [b.maxX + bufferM, b.minY - bufferM],
    [b.maxX + bufferM, b.maxY + bufferM],
    [b.minX - bufferM, b.maxY + bufferM],
    [b.minX - bufferM, b.minY - bufferM],
  ]]
}

/**
 * Klassifiser bygninger.
 *
 * @param {Array<{ring: Array<[number,number]>, original?: any}>} buildings
 *        Bygninger med UTM-koordinater (i SVG-koord-system, dvs etter projeksjon).
 * @param {object} [opts]
 * @param {number} [opts.neighborRadiusM=15]   Avstand for "nabo"-deteksjon
 * @param {number} [opts.minClusterSize=3]     Min antall bygninger i en klynge
 * @param {number} [opts.bufferM=6]            Buffer-radius for union (også ISOM 522 utstrekning)
 * @returns {{
 *   urbanMass: Array<Array<Array<[number,number]>>>,  // MultiPolygon: array of polygons (each [outerRing, ...holes])
 *   scattered: Array<typeof buildings[0]>             // bygninger som ikke er i tette klynger
 * }}
 */
export function classifyBuildings(buildings, opts = {}) {
  const {
    neighborRadiusM = 15,
    minClusterSize = 3,
    bufferM = 6,
  } = opts

  if (buildings.length === 0) return { urbanMass: [], scattered: [] }

  // 1) Spatial index på bygnings-bbox
  const tree = new RBush()
  buildings.forEach((b, i) => {
    const bb = bboxOf(b.ring)
    tree.insert({ ...bb, i })
  })

  // 2) Union-Find for transitiv gruppering
  const uf = new UnionFind(buildings.length)
  for (let i = 0; i < buildings.length; i++) {
    const bb = bboxOf(buildings[i].ring)
    const expanded = {
      minX: bb.minX - neighborRadiusM,
      minY: bb.minY - neighborRadiusM,
      maxX: bb.maxX + neighborRadiusM,
      maxY: bb.maxY + neighborRadiusM,
    }
    const neighbors = tree.search(expanded)
    for (const n of neighbors) {
      if (n.i !== i) uf.union(i, n.i)
    }
  }

  // 3) Gruppe-medlemskap pr root
  const groups = new Map()
  for (let i = 0; i < buildings.length; i++) {
    const root = uf.find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(i)
  }

  // 4 + 5) For hver gruppe, klassifiser tett vs spredt
  const urbanMass = []
  const scattered = []
  for (const indices of groups.values()) {
    if (indices.length >= minClusterSize) {
      // Tett klynge: union av buffer'ede bbox-rektangler
      const polysToUnion = indices.map(i => bufferedBboxRect(buildings[i].ring, bufferM))
      try {
        const merged = polygonClipping.union(...polysToUnion)
        // merged er MultiPolygon = Array<Polygon> der Polygon = [outer, hole1, ...]
        for (const poly of merged) urbanMass.push(poly)
      } catch (e) {
        // Hvis union feiler (f.eks. self-intersecting input), fall tilbake
        for (const i of indices) scattered.push(buildings[i])
      }
    } else {
      for (const i of indices) scattered.push(buildings[i])
    }
  }

  return { urbanMass, scattered }
}

/**
 * Konverter en MultiPolygon (fra polygon-clipping) til SVG d-attribute.
 * Bruker fill-rule="evenodd" så hull rendres korrekt.
 *
 * @param {Array<Array<Array<[number,number]>>>} multiPoly
 * @param {(n: number) => number} [fmt]
 * @returns {string}
 */
export function multiPolyToPath(multiPoly, fmt = (n) => Number(n.toFixed(2))) {
  const parts = []
  for (const poly of multiPoly) {
    for (const ring of poly) {
      if (ring.length === 0) continue
      let d = `M${fmt(ring[0][0])},${fmt(ring[0][1])}`
      for (let i = 1; i < ring.length; i++) {
        d += `L${fmt(ring[i][0])},${fmt(ring[i][1])}`
      }
      d += 'Z'
      parts.push(d)
    }
  }
  return parts.join(' ')
}

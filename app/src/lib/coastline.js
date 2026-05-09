// Kystlinje-polygonisering for ISOM-turkart.
//
// OSM tagger kystlinje som natural=coastline ways (ikke sjø-polygoner).
// Sjøen er bare "alt utenfor kystlinjen" og har ingen egen polygon.
//
// Denne modulen rekonstruerer LAND-polygoner i en bbox fra OSM-kystlinje-
// ways slik at vi kan rendre sjøen som en heldekkende blå bakgrunn med
// land-maske over.
//
// OSM-konvensjon: når du går langs en kystlinje ligger LAND på venstre,
// SJØ på høyre. I geografiske y-opp-koordinater (UTM) går derfor kyst-
// linjer rundt øyer mot klokken. Etter projeksjon til SVG (y-ned) blir
// dette med klokken visuelt.
//
// I SVG y-ned med rotasjons-konvensjon "med klokken":
//  - innsiden av en CW ring er på HØYRE side av reisen
//  - som tilsvarer LAND etter y-flippet (OSM "land left" → SVG "land right")
//  - så CW kystlinjering omslutter land
//
// Algoritme:
//  1. Klipp hver kystlinje-way til bbox
//  2. Slå sammen ways med matchede endepunkter til kjeder
//  3. Lukkede kjeder = øyer (CW i SVG) → direkte land-polygoner
//  4. Åpne kjeder berører bbox-kanten; lukkes ved å gå CW langs bbox-
//     omkretsen fra én bues utgangspunkt til neste bues inngangspunkt

/**
 * Bygg land-polygoner i bbox fra OSM natural=coastline ways.
 *
 * @param {Array<{geometry: Array<{lat:number, lon:number}>}>} coastlineWays
 * @param {(lat:number, lon:number) => {x:number, y:number}} project   til SVG-koord
 * @param {number} widthM   bbox-bredde i SVG-enheter
 * @param {number} heightM  bbox-høyde i SVG-enheter
 * @returns {{ rings: Array<Array<[number, number]>>, openArcsCount: number, closedRingsCount: number }}
 *          rings er liste av land-ringer (hver er liste av [x,y]).
 *          openArcsCount = antall åpne arcer som ble lukket via bbox.
 *          closedRingsCount = antall lukkede ringer (etter filter).
 */
export function buildLandPolygonsFromCoastline(coastlineWays, project, widthM, heightM) {
  const W = widthM
  const H = heightM
  // v6.21.1: bumped fra 5m → 20m. OSM coastline-noder kan ligge 10-30m
  // fra hverandre, og ulike ways i samme kystkjede har ofte endepunkter
  // som ikke er bit-eksakt like (forskjellige bidragsytere har plassert
  // dem litt forskjellig). 5m var for stramt og kunne hindre kjeding av
  // konsekutive ways → resultat: 0 lukkede land-polygoner i bbox-er som
  // åpenbart har sammenhengende kystlinje (Nesøya, Asker rapportert).
  const eps = 20.0      // 20m for å matche endepunkter mellom ways
  const edgeEps = 20.0  // 20m fra bbox-kant regnes som "på kanten"
  const bboxArea = W * H

  // Projiser ways
  const projected = coastlineWays
    .filter(w => w.geometry && w.geometry.length >= 2)
    .map(w => w.geometry.map(g => {
      const p = project(g.lat, g.lon)
      return [p.x, p.y]
    }))

  // Klipp hver til bbox (kan splitte i flere biter ved utgang/inngang)
  const clipped = []
  for (const seg of projected) {
    for (const piece of clipPolylineToBbox(seg, W, H, edgeEps * 2)) {
      if (piece.length >= 2) clipped.push(piece)
    }
  }
  if (clipped.length === 0) {
    return { rings: [], openArcsCount: 0, closedRingsCount: 0 }
  }

  // Slå sammen kjeder
  const chains = mergeChains(clipped, eps)

  // Skill lukkede ringer fra åpne arcer
  const closedRings = []
  const openArcs = []
  for (const c of chains) {
    if (c.length < 3) continue
    const f = c[0], l = c[c.length - 1]
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < eps * 4) {
      closedRings.push(c)
    } else {
      openArcs.push(c)
    }
  }

  // Filtrer ut lukkede ringer som er for store — antagelig store innenlands-
  // innsjøer (Mjøsa, Setten osv) som er feilmerket som natural=coastline i
  // OSM. En ekte øy dekker typisk en liten del av bbox; en lake-mistag
  // dekker ofte > 50% av bbox.
  const filteredClosed = closedRings.filter(ring => {
    const area = Math.abs(signedArea(ring))
    if (area > 0.5 * bboxArea) {
      console.warn(`[Kystlinje] Lukket ring dekker ${(100 * area / bboxArea).toFixed(0)}% av bbox — antagelig lake-mistag, hopper over`)
      return false
    }
    return true
  })

  // Lukk åpne arcer via bbox-kanter
  const mainlandRings = closeArcsViaBbox(openArcs, W, H, edgeEps)

  return {
    rings: [...filteredClosed, ...mainlandRings],
    openArcsCount: openArcs.length,
    closedRingsCount: filteredClosed.length,
  }
}

function signedArea(ring) {
  let a = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]
  }
  return a / 2
}

/**
 * Klipp en polylinje mot bbox [0,0]→[W,H]. Returnerer 0 eller flere
 * polylinje-biter helt innenfor bbox. Punkter som krysser bbox-kanten
 * får skjæringspunkt som nytt endepunkt.
 */
export function clipPolylineToBbox(coords, W, H, slop = 0.01) {
  if (coords.length < 2) return []
  const eps = slop
  const inside = (p) => p[0] >= -eps && p[0] <= W + eps && p[1] >= -eps && p[1] <= H + eps

  const result = []
  let current = []

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i]
    const p2 = coords[i + 1]
    const p1in = inside(p1)
    const p2in = inside(p2)

    if (p1in && p2in) {
      if (current.length === 0) current.push(p1)
      current.push(p2)
    } else if (p1in && !p2in) {
      if (current.length === 0) current.push(p1)
      const cross = lineToBboxIntersection(p1, p2, W, H)
      if (cross) current.push(cross)
      if (current.length >= 2) result.push(current)
      current = []
    } else if (!p1in && p2in) {
      const cross = lineToBboxIntersection(p2, p1, W, H)
      current = cross ? [cross, p2] : [p2]
    }
    // begge utenfor: hopp over (kan ha sjelden chord-crossing — ignorerer)
  }
  if (current.length >= 2) result.push(current)
  return result
}

/** Finn skjæringspunkt mellom segment (insidePt → outsidePt) og bbox-kant */
function lineToBboxIntersection(insidePt, outsidePt, W, H) {
  const [ix, iy] = insidePt
  const [ox, oy] = outsidePt
  let bestT = Infinity
  let bestPt = null

  const tryEdge = (t, x, y) => {
    if (t > 0 && t <= 1 && t < bestT) { bestT = t; bestPt = [x, y] }
  }

  // Top y=0
  if (oy < 0 && iy >= 0) {
    const t = iy / (iy - oy)
    const x = ix + t * (ox - ix)
    if (x >= 0 && x <= W) tryEdge(t, x, 0)
  }
  // Bottom y=H
  if (oy > H && iy <= H) {
    const t = (H - iy) / (oy - iy)
    const x = ix + t * (ox - ix)
    if (x >= 0 && x <= W) tryEdge(t, x, H)
  }
  // Left x=0
  if (ox < 0 && ix >= 0) {
    const t = ix / (ix - ox)
    const y = iy + t * (oy - iy)
    if (y >= 0 && y <= H) tryEdge(t, 0, y)
  }
  // Right x=W
  if (ox > W && ix <= W) {
    const t = (W - ix) / (ox - ix)
    const y = iy + t * (oy - iy)
    if (y >= 0 && y <= H) tryEdge(t, W, y)
  }
  return bestPt
}

/**
 * Slå sammen polylinje-segmenter med matchede endepunkter til lengre kjeder.
 * Greedy approach — kjapp, holder for typiske OSM-kystlinjer.
 */
export function mergeChains(segments, eps = 1.0) {
  const remaining = segments.map(s => s.slice())
  const chains = []
  while (remaining.length > 0) {
    let chain = remaining.shift().slice()
    let progress = true
    while (progress) {
      progress = false
      const head = chain[0]
      const tail = chain[chain.length - 1]
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i]
        const sFirst = seg[0]
        const sLast = seg[seg.length - 1]
        if (Math.hypot(tail[0] - sFirst[0], tail[1] - sFirst[1]) < eps) {
          chain = chain.concat(seg.slice(1))
          remaining.splice(i, 1); progress = true; break
        }
        if (Math.hypot(tail[0] - sLast[0], tail[1] - sLast[1]) < eps) {
          chain = chain.concat(seg.slice(0, -1).reverse())
          remaining.splice(i, 1); progress = true; break
        }
        if (Math.hypot(head[0] - sLast[0], head[1] - sLast[1]) < eps) {
          chain = seg.slice(0, -1).concat(chain)
          remaining.splice(i, 1); progress = true; break
        }
        if (Math.hypot(head[0] - sFirst[0], head[1] - sFirst[1]) < eps) {
          chain = seg.slice(1).reverse().concat(chain)
          remaining.splice(i, 1); progress = true; break
        }
      }
    }
    chains.push(chain)
  }
  return chains
}

/**
 * Lukk åpne kystlinje-arcer ved å gå CCW langs bbox-omkretsen mellom
 * endepunkt og neste arcs startpunkt. Resultatet er lukkede LAND-
 * polygoner.
 *
 * Hvorfor CCW: OSM-konvensjon er "land på venstre, sjø på høyre" når
 * du går langs kystlinjen. I SVG y-ned beholder en CCW gangrunde rundt
 * bbox interiøret på venstre side. Hvis vi vil at interiøret skal være
 * LAND (= bbox-fyll med kremgul over sjø-blå bg), må vi gå CCW.
 *
 * Bbox-omkretsen parametrisert CW i SVG (y-ned) — vi snur "delta-
 * retningen" for å gå CCW:
 *   t ∈ [0, W):           top-edge          (0,0) → (W,0)
 *   t ∈ [W, W+H):         right-edge        (W,0) → (W,H)
 *   t ∈ [W+H, 2W+H):      bottom-edge       (W,H) → (0,H)
 *   t ∈ [2W+H, 2W+2H):    left-edge         (0,H) → (0,0)
 */
export function closeArcsViaBbox(arcs, W, H, edgeEps = 5.0) {
  const perim = 2 * (W + H)

  const paramOf = (p) => {
    if (Math.abs(p[1]) < edgeEps)       return Math.max(0, Math.min(W, p[0]))
    if (Math.abs(p[0] - W) < edgeEps)   return W + Math.max(0, Math.min(H, p[1]))
    if (Math.abs(p[1] - H) < edgeEps)   return W + H + Math.max(0, Math.min(W, W - p[0]))
    if (Math.abs(p[0]) < edgeEps)       return 2 * W + H + Math.max(0, Math.min(H, H - p[1]))
    return -1
  }

  const pointAt = (t) => {
    let tt = ((t % perim) + perim) % perim
    if (tt <= W)         return [tt, 0]
    if (tt <= W + H)     return [W, tt - W]
    if (tt <= 2 * W + H) return [W - (tt - W - H), H]
    return [0, H - (tt - 2 * W - H)]
  }

  // Bbox-hjørner som t-verdier (CW-rekkefølge i parametrisering)
  const cornerTs = [W, W + H, 2 * W + H, 2 * W + 2 * H]

  const items = []
  for (const arc of arcs) {
    const startT = paramOf(arc[0])
    const endT = paramOf(arc[arc.length - 1])
    if (startT < 0 || endT < 0) continue
    items.push({ arc, startT, endT, used: false })
  }
  if (items.length === 0) return []

  const polygons = []
  for (const startItem of items) {
    if (startItem.used) continue
    const ring = []
    let cur = startItem
    let safety = items.length * 4 + 4

    while (cur && safety-- > 0) {
      cur.used = true
      const startIdx = ring.length === 0 ? 0 : 1
      for (let i = startIdx; i < cur.arc.length; i++) ring.push(cur.arc[i])

      // Gå CCW langs bbox fra cur.endT (decreasing t mod perim) til neste
      // arcs startT. CCW-distanse = (fromT - candidateStartT) mod perim.
      const fromT = cur.endT
      let next = null
      let bestDelta = Infinity
      for (const cand of items) {
        if (cand.used && cand !== startItem) continue
        let delta = fromT - cand.startT
        if (delta <= 0) delta += perim
        if (delta < bestDelta) { bestDelta = delta; next = cand }
      }
      if (!next) break

      // Hjørner mellom fromT og next.startT i CCW-retning, sortert etter
      // når de møtes (smallest cDelta først)
      const cornersBetween = []
      for (const cT of cornerTs) {
        let cDelta = fromT - cT
        if (cDelta <= 0) cDelta += perim
        if (cDelta > 0 && cDelta < bestDelta) cornersBetween.push({ cT, cDelta })
      }
      cornersBetween.sort((a, b) => a.cDelta - b.cDelta)
      for (const c of cornersBetween) ring.push(pointAt(c.cT))

      // Hopp til neste arcs startpunkt
      ring.push(pointAt(next.startT))

      if (next === startItem) break
      cur = next
    }

    if (ring.length >= 3) polygons.push(ring)
  }
  return polygons
}

/**
 * Konverter en ring [[x,y], ...] til SVG path-streng (M…L…Z).
 */
export function ringToPath(ring, fmtFn = (n) => Number(n.toFixed(2))) {
  if (!ring || ring.length === 0) return ''
  let d = `M${fmtFn(ring[0][0])},${fmtFn(ring[0][1])}`
  for (let i = 1; i < ring.length; i++) {
    d += `L${fmtFn(ring[i][0])},${fmtFn(ring[i][1])}`
  }
  d += 'Z'
  return d
}

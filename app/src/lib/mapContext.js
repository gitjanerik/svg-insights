// Kontekstmeny-info: kalkulerer nyttig informasjon for et SVG-punkt på kartet
// (long-press / høyreklikk). All geometri i SVG user-units (1 unit = 1 m).

// Kompass-retning fra (x0, y0) til (x1, y1) i SVG-koord. SVG y-aksen vokser
// nedover (sørover), så vi flipper dy. 0° = nord, 90° = øst, 180° = sør.
export function bearingDeg(x0, y0, x1, y1) {
  const dx = x1 - x0
  const dy = y0 - y1     // flip: y øker sørover i SVG
  if (dx === 0 && dy === 0) return 0
  let a = Math.atan2(dx, dy) * 180 / Math.PI
  if (a < 0) a += 360
  return a
}

// 16-trinns kompass-rose med norske ord. Mer presis enn 8-trinns —
// avgrenser retning til ±11.25°.
const COMPASS_16_NO = [
  'nord', 'nord-nordøst', 'nordøst', 'øst-nordøst',
  'øst', 'øst-sørøst',    'sørøst', 'sør-sørøst',
  'sør',  'sør-sørvest',  'sørvest', 'vest-sørvest',
  'vest', 'vest-nordvest','nordvest','nord-nordvest',
]

export function bearingToCompass(deg) {
  const idx = Math.round((deg % 360) / 22.5) % 16
  return COMPASS_16_NO[idx]
}

export function formatDistanceM(m) {
  if (!Number.isFinite(m)) return '–'
  if (m < 10) return `${m.toFixed(1)} m`
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(2)} km`
}

// Punkt-til-segment-avstand. Returnerer { distM, x, y } der (x,y) er
// projeksjons-punktet på segmentet.
function pointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) {
    const d = Math.hypot(px - ax, py - ay)
    return { distM: d, x: ax, y: ay }
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const qx = ax + t * dx
  const qy = ay + t * dy
  return { distM: Math.hypot(px - qx, py - qy), x: qx, y: qy }
}

// Finn nærmeste sti/vei på kartet. Itererer over alle paths innenfor de
// gitte data-layer-verdiene, sampler langs total-lengden med getPointAtLength
// for å håndtere både rette og buete subpaths korrekt.
//
// Returnerer { distM, layerKey, layerLabel, x, y } eller null hvis ingen
// passende lag finnes innenfor maxRadiusM.
//
// VIKTIG (frys-fix): getPointAtLength-sampling er dyrt. På store kart med
// tusenvis av paths blokkerer en naiv full-sampling hovedtråden i sekunder
// (long-press-menyen «fryser» appen). Derfor pruner vi hver path med en
// billig getBBox FØR vi sampler: er bounding-boksen lenger unna enn beste
// treff så langt (eller maks-radiusen), hopper vi over samplingen helt.
// På et stort kart betyr det at bare de få stiene nær fingeren faktisk
// samples — uavhengig av total kartstørrelse.
export function findNearestPath(svgEl, x, y, layerSpecs, opts = {}) {
  if (!svgEl) return null
  const maxRadiusM = Number.isFinite(opts.maxRadiusM) ? opts.maxRadiusM : 300
  let best = null
  let bestDist = maxRadiusM   // ignorer paths lenger unna enn dette
  for (const spec of layerSpecs) {
    const groups = svgEl.querySelectorAll(`g[data-layer="${spec.key}"]`)
    for (const g of groups) {
      for (const path of g.querySelectorAll('path')) {
        // Grov-prune: avstand fra punktet til path-ens bounding-boks. Er
        // boksen alt lenger unna enn beste treff, kan ingen del av path-en
        // være nærmere — dropp den uten å sample. getBBox er billig (cachet
        // geometri); getPointAtLength er det ikke.
        const bb = safeBBox(path)
        if (!bb) continue
        if (bboxDistance(x, y, bb) >= bestDist) continue
        const len = safeTotalLength(path)
        if (!len) continue
        // Sampling-steg: ~8 m for korte paths, opp til ~25 m for veldig
        // lange. Nok presisjon for «hvilken vei er nærmest» uten å bli
        // dyrt på store sti-nett.
        const step = Math.max(8, Math.min(25, len / 400))
        const n = Math.max(2, Math.ceil(len / step))
        let prev = null
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * len
          let pt
          try { pt = path.getPointAtLength(t) }
          catch { continue }
          if (prev) {
            const seg = pointToSegment(x, y, prev.x, prev.y, pt.x, pt.y)
            if (seg.distM < bestDist) {
              best = {
                distM: seg.distM,
                layerKey: spec.key,
                layerLabel: spec.label,
                x: seg.x,
                y: seg.y,
              }
              bestDist = seg.distM
            }
          }
          prev = pt
        }
      }
    }
  }
  return best
}

// Avstand fra punkt (x, y) til en akse-justert boks. 0 hvis punktet er inni.
function bboxDistance(x, y, bb) {
  const dx = x < bb.x ? bb.x - x : (x > bb.x + bb.width ? x - (bb.x + bb.width) : 0)
  const dy = y < bb.y ? bb.y - y : (y > bb.y + bb.height ? y - (bb.y + bb.height) : 0)
  return Math.hypot(dx, dy)
}

function safeBBox(path) {
  try { return path.getBBox() }
  catch { return null }
}

function safeTotalLength(path) {
  try { return path.getTotalLength() }
  catch { return 0 }
}

// Finn nærmeste navngitte sted i søke-indeksen. Begrenser til ekte
// stedsnavn (ikke unavngitte vann-polygoner som har syntetiske navn).
export function findNearestPlace(searchIndex, x, y) {
  if (!Array.isArray(searchIndex) || !searchIndex.length) return null
  let best = null
  for (const r of searchIndex) {
    if (r.kind === 'vann-omrade') continue   // syntetisk «Innsjø uten navn» — skip
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue
    const d = Math.hypot(r.x - x, r.y - y)
    if (!best || d < best.distM) {
      best = { name: r.name, label: r.label, kind: r.kind, x: r.x, y: r.y, distM: d }
    }
  }
  return best
}

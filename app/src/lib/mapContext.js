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

// Korteste avstand fra punkt (px,py) til linjesegmentet (ax,ay)-(bx,by).
// Ren matematikk — ingen DOM/layout. SVG user-units = meter.
export function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

// Korteste avstand fra punkt til en åpen polylinje (array av [x,y]). Brukes til
// å avgjøre om et long-press-punkt ligger PÅ en navngitt bekk/elv (linje-vann)
// — getPointAtLength er bevisst unngått (synkron, layout-tvingende, frøs store
// kart i v9.1.22); dette er ren punkt-til-segment-aritmetikk.
export function pointToPolylineDist(px, py, pts) {
  if (!Array.isArray(pts) || pts.length === 0) return Infinity
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1])
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const d = pointToSegmentDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
    if (d < best) best = d
  }
  return best
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

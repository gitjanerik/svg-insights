import RBush from 'rbush'

// Tetthets-budsjett — ren, deterministisk navne-vraking i SKJERMROM.
//
// Gir et sett med navn-id-er som skal vises i gjeldende utsnitt/zoom. Ingen DOM,
// ingen Vue, ingen tilfeldighet → fullt enhetstestbar. MapView står for
// skjermrom-transformen (senter sx,sy + boks halfW,halfH) og toggler CSS-klassen.
//
// Pipeline (CD-handoff §4): forced (søk) → LOD-filter m/hysterese → sorter på
// score → grådig kollisjon (rbush) + rutenett-kvote → synlig-sett.
//
// candidate: {
//   id:     stabil streng (navnet — globalt unikt ved bygging) for tie-break + hysterese
//   score:  0–100 viktighet (data-score fra mapBuilder)
//   sx, sy: skjerm-senter (px)
//   halfW, halfH: halv boks-utstrekning i skjerm-px (aksejustert AABB)
//   group:  'priority' (topp/vann/område — utenom kvote) | 'quota' (bebyggelse/hytte)
//   forced: true ⇒ søke-pin: vises alltid, tegnes over, uten kollisjons-fotavtrykk
// }
// opts: { cellPx, K, scale, minZoomOf(score)->number, prevShown:Set, pad }
//
// Returnerer Set<id> som skal være synlige.

// Et allerede-vist navn overlever til zoom faller godt UNDER terskelen (× denne
// faktoren) — hindrer blinking når man panorerer/zoomer rundt en LOD-grense.
const HYSTERESIS = 0.85

export function declutter(candidates = [], opts = {}) {
  const {
    cellPx = 240,
    K = 2,
    scale = 1,
    prevShown = new Set(),
    pad = 3,
    maxVisible = Infinity,   // global tak (Utvikler-budsjett) — rutenett-kvote er primær
  } = opts
  const minZoomOf = typeof opts.minZoomOf === 'function' ? opts.minZoomOf : () => 0

  const visible = new Set()
  const tree = new RBush()
  const cellCount = new Map()

  const boxOf = (c) => ({
    minX: c.sx - c.halfW - pad,
    minY: c.sy - c.halfH - pad,
    maxX: c.sx + c.halfW + pad,
    maxY: c.sy + c.halfH + pad,
  })

  // 1. Søke-pin: alltid synlig, tegnes over. Får IKKE kollisjons-fotavtrykk
  //    (skal ikke dytte/vrake naboer — kun ligge oppå).
  for (const c of candidates) {
    if (c.forced) visible.add(c.id)
  }

  // 2. LOD-filter med hysterese.
  const eligible = []
  for (const c of candidates) {
    if (c.forced) continue
    const mz = minZoomOf(c.score)
    const thresh = prevShown.has(c.id) ? mz * HYSTERESIS : mz
    if (scale >= thresh) eligible.push(c)
  }

  // 3. Sorter: score desc → allerede-vist først (stabilitet) → stabil id.
  eligible.sort((a, b) =>
    b.score - a.score ||
    (Number(prevShown.has(b.id)) - Number(prevShown.has(a.id))) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )

  // 4. Grådig plassering: kollisjon (rbush) + rutenett-kvote pr klassegruppe.
  let placed = 0
  for (const c of eligible) {
    if (placed >= maxVisible) break   // globalt tak nådd (sortert desc → resten lavere)
    const box = boxOf(c)
    if (tree.collides(box)) continue
    if (c.group !== 'priority') {
      const key = `${Math.floor(c.sx / cellPx)},${Math.floor(c.sy / cellPx)}`
      const n = cellCount.get(key) || 0
      if (n >= K) continue
      cellCount.set(key, n + 1)
    }
    visible.add(c.id)
    tree.insert({ ...box, id: c.id })
    placed++
  }

  return visible
}

// Standard score→minZoom-bånd (kalibrerbart). Høyere score ⇒ synlig tidligere
// (lavere zoom). near = .zoom-near-terskelen (default 2.5) gjenbrukes for det
// laveste «detalj»-båndet. Returnerer minste scale der navnet er kvalifisert.
export function makeMinZoomOf(near = 2.5) {
  return (score) => {
    if (score >= 80) return 0
    if (score >= 60) return 1.0
    if (score >= 40) return 1.3
    if (score >= 20) return near
    return 4
  }
}

import RBush from 'rbush'

// Tetthets-budsjett — ren, deterministisk navne-vraking i SKJERMROM.
//
// Gir et sett med navn-id-er som skal vises i gjeldende utsnitt/zoom. Ingen DOM,
// ingen Vue, ingen tilfeldighet → fullt enhetstestbar. MapView står for
// skjermrom-transformen (senter sx,sy + boks halfW,halfH) og toggler CSS-klassen.
//
// Pipeline (CD-handoff §4): forced (søk) → LOD-filter m/hysterese → STICKY-først
// grådig plassering (allerede-viste navn beholder plassen) → fersk fyll i ledige
// hull (kollisjon + rutenett-kvote) → synlig-sett.
//
// STABILITET er hovedkravet: navn skal IKKE «komme og gå» ved panorering eller
// ubevisst marginal zoom. Derfor er allerede-viste navn klistret (placeres først,
// utenom kvoten) — så et synlig navn forsvinner bare når det går ut av skjermen
// eller faller under sin (hysterese-relakserte) LOD-terskel, eller (ved utzoom)
// kolliderer med et VIKTIGERE allerede-vist navn. Under panorering er innbyrdes
// skjerm-avstand mellom viste navn konstant ⇒ ingen nye kollisjoner ⇒ ro.
//
// candidate: {
//   id:     stabil streng (navnet — globalt unikt ved bygging)
//   score:  0–100 viktighet (data-score fra mapBuilder)
//   sx, sy: skjerm-senter (px)
//   halfW, halfH: halv boks-utstrekning i skjerm-px (aksejustert AABB)
//   group:  'priority' (topp/vann/område — utenom kvote) | 'quota' (bebyggelse/hytte)
//   forced: true ⇒ søke-pin: vises alltid, tegnes over, uten kollisjons-fotavtrykk
// }
// opts: { cellPx, K, scale, minZoomOf(score)->number, prevShown:Set, pad, maxVisible }
//
// Returnerer Set<id> som skal være synlige.

// Et allerede-vist navn overlever til zoom faller godt UNDER terskelen (× denne
// faktoren) — hindrer blinking når man panorerer/zoomer rundt en LOD-grense.
const HYSTERESIS = 0.7

export function declutter(candidates = [], opts = {}) {
  const {
    cellPx = 240,
    K = 2,
    scale = 1,
    prevShown = new Set(),
    pad = 2,
    maxVisible = Infinity,   // global tak (Utvikler-budsjett) — rutenett-kvote er primær
  } = opts
  const minZoomOf = typeof opts.minZoomOf === 'function' ? opts.minZoomOf : () => 0

  const visible = new Set()
  const tree = new RBush()
  const cellCount = new Map()
  let placed = 0

  const boxOf = (c) => ({
    minX: c.sx - c.halfW - pad,
    minY: c.sy - c.halfH - pad,
    maxX: c.sx + c.halfW + pad,
    maxY: c.sy + c.halfH + pad,
  })
  const cellKey = (c) => `${Math.floor(c.sx / cellPx)},${Math.floor(c.sy / cellPx)}`

  // Forsøk å plassere én kandidat. enforceQuota=false for sticky (de har alt
  // fortjent plassen — kvoten gater bare VEKST). Tellingen skjer uansett, så
  // ferske navn respekterer at sticky allerede opptar celle-plass.
  const tryPlace = (c, enforceQuota) => {
    if (placed >= maxVisible) return
    const box = boxOf(c)
    if (tree.collides(box)) return
    if (c.group !== 'priority') {
      const key = cellKey(c)
      const n = cellCount.get(key) || 0
      if (enforceQuota && n >= K) return
      cellCount.set(key, n + 1)
    }
    visible.add(c.id)
    tree.insert({ ...box, id: c.id })
    placed++
  }

  // 1. Søke-pin: alltid synlig, tegnes over. Får IKKE kollisjons-fotavtrykk.
  for (const c of candidates) {
    if (c.forced) visible.add(c.id)
  }

  // 2. LOD-filter med hysterese (sticky-navn får relaksert terskel).
  const eligible = []
  for (const c of candidates) {
    if (c.forced) continue
    const mz = minZoomOf(c.score)
    const thresh = prevShown.has(c.id) ? mz * HYSTERESIS : mz
    if (scale >= thresh) eligible.push(c)
  }

  const byScore = (a, b) =>
    b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  // 3. STICKY først (allerede vist) — beholder plassen, utenom kvoten.
  const sticky = eligible.filter((c) => prevShown.has(c.id)).sort(byScore)
  for (const c of sticky) tryPlace(c, false)

  // 4. FERSKE navn fyller ledige hull — kollisjon + rutenett-kvote.
  const fresh = eligible.filter((c) => !prevShown.has(c.id)).sort(byScore)
  for (const c of fresh) tryPlace(c, true)

  return visible
}

// Score→minZoom-bånd. Bevisst LØS: tetthet styres primært av kollisjon +
// rutenett-kvote i skjermrom (naturlig stabilt — flere navn får plass når man
// zoomer inn). minZoom gater bare så vidt det minst viktige ved lav zoom, så
// kartet ikke er overlesset på full oversikt. near = .zoom-near-terskelen.
export function makeMinZoomOf(near = 2.5) {
  return (score) => {
    if (score >= 55) return 0      // topp, vann, store steder — alltid kvalifisert
    if (score >= 35) return 0.9    // grend/gård/seter — nær full oversikt
    if (score >= 20) return 1.3    // hytter o.l. — et lite hint innzoom
    return 1.8
  }
}

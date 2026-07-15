// Stifinner — rutenavigasjon på kartets sti-/vei-lag.
//
// Brukeren velger et mål (B) fra info-arket («Naviger hit»), så et startpunkt
// (A) via et midt-kikkertsikte i kartet. Når ruten vises kan hun legge til
// inntil 3 valgfrie via-punkter (samme sikte, gult) — ruten reberegnes A →
// via… → B. Vi leser sti-geometrien tilbake fra den rendrede kart-SVG-en (kun
// `<path d>` er tilgjengelig på view-tid), bygger en routing-graf og foreslår
// 1–3 alternative ruter.
//
// Modus-maskin:  idle → pickingStart → showing ⇄ pickingVia  (X-knapp → idle)
//
// All DOM-tilgang skjer i featuresFromSvg(svgElement); parsing/graf/k-ruter er
// ren, testet lib (routing.js + pathUtils.parsePathSubpaths).

import { ref, computed } from 'vue'
import { buildRoutingGraph, planRoutesThrough, planLoop } from '../lib/routing.js'
import { parsePathSubpaths } from '../lib/pathUtils.js'

// ISOM-koder som er routbare (vei/sti/bro). Må matche ISOM_COST i routing.js.
const ROUTABLE_CODES = new Set(['501', '502', '503', '504', '505', '506', '507', '509'])

// Maks snap-avstand fra valgt punkt til nærmeste sti-node (meter). Lenger unna
// → vi antar «ingen sti i nærheten».
const MAX_SNAP_M = 150

// Maks antall via-punkter (A + inntil 3 via + B = 5 punkter totalt).
const MAX_VIA = 3

// Antatt ganghastighet for estimert tid (m/min ≈ 4 km/t).
const WALK_M_PER_MIN = 4000 / 60
// Naismith-tillegg: +1 min per 10 høydemeter stigning (600 m/t vertikalt).
const ASCENT_M_PER_MIN = 10
// Mildt tillegg for nedstigning — bratt utfor koster også tid, men langt
// mindre enn stigning: +1 min per 30 høydemeter fall.
const DESCENT_M_PER_MIN = 30

export function useStifinner() {
  const mode = ref('idle')          // 'idle' | 'pickingStart' | 'showing' | 'pickingVia'
  const isLoop = ref(false)         // rundtur (origo = start = mål); via = vendepunkt(er)
  const destination = ref(null)     // { svgX, svgY } — B (== start når isLoop)
  const start = ref(null)           // { svgX, svgY } — A
  const via = ref([])               // [{ svgX, svgY }] — 0–3 via-punkter, i rekkefølge
  const routes = ref([])            // [{ coordinates, lengthM, costM }]
  const selectedRouteIdx = ref(0)
  const error = ref('')             // brukervendt feilmelding
  // Snappede graf-noder (for connector-strek fra valgt punkt til stien).
  const startSnap = ref(null)       // { x, y } i SVG-rom
  const destSnap = ref(null)
  const viaSnaps = ref([])          // [{ x, y }] parallelt til via

  // Cache av routing-grafen for sist brukte SVG-element, så gjentatte via-
  // redigeringer ikke bygger grafen på nytt hver gang.
  let cachedRg = null
  let cachedSvg = null
  // Sist brukte SVG-element, så recompute() kan reberegne når via endres.
  let lastSvg = null

  const active = computed(() => mode.value !== 'idle')
  const canAddVia = computed(() =>
    (mode.value === 'showing' || mode.value === 'pickingVia') &&
    !!start.value && via.value.length < MAX_VIA)

  // Luftlinje (rett strek) A→B i meter. SVG-rommet er i meter (viewBox), så
  // dette er ekte avstand. Tilgjengelig så snart både start og mål er satt —
  // også når ingen sammenhengende rute finnes, så brukeren alltid ser den
  // faktiske A→B-avstanden.
  const directDistanceM = computed(() => {
    if (isLoop.value) return null       // origo == mål → luftlinje er meningsløs
    const a = start.value, b = destination.value
    if (!a || !b) return null
    return Math.hypot(a.svgX - b.svgX, a.svgY - b.svgY)
  })

  function begin(dest) {
    isLoop.value = false
    destination.value = { svgX: dest.svgX, svgY: dest.svgY }
    start.value = null
    via.value = []
    routes.value = []
    selectedRouteIdx.value = 0
    error.value = ''
    startSnap.value = null
    destSnap.value = null
    viaSnaps.value = []
    mode.value = 'pickingStart'
  }

  // Rundtur: origo (long-press-punktet) er BÅDE start og mål. Brukeren sikter
  // deretter inn ett vendepunkt (via) — ruten blir origo → via → origo, der
  // hjemveien unngår utturen (planLoop) så det blir en ekte sløyfe. Går rett
  // til via-plukk siden en runde trenger minst ett vendepunkt.
  function beginLoop(origin) {
    isLoop.value = true
    destination.value = { svgX: origin.svgX, svgY: origin.svgY }
    start.value = { svgX: origin.svgX, svgY: origin.svgY }
    via.value = []
    routes.value = []
    selectedRouteIdx.value = 0
    error.value = ''
    startSnap.value = null
    destSnap.value = null
    viaSnaps.value = []
    mode.value = 'pickingVia'
  }

  function cancel() {
    mode.value = 'idle'
    isLoop.value = false
    destination.value = null
    start.value = null
    via.value = []
    routes.value = []
    selectedRouteIdx.value = 0
    error.value = ''
    startSnap.value = null
    destSnap.value = null
    viaSnaps.value = []
    cachedRg = null
    cachedSvg = null
    lastSvg = null
  }

  // Spøkelses-/utvidelsesfliser ligger som nestede <svg x y> i aktiv-flisas
  // meterrom (buildGhostSvg i MapView), og path-d-ene deres er FLIS-LOKALE.
  // Uten dette offsetet ble naboflisenes stinett limt inn feilplassert oppå
  // aktiv flis — forskjøvet med flis-bredder — og Stifinner foreslo ruter
  // tvers over innsjøer langs de feilplasserte kopiene (Gjende-tilfellet).
  // Nestede fliser er gitter-kompatible (samme størrelse, scale 1), så
  // kumulert x/y er hele transformasjonen.
  function nestedSvgOffset(el, rootSvg) {
    let dx = 0, dy = 0
    for (let n = el; n && n !== rootSvg; n = n.parentNode) {
      if (String(n.tagName).toLowerCase() === 'svg') {
        dx += parseFloat(n.getAttribute('x')) || 0
        dy += parseFloat(n.getAttribute('y')) || 0
      }
    }
    return { dx, dy }
  }

  // Les routbare sti-/vei-paths fra SVG-en (aktiv flis + spøkelsesfliser,
  // løftet til aktiv-flisas koordinatrom) og bygg features til grafen.
  function featuresFromSvg(svgElement) {
    const features = []
    const groups = svgElement.querySelectorAll('[data-iso]')
    for (const g of groups) {
      const code = g.getAttribute('data-iso')
      if (!ROUTABLE_CODES.has(code)) continue
      const { dx, dy } = nestedSvgOffset(g, svgElement)
      const paths = g.tagName.toLowerCase() === 'path' ? [g] : g.querySelectorAll('path')
      for (const p of paths) {
        const d = p.getAttribute('d')
        if (!d) continue
        for (const sub of parsePathSubpaths(d)) {
          if (sub.length < 2) continue
          features.push({
            coordinates: (dx || dy) ? sub.map(([x, y]) => [x + dx, y + dy]) : sub,
            isomCode: code,
          })
        }
      }
    }
    return features
  }

  // Bygg (eller gjenbruk cachet) routing-graf for et SVG-element.
  // componentBridgeM=6→80: se lib/routing.js — kobler frakoblede sti-/vei-
  // fragmenter til hovednettet så et startpunkt ved en stasjon/P-plass ikke
  // ender i en isolert stump.
  function graphFor(svgElement) {
    if (cachedRg && cachedSvg === svgElement) return cachedRg
    const features = featuresFromSvg(svgElement)
    if (!features.length) return null
    cachedRg = buildRoutingGraph(features, { snapM: 6, componentBridgeM: 80 })
    cachedSvg = svgElement
    return cachedRg
  }

  // Reberegn ruter gjennom [start, ...via, mål] mot cachet graf. Setter routes/
  // snaps/error. Kalles av confirmStart og alle via-endringer.
  function recompute() {
    error.value = ''
    routes.value = []
    selectedRouteIdx.value = 0
    startSnap.value = null
    destSnap.value = null
    viaSnaps.value = []

    if (!lastSvg || !start.value || !destination.value) {
      error.value = 'Mangler kartdata'
      return
    }
    const rg = graphFor(lastSvg)
    if (!rg) {
      error.value = 'Fant ingen sti eller vei på kartet'
      return
    }

    // Rundtur: origo (start == mål) + vendepunkt(er). Ellers A → via… → B.
    if (isLoop.value) {
      if (!via.value.length) return   // trenger minst ett vendepunkt (venter på plukk)
      const pts = [start.value, ...via.value]
      const snapped = pts.map(p => rg.nearestNode([p.svgX, p.svgY]))
      for (let i = 0; i < snapped.length; i++) {
        const n = snapped[i]
        if (!n || n.distM > MAX_SNAP_M) {
          error.value = i === 0 ? 'Ingen sti eller vei i nærheten av startpunktet'
            : `Ingen sti eller vei i nærheten av vendepunkt ${i}`
          return
        }
      }
      startSnap.value = { x: snapped[0].pos[0], y: snapped[0].pos[1] }
      destSnap.value = { x: snapped[0].pos[0], y: snapped[0].pos[1] }
      viaSnaps.value = snapped.slice(1).map(n => ({ x: n.pos[0], y: n.pos[1] }))

      const found = planLoop(rg, snapped[0].id, snapped.slice(1).map(n => n.id), { k: 3 })
      if (!found.length) {
        error.value = 'Fant ingen rundtur innom vendepunktet'
        return
      }
      routes.value = found
      return
    }

    const pts = [start.value, ...via.value, destination.value]
    const snapped = pts.map(p => rg.nearestNode([p.svgX, p.svgY]))
    for (let i = 0; i < snapped.length; i++) {
      const n = snapped[i]
      if (!n || n.distM > MAX_SNAP_M) {
        error.value = i === 0 ? 'Ingen sti eller vei i nærheten av startpunktet'
          : i === snapped.length - 1 ? 'Ingen sti eller vei i nærheten av målet'
            : `Ingen sti eller vei i nærheten av via-punkt ${i}`
        return
      }
    }

    startSnap.value = { x: snapped[0].pos[0], y: snapped[0].pos[1] }
    destSnap.value = { x: snapped[snapped.length - 1].pos[0], y: snapped[snapped.length - 1].pos[1] }
    viaSnaps.value = snapped.slice(1, -1).map(n => ({ x: n.pos[0], y: n.pos[1] }))

    const found = planRoutesThrough(rg, snapped.map(n => n.id), { k: 3 })
    if (!found.length) {
      error.value = 'Fant ingen rute mellom punktene'
      return
    }
    routes.value = found
  }

  /**
   * Bekreft startpunkt (A) og beregn ruter A→B. Går til 'showing'.
   * @param {{x:number,y:number}} svgPoint
   * @param {SVGElement} svgElement
   * @param {{startOnWater?:boolean}} opts
   */
  function confirmStart(svgPoint, svgElement, opts = {}) {
    error.value = ''
    routes.value = []
    selectedRouteIdx.value = 0
    startSnap.value = null
    destSnap.value = null
    viaSnaps.value = []
    via.value = []
    mode.value = 'showing'

    // Startpunkt i vann → ingen rute, og ikke sett start (så ingen villedende
    // markør tegnes midt i vannet). Caller avgjør vann-treff (DOM-avhengig).
    if (opts.startOnWater) {
      start.value = null
      error.value = 'Fant ingen rute – startpunktet er i vann'
      return
    }

    start.value = { svgX: svgPoint.x, svgY: svgPoint.y }
    lastSvg = svgElement

    if (!svgElement || !destination.value) {
      error.value = 'Mangler kartdata'
      return
    }
    recompute()
  }

  // Gå til via-plukk-modus (crosshair). Kalles av «+ Via»-knappen.
  function beginAddVia() {
    if (!canAddVia.value) return
    mode.value = 'pickingVia'
  }

  // Bekreft et via-punkt (skjermsenteret). Legges til i rekkefølge og ruten
  // reberegnes. Går tilbake til 'showing'.
  function confirmVia(svgPoint, svgElement) {
    mode.value = 'showing'
    if (via.value.length >= MAX_VIA) return
    if (svgElement) lastSvg = svgElement
    via.value = [...via.value, { svgX: svgPoint.x, svgY: svgPoint.y }]
    recompute()
  }

  function removeVia(index) {
    if (index < 0 || index >= via.value.length) return
    via.value = via.value.filter((_, i) => i !== index)
    recompute()
  }

  function clearVia() {
    if (!via.value.length) return
    via.value = []
    recompute()
  }

  function selectRoute(idx) {
    if (idx >= 0 && idx < routes.value.length) selectedRouteIdx.value = idx
  }

  // Estimert gangtid. Basis er flat gange 4 km/t; med høydeprofil (DEM-sampla
  // ascent/descent langs ruta) legges Naismith-tillegg på, så 1,5 km med 450
  // stigningsmeter estimeres ~67 min i stedet for urealistiske 22. Uten profil
  // (kart uten DEM) faller vi tilbake til ren distanse som før.
  function estWalkMinutes(lengthM, climb = null) {
    let min = lengthM / WALK_M_PER_MIN
    if (climb) {
      min += (climb.ascent || 0) / ASCENT_M_PER_MIN
      min += (climb.descent || 0) / DESCENT_M_PER_MIN
    }
    return Math.max(1, Math.round(min))
  }

  return {
    mode, active, isLoop, destination, start, via, routes, selectedRouteIdx, error,
    startSnap, destSnap, viaSnaps, directDistanceM, canAddVia, MAX_VIA,
    begin, beginLoop, cancel, confirmStart, beginAddVia, confirmVia, removeVia, clearVia,
    selectRoute, estWalkMinutes,
  }
}

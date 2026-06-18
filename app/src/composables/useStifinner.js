// Stifinner — rutenavigasjon på kartets sti-/vei-lag.
//
// Brukeren velger et mål (B) fra info-arket («Naviger hit»), så et startpunkt
// (A) via et midt-kikkertsikte i kartet. Vi leser sti-geometrien tilbake fra
// den rendrede kart-SVG-en (kun `<path d>` er tilgjengelig på view-tid),
// bygger en routing-graf og foreslår 1–3 alternative ruter A→B.
//
// Modus-maskin:  idle → pickingStart → showing  (X-knapp → idle)
//
// All DOM-tilgang skjer i computeRoutes(svgElement); parsing/graf/k-ruter er
// ren, testet lib (routing.js + pathUtils.parsePathSubpaths).

import { ref, computed } from 'vue'
import { buildRoutingGraph, kShortestRoutes } from '../lib/routing.js'
import { parsePathSubpaths } from '../lib/pathUtils.js'

// ISOM-koder som er routbare (vei/sti/bro). Må matche ISOM_COST i routing.js.
const ROUTABLE_CODES = new Set(['501', '502', '503', '504', '505', '506', '507', '509'])

// Maks snap-avstand fra valgt punkt til nærmeste sti-node (meter). Lenger unna
// → vi antar «ingen sti i nærheten».
const MAX_SNAP_M = 150

// Antatt ganghastighet for estimert tid (m/min ≈ 4 km/t).
const WALK_M_PER_MIN = 4000 / 60

export function useStifinner() {
  const mode = ref('idle')          // 'idle' | 'pickingStart' | 'showing'
  const destination = ref(null)     // { svgX, svgY } — B
  const start = ref(null)           // { svgX, svgY } — A
  const routes = ref([])            // [{ coordinates, lengthM, costM }]
  const selectedRouteIdx = ref(0)
  const error = ref('')             // brukervendt feilmelding
  // Snappede graf-noder (for connector-strek fra valgt punkt til stien).
  const startSnap = ref(null)       // { x, y } i SVG-rom
  const destSnap = ref(null)

  const active = computed(() => mode.value !== 'idle')

  // Luftlinje (rett strek) A→B i meter. SVG-rommet er i meter (viewBox), så
  // dette er ekte avstand. Tilgjengelig så snart både start og mål er satt —
  // også når ingen sammenhengende rute finnes, så brukeren alltid ser den
  // faktiske A→B-avstanden.
  const directDistanceM = computed(() => {
    const a = start.value, b = destination.value
    if (!a || !b) return null
    return Math.hypot(a.svgX - b.svgX, a.svgY - b.svgY)
  })

  function begin(dest) {
    destination.value = { svgX: dest.svgX, svgY: dest.svgY }
    start.value = null
    routes.value = []
    selectedRouteIdx.value = 0
    error.value = ''
    startSnap.value = null
    destSnap.value = null
    mode.value = 'pickingStart'
  }

  function cancel() {
    mode.value = 'idle'
    destination.value = null
    start.value = null
    routes.value = []
    selectedRouteIdx.value = 0
    error.value = ''
    startSnap.value = null
    destSnap.value = null
  }

  // Les routbare sti-/vei-paths fra SVG-en og bygg features til grafen.
  function featuresFromSvg(svgElement) {
    const features = []
    const groups = svgElement.querySelectorAll('[data-iso]')
    for (const g of groups) {
      const code = g.getAttribute('data-iso')
      if (!ROUTABLE_CODES.has(code)) continue
      const paths = g.tagName.toLowerCase() === 'path' ? [g] : g.querySelectorAll('path')
      for (const p of paths) {
        const d = p.getAttribute('d')
        if (!d) continue
        for (const sub of parsePathSubpaths(d)) {
          if (sub.length >= 2) features.push({ coordinates: sub, isomCode: code })
        }
      }
    }
    return features
  }

  /**
   * Beregn ruter fra start (A) til destination (B) basert på sti-laget i
   * `svgElement`. Setter routes/error og går til 'showing'.
   * @param {SVGElement} svgElement
   */
  function confirmStart(svgPoint, svgElement) {
    start.value = { svgX: svgPoint.x, svgY: svgPoint.y }
    error.value = ''
    routes.value = []
    selectedRouteIdx.value = 0
    startSnap.value = null
    destSnap.value = null
    mode.value = 'showing'

    if (!svgElement || !destination.value) {
      error.value = 'Mangler kartdata'
      return
    }

    const features = featuresFromSvg(svgElement)
    if (!features.length) {
      error.value = 'Fant ingen sti eller vei på kartet'
      return
    }

    // snapM=6: routbare lag dekker vei + skogsbilvei + sti (ROUTABLE_CODES),
    // men der en adkomstvei møter en sti er endepunktene ofte nudget noen
    // meter fra hverandre etter rendering/DP-forenkling. 6 m slår sammen
    // slike kryss så en tur som går vei → skogsbilvei → sti henger sammen
    // i grafen (var 3 m, som lot road- og sti-nettet falle i hver sin
    // frakoblede komponent → «fant ingen rute» når man startet på en P-plass
    // ved en vei).
    const rg = buildRoutingGraph(features, { snapM: 6 })
    const aPos = [start.value.svgX, start.value.svgY]
    const bPos = [destination.value.svgX, destination.value.svgY]
    const aNode = rg.nearestNode(aPos)
    const bNode = rg.nearestNode(bPos)

    if (!aNode || aNode.distM > MAX_SNAP_M) {
      error.value = 'Ingen sti eller vei i nærheten av startpunktet'
      return
    }
    if (!bNode || bNode.distM > MAX_SNAP_M) {
      error.value = 'Ingen sti eller vei i nærheten av målet'
      return
    }
    startSnap.value = { x: aNode.pos[0], y: aNode.pos[1] }
    destSnap.value = { x: bNode.pos[0], y: bNode.pos[1] }

    const found = kShortestRoutes(rg, aNode.id, bNode.id, { k: 3 })
    if (!found.length) {
      error.value = 'Fant ingen rute mellom punktene'
      return
    }
    routes.value = found
  }

  function selectRoute(idx) {
    if (idx >= 0 && idx < routes.value.length) selectedRouteIdx.value = idx
  }

  function estWalkMinutes(lengthM) {
    return Math.max(1, Math.round(lengthM / WALK_M_PER_MIN))
  }

  return {
    mode, active, destination, start, routes, selectedRouteIdx, error,
    startSnap, destSnap, directDistanceM,
    begin, cancel, confirmStart, selectRoute, estWalkMinutes,
  }
}

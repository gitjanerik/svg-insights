<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePinchZoom } from '../composables/usePinchZoom.js'
import { useUserPosition } from '../composables/useUserPosition.js'
import { useCompass } from '../composables/useCompass.js'
import { useDraggableDrawer } from '../composables/useDraggableDrawer.js'
import { useMapAnnotations, ANNOTATION_SYMBOLS } from '../composables/useMapAnnotations.js'
import AnnotationIcon from '../components/AnnotationIcon.vue'
import { loadMap as loadStoredMap, listMaps as listStoredMaps } from '../lib/mapStorage.js'
import { isomCatalog } from '../lib/symbolizer.js'
import { printDocument, exportSvgFile, exportPngFile, exportPdfFile } from '../lib/printExport.js'
import { unpackDem, findHighestPoint } from '../lib/demSampling.js'
import { fetchDEM } from '../lib/demFetcher.js'
import { useCurveBall } from '../composables/useCurveBall.js'
import CurveBallLayer from '../components/CurveBallLayer.vue'
import CurveBallHUD from '../components/CurveBallHUD.vue'
import CurveBallFlippers from '../components/CurveBallFlippers.vue'
import { t } from '../lib/i18n.js'

const router = useRouter()
const route = useRoute()
const wrapperRef = ref(null)
const svgHostRef = ref(null)

const loading = ref(true)
const loadError = ref(null)
const meta = ref(null)
const mapTitle = ref('Turkart')

const curveball = useCurveBall()
const storedDem = ref(null)             // unpacked DEM, eller null hvis ikke tilgjengelig
const storedHighestPoint = ref(null)

// v7.4.0: turneringsmodus — kart-rekkefølge og state-bæring mellom kart.
// userMaps: alle brukerens egne kart (sortert av listMaps i opprettet-desc).
// visitedMapIds: hvilke kart turneringen allerede har spilt (lagres i sessionStorage).
const userMaps = ref([])
// v8.0.0 rebrand-migrering: skriv kun ny nøkkel, men les begge så turneringer
// fra før-deploy fortsetter å virke. Legacy-keys leses og ryddes etter konsumering.
const TOURNAMENT_KEY = 'curveball-tournament-state'
const TOURNAMENT_KEY_LEGACY = 'flippkart-tournament-state'

function readTournamentRaw() {
  try {
    return sessionStorage.getItem(TOURNAMENT_KEY)
        ?? sessionStorage.getItem(TOURNAMENT_KEY_LEGACY)
  } catch { return null }
}
function clearTournamentLegacy() {
  try { sessionStorage.removeItem(TOURNAMENT_KEY_LEGACY) } catch { /* ignore */ }
}

// Neste kart i turneringen — første userMap som ikke er gjeldende kart og
// ikke i visitedMapIds. null hvis ingen flere kart finnes.
const tournamentNextMap = computed(() => {
  if (!userMaps.value.length) return null
  const visited = readVisitedMapIds()
  const currentId = route.params.id
  for (const m of userMaps.value) {
    if (m.id === currentId) continue
    if (visited.includes(m.id)) continue
    return { id: m.id, navn: m.navn }
  }
  return null
})

function readVisitedMapIds() {
  try {
    const raw = readTournamentRaw()
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.visitedMapIds) ? parsed.visitedMapIds : []
  } catch { return [] }
}

// shareInfo for HUD-modal — bygges fra meta + base-URL. null hvis meta mangler.
const cbShareInfo = computed(() => {
  const m = meta.value
  if (!m || !m.bbox) return null
  const lat = (m.bbox.south + m.bbox.north) / 2
  const lon = (m.bbox.west + m.bbox.east) / 2
  // sizeKm = bredde i km (kvadratiske kart, så bredde≈høyde). Faller tilbake til 4.
  const sizeKm = m.widthM ? +(m.widthM / 1000).toFixed(2) : 4
  const equidistanceM = m.equidistance ?? 20
  const baseUrl = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`
  return { lat, lon, sizeKm, equidistanceM, baseUrl }
})

async function loadUserMapsForTournament() {
  try { userMaps.value = await listStoredMaps() }
  catch { userMaps.value = [] }
}

async function onTournamentNext(next) {
  if (!next?.id) return
  // Lagre curveball-state + visited-list for restoring i ny MapView-mount
  const state = curveball.serializeForTournament()
  const visited = readVisitedMapIds()
  if (!visited.includes(route.params.id)) visited.push(route.params.id)
  try {
    sessionStorage.setItem(TOURNAMENT_KEY, JSON.stringify({
      state,
      visitedMapIds: visited,
      pendingNextMapId: next.id,
    }))
  } catch { /* QuotaExceeded — fall through, restore vil ikke trigge */ }
  curveball.deactivate()
  router.push({ name: 'kart-vis', params: { id: next.id } })
}

function consumeTournamentRestore() {
  try {
    const raw = readTournamentRaw()
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.pendingNextMapId !== route.params.id) {
      // Mounted på et annet kart enn forventet — turneringen er brutt.
      sessionStorage.removeItem(TOURNAMENT_KEY)
      clearTournamentLegacy()
      return null
    }
    // Behold visitedMapIds for senere "Neste kart"-kjeder, men fjern
    // state+pendingNextMapId så vi ikke restorer dobbelt. Tøm legacy også
    // så vi ikke ender med to konkurrerende verdier.
    sessionStorage.setItem(TOURNAMENT_KEY, JSON.stringify({
      visitedMapIds: parsed.visitedMapIds ?? [],
    }))
    clearTournamentLegacy()
    return parsed.state ?? null
  } catch { return null }
}
const cbViewBox = computed(() => {
  if (!meta.value) return '0 0 1 1'
  return `0 0 ${meta.value.widthM} ${meta.value.heightM}`
})

// Skjerm-rekt for kart-SVG-en, oppdatert når curveball er aktiv så Pong-paddles
// kan posisjoneres relativt til kartets ekte plass på skjermen (etter pinch/pan).
const mapRect = ref(null)

function updateMapRect() {
  if (!curveball.active.value) {
    mapRect.value = null
    return
  }
  const el = svgHostRef.value
  if (!el || !meta.value) return
  const r = el.getBoundingClientRect()
  // SVG bruker preserveAspectRatio="xMidYMid meet" — content-rect er centrert
  // og letterboxet i host-div-en. Beregn ekte content-rect (der kart-kantene
  // faktisk er) så paddles følger kantene, ikke host-edges.
  const containerAR = r.width / r.height
  const viewBoxAR = meta.value.widthM / meta.value.heightM
  let contentW, contentH, offsetX, offsetY
  if (containerAR > viewBoxAR) {
    // Container bredere → fit by height, horisontal letterbox
    contentH = r.height
    contentW = r.height * viewBoxAR
    offsetY = 0
    offsetX = (r.width - contentW) / 2
  } else {
    contentW = r.width
    contentH = r.width / viewBoxAR
    offsetX = 0
    offsetY = (r.height - contentH) / 2
  }
  // v8.0.1: HUD-elementer (paddle-tykkelse, topp-bar, hjerter, exit-knapp)
  // skal skaleres med kart-utsnittets faktiske skjerm-størrelse. Tidligere
  // var alt fast i CSS-px slik at små kart fikk store paddles. Referansen
  // 420px tilsvarer ca. en typisk 4×4km-mapRect på telefon i portrait — der
  // designet var tunet — så scale=1 der. Clampes så HUD aldri blir mikro
  // eller dominerer hele kartet.
  const minDim = Math.min(contentW, contentH)
  const hudScale = Math.max(0.55, Math.min(1.3, minDim / 420))
  mapRect.value = {
    top:    r.top + offsetY,
    left:   r.left + offsetX,
    width:  contentW,
    height: contentH,
    pxPerM: contentW / meta.value.widthM,    // CSS-px per viewBox-meter
    hudScale,
  }
}

const BUILTIN = {
  vardasen: { navn: 'Vardåsen · turkart', file: 'vardasen.svg' },
}

// Lag-kategorier som matcher mapBuilder.js sin categoryFor()
const LAYERS = [
  { key: 'skog',       label: 'Skog' },
  { key: 'aapen',      label: 'Åpen mark' },
  { key: 'aker',       label: 'Åker' },
  { key: 'myr',        label: 'Myr' },
  { key: 'vann',       label: 'Vann' },
  { key: 'bekk',       label: 'Bekk / dybdekurver' },
  { key: 'land',       label: 'Land-overlay (øyer)' },
  { key: 'kontur',     label: 'Høydekurver' },
  { key: 'bygning',    label: 'Bygninger' },
  { key: 'vei-stor',   label: 'Storveg' },
  { key: 'vei-liten',  label: 'Småveg' },
  { key: 'tog',        label: 'Jernbane' },
  { key: 'sti',        label: 'Sti' },
  { key: 'sykkel',     label: 'Sykkel-sti' },
  { key: 'lysloype',   label: 'Lysløype' },
  { key: 'heistrase',  label: 'Heistrasé' },
  { key: 'slalombakke', label: 'Slalombakke' },
  { key: 'stein',      label: 'Stein / skjær' },
  { key: 'trig',       label: 'Trigpunkter' },
  { key: 'stupkant',   label: 'Stupkant' },
  { key: 'linje',      label: 'Gjerde / kraft' },
  { key: 'sjokart',    label: 'Lanterner / fyr' },
  { key: 'staker',     label: 'Sjømerker / staker' },
  { key: 'dybde',      label: 'Dybdetall' },
  { key: 'navn',       label: 'Navn' },
  { key: 'stedsnavn',  label: 'Stedsnavn' },
]

// v8.1.0: Stedsnavn-overlay er AV som default — det er et stort tekst-
// overlegg over kartet som brukeren slår på når de trenger områdenavn
// med stor skrift (matcher tradisjonell turkart-stil).
// v8.2.0: lysloype skjules som default (lite relevant for de fleste
// turkart-bbox), og stedsnavn vises som default (større områdenavn er
// nyttig kontekst).
const DEFAULT_OFF_LAYERS = new Set(['lysloype'])
const visibleLayers = ref(new Set(LAYERS.filter(l => !DEFAULT_OFF_LAYERS.has(l.key)).map(l => l.key)))
// Tema: 'light' (default ISOM), 'dark', 'mono-sepia', 'mono-indigo', 'mono-slate'.
// isDark er derivert for steder som styrer UI-farger (toppbar, drawer-bg).
const currentTheme = ref('light')
const isDark = computed(() => currentTheme.value !== 'light')
const THEMES = computed(() => Object.entries(isomCatalog.themes ?? {}).map(([k, v]) => ({ key: k, label: v.label ?? k })))
const diagnose = ref(false)
const showControls = ref(false)

const drawer = useDraggableDrawer({ expandedHeight: 0.45, minimizedPeek: 32 })

function openDrawer() { showControls.value = true; drawer.reset() }
function closeDrawer() { showControls.value = false }

function onThemeTap(key) {
  currentTheme.value = key
}

// v7.3.1: ekstra state for built-in maps som mangler stored DEM
const cbDemFetching = ref(false)
const cbDemError = ref(null)

async function ensureDemForCurveBall() {
  if (storedDem.value || !meta.value) return !!storedDem.value
  // Lazy-fetch DEM for built-in maps (Vardåsen) som mangler IndexedDB-DEM
  cbDemFetching.value = true
  cbDemError.value = null
  try {
    const m = meta.value
    const utmBbox = { minE: m.minE, maxE: m.maxE, minN: m.minN, maxN: m.maxN }
    const dem = await fetchDEM(m.bbox, utmBbox, { resolutionM: 10, useReal: true })
    if (dem && !dem.source?.startsWith('synthetic')) {
      storedDem.value = dem
      storedHighestPoint.value = findHighestPoint(dem)
    }
  } catch (e) {
    cbDemError.value = e?.message ?? 'Kunne ikke hente høydedata'
  }
  cbDemFetching.value = false
  return !!storedDem.value
}

async function startCurveBall() {
  if (!meta.value || cbDemFetching.value) return
  const ok = await ensureDemForCurveBall()
  if (!ok) return
  // v8.7.1: rydd annoteringsmodus så indikator-tooltipet ikke henger
  // inne i spillet (og så et map-tap ikke kan plassere en annotering
  // bak game-overlayet).
  annot.selectedSymbol.value = null
  annot.isAnnotateMode.value = false
  // v7.4.2: CurveBall skal ALLTID kjøres med Curves-tema aktivt — også i
  // turneringsmodus, share-link-flow og direkte fra CurveBall-knappen.
  // Bryterhåndtering bevares (currentTheme er en ref, watch kjører applyTheme).
  currentTheme.value = 'curves'
  curveball.init({
    dem: storedDem.value,
    bounds: { width: meta.value.widthM, height: meta.value.heightM },
    equidistanceM: meta.value.equidistance ?? 20,
    // v8.7.0: kart-annoteringer blir custom bumpers i tillegg til random pr level.
    // Geocache-bumper trigger Invaders-modus direkte ved multiball-trigger.
    annotations: annot.annotations.value,
  })
  curveball.restart()
  // Reset pinch/zoom så hele kartet er synlig (paddles trenger map-edges på skjermen)
  reset()
  curveball.activate()
  closeDrawer()
}

function stopCurveBall() {
  curveball.deactivate()
}

// v8.5.2: «Sentrer»-FAB resetter pinch/zoom OG tvinger en fersk GPS-fix
// hvis GPS er aktivert. P&aring; toget kan watchPosition henge p&aring; en cached
// koordinat — getCurrentPosition med maximumAge=0 gir alltid ny m&aring;ling.
function onResetAndRefreshGps() {
  reset()
  if (userPos.isWatching) userPos.refresh()
}

function onCurveBallRestart() {
  // v7.4.0: full restart fra game over → glem turneringens visited-list
  // så neste runde kan re-besøke samme kart. v8.0.0: tøm også legacy-key
  // for sikkerhet under rebrand-overgangen.
  try { sessionStorage.removeItem(TOURNAMENT_KEY) } catch { /* noop */ }
  clearTournamentLegacy()
  curveball.restart()
}

// Tap på kart eller HUD-overlay → start nedtelling. Auto-drop ved 0.
function onCurveBallContinue() {
  curveball.startCountdown()
}

function toggleLayer(key) {
  const next = new Set(visibleLayers.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  visibleLayers.value = next
  applyLayerVisibility()
}

function applyLayerVisibility() {
  const root = svgHostRef.value?.querySelector('svg')
  if (!root) return
  for (const lay of LAYERS) {
    const groups = root.querySelectorAll(`[data-layer="${lay.key}"]`)
    for (const g of groups) {
      g.style.display = visibleLayers.value.has(lay.key) ? '' : 'none'
    }
  }
  // Hvis 'navn' er av, skjul også vann-/kontur-/peak-tall (data-label) som
  // ligger inni andre lag-grupper. Da blir Navn-toggle en konsistent
  // "all text on/off"-bryter — men labels inne i 'stedsnavn'-laget styres
  // separat (se under).
  const showLabels = visibleLayers.value.has('navn')
  const labelEls = root.querySelectorAll('[data-label]:not([data-label="stedsnavn"])')
  for (const el of labelEls) {
    el.style.display = showLabels ? '' : 'none'
  }
}

// Pinch/pan/rotate fryses i CurveBall-modus (kart skal stå i ro under spill).
const pinchEnabled = computed(() => !curveball.active.value)
const { scale, translateX, translateY, rotation, reset, zoomIn, zoomOut, animating } = usePinchZoom(wrapperRef, { enabled: pinchEnabled })

// Pong-paddles: følg kart-SVG-ens skjerm-rekt ved pinch/pan/rotate så de
// alltid sitter rett ved kartets kanter. nextTick venter til CSS transform
// faktisk er applied i DOM før vi måler.
watch([scale, translateX, translateY, rotation], () => {
  if (curveball.active.value) nextTick(updateMapRect)
})

watch(() => curveball.active.value, (active) => {
  if (active) {
    nextTick(updateMapRect)
    // Reset() animerer scale/translate over 200ms — re-mål når transitionen er ferdig.
    setTimeout(updateMapRect, 250)
  } else {
    mapRect.value = null
  }
})

// Translate + scale i ytre lag (origin 0 0 så pinch-zoom rundt finger
// fungerer som før). Rotasjon i indre lag (origin center center) så
// brukeren kan rotere kartet med to fingre uten at scale-matematikken
// komplisseres.
const transformStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
  transition: animating.value ? 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
}))
const rotateStyle = computed(() => ({
  transform: `rotate(${rotation.value}deg)`,
  transformOrigin: 'center center',
  transition: animating.value ? 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
}))

const userPos = useUserPosition(() => meta.value)
const compass = useCompass()

// Annoteringsmodus — point-symboler over auto-generert kart
const mapId = computed(() => route.params.id ?? 'vardasen')
const annot = useMapAnnotations(mapId.value)
const showSymbolPalette = ref(false)
let lastSvgString = ''      // huskes til print-eksport

watch(() => annot.annotations.value, () => renderAnnotations(), { deep: true })

// Lilla ring rundt symbolene er en hint for at man er i annoteringsmodus
// — re-render når modusen toggles slik at ringen forsvinner ut av modus.
// Per-type visibility (Annoteringer-laget) trigger også re-render.
watch(() => annot.isAnnotateMode.value, () => renderAnnotations())
watch(() => annot.visibleTypes.value, () => renderAnnotations())

// Re-render symboler (annoteringer + bruker-pos dot) når pinch-zoom endrer
// seg, slik at de holder konstant skjerm-størrelse uansett zoom-nivå.
watch(scale, () => { renderAnnotations(); updateUserDot() })

/**
 * Konverter CSS-piksler til SVG user-units, basert på SVG-elementets
 * faktiske on-screen rect (inkludert eventuelle parent CSS-transforms).
 *
 * Kart-SVG har viewBox i meter (1 user-unit = 1 m). På et 5×5 km kart
 * vist i 380 CSS px container blir 1 m ≈ 0.076 CSS px → en r=6 m sirkel
 * blir ~0.5 CSS px = usynlig. Ved å konvertere ønsket skjerm-størrelse
 * dynamisk får vi symboler som alltid er lesbare uansett zoom.
 *
 * Bruker getBoundingClientRect() som inkluderer pinch-zoom CSS-transform
 * fra ancestor wrapper-divv, så samme verdi gir samme skjerm-størrelse
 * uansett om brukeren har zoomet inn eller ut.
 */
function pxToUserUnits(cssPx) {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return cssPx
  const rect = svg.getBoundingClientRect()
  const vb = svg.viewBox.baseVal
  if (!rect.width || !vb.width) return cssPx
  return cssPx * (vb.width / rect.width)
}

// Klikk på kart i annoteringsmodus → plasser symbol
function onMapClick(e) {
  if (!annot.isAnnotateMode.value || !annot.selectedSymbol.value) return
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return
  const local = pt.matrixTransform(ctm.inverse())
  const sym = ANNOTATION_SYMBOLS.find(s => s.symbolKey === annot.selectedSymbol.value)
  if (!sym) return
  annot.addPoint(sym.code, local.x, local.y)
  annot.persist()
}

function renderAnnotations() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const ns = 'http://www.w3.org/2000/svg'
  const xlink = 'http://www.w3.org/1999/xlink'
  let layer = svg.querySelector('#annotation-layer')
  if (!layer) {
    layer = document.createElementNS(ns, 'g')
    layer.setAttribute('id', 'annotation-layer')
    layer.setAttribute('data-layer', 'annotering')
    layer.setAttribute('pointer-events', 'none')
    svg.appendChild(layer)
  }
  layer.replaceChildren()

  // Symbol-størrelse: ~32 CSS px på skjerm uansett zoom-nivå. ISOM-print-
  // størrelse (1.5–2 mm = 6–7.5 px) er usynlig på telefon ved standard
  // kart-zoom (5 km bbox i ~380 px container → 1 m ≈ 0.076 CSS px).
  // pxToUserUnits konverterer ønsket skjerm-px til user-units (meter)
  // basert på faktisk getBoundingClientRect — inkluderer pinch-zoom CSS-
  // transform så symbolet holder konstant skjerm-størrelse.
  const SYMBOL_M = pxToUserUnits(32)
  const HALF = SYMBOL_M / 2

  for (const a of annot.annotations.value) {
    if (a.type !== 'point') continue
    const sym = ANNOTATION_SYMBOLS.find(s => s.code === a.isomCode)
    if (!sym) continue
    // Per-type synlighet (drawer-laget «Annoteringer»). Når brukeren skjuler
    // f.eks. alle «Knaus» beholdes annotasjonen i lagring men ikke rendres.
    if (!annot.visibleTypes.value.has(sym.symbolKey)) continue

    const g = document.createElementNS(ns, 'g')
    g.setAttribute('transform', `translate(${a.x},${a.y})`)
    g.setAttribute('data-annot-id', a.id)
    g.setAttribute('data-annot-type', sym.symbolKey)

    // Lys ring (lilla) bak symbolet er et editor-hint som vises kun mens
    // brukeren er i annoteringsmodus. Når modusen lukkes (deselect i
    // drawer) forsvinner ringen og symbolet rendres «rent» som på print.
    if (annot.isAnnotateMode.value) {
      const halo = document.createElementNS(ns, 'circle')
      halo.setAttribute('cx', '0')
      halo.setAttribute('cy', '0')
      halo.setAttribute('r', String(HALF * 0.95))
      halo.setAttribute('fill', '#fffef0')
      halo.setAttribute('fill-opacity', '0.9')
      halo.setAttribute('stroke', '#7a3aa3')
      halo.setAttribute('stroke-width', '2')
      halo.setAttribute('vector-effect', 'non-scaling-stroke')
      g.appendChild(halo)
    }

    if (sym.symbolKey === 'geocache') {
      // Geocache er bonus-annotering med SMIL-animasjon — pulsende gul
      // glow, roterende stjerne-rays og blinkende rød X i sentrum.
      // Tegnes inline istedenfor <use> så vi kan legge til <animate>/
      // <animateTransform>.
      appendGeocacheSymbol(g, HALF)
    } else {
      const use = document.createElementNS(ns, 'use')
      const href = `#iso-sym-${sym.symbolKey}`
      use.setAttribute('href', href)
      use.setAttributeNS(xlink, 'xlink:href', href)
      use.setAttribute('x', String(-HALF))
      use.setAttribute('y', String(-HALF))
      use.setAttribute('width', String(SYMBOL_M))
      use.setAttribute('height', String(SYMBOL_M))
      g.appendChild(use)
    }

    layer.appendChild(g)
  }
}

/**
 * Bygg det animerte Geocache-symbolet inn i en eksisterende g-node.
 * - s   = halv symbol-bredde (user-units, ~16 CSS-px på skjerm)
 * - parent g er allerede translate-positionert til annotasjonens (x,y)
 *
 * Tre lag med SMIL-animasjoner som kjører kontinuerlig i nettleseren:
 *   1) Gul glow-circle med pulserende r + opacity (news-flash-feel)
 *   2) 8 stjerne-rays som roterer rundt sentrum (sparkle)
 *   3) Rød X som blinker på/av («X marks the spot»)
 *
 * Animasjonene er rene SVG (SMIL `<animate>`) — ingen JS-timer, ingen
 * requestAnimationFrame. Browseren håndterer alt på compositor-tråden,
 * så det går ikke utover map-rendering eller pinch-zoom-ytelse.
 */
function appendGeocacheSymbol(parent, s) {
  const ns = 'http://www.w3.org/2000/svg'
  const mk = (tag, attrs) => {
    const el = document.createElementNS(ns, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    return el
  }

  // 1) Pulsende gul glow
  const glow = mk('circle', {
    cx: '0', cy: '0', r: String(s * 0.75),
    fill: '#fbbf24', opacity: '0.55',
  })
  glow.appendChild(mk('animate', {
    attributeName: 'r',
    values: `${s * 0.6};${s * 0.95};${s * 0.6}`,
    dur: '0.7s', repeatCount: 'indefinite',
  }))
  glow.appendChild(mk('animate', {
    attributeName: 'opacity',
    values: '0.35;0.8;0.35',
    dur: '0.7s', repeatCount: 'indefinite',
  }))
  parent.appendChild(glow)

  // 2) Roterende stjerne-rays (8 stk, peker utover fra liten indre radius
  // så de ikke overskriver X-en i midten)
  const rays = mk('g', {
    stroke: '#b45309',
    'stroke-width': String(Math.max(1, s * 0.13)),
    'stroke-linecap': 'round',
  })
  const N = 8
  const innerR = s * 0.32
  const outerR = s * 0.98
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2
    const cos = Math.cos(a), sin = Math.sin(a)
    rays.appendChild(mk('line', {
      x1: String(cos * innerR), y1: String(sin * innerR),
      x2: String(cos * outerR), y2: String(sin * outerR),
    }))
  }
  rays.appendChild(mk('animateTransform', {
    attributeName: 'transform', type: 'rotate',
    from: '0', to: '360',
    dur: '6s', repeatCount: 'indefinite',
  }))
  parent.appendChild(rays)

  // 3) Blinkende rød X
  const xMark = mk('g', {
    stroke: '#dc2626',
    'stroke-width': String(Math.max(1.5, s * 0.2)),
    'stroke-linecap': 'round',
  })
  const xR = s * 0.38
  xMark.appendChild(mk('line', { x1: String(-xR), y1: String(-xR), x2: String(xR), y2: String(xR) }))
  xMark.appendChild(mk('line', { x1: String(-xR), y1: String(xR), x2: String(xR), y2: String(-xR) }))
  xMark.appendChild(mk('animate', {
    attributeName: 'opacity',
    values: '1;0.25;1',
    dur: '0.55s', repeatCount: 'indefinite',
  }))
  parent.appendChild(xMark)
}

function selectSymbol(key) {
  annot.selectedSymbol.value = annot.selectedSymbol.value === key ? null : key
  annot.isAnnotateMode.value = annot.selectedSymbol.value !== null
}

// Slå opp symbolKey + label for en lagret annotering. Faller tilbake til
// råverdien fra entry hvis isomCode ikke matcher noen kjent type (skulle
// ikke skje, men beskytter mot kart-data som er lagret med en eldre
// ANNOTATION_SYMBOLS-liste).
function labelForAnnotation(a) {
  const sym = ANNOTATION_SYMBOLS.find(s => s.code === a.isomCode)
  return {
    symbolKey: sym?.symbolKey ?? '',
    label: sym?.label ?? `Kode ${a.isomCode}`,
  }
}

// Print- / eksport-handlers
function onExportSvg() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  exportSvgFile(svg.outerHTML, `${mapTitle.value.replace(/[^a-z0-9æøå]+/gi, '-').toLowerCase()}.svg`)
}
async function onExportPng() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  await exportPngFile(svg.outerHTML, `${mapTitle.value.replace(/[^a-z0-9æøå]+/gi, '-').toLowerCase()}.png`, { dpi: 300 })
}
async function onExportPdf() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  await exportPdfFile(svg.outerHTML, `${mapTitle.value.replace(/[^a-z0-9æøå]+/gi, '-').toLowerCase()}.pdf`, { dpi: 300 })
}
function onPrint() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  printDocument(svg.outerHTML, { title: mapTitle.value })
}

async function loadMap() {
  loading.value = true
  loadError.value = null
  try {
    const id = route.params.id ?? 'vardasen'
    let text
    if (BUILTIN[id]) {
      mapTitle.value = BUILTIN[id].navn
      const url = `${import.meta.env.BASE_URL}maps/${BUILTIN[id].file}`
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      text = await res.text()
    } else {
      const stored = await loadStoredMap(id)
      if (!stored) throw new Error('Kart ikke funnet i lagring')
      mapTitle.value = stored.navn
      text = stored.svg
      // v7.2.0: hent DEM hvis lagret (forberedt for CurveBall)
      if (stored.dem) {
        try { storedDem.value = unpackDem(stored.dem) } catch { storedDem.value = null }
      }
      storedHighestPoint.value = stored.highestPoint ?? null
    }
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, 'image/svg+xml')
    const root = doc.documentElement
    if (root.nodeName === 'parsererror' || root.querySelector('parsererror')) {
      throw new Error('Ugyldig SVG')
    }
    const metaRaw = root.getAttribute('data-meta')
    if (!metaRaw) throw new Error('Mangler data-meta i SVG')
    const m = JSON.parse(metaRaw)
    meta.value = {
      minE: m.utmBbox.minE,
      minN: m.utmBbox.minN,
      maxE: m.utmBbox.maxE,
      maxN: m.utmBbox.maxN,
      widthM: m.widthM,
      heightM: m.heightM,
      bbox: m.bbox,
      equidistance: m.equidistance ?? null,
      isomVersion: m.isomVersion ?? null,
      scaleDenom: m.scaleDenom ?? 10000,
      source: m.source,
      demSource: m.demSource ?? null,
      contoursSkipped: m.contoursSkipped ?? null,
      // v7.1.2: kritisk for SEA-mode bg-fix. applyTheme() leser
      // meta.value.mapType for å re-applysere --bg=#9ec9de etter
      // theme-reset. Manglende mapType i denne mappingen var hvorfor
      // v7.1.1 ikke virket — vi sjekket alltid mot undefined.
      mapType: m.mapType ?? null,
      useSeaBg: !!m.useSeaBg,
      sjokartCounts: m.sjokartCounts ?? null,
      sjokartFetchErrors: Array.isArray(m.sjokartFetchErrors) ? m.sjokartFetchErrors : [],
      sjokartDebugSamples: Array.isArray(m.sjokartDebugSamples) ? m.sjokartDebugSamples : [],
      coastlineLandRings: m.coastlineLandRings ?? null,
      coastlineWaysCount: m.coastlineWaysCount,
    }
    setupHostSvg(root)
    loading.value = false
    await nextTick()
    applyLayerVisibility()
    applyTheme()
    userPos.recompute()
    await annot.load()
    renderAnnotations()
  } catch (e) {
    loading.value = false
    loadError.value = e.message ?? 'Kunne ikke laste kart'
  }
}

function setupHostSvg(sourceRoot) {
  const ns = 'http://www.w3.org/2000/svg'
  const host = svgHostRef.value
  host.replaceChildren()
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', sourceRoot.getAttribute('viewBox'))
  svg.setAttribute('xmlns', ns)
  svg.setAttribute('class', 'isom-map')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  for (const child of Array.from(sourceRoot.childNodes)) {
    svg.appendChild(child.cloneNode(true))
  }
  const userLayer = document.createElementNS(ns, 'g')
  userLayer.setAttribute('id', 'user-layer')
  // v8.5.2: GPS-laget skal aldri sluke pinch-to-zoom-gester n&aring;r brukerens
  // finger lander p&aring; prikken/ringen.
  userLayer.setAttribute('pointer-events', 'none')
  svg.appendChild(userLayer)
  host.appendChild(svg)
}

watch(
  () => [userPos.svgX, userPos.svgY, userPos.accuracyM, userPos.headingDeg],
  () => updateUserDot()
)

function updateUserDot() {
  const svg = svgHostRef.value?.querySelector('svg')
  const layer = svg?.querySelector('#user-layer')
  if (!layer) return
  const x = userPos.svgX
  const y = userPos.svgY
  const acc = userPos.accuracyM ?? 30
  const heading = userPos.headingDeg
  layer.replaceChildren()
  if (x == null || y == null) return
  const ns = 'http://www.w3.org/2000/svg'

  // Dynamiske skjerm-størrelser. Dot er fast 14 CSS-px, kjegle 60 CSS-px
  // ut fra dot. Accuracy-ringen reflekterer ekte fysisk usikkerhet (i meter)
  // men cappes p&aring; ~28 CSS-px radius slik at d&aring;rlig GPS (urban / tog / tunnel)
  // ikke spr&aring;ker ringen utover halve skjermen og d&oslash;mmer kart-innholdet.
  // v8.5.3: stroke-bredder via pxToUserUnits — non-scaling-stroke virker
  // ikke n&aring;r SVG-en CSS-transformeres av pinch-zoom-wrapperen, s&aring; stroke
  // ble fete p&aring; h&oslash;y zoom og det bl&aring; fyllet forsvant under den hvite kant-
  // linjen. N&aring; skaleres bredden eksplisitt p&aring; samme m&aring;te som radius.
  const dotR = pxToUserUnits(7)         // ~14 CSS-px diameter
  const dotStroke = pxToUserUnits(1.6)  // tynn hvit halo
  const coneR = pxToUserUnits(30)       // ~60 CSS-px ut fra dot
  const minRingR = pxToUserUnits(12)    // ringen blir aldri mindre enn dot+halo
  const maxRingR = pxToUserUnits(28)    // visuelt cap
  const ringR = Math.min(maxRingR, Math.max(minRingR, acc))
  const ringStroke = pxToUserUnits(0.8)

  const ring = document.createElementNS(ns, 'circle')
  ring.setAttribute('cx', x)
  ring.setAttribute('cy', y)
  ring.setAttribute('r', ringR)
  ring.setAttribute('fill', 'rgba(56, 189, 248, 0.10)')
  ring.setAttribute('stroke', 'rgba(56, 189, 248, 0.40)')
  ring.setAttribute('stroke-width', ringStroke)
  layer.appendChild(ring)

  if (Number.isFinite(heading)) {
    const cone = document.createElementNS(ns, 'path')
    const ang = (heading - 90) * Math.PI / 180
    const ang1 = ang - 0.35
    const ang2 = ang + 0.35
    const x1 = x + Math.cos(ang1) * coneR
    const y1 = y + Math.sin(ang1) * coneR
    const x2 = x + Math.cos(ang2) * coneR
    const y2 = y + Math.sin(ang2) * coneR
    cone.setAttribute('d', `M${x},${y} L${x1},${y1} A${coneR},${coneR} 0 0 1 ${x2},${y2} Z`)
    cone.setAttribute('fill', 'rgba(56, 189, 248, 0.35)')
    layer.appendChild(cone)
  }

  const dot = document.createElementNS(ns, 'circle')
  dot.setAttribute('cx', x)
  dot.setAttribute('cy', y)
  dot.setAttribute('r', dotR)
  dot.setAttribute('fill', '#0ea5e9')
  dot.setAttribute('stroke', '#fff')
  dot.setAttribute('stroke-width', dotStroke)
  layer.appendChild(dot)
}

const equidistanceLabel = computed(() => {
  if (!meta.value) return ''
  const eq = meta.value.equidistance
  if (eq) return `Høydekurver pr ${eq} m`
  if (meta.value.contoursSkipped) return 'Høydekurver: kun på innebygde kart'
  return 'Høydekurver ikke tilgjengelig'
})

// v7.1.5: oppsummer Sjøkart-WFS-feil til kort tekst for attribusjons-
// boksen. Hvis fetcher fanget exceptions, vis dominerende feiltype så
// brukeren ser at det er WFS-side, ikke app-side.
// v7.1.10: viser kort hvis ALLE sjøkart-counts er 0, så vi kan vise
// første response-sample for debugging.
const sjokartZeroFeatures = computed(() => {
  const c = meta.value?.sjokartCounts
  if (!c) return false
  return (c.dybdeareal ?? 0) + (c.dybdekontur ?? 0) + (c.lanterne ?? 0)
       + (c.grunne ?? 0) + (c.dybdepunkt ?? 0) === 0
})

const sjokartFirstSample = computed(() => {
  const samples = meta.value?.sjokartDebugSamples
  if (!Array.isArray(samples) || samples.length === 0) return null
  const s = samples[0]
  return `${s.typeName} (${s.length}b): ${s.sample.slice(0, 120)}…`
})

const sjokartFetchErrorSummary = computed(() => {
  const errs = meta.value?.sjokartFetchErrors
  if (!Array.isArray(errs) || errs.length === 0) return null
  // v7.1.17: hvis vi faktisk har features fra Sjøkart, skjul WFS-
  // advarselen. Én feil av mange typenames (typisk lanterne som
  // ikke er i wfs.dybdedata) skal ikke skremme brukeren når andre
  // typenames leverer fint.
  if (!sjokartZeroFeatures.value) return null
  // Tell pr type, vis mest vanlige
  const counts = {}
  for (const e of errs) counts[e.kind] = (counts[e.kind] ?? 0) + 1
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const labels = {
    'network-or-cors': 'CORS/nettfeil',
    'http-error': 'HTTP-feil',
    'not-json': 'GML/XML-svar',
    'zero-features': 'tom respons',
    'aborted': 'avbrutt',
    'endpoint-deprecated': 'utdatert endepunkt',
    'unknown': 'ukjent feil',
  }
  return sorted.slice(0, 2).map(([k, n]) => `${labels[k] ?? k} (${n})`).join(', ')
})

const wrapperSize = ref({ w: 0, h: 0 })
function measureWrapper() {
  const r = wrapperRef.value?.getBoundingClientRect()
  if (r) wrapperSize.value = { w: r.width, h: r.height }
}

const SCALE_BAR_MAX_PX = 180
const scaleBar = computed(() => {
  if (!meta.value) return { px: 0, label: '', ticks: [] }
  const { w, h } = wrapperSize.value
  if (!w || !h) return { px: 0, label: '', ticks: [] }
  const fit = Math.min(w / meta.value.widthM, h / meta.value.heightM)
  const pxPerMeter = fit * scale.value
  const candidates = [1000, 500, 200, 100, 50, 20]
  for (const m of candidates) {
    const px = m * pxPerMeter
    if (px <= SCALE_BAR_MAX_PX && px >= 30) {
      // Lag tikker pr 1/4 av lengden
      const tickStep = m / 4
      const ticks = []
      for (let i = 0; i <= 4; i++) {
        ticks.push({ px: i * px / 4, m: i * tickStep })
      }
      return { px, label: m >= 1000 ? `${m / 1000} km` : `${m} m`, ticks }
    }
  }
  return { px: 0, label: '', ticks: [] }
})

// Tema-applisering: setter CSS-variabler pr ISOM-kode + label på SVG-roten.
// Først ryddes ALLE tema-vars (så bytte mellom mono-paletter ikke etterlater
// rester), så settes vars for valgt tema.
function applyTheme() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const themes = isomCatalog.themes ?? {}
  const allCodes = new Set()
  const allLabels = new Set()
  for (const t of Object.values(themes)) {
    for (const c of Object.keys(t.categories ?? {})) allCodes.add(c)
    for (const l of Object.keys(t.labels ?? {})) allLabels.add(l)
  }
  svg.style.removeProperty('--bg')
  svg.style.removeProperty('--art-fill-opacity')
  // v7.1.15: bg respekterer mapType strengt. Tidligere v7.1.3-logikk
  // (useSeaBg basert på coastline-rekonstruksjon) ga uventet blå bg på
  // kyst-Land-kart der bare en fjordarm passerer. Nå: mapType='sea' →
  // blå, ellers kremgul (catalog-fallback).
  if (meta.value?.mapType === 'sea') {
    svg.style.setProperty('--bg', '#9ec9de')
  }
  for (const code of allCodes) {
    svg.style.removeProperty(`--iso-${code}-fill`)
    svg.style.removeProperty(`--iso-${code}-stroke`)
    svg.style.removeProperty(`--iso-${code}-overlay-stroke`)
  }
  for (const name of allLabels) {
    svg.style.removeProperty(`--label-${name}-fill`)
    svg.style.removeProperty(`--label-${name}-halo`)
  }
  const t = themes[currentTheme.value]
  if (!t) return
  // Fyll-opacity (subtilt mørke + art-modes) — settes selv for light=1 så
  // tidligere art-mode-rest ikke henger igjen.
  if (typeof t.fillOpacity === 'number' && t.fillOpacity < 1) {
    svg.style.setProperty('--art-fill-opacity', String(t.fillOpacity))
  }
  if (currentTheme.value === 'light') return
  if (t.background) svg.style.setProperty('--bg', t.background)
  for (const [code, def] of Object.entries(t.categories ?? {})) {
    if (def.fill?.color) svg.style.setProperty(`--iso-${code}-fill`, def.fill.color)
    if (def.stroke?.color) svg.style.setProperty(`--iso-${code}-stroke`, def.stroke.color)
    if (def.overlayStroke?.color) svg.style.setProperty(`--iso-${code}-overlay-stroke`, def.overlayStroke.color)
  }
  for (const [name, def] of Object.entries(t.labels ?? {})) {
    if (def.color) svg.style.setProperty(`--label-${name}-fill`, def.color)
    if (def.haloColor) svg.style.setProperty(`--label-${name}-halo`, def.haloColor)
  }
}

// Auto-hide / restore layers ved tema-bytte:
//   - Inn til art-mode (autoHideLayers=true) → bare høydekurver vises
//   - Ut fra art-mode → alle lag restaureres
//   - Mellom andre temaer → ingen endring (brukerens manuelle valg beholdes)
// applyLayerVisibility kalles ubetinget på slutten så DOM er garantert
// i sync med state — fjerner mulighet for stuck display=none fra forrige
// art-mode.
function onThemeChange(newTheme, oldTheme) {
  applyTheme()
  const newT = isomCatalog.themes?.[newTheme]
  const oldT = isomCatalog.themes?.[oldTheme]
  if (newT?.autoHideLayers) {
    visibleLayers.value = new Set(['kontur'])
  } else if (oldT?.autoHideLayers) {
    visibleLayers.value = new Set(LAYERS.filter(l => !DEFAULT_OFF_LAYERS.has(l.key)).map(l => l.key))
  }
  applyLayerVisibility()
}

watch(currentTheme, onThemeChange)

// Diagnose-modus: fargelegg polygoner etter data-src så vi visuelt kan
// se om wedger kommer fra N50, OSM-way, OSM-relation, eller polygon-
// clipping merge. Kjør, ta screenshot, del med Claude.
function applyDiagnoseMode() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  let style = svg.querySelector('style[data-diagnose]')
  if (diagnose.value) {
    if (!style) {
      style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
      style.setAttribute('data-diagnose', '1')
      svg.appendChild(style)
    }
    style.textContent = `
      .isom-map [data-src="n50"]      { fill: hsl(180, 80%, 55%) !important; opacity: 0.85 !important; }
      .isom-map [data-src="way"]      { fill: hsl(220, 80%, 60%) !important; opacity: 0.85 !important; }
      .isom-map [data-src="relation"] { fill: hsl(300, 80%, 60%) !important; opacity: 0.85 !important; }
      .isom-map [data-src="merged"]   { fill: hsl(45, 90%, 55%) !important; opacity: 0.85 !important; }
      .isom-map [data-src="sjokart"]  { fill: hsl(160, 70%, 50%) !important; opacity: 0.85 !important; }
      .isom-map [data-src="kystlinje"] { fill: hsl(20, 80%, 55%) !important; opacity: 0.85 !important; }
    `
  } else if (style) {
    style.remove()
  }
}
watch(diagnose, applyDiagnoseMode)

// v7.1.0: nullstill globalt karttype-valg slik at picker spør på nytt
// neste gang. Påvirker ikke gjeldende kart (det er allerede generert med
// sin valgte type), kun fremtidige genereringer.
function clearMapTypePreference() {
  try { localStorage.removeItem('svg-insights:mapType') } catch { /* ignore */ }
}

/**
 * v7.4.1: Auto-start curveball hvis brukeren akkurat bygde dette kartet
 * fra en delingslenke. Skipper Curves-tema-easter-eggen helt — share-flowen
 * er ekvivalent med at CurveBall-knappen ble trykket.
 */
function consumeShareAutostart() {
  try {
    // v8.0.0: les både ny og legacy share-autostart-key. Begge ryddes
    // etter konsumering så vi ikke ender med to konkurrerende verdier.
    const flagId = sessionStorage.getItem('curveball-autostart-mapId')
                ?? sessionStorage.getItem('flippkart-autostart-mapId')
    if (!flagId || flagId !== route.params.id) return false
    sessionStorage.removeItem('curveball-autostart-mapId')
    sessionStorage.removeItem('flippkart-autostart-mapId')
    return true
  } catch { return false }
}

async function maybeAutostartFromShare() {
  if (!consumeShareAutostart()) return
  if (!meta.value) {
    const stop = watch(meta, async (m) => {
      if (m) { stop(); await startCurveBall() }
    })
  } else {
    await startCurveBall()
  }
}

async function maybeRestoreTournament() {
  // Sjekk om vi mountet på dette kartet pga «Neste kart»-snarvei. Hvis ja,
  // init+aktivér curveball med restorert state. Krever at kartet og DEM
  // er ferdig lastet, så vi venter på loadMap().
  const state = consumeTournamentRestore()
  if (!state) return
  await loadUserMapsForTournament()
  // Vent til meta er klar — loadMap settes ferdig før onMounted-callback returnerer
  // hvis kartet ligger i IndexedDB. Hvis ikke, watch på meta nedenfor håndterer det.
  if (!meta.value) {
    const stop = watch(meta, async (m) => {
      if (m) { stop(); await activateRestoredCurveBall(state) }
    })
  } else {
    await activateRestoredCurveBall(state)
  }
}

async function activateRestoredCurveBall(state) {
  if (!meta.value) return
  const ok = await ensureDemForCurveBall()
  if (!ok) return
  // v7.4.2: Curves-tema aktivt for hele turneringsmoduset, ikke bare ved
  // første start. Sikrer konsistent visuell stil mellom kart-bytter.
  currentTheme.value = 'curves'
  curveball.init({
    dem: storedDem.value,
    bounds: { width: meta.value.widthM, height: meta.value.heightM },
    equidistanceM: meta.value.equidistance ?? 20,
    // v8.7.0: kart-annoteringer blir custom bumpers i tillegg til random pr level.
    // Geocache-bumper trigger Invaders-modus direkte ved multiball-trigger.
    annotations: annot.annotations.value,
  })
  curveball.restoreFromTournament(state)
  reset()
  curveball.activate()
  closeDrawer()
}

// v8.5.5: tikker hvert sekund mens GPS er på, så debug-readout (alder
// på siste fix) oppdaterer seg jevnt uten å bero på nye GPS-events.
const gpsNow = ref(Date.now())
let gpsTickTimer = null
function startGpsTick() {
  if (gpsTickTimer) return
  gpsTickTimer = setInterval(() => { gpsNow.value = Date.now() }, 1000)
}
function stopGpsTick() {
  if (gpsTickTimer) { clearInterval(gpsTickTimer); gpsTickTimer = null }
}
watch(() => userPos.isWatching, (on) => on ? startGpsTick() : stopGpsTick())

const gpsDebugLine = computed(() => {
  if (!userPos.isWatching) return ''
  if (userPos.latRaw == null || userPos.lonRaw == null) return 'Venter på fix …'
  const lat = userPos.latRaw.toFixed(6)
  const lon = userPos.lonRaw.toFixed(6)
  const acc = userPos.accuracyM != null ? `±${Math.round(userPos.accuracyM)} m` : '±? m'
  const ageS = Math.max(0, Math.round((gpsNow.value - userPos.lastFixAt) / 1000))
  const src = userPos.lastFixSource === 'poll' ? 'P' : 'W'
  const rej = userPos.rejectedCount ? ` · ${userPos.rejectedCount} avvist` : ''
  return `${lat}, ${lon} · ${acc} · ${ageS}s · ${src}${rej}`
})

// v8.5.6: kopier raw lat/lng som Google Maps-URL. Universelt format —
// blir tappable lenke i meldinger og åpner Maps-appen direkte.
const copyState = ref('idle') // 'idle' | 'copied' | 'failed'
async function copyGpsCoords() {
  if (userPos.latRaw == null || userPos.lonRaw == null) return
  const lat = userPos.latRaw.toFixed(6)
  const lon = userPos.lonRaw.toFixed(6)
  const url = `https://www.google.com/maps?q=${lat},${lon}`
  try {
    await navigator.clipboard.writeText(url)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
  setTimeout(() => { copyState.value = 'idle' }, 1500)
}

// v8.5.6: førstegangs-tips om «Presis posisjon» (Android 12+). Vi gikk i
// fella selv — `enableHighAccuracy: true` gir 2000 m fallback hvis appen
// kun har «Omtrentlig» lokasjon. Vis i drawer første gang GPS aktiveres,
// dismissible. localStorage husker dismissal på tvers av sesjoner.
const GPS_TIP_KEY = 'svg-insights-gps-tip-seen'
const gpsTipDismissed = ref(false)
try { gpsTipDismissed.value = localStorage.getItem(GPS_TIP_KEY) === '1' } catch {}
const showGpsTip = computed(() => userPos.isWatching && !gpsTipDismissed.value)
function dismissGpsTip() {
  gpsTipDismissed.value = true
  try { localStorage.setItem(GPS_TIP_KEY, '1') } catch {}
}

// v8.5.6: in-map advarsels-banner når accuracy er dårlig (>100m).
// Synlig over kartet uten at brukeren må åpne drawer. Dismissable
// per sesjon — resettes når GPS toggles off→on.
const LOW_ACCURACY_THRESHOLD_M = 100
const lowAccuracyDismissed = ref(false)
const showLowAccuracyBanner = computed(() =>
  userPos.isWatching &&
  userPos.accuracyM != null &&
  userPos.accuracyM > LOW_ACCURACY_THRESHOLD_M &&
  !lowAccuracyDismissed.value &&
  !userPos.error &&
  !userPos.isOutsideMap
)
function dismissLowAccuracy() { lowAccuracyDismissed.value = true }
watch(() => userPos.isWatching, (on) => { if (on) lowAccuracyDismissed.value = false })

onMounted(() => {
  measureWrapper()
  window.addEventListener('resize', measureWrapper)
  window.addEventListener('resize', updateMapRect)
  window.addEventListener('orientationchange', updateMapRect)
  loadMap()
  loadUserMapsForTournament()
  maybeRestoreTournament()
  maybeAutostartFromShare()
})

onUnmounted(stopGpsTick)
</script>

<template>
  <div class="relative w-full h-[100dvh] overflow-hidden"
       :class="isDark ? 'bg-zinc-900' : 'bg-stone-100'">

    <!-- Toppbar. v8.7.1: skjult i Curve Invaders-modus — den lå tidligere
         halvveis bak game-HUD-en, og hamburger-knappen i høyre hjørne var
         delvis klikkbar med uønskede effekter (drawer åpnet seg midt i
         spillet). Skjuler hele toppbaren, matcher kompass-rosen og andre
         map-only UI som allerede har samme v-if. -->
    <div v-if="!curveball.active.value"
         class="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-3
                pointer-events-none">
      <button @click="router.push('/kart')"
              class="pointer-events-auto rounded-full w-10 h-10 flex items-center justify-center
                     bg-zinc-950 text-white shadow-lg active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>

      <div class="pointer-events-none px-3 py-1.5 rounded-full bg-zinc-950
                  text-[12px] text-white font-medium shadow-lg max-w-[60%] truncate">
        {{ mapTitle }}
      </div>

      <button @click="openDrawer"
              class="pointer-events-auto rounded-full w-10 h-10 flex items-center justify-center
                     bg-zinc-950 text-white shadow-lg active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="6" x2="20" y2="6"/>
          <line x1="4" y1="12" x2="20" y2="12"/>
          <line x1="4" y1="18" x2="20" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Kompass-rose (skjult i CurveBall-modus) -->
    <div v-if="!curveball.active.value"
         class="absolute top-20 right-3 z-20 pointer-events-auto select-none">
      <button @click="compass.isActive ? compass.stop() : compass.start()"
              class="w-14 h-14 rounded-full bg-zinc-950
                     flex items-center justify-center text-white shadow-lg active:scale-95 transition">
        <svg viewBox="-50 -50 100 100" class="w-12 h-12"
             :style="{ transform: compass.isActive && compass.headingDeg !== null
                                  ? `rotate(${-compass.headingDeg}deg)`
                                  : 'none',
                       transition: 'transform 0.2s linear' }">
          <circle r="44" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
          <polygon points="0,-38 6,0 0,8 -6,0" fill="#ef4444"/>
          <polygon points="0,38 6,0 0,-8 -6,0" fill="currentColor" opacity="0.85"/>
          <text y="-28" text-anchor="middle" font-size="14" font-weight="700"
                fill="currentColor">N</text>
        </svg>
      </button>
      <div v-if="compass.error"
           class="text-[10px] text-red-300 mt-1 max-w-[80px] text-right leading-tight
                  px-1.5 py-0.5 rounded bg-zinc-950">
        {{ compass.error }}
      </div>
    </div>

    <!-- FAB-stack: zoom inn / zoom ut / sentrer. Synlig både når drawer er
         åpen og lukket. Når drawer er åpen flyttes FAB-en opp over drawer-
         toppen så den ikke dekker innstillinger. z-40 sikrer at FAB-en
         ligger over drawer (z-30). Skjult i CurveBall-modus. -->
    <div v-if="!curveball.active.value"
         class="absolute right-3 z-40 flex flex-col gap-2 pointer-events-auto select-none transition-[bottom] duration-200"
         :style="{
           bottom: showControls
             ? 'calc(45dvh + 0.75rem)'
             : 'calc(env(safe-area-inset-bottom, 0px) + 5rem)'
         }">
      <button @click="zoomIn()" aria-label="Zoom inn"
              class="w-12 h-12 rounded-full bg-zinc-950 text-white shadow-lg
                     flex items-center justify-center active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
      <button @click="zoomOut()" aria-label="Zoom ut"
              class="w-12 h-12 rounded-full bg-zinc-950 text-white shadow-lg
                     flex items-center justify-center active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
      <button @click="onResetAndRefreshGps" :aria-label="userPos.isWatching ? 'Sentrer + oppdater GPS' : 'Sentrer'"
              class="w-12 h-12 rounded-full bg-zinc-950 text-white shadow-lg
                     flex items-center justify-center active:scale-95 transition relative">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <line x1="12" y1="2" x2="12" y2="5"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
          <line x1="2" y1="12" x2="5" y2="12"/>
          <line x1="19" y1="12" x2="22" y2="12"/>
        </svg>
        <!-- v8.5.2: liten GPS-indikator-prikk i hjørnet n&aring;r GPS er aktiv,
             s&aring; brukeren ser at knappen ogs&aring; refresher posisjonen. -->
        <span v-if="userPos.isWatching"
              class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_4px_rgba(56,189,248,0.8)]" />
      </button>
    </div>

    <!-- Kart-flate. Ytre lag = translate+scale, indre lag = rotate.
         Indre lag separert så pinch-zoom og rotasjon kan brukes uavhengig
         uten å komplisere transform-matematikken. -->
    <div ref="wrapperRef" class="absolute inset-0 touch-none select-none"
         :class="annot.isAnnotateMode.value ? 'cursor-crosshair' : ''">
      <div class="w-full h-full" :style="transformStyle">
        <div class="w-full h-full relative" :style="rotateStyle">
          <div ref="svgHostRef" class="w-full h-full" @click="onMapClick"></div>
          <CurveBallLayer
            :flipp="curveball"
            :view-box="cbViewBox"
            @drop="onCurveBallContinue"/>
        </div>
      </div>
    </div>

    <!-- Annoteringsmodus indikator. v8.7.1: skjules eksplisitt mens
         Curve Invaders kjører — ellers ble den hengende inne i spill-
         viewet og så ut som en stor «utilsiktet bumper» midt på kartet. -->
    <div v-if="annot.isAnnotateMode.value && annot.selectedSymbol.value && !curveball.active.value"
         class="absolute top-[16rem] right-3 z-20 px-2.5 py-1.5 rounded-md bg-slate-600
                text-white text-[11px] font-medium shadow-lg pointer-events-none">
      Trykk på kartet for å plassere
      <div class="text-[9px] text-white/80 mt-0.5">
        {{ ANNOTATION_SYMBOLS.find(s => s.symbolKey === annot.selectedSymbol.value)?.label }}
      </div>
    </div>

    <!-- Lasting / feil -->
    <div v-if="loading"
         class="absolute inset-0 flex flex-col items-center justify-center text-white/60 z-10">
      <div class="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin mb-3"/>
      <div class="text-sm">Laster kart …</div>
    </div>

    <div v-else-if="loadError"
         class="absolute inset-0 flex flex-col items-center justify-center z-10 px-6 text-center"
         :class="isDark ? 'text-white/80' : 'text-zinc-700'">
      <div class="text-lg font-semibold mb-2">Kunne ikke laste kartet</div>
      <div class="text-sm opacity-70 mb-4">{{ loadError }}</div>
      <button @click="loadMap"
              class="mt-2 px-4 py-2 rounded-lg border text-sm active:scale-95"
              :class="isDark
                      ? 'bg-white/10 border-white/20 text-white'
                      : 'bg-white border-zinc-300 text-zinc-800'">
        Prøv igjen
      </button>
    </div>

    <!-- Posisjons-status -->
    <div v-if="!loading && userPos.error"
         class="absolute bottom-32 left-3 right-3 z-20 px-3 py-2 rounded-lg backdrop-blur
                bg-amber-600/95 border border-slate-300/40 text-white text-[12px] shadow-lg">
      {{ userPos.error }}
    </div>
    <div v-else-if="!loading && userPos.isOutsideMap"
         class="absolute bottom-32 left-3 right-3 z-20 px-3 py-2 rounded-lg backdrop-blur
                bg-amber-600/95 border border-slate-300/40 text-white text-[12px] shadow-lg">
      Du er utenfor dette kartet.
    </div>

    <!-- v8.5.6: advarsel ved lav GPS-nøyaktighet — peker bruker mot
         «Presis posisjon»-innstillingen, som er den vanligste rotårsaken. -->
    <div v-else-if="!loading && showLowAccuracyBanner"
         class="absolute bottom-32 left-3 right-3 z-20 px-3 py-2.5 rounded-lg backdrop-blur
                bg-amber-600/95 border border-amber-300/40 text-white text-[12px] shadow-lg
                flex items-start gap-2">
      <div class="flex-1 leading-snug">
        <div class="font-semibold mb-0.5">
          Unøyaktig posisjon (&plusmn;{{ Math.round(userPos.accuracyM) }} m)
        </div>
        <div class="text-white/90">
          Sjekk at appen har «Presis posisjon» (Android: Innstillinger →
          Apper → din nettleser → Tillatelser → Posisjon).
        </div>
      </div>
      <button @click="dismissLowAccuracy" aria-label="Skjul advarsel"
              class="w-6 h-6 -mt-0.5 -mr-1 flex items-center justify-center rounded-md
                     text-white/85 active:scale-90 hover:bg-white/10 shrink-0">
        <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
             stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Skala + ekvidistanse + ISOM-info (skjult i CurveBall-modus) -->
    <div v-if="!loading && !curveball.active.value"
         class="absolute bottom-3 left-3 z-20 pointer-events-none">
      <div class="px-3 py-2 rounded-lg bg-zinc-950 text-white text-[11px]
                  font-medium space-y-1.5 shadow-lg">
        <div v-if="scaleBar.px > 0">
          <div class="flex items-end gap-2">
            <svg :width="scaleBar.px" height="14" class="overflow-visible">
              <line x1="0" y1="6" :x2="scaleBar.px" y2="6" stroke="white" stroke-width="2"/>
              <g v-for="(t, i) in scaleBar.ticks" :key="i">
                <line :x1="t.px" y1="2" :x2="t.px" y2="10" stroke="white"
                      :stroke-width="i === 0 || i === scaleBar.ticks.length - 1 ? 2 : 1"/>
              </g>
            </svg>
            <div>{{ scaleBar.label }}</div>
          </div>
          <div v-if="meta?.scaleDenom" class="text-[9px] text-white/55 mt-0.5">
            print 1:{{ meta.scaleDenom.toLocaleString('no-NO') }}
          </div>
        </div>
        <div class="text-white/70">{{ equidistanceLabel }}</div>
      </div>
    </div>

    <!-- Attribusjon (skjult i CurveBall-modus) -->
    <div v-if="!loading && !curveball.active.value"
         class="absolute bottom-3 right-3 z-20 px-2 py-1 rounded-md bg-zinc-950
                text-white/85 text-[9px] leading-tight pointer-events-none shadow-lg max-w-[180px]">
      © OpenStreetMap-bidragsytere<br>
      <span class="text-white/50">{{ meta?.isomVersion ? `ISOM ${meta.isomVersion}` : '' }}</span><br>
      <span class="text-white/50">DEM: {{ meta?.demSource ?? '—' }}</span>
      <template v-if="meta?.mapType">
        <br><span class="text-white/65">{{ meta.mapType === 'sea' ? '🌊 Sjøkart' : '🥾 Land-kart' }}</span>
        <button @click="clearMapTypePreference"
                class="ml-1 text-[8px] text-sky-400/70 underline pointer-events-auto"
                :title="'Nullstiller globalt karttype-valg. Du blir spurt på nytt neste gang.'">
          Nullstill
        </button>
        <template v-if="meta.mapType === 'sea' && meta.sjokartCounts">
          <br><span class="text-sky-300/70">Sjøkart: omr={{ meta.sjokartCounts.dybdeareal }} kontur={{ meta.sjokartCounts.dybdekontur }} skj={{ meta.sjokartCounts.grunne }} dyb={{ meta.sjokartCounts.dybdepunkt }} lan={{ meta.sjokartCounts.lanterne }}</span>
          <template v-if="(meta.sjokartCounts.slipp ?? 0) + (meta.sjokartCounts.havnestruktur ?? 0) + (meta.sjokartCounts.fareomraade ?? 0) > 0">
            <br><span class="text-sky-300/70">Padle: slipp={{ meta.sjokartCounts.slipp ?? 0 }} hav={{ meta.sjokartCounts.havnestruktur ?? 0 }} fare={{ meta.sjokartCounts.fareomraade ?? 0 }}</span>
          </template>
        </template>
        <template v-if="meta.mapType === 'sea' && sjokartFetchErrorSummary">
          <br><span class="text-amber-300/85">⚠ Sjøkart-WFS feilet: {{ sjokartFetchErrorSummary }}</span>
        </template>
        <template v-if="meta.mapType === 'sea' && sjokartZeroFeatures && sjokartFirstSample">
          <br><span class="text-amber-200/70 break-all">Sample: {{ sjokartFirstSample }}</span>
        </template>
      </template>
      <template v-else-if="meta?.coastlineWaysCount !== undefined">
        <br><span class="text-sky-300/85">Kyst: ways={{ meta.coastlineWaysCount }} ringer={{ meta?.coastlineLandRings ?? 0 }}</span>
      </template>
    </div>

    <!-- Kontrollpanel (drawer) -->
    <Transition name="drawer">
      <div v-if="showControls"
           class="absolute inset-x-0 bottom-0 z-30 backdrop-blur-md bg-zinc-900/92
                  border-t border-white/10 rounded-t-2xl flex flex-col shadow-2xl"
           :style="drawer.drawerHeightStyle.value">
        <div class="shrink-0 select-none touch-none cursor-grab active:cursor-grabbing"
             @pointerdown="drawer.onPointerDown"
             @pointermove="drawer.onPointerMove"
             @pointerup="drawer.onPointerUp"
             @pointercancel="drawer.onPointerUp">
          <div class="pt-2 pb-1 flex justify-center">
            <div class="w-10 h-1 rounded-full bg-white/40"
                 :style="{ opacity: drawer.handleOpacity.value }"></div>
          </div>
          <div class="px-4 pb-2 flex items-center justify-between">
            <div class="text-white text-sm font-semibold">Innstillinger</div>
            <button @pointerdown.stop @click.stop="closeDrawer"
                    class="w-8 h-8 -mr-1 rounded-full flex items-center justify-center
                           text-white/70 active:bg-white/10">
              <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto px-4 pb-6">
          <div class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Lag</div>
          <div class="grid grid-cols-2 gap-2 mb-4">
            <button v-for="lay in LAYERS" :key="lay.key"
                    @click="toggleLayer(lay.key)"
                    class="px-3 py-2 rounded-lg border text-left active:scale-[0.98] transition"
                    :class="visibleLayers.has(lay.key)
                            ? 'bg-slate-400/25 border-slate-300/50 text-white'
                            : 'bg-white/5 border-white/10 text-white/45'">
              <span class="text-[12px]">{{ lay.label }}</span>
            </button>
          </div>

          <div class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Tema</div>
          <div class="grid grid-cols-3 gap-2 mb-4">
            <button v-for="t in THEMES" :key="t.key"
                    @click="onThemeTap(t.key)"
                    class="px-3 py-2 rounded-lg border text-[11px] active:scale-[0.98] transition text-center"
                    :class="currentTheme === t.key
                            ? 'bg-slate-400/25 border-slate-300/50 text-white font-medium'
                            : 'bg-white/5 border-white/10 text-white/65'">
              {{ t.label }}
            </button>
          </div>

          <!-- Curve Invaders-knapp alltid synlig (uavhengig av tema-valg) -->
          <button @click="startCurveBall"
                  :disabled="cbDemFetching"
                  class="w-full mb-4 px-3 py-2.5 rounded-lg bg-gradient-to-r from-fuchsia-500/20 to-cyan-500/20
                         border border-fuchsia-400/40 text-white text-[12px]
                         active:scale-[0.98] flex items-center justify-center gap-2
                         disabled:opacity-60">
            <span v-if="cbDemFetching">⏳ {{ t('mapview.gameLoading') }}</span>
            <span v-else>{{ t('mapview.gameButton', { emoji: t('game.emoji'), gameName: t('game.name') }) }}</span>
          </button>
          <div v-if="cbDemError"
               class="w-full mb-4 px-3 py-2 rounded-lg bg-red-900/30 border border-red-500/40
                      text-red-200 text-[11px] text-center">
            {{ cbDemError }}
          </div>

          <button @click="router.push('/tegnforklaring')"
                  class="w-full mb-4 px-3 py-2 rounded-lg bg-white/5 border border-white/10
                         text-white/75 text-[12px] active:scale-[0.98] flex items-center
                         justify-between">
            <span>Tegnforklaring</span>
            <span class="text-white/40">→</span>
          </button>

          <div class="flex gap-2 mb-4">
            <button @click="diagnose = !diagnose"
                    class="flex-1 px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98]"
                    :class="diagnose
                            ? 'bg-slate-400/20 border-slate-300/50 text-white'
                            : 'bg-white/5 border-white/10 text-white/75'">
              {{ diagnose ? 'Diagnose: AV' : 'Diagnose-modus' }}
            </button>
          </div>
          <div v-if="diagnose" class="text-[10px] text-white/55 leading-relaxed -mt-2 mb-4 px-1">
            Polygon-fargen viser kilden:
            <span class="inline-block w-3 h-3 rounded-sm align-middle" style="background: hsl(180, 80%, 55%);"></span> N50,
            <span class="inline-block w-3 h-3 rounded-sm align-middle" style="background: hsl(220, 80%, 60%);"></span> OSM way,
            <span class="inline-block w-3 h-3 rounded-sm align-middle" style="background: hsl(300, 80%, 60%);"></span> OSM relation,
            <span class="inline-block w-3 h-3 rounded-sm align-middle" style="background: hsl(45, 90%, 55%);"></span> merged.
            Ta skjermbilde og del.
          </div>

          <div v-if="!mapId.startsWith('vardasen')"
               class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Annotering</div>
          <div v-if="!mapId.startsWith('vardasen')" class="space-y-2 mb-4">
            <div class="grid grid-cols-2 gap-2">
              <button v-for="s in ANNOTATION_SYMBOLS" :key="s.code"
                      @click="selectSymbol(s.symbolKey)"
                      class="px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98] transition flex items-center gap-2"
                      :class="annot.selectedSymbol.value === s.symbolKey
                              ? 'bg-slate-400/30 border-slate-200/60 text-white'
                              : 'bg-white/5 border-white/10 text-white/70'">
                <AnnotationIcon :symbol-key="s.symbolKey"/>
                {{ s.label }}
              </button>
            </div>
            <div class="flex gap-2 text-[11px] text-white/55">
              <span>{{ annot.annotations.value.length }} symbol(er)</span>
              <button v-if="annot.annotations.value.length"
                      @click="annot.clearAll(); annot.persist()"
                      class="ml-auto text-red-300 active:text-red-100">Slett alle</button>
            </div>
          </div>

          <!-- Plasserte annoteringer som egne lag (toggleable, med teller).
               Brukeren kan skjule alle «Knaus» uten å slette dem. Bare typer
               som faktisk er plassert vises som lag-knapp. -->
          <div v-if="!mapId.startsWith('vardasen') && annot.annotations.value.length"
               class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Annoteringer (lag)</div>
          <div v-if="!mapId.startsWith('vardasen') && annot.annotations.value.length"
               class="grid grid-cols-2 gap-2 mb-4">
            <button v-for="s in ANNOTATION_SYMBOLS.filter(x => annot.countByType.value[x.symbolKey] > 0)"
                    :key="s.code"
                    @click="annot.toggleTypeVisibility(s.symbolKey)"
                    class="px-3 py-2 rounded-lg border text-left active:scale-[0.98] transition
                           flex items-center gap-2"
                    :class="annot.visibleTypes.value.has(s.symbolKey)
                            ? 'bg-slate-400/25 border-slate-300/50 text-white'
                            : 'bg-white/5 border-white/10 text-white/45'">
              <AnnotationIcon :symbol-key="s.symbolKey"/>
              <span class="text-[12px]">{{ s.label }} ({{ annot.countByType.value[s.symbolKey] }})</span>
            </button>
          </div>

          <!-- Individuell annoterings-liste: se og slett enkeltvis. Maks-
               høyde med scroll så lange lister ikke spiser drawer-en. -->
          <div v-if="!mapId.startsWith('vardasen') && annot.annotations.value.length"
               class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Annoteringer (liste)</div>
          <div v-if="!mapId.startsWith('vardasen') && annot.annotations.value.length"
               class="space-y-1 mb-4 max-h-48 overflow-y-auto pr-1">
            <div v-for="a in annot.annotations.value" :key="a.id"
                 class="flex items-center gap-2 px-2.5 py-1.5 rounded-md
                        bg-white/5 border border-white/10 text-white/75">
              <AnnotationIcon :symbol-key="labelForAnnotation(a).symbolKey"/>
              <span class="text-[12px] flex-1 truncate">{{ labelForAnnotation(a).label }}</span>
              <span class="text-[10px] text-white/35 tabular-nums shrink-0">
                {{ Math.round(a.x) }},&nbsp;{{ Math.round(a.y) }}
              </span>
              <button @click="annot.remove(a.id); annot.persist()"
                      class="w-6 h-6 flex items-center justify-center rounded-md
                             text-white/55 active:scale-90 active:bg-rose-500/20
                             active:text-rose-200 shrink-0"
                      aria-label="Slett annotering">
                <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                     stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Eksport</div>
          <div class="grid grid-cols-2 gap-2 mb-2">
            <button @click="onExportSvg"
                    class="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/75
                           text-[11px] active:scale-[0.98]">
              Lagre .svg
            </button>
            <button @click="onExportPng"
                    class="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/75
                           text-[11px] active:scale-[0.98]">
              Lagre .png (300 dpi)
            </button>
            <button @click="onExportPdf"
                    class="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/75
                           text-[11px] active:scale-[0.98]">
              Lagre som PDF
            </button>
            <button @click="onPrint"
                    class="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/75
                           text-[11px] active:scale-[0.98]">
              Skriv ut
            </button>
          </div>

          <div class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Posisjon og kompass</div>
          <div class="flex gap-2 mb-2">
            <button @click="userPos.isWatching ? userPos.stop() : userPos.start()"
                    class="flex-1 px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98]"
                    :class="userPos.isWatching
                            ? 'bg-sky-500/20 border-sky-400/50 text-white'
                            : 'bg-white/5 border-white/10 text-white/75'">
              {{ userPos.isWatching ? 'Følger GPS' : 'Start GPS' }}
            </button>
            <button @click="compass.isActive ? compass.stop() : compass.start()"
                    class="flex-1 px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98]"
                    :class="compass.isActive
                            ? 'bg-sky-500/20 border-sky-400/50 text-white'
                            : 'bg-white/5 border-white/10 text-white/75'">
              {{ compass.isActive ? 'Kompass på' : 'Aktiver kompass' }}
            </button>
          </div>

          <!-- v8.5.6: GPS-debug-readout med kopier-knapp. Lar brukeren
               sammenligne raw lat/lng mot kartet, se accuracy + alder +
               kilde (W=watchPosition, P=poll), og kopiere posisjonen som
               Google Maps-URL. Vis kun når GPS er aktivt. -->
          <div v-if="userPos.isWatching"
               class="flex items-stretch gap-2 mb-2">
            <div class="flex-1 text-white/60 text-[10.5px] font-mono leading-snug
                        bg-white/5 border border-white/10 rounded-lg px-3 py-2 tabular-nums
                        flex items-center">
              {{ gpsDebugLine }}
            </div>
            <button @click="copyGpsCoords"
                    :disabled="userPos.latRaw == null"
                    :aria-label="copyState === 'copied' ? 'Kopiert' : 'Kopier posisjon som Google Maps-lenke'"
                    class="px-3 rounded-lg border text-[11px] active:scale-[0.98] transition disabled:opacity-40"
                    :class="copyState === 'copied'
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-100'
                            : copyState === 'failed'
                              ? 'bg-rose-500/20 border-rose-400/50 text-rose-100'
                              : 'bg-white/5 border-white/10 text-white/75'">
              {{ copyState === 'copied' ? 'Kopiert' : copyState === 'failed' ? 'Feil' : 'Kopier' }}
            </button>
          </div>

          <!-- v8.5.6: førstegangs-tips om Android «Presis posisjon». -->
          <div v-if="showGpsTip"
               class="relative text-[11px] leading-snug bg-amber-500/15 border border-amber-400/40
                      text-amber-50/95 rounded-lg px-3 py-2.5 mb-2 pr-8">
            <button @click="dismissGpsTip"
                    aria-label="Skjul tips"
                    class="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center
                           rounded-md text-amber-100/70 active:scale-90 hover:bg-white/10">
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                   stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
              </svg>
            </button>
            <div class="font-semibold text-amber-100 mb-0.5">Tips: Sjekk «Presis posisjon»</div>
            Hvis prikken ligger langt unna deg, har nettleseren sannsynligvis bare «Omtrentlig»
            posisjon (~2 km nøyaktighet). På Android 12+: Innstillinger → Apper → din nettleser →
            Tillatelser → Posisjon → velg <b>Presis</b>.
          </div>

          <div class="text-white/40 text-[10px] leading-relaxed mt-4">
            ISOM 2017-2 inspirert symbolisering med mm-baserte streker for print-kvalitet.
            Kartdata © OpenStreetMap-bidragsytere (ODbL). Reprojisert til UTM 32N
            (EPSG:25832-kompatibel) med 1 SVG-enhet = 1 m.
          </div>
        </div>
      </div>
    </Transition>

    <!-- CurveBall-HUD: 8-bit pixel-overlay (Pac-Man-stil), kun aktivt i spillmodus -->
    <CurveBallHUD :flipp="curveball"
                  :tournament-next="tournamentNextMap"
                  :share-info="cbShareInfo"
                  :map-rect="mapRect"
                  @restart="onCurveBallRestart"
                  @continue="onCurveBallContinue"
                  @exit="stopCurveBall"
                  @tournament-next="onTournamentNext"/>

    <!-- Pong-paddles på alle fire kart-kanter, draggable i screen-space -->
    <CurveBallFlippers :flipp="curveball" :map-rect="mapRect"/>
  </div>
</template>

<style scoped>
.drawer-enter-active, .drawer-leave-active { transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.drawer-enter-from, .drawer-leave-to       { transform: translateY(100%); }
</style>

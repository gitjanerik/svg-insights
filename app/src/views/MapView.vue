<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePinchZoom } from '../composables/usePinchZoom.js'
import { useUserPosition } from '../composables/useUserPosition.js'
import { useCompass } from '../composables/useCompass.js'
import { useDraggableDrawer } from '../composables/useDraggableDrawer.js'
import { useMapAnnotations, ANNOTATION_SYMBOLS } from '../composables/useMapAnnotations.js'
import { useTrackRecorder, TRACK_STYLES } from '../composables/useTrackRecorder.js'
import { trackLengthM, trackDurationMs, downloadGpx } from '../lib/gpxExport.js'
import AnnotationIcon from '../components/AnnotationIcon.vue'
import { loadMap as loadStoredMap, listMaps as listStoredMaps } from '../lib/mapStorage.js'
import { isomCatalog } from '../lib/symbolizer.js'
import { printDocument, exportSvgFile, exportPngFile, exportPdfFile } from '../lib/printExport.js'
import { unpackDem, findHighestPoint } from '../lib/demSampling.js'
import { computeHillshade, hillshadeToDataURL } from '../lib/hillshade.js'
import { sampleProfile, buildProfilePath } from '../lib/elevationProfile.js'
import { fetchDEM } from '../lib/demFetcher.js'
import { useCurveBall } from '../composables/useCurveBall.js'
import CurveBallLayer from '../components/CurveBallLayer.vue'
import CurveBallHUD from '../components/CurveBallHUD.vue'
import CurveBallFlippers from '../components/CurveBallFlippers.vue'
import { t } from '../lib/i18n.js'
import { APP_VERSION } from '../version.js'
import {
  STEDSMERKE_KEY_TIMES, STEDSMERKE_DUR, STEDSMERKE_SHADOW_OPACITY,
  PIN_SCALE_VALUES, SHADOW_SCALE_VALUES,
  pinTranslateValues, randomBegin, pinPath,
} from '../lib/stedsmerkeAnimation.js'

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

// Lag-kategorier som matcher mapBuilder.js sin categoryFor().
// 'hillshade' og 'spor' er klient-side syntetiske lag (ikke fra mapBuilder).
const LAYERS = [
  { key: 'hillshade',  label: 'Reliefskygge' },
  { key: 'skog',       label: 'Skog' },
  { key: 'aapen',      label: 'Åpen mark' },
  { key: 'aker',       label: 'Åker' },
  { key: 'myr',        label: 'Myr' },
  { key: 'vann',       label: 'Vann' },
  { key: 'bekk',       label: 'Bekk / dybdekurver' },
  { key: 'land',       label: 'Land-overlay (øyer)' },
  { key: 'kontur',     label: 'Høydekurver' },
  { key: 'bygning',    label: 'Bygninger (frittstående)' },
  { key: 'bymasse',    label: 'Tett bebyggelse' },
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
  { key: 'spor',       label: 'GPS-spor' },
]

// v8.1.0: Stedsnavn-overlay er AV som default — det er et stort tekst-
// overlegg over kartet som brukeren slår på når de trenger områdenavn
// med stor skrift (matcher tradisjonell turkart-stil).
// v8.2.0: lysloype skjules som default (lite relevant for de fleste
// turkart-bbox), og stedsnavn vises som default (større områdenavn er
// nyttig kontekst).
// v8.9.10: 'bymasse' (ISOM 522 tett bebyggelse) er AV som default — på
// turkart er hytter/frittstående bygg interessant, mens dominerende by-
// pattern bare forstyrrer. Brukeren kan slå det på for bymiljø-kart.
const DEFAULT_OFF_LAYERS = new Set(['lysloype', 'bymasse'])
const visibleLayers = ref(new Set(LAYERS.filter(l => !DEFAULT_OFF_LAYERS.has(l.key)).map(l => l.key)))
// Tema: 'light' (default ISOM), 'dark', 'mono-sepia', 'mono-indigo', 'mono-slate'.
// isDark er derivert for steder som styrer UI-farger (toppbar, drawer-bg).
const currentTheme = ref('light')
const isDark = computed(() => currentTheme.value !== 'light')
const THEMES = computed(() => Object.entries(isomCatalog.themes ?? {}).map(([k, v]) => ({ key: k, label: v.label ?? k })))
const diagnose = ref(false)
const showControls = ref(false)

// Drawer-faner (v8.9.6) — drawer-en hadde vokst seg ulesbar med 10+ vertikale
// seksjoner. Splittet i 7 faner: Lag / Tema / Annotering / Måling / Sporing /
// Eksport / Om. Annotering og Sporing skjules for built-in kart (Vardåsen).
// Aktiv fane huskes i localStorage så drawer åpner tilbake i samme kontekst.
const ACTIVE_TAB_KEY = 'svg-insights-mapview-active-tab'
const ALL_TABS = [
  { key: 'lag',         label: 'Lag' },
  { key: 'tema',        label: 'Tema' },
  { key: 'annotering',  label: 'Annotering', userOnly: true },
  { key: 'maaling',     label: 'Måling' },
  { key: 'sporing',     label: 'Sporing',    userOnly: true },
  { key: 'eksport',     label: 'Eksport' },
  { key: 'om',          label: 'Om' },
]
const activeTab = ref('lag')
try {
  const saved = localStorage.getItem(ACTIVE_TAB_KEY)
  if (saved && ALL_TABS.some(t => t.key === saved)) activeTab.value = saved
} catch { /* private mode / quota — ignore */ }
const visibleTabs = computed(() => {
  const isBuiltin = (route.params.id ?? 'vardasen').startsWith('vardasen')
  return ALL_TABS.filter(t => !t.userOnly || !isBuiltin)
})
watch(activeTab, (v) => {
  try { localStorage.setItem(ACTIVE_TAB_KEY, v) } catch { /* noop */ }
})
// Hvis fanen ble usynlig (f.eks. åpnet et Vardåsen-kart med Sporing aktiv),
// fall tilbake til Lag som er garantert alltid synlig.
watch(visibleTabs, (tabs) => {
  if (!tabs.some(t => t.key === activeTab.value)) activeTab.value = 'lag'
}, { immediate: true })

const drawer = useDraggableDrawer({ expandedHeight: 0.45, minimizedPeek: 32 })

function openDrawer() { showControls.value = true; drawer.reset() }
function closeDrawer() { showControls.value = false }

function onThemeTap(key) {
  currentTheme.value = key
}

// v7.3.1: ekstra state for built-in maps som mangler stored DEM
const cbDemFetching = ref(false)
const cbDemError = ref(null)

// v8.9.4: ensureDem brukes nå av flere features (CurveBall, hill-shading,
// høydeprofil) — derav den generelle navngivningen.
async function ensureDem() {
  if (storedDem.value || !meta.value) return !!storedDem.value
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
// Alias for å bevare eksisterende kall-sites (CurveBall + Tournament).
const ensureDemForCurveBall = ensureDem

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
    // Stedsmerke-bumper trigger Invaders-modus direkte ved multiball-trigger.
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
// hvis GPS er aktivert. På toget kan watchPosition henge på en cached
// koordinat — getCurrentPosition med maximumAge=0 gir alltid ny måling.
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

// Unified transform: translate ∘ rotate ∘ scale med transform-origin 0 0.
// Én enkelt transform-matrise lar oss rotere rundt vilkårlig pivot (finger-
// senter) ved å oppdatere translate samtidig — to nested transformer ville
// låst rotasjonen til element-senter (v8.9.2).
const mapTransformStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) `
           + `rotate(${rotation.value}deg) scale(${scale.value})`,
  transformOrigin: '0 0',
  transition: animating.value ? 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
}))

const userPos = useUserPosition(() => meta.value)
const compass = useCompass()

// Annoteringsmodus — point-symboler over auto-generert kart
const mapId = computed(() => route.params.id ?? 'vardasen')
const annot = useMapAnnotations(mapId.value)
const showSymbolPalette = ref(false)
let lastSvgString = ''      // huskes til print-eksport

// GPS-spor — opptak + rendering av rutene brukeren går (v8.9.2)
const tracker = useTrackRecorder(mapId.value, userPos)
// Tikker hvert sekund mens opptak pågår, så live-stats (distanse/varighet)
// i drawer-en oppdateres uten å bero på nye GPS-fix.
const tracksNow = ref(Date.now())
let tracksTickTimer = null
watch(() => tracker.isRecording.value, (on) => {
  if (on) {
    if (!tracksTickTimer) tracksTickTimer = setInterval(() => { tracksNow.value = Date.now() }, 1000)
  } else if (tracksTickTimer) {
    clearInterval(tracksTickTimer); tracksTickTimer = null
  }
})

const liveTrackStats = computed(() => {
  const t = tracker.activeTrack.value
  if (!t) return null
  void tracksNow.value      // forcer re-eval på hver tikk
  const meters = trackLengthM(t)
  const ms = t.points.length > 0 ? Date.now() - t.points[0].t : 0
  return { meters, ms, points: t.points.length }
})

function formatDistance(m) {
  if (!m) return '0 m'
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(2)} km`
}
function formatDuration(ms) {
  if (!ms || ms < 1000) return '0 s'
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}t ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// Reliefskygge (hill-shading, v8.9.4) — DEM regnes til grayscale-PNG og
// embeddes som SVG <image> i bunnen av lag-stacken. Cached så bytte AV/PÅ
// er øyeblikkelig, og en watch på visibleLayers + storedDem trigger
// re-apply når brukeren toggler eller når DEM er lazy-lastet inn.
let cachedHillshadeUrl = null   // memoize-key: storedDem-referansen
let cachedHillshadeDem = null

async function applyHillshade() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg || !meta.value) return
  const wantOn = visibleLayers.value.has('hillshade')
  let img = svg.querySelector('#hillshade-layer')
  if (!wantOn) {
    if (img) img.remove()
    return
  }
  // Lazy-last DEM hvis nødvendig — built-in Vardåsen fetcher fra Kartverket WCS
  await ensureDem()
  if (!storedDem.value) {
    if (img) img.remove()
    return
  }
  if (cachedHillshadeDem !== storedDem.value) {
    const shade = computeHillshade(storedDem.value)
    cachedHillshadeUrl = hillshadeToDataURL(shade)
    cachedHillshadeDem = storedDem.value
  }
  // Plasser-strategi: hillshade skal blende NED over kart-innholdet
  // (vegetasjon, vann, veier), men ligge UNDER user-/annotation-/track-/
  // measure-lagene som er klient-genererte overlays. Insert-before
  // første overlay-lag som finnes; ellers append.
  const insertBefore = svg.querySelector('#user-layer')
                    ?? svg.querySelector('#annotation-layer')
                    ?? svg.querySelector('#track-layer')
                    ?? svg.querySelector('#measure-layer')
  if (!img) {
    const ns = 'http://www.w3.org/2000/svg'
    img = document.createElementNS(ns, 'image')
    img.setAttribute('id', 'hillshade-layer')
    img.setAttribute('data-layer', 'hillshade')
    img.setAttribute('preserveAspectRatio', 'none')
    // Opacity 0.42 + multiply gir nok kontrast til at terrenget «vrir» seg
    // synlig uten at vegetasjons-mønstre og tekst dempes nevneverdig.
    img.setAttribute('opacity', '0.42')
    img.setAttribute('pointer-events', 'none')
    img.setAttribute('image-rendering', 'auto')
    img.style.mixBlendMode = 'multiply'
  }
  if (insertBefore) svg.insertBefore(img, insertBefore)
  else svg.appendChild(img)
  img.setAttribute('x', '0'); img.setAttribute('y', '0')
  img.setAttribute('width', String(meta.value.widthM))
  img.setAttribute('height', String(meta.value.heightM))
  img.setAttribute('href', cachedHillshadeUrl)
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', cachedHillshadeUrl)
}

watch([() => visibleLayers.value, storedDem], () => { applyHillshade() })

// Måleverktøy — distanse + areal (v8.9.4). Aktiveres via knapp i drawer.
// Tap-på-kart i denne modusen plasserer vertices. Lukket polygon viser
// både omkrets og areal (hektar / km²).
const measureMode = ref(false)
const measureVertices = ref([])
const measureClosed = ref(false)
function startMeasure() {
  measureMode.value = true
  measureVertices.value = []
  measureClosed.value = false
  // Sørg for at annoteringsmodus ikke konkurrerer om tap-eventet
  annot.selectedSymbol.value = null
  annot.isAnnotateMode.value = false
}
function stopMeasure() {
  measureMode.value = false
  measureVertices.value = []
  measureClosed.value = false
}
function clearMeasure() {
  measureVertices.value = []
  measureClosed.value = false
}
function closeMeasure() {
  if (measureVertices.value.length >= 3) measureClosed.value = true
}
function undoMeasureVertex() {
  if (measureClosed.value) { measureClosed.value = false; return }
  if (measureVertices.value.length === 0) return
  measureVertices.value = measureVertices.value.slice(0, -1)
}

// Distance og areal-stats utledes via computed slik at de re-evaluerer
// automatisk når vertices endres
const measureStats = computed(() => {
  const v = measureVertices.value
  if (v.length < 2) return { distM: 0, areaM2: 0 }
  let distM = 0
  for (let i = 1; i < v.length; i++) {
    distM += Math.hypot(v[i].x - v[i - 1].x, v[i].y - v[i - 1].y)
  }
  // Lukket polygon: shoelace + closing-edge i distance
  let areaM2 = 0
  if (measureClosed.value && v.length >= 3) {
    distM += Math.hypot(v[0].x - v[v.length - 1].x, v[0].y - v[v.length - 1].y)
    let sum = 0
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length]
      sum += a.x * b.y - b.x * a.y
    }
    areaM2 = Math.abs(sum) / 2
  }
  return { distM, areaM2 }
})

function formatArea(m2) {
  if (m2 < 10_000) return `${Math.round(m2)} m²`
  if (m2 < 1_000_000) return `${(m2 / 10_000).toFixed(2)} ha`
  return `${(m2 / 1_000_000).toFixed(2)} km²`
}

// Høydeprofil — sample stripe + gradient-fyll under (v8.9.4).
// expandedTrackId holder hvilket spor som er "zoomet" i drawer-en (=
// vises som stor profil under en modal-overlay).
const expandedTrackId = ref(null)

const profileCache = new Map()  // trackId+pointCount → profileObj
function profileFor(track) {
  if (!track?.points?.length || !storedDem.value) return null
  const key = `${track.id}-${track.points.length}`
  if (profileCache.has(key)) return profileCache.get(key)
  const prof = sampleProfile(track, storedDem.value)
  if (prof) profileCache.set(key, prof)
  return prof
}
// Når DEM endres (lazy-load), invalider caches
watch(storedDem, () => { profileCache.clear() })

watch(() => annot.annotations.value, () => renderAnnotations(), { deep: true })

// Lilla ring rundt symbolene er en hint for at man er i annoteringsmodus
// — re-render når modusen toggles slik at ringen forsvinner ut av modus.
// Per-type visibility (Annoteringer-laget) trigger også re-render.
watch(() => annot.isAnnotateMode.value, () => renderAnnotations())
watch(() => annot.visibleTypes.value, () => renderAnnotations())

// Re-render symboler (annoteringer + bruker-pos dot + spor) når pinch-zoom
// endrer seg, slik at de holder konstant skjerm-størrelse uansett zoom-nivå.
watch(scale, () => { renderAnnotations(); updateUserDot(); renderTracks() })

// Skjul annoteringer i spillmodus — bumpers representerer de samme
// posisjonene med konsistent halo+icon-styling, og uten dobbel-render
// unngår vi at map-annotering-animasjonen (5s loop) overlapper bumper-
// animasjonen (hit-triggered).
watch(() => curveball.active.value, () => { renderAnnotations(); renderTracks() })

// Tracks: re-render når spor endres, stil endres, eller synlighet toggles.
// Deep watch på tracks fordi vi pusher nye punkter inn i samme array under
// opptak (~hvert 5. m).
watch(() => tracker.tracks.value, () => renderTracks(), { deep: true })
watch(() => tracker.trackStyle.value, () => renderTracks())
watch(() => tracker.visibleTrackIds.value, () => renderTracks())

/**
 * Konverter CSS-piksler til SVG user-units. Brukes til å holde symboler
 * (annoterings-ikoner, GPS-prikk) på konstant skjerm-størrelse uansett zoom.
 *
 * v8.9.2: tidligere brukte vi svg.getBoundingClientRect() som inkluderer CSS-
 * transformer. Det ga en subtil bug: når man tappet «Nullstill zoom» midt
 * under en pinch-transition, returnerte rect-en mid-animasjons-verdier — vi
 * malte stedsmerker basert på rect ved scale=20 selv om scale-ref var 1,
 * og så ble pin-ene ekstremt små etter at animasjonen var ferdig.
 *
 * Nå bruker vi wrapperSize (fast container målt på mount/resize) + scale.value
 * (mål-skala fra pinch-state) som er garantert konsistent uansett om CSS-
 * transitionen er ferdig eller ikke.
 */
function pxToUserUnits(cssPx) {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return cssPx
  const vb = svg.viewBox.baseVal
  const { w, h } = wrapperSize.value
  if (!w || !h || !vb.width || !vb.height) return cssPx
  // SVG fits-with-meet til wrapperen: minste dim bestemmer pxPerUnit
  const fitPxPerUnit = Math.min(w / vb.width, h / vb.height)
  const pxPerUnit = fitPxPerUnit * (scale.value || 1)
  if (!pxPerUnit) return cssPx
  return cssPx / pxPerUnit
}

// Klikk på kart i annoteringsmodus → plasser symbol
function onMapClick(e) {
  // Måleverktøy har prioritet over annotering siden brukeren eksplisitt
  // har slått det på (annoteringsmodus blir tvunget av i startMeasure).
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return
  const local = pt.matrixTransform(ctm.inverse())
  if (measureMode.value) {
    if (measureClosed.value) return  // ingen flere vertices etter lukking
    measureVertices.value = [...measureVertices.value, { x: local.x, y: local.y }]
    return
  }
  if (!annot.isAnnotateMode.value || !annot.selectedSymbol.value) return
  const sym = ANNOTATION_SYMBOLS.find(s => s.symbolKey === annot.selectedSymbol.value)
  if (!sym) return
  annot.addPoint(sym.code, local.x, local.y)
  annot.persist()
}

function renderMeasure() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const ns = 'http://www.w3.org/2000/svg'
  let layer = svg.querySelector('#measure-layer')
  if (!layer) {
    layer = document.createElementNS(ns, 'g')
    layer.setAttribute('id', 'measure-layer')
    layer.setAttribute('data-layer', 'maaling')
    layer.setAttribute('pointer-events', 'none')
    svg.appendChild(layer)
  }
  layer.replaceChildren()
  const v = measureVertices.value
  if (!v.length || curveball.active.value) return

  // Stroke-widths: paths inne i [data-layer] arver vector-effect:
  // non-scaling-stroke fra global SVG-CSS (symbolizer.js linje 394). Det
  // betyr at stroke-width tolkes i CSS-px, ikke i user-units — så
  // pxToUserUnits ville gjort linjene ~10× for tykke (v8.9.5).
  // For å holde konstant skjerm-tykkelse under pinch-zoom: del på scale.
  const s = scale.value || 1
  const haloW = 6 / s
  const lineW = 2.5 / s
  // Vertices er circles, IKKE paths — de arver ikke non-scaling-stroke,
  // så radius må fortsatt konverteres via pxToUserUnits.
  const vertR = pxToUserUnits(4)

  // Areal-polygon (fill) hvis lukket
  if (measureClosed.value && v.length >= 3) {
    const ptsAttr = v.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const poly = document.createElementNS(ns, 'polygon')
    poly.setAttribute('points', ptsAttr)
    poly.setAttribute('fill', 'rgba(34, 197, 94, 0.22)')
    poly.setAttribute('stroke', 'none')
    layer.appendChild(poly)
  }

  // To-lags polyline: hvit halo + grønn linje
  if (v.length >= 2) {
    let d = `M${v[0].x.toFixed(1)},${v[0].y.toFixed(1)}`
    for (let i = 1; i < v.length; i++) d += ` L${v[i].x.toFixed(1)},${v[i].y.toFixed(1)}`
    if (measureClosed.value) d += ' Z'
    const halo = document.createElementNS(ns, 'path')
    halo.setAttribute('d', d); halo.setAttribute('fill', 'none')
    halo.setAttribute('stroke', 'rgba(255,255,255,0.9)')
    halo.setAttribute('stroke-width', String(haloW))
    halo.setAttribute('stroke-linecap', 'round')
    halo.setAttribute('stroke-linejoin', 'round')
    layer.appendChild(halo)
    const line = document.createElementNS(ns, 'path')
    line.setAttribute('d', d); line.setAttribute('fill', 'none')
    line.setAttribute('stroke', '#16a34a')
    line.setAttribute('stroke-width', String(lineW))
    line.setAttribute('stroke-linecap', 'round')
    line.setAttribute('stroke-linejoin', 'round')
    layer.appendChild(line)
  }

  // Vertices (circles — får ikke non-scaling-stroke fra CSS-regelen som
  // kun matcher `path`, så vi gir dem den eksplisitt for å unngå at
  // strok-bredden vokser ved zoom inn).
  for (let i = 0; i < v.length; i++) {
    const c = document.createElementNS(ns, 'circle')
    c.setAttribute('cx', v[i].x); c.setAttribute('cy', v[i].y)
    c.setAttribute('r', vertR)
    c.setAttribute('fill', '#16a34a')
    c.setAttribute('stroke', '#fff')
    c.setAttribute('stroke-width', String(1.5 / s))
    c.setAttribute('vector-effect', 'non-scaling-stroke')
    layer.appendChild(c)
  }
}

watch([measureVertices, measureClosed, scale], () => renderMeasure(), { deep: true })
watch(() => curveball.active.value, () => renderMeasure())

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

  // Spillmodus: ikke render annoteringer. Bumpers i CurveBallLayer viser
  // samme posisjoner med konsistent halo+icon-stil. Annoteringer kommer
  // tilbake automatisk når spillet avsluttes (curveball.active → false
  // trigger ny renderAnnotations via watch).
  if (curveball.active.value) return

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
    // Stedsmerke (rød dråpe-pin) og stedsnavn skal alltid vises «opp» på
    // skjermen selv om kartet er rotert. Counter-rotate g-en med samme
    // mengde som kartets rotasjon, rundt anker-punktet (som nå er (0,0)
    // etter translate). applyUprightLabels() oppdaterer transformen ved
    // hver rotasjons-endring uten å re-rendre noden (v8.9.3).
    if (sym.symbolKey === 'stedsmerke') {
      g.setAttribute('transform', `translate(${a.x},${a.y}) rotate(${-rotation.value})`)
    } else {
      g.setAttribute('transform', `translate(${a.x},${a.y})`)
    }
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

    if (sym.symbolKey === 'stedsmerke') {
      // I annoteringsmodus tegnes pin-en statisk (brukeren plasserer/
      // justerer — animasjon ville vært forstyrrende). Når kartet
      // gjenåpnes fra lagring rendres med squash & stretch hver 5s, med
      // tilfeldig pre-roll pr instans så ikke alle spretter i takt.
      // (Spillmodus skjules tidligere via early return ovenfor.)
      appendStedsmerkeSymbol(g, HALF, !annot.isAnnotateMode.value)
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
 * Bygg Stedsmerke-symbolet inn i en eksisterende g-node.
 * - s        = halv symbol-bredde (user-units, ~16 CSS-px på skjerm)
 * - animated = true → squash & stretch + random pre-roll. false → ren hvile-
 *              positur (brukes i annoteringsmodus mens brukeren plasserer)
 * - parent g er allerede translate-positionert til annotasjonens (x,y)
 *
 * Visuell design: klassisk rød dråpe-pin med hvit prikk og halvgjennom-
 * siktig skygge under. Pin-tip-en peker presist på annotasjonens (x, y) —
 * pin-en strekker seg oppover derfra. SMIL — ingen JS-timer.
 *
 * Animasjonen er nestet g-er: ytterste plasserer pin-tip-en, midtre
 * animerer translate Y (sprett), innerste animerer scale (squash &
 * stretch). `animateTransform type` må være translate eller scale —
 * `type="matrix"` finnes IKKE i SVG SMIL.
 */
function appendStedsmerkeSymbol(parent, s, animated) {
  const ns = 'http://www.w3.org/2000/svg'
  const mk = (tag, attrs) => {
    const el = document.createElementNS(ns, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    return el
  }

  // s = half-symbol-bredde. Pin head-radius på 0.55*s gir kompakt pin
  // som passer i symbol-boksen uten å dominere kartet.
  const r = s * 0.55
  const shadowRx = r
  const shadowRy = r * 0.22
  const shadowPy = r * 0.18  // Like under pin-tip-en (annotasjonspunktet).

  // Skygge: outer g plasserer + skalerer til ønsket størrelse.
  const shadowOuter = mk('g', {
    transform: `translate(0 ${shadowPy}) scale(${shadowRx} ${shadowRy})`,
  })
  const shadowEl = mk('ellipse', {
    cx: '0', cy: '0', rx: '1', ry: '1',
    fill: '#000', opacity: '0.55',
  })

  // Pin: outer g (rest-pos er allerede annotasjonspunkt, så ingen translate).
  const pinPosG = mk('g', {})
  const pinPathEl = mk('path', {
    d: pinPath(r),
    fill: '#dc2626', stroke: '#7f1d1d',
    'stroke-width': String(r * 0.08), 'stroke-linejoin': 'round',
  })
  const pinDotEl = mk('circle', {
    cx: '0', cy: String(-1.85 * r), r: String(r * 0.38),
    fill: '#fff',
  })

  if (!animated) {
    // Statisk: ingen sprett, ingen scale, ingen random offset.
    shadowOuter.appendChild(shadowEl)
    pinPosG.appendChild(pinPathEl)
    pinPosG.appendChild(pinDotEl)
    parent.appendChild(shadowOuter)
    parent.appendChild(pinPosG)
    return
  }

  // Animert: shadow får inner-g for scale, pin får mid-g for translate
  // og inner-g for scale. Felles random begin på alle 4 animatorer.
  const begin = randomBegin()

  const shadowAnim = mk('g', {})
  shadowAnim.appendChild(mk('animateTransform', {
    attributeName: 'transform', type: 'scale',
    values: SHADOW_SCALE_VALUES, keyTimes: STEDSMERKE_KEY_TIMES,
    dur: STEDSMERKE_DUR, repeatCount: 'indefinite', begin,
  }))
  shadowEl.appendChild(mk('animate', {
    attributeName: 'opacity',
    values: STEDSMERKE_SHADOW_OPACITY,
    keyTimes: STEDSMERKE_KEY_TIMES,
    dur: STEDSMERKE_DUR, repeatCount: 'indefinite', begin,
  }))
  shadowAnim.appendChild(shadowEl)
  shadowOuter.appendChild(shadowAnim)
  parent.appendChild(shadowOuter)

  const pinTranslateG = mk('g', {})
  pinTranslateG.appendChild(mk('animateTransform', {
    attributeName: 'transform', type: 'translate',
    values: pinTranslateValues(r), keyTimes: STEDSMERKE_KEY_TIMES,
    dur: STEDSMERKE_DUR, repeatCount: 'indefinite', begin,
  }))
  const pinScaleG = mk('g', {})
  pinScaleG.appendChild(mk('animateTransform', {
    attributeName: 'transform', type: 'scale',
    values: PIN_SCALE_VALUES, keyTimes: STEDSMERKE_KEY_TIMES,
    dur: STEDSMERKE_DUR, repeatCount: 'indefinite', begin,
  }))
  pinScaleG.appendChild(pinPathEl)
  pinScaleG.appendChild(pinDotEl)
  pinTranslateG.appendChild(pinScaleG)
  pinPosG.appendChild(pinTranslateG)
  parent.appendChild(pinPosG)
}

function selectSymbol(key) {
  annot.selectedSymbol.value = annot.selectedSymbol.value === key ? null : key
  annot.isAnnotateMode.value = annot.selectedSymbol.value !== null
}

/**
 * Hold ALL tekst i kart-SVG-en samt stedsmerke-piner stående «opp» på
 * skjermen mens resten av kartet roterer. Counter-rotation appliseres
 * rundt hver etikets eget ankerpunkt slik at de blir lesbare uansett
 * kart-vinkel.
 *
 * v8.9.3: kun stedsnavn + stedsmerke. v8.9.7: utvidet til alle <text>
 * (vann-navn, kontur-tall, dybde-tall, peak, peak-ele, lanterne-tall,
 * skjaer-navn, dybde-kontur-tall, slipp-navn …). Symboler (use/path)
 * roterer fortsatt med terrenget — kun tekst og pin holdes opp.
 *
 * Bruker text.x.baseVal[0].value som gir resolved numeric verdi i
 * user-units uansett om attributtet er "2mm" eller et tall — browseren
 * konverterer mm → user-units for oss. Faller tilbake til 0 hvis x/y
 * mangler (multi-coordinate texts og defaults).
 *
 * Kjøres som lett attributt-oppdatering ved hver rotasjons-endring —
 * ingen DOM-creation, så det er trygt å kalle hver touchmove-frame.
 */
function applyUprightLabels() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const rot = -rotation.value
  // Alle tekst-labels i kart-innholdet
  const texts = svg.querySelectorAll('text')
  for (const el of texts) {
    const xVal = el.x?.baseVal?.[0]?.value ?? 0
    const yVal = el.y?.baseVal?.[0]?.value ?? 0
    el.setAttribute('transform', `rotate(${rot} ${xVal} ${yVal})`)
  }
  // Stedsmerke-annoteringer (rød dråpe-pin). G-en har allerede
  // translate(x,y) — counter-rotate rundt (0,0) i lokalt rom holder
  // pin-tipp-en forankret mens hodet vippes opp.
  const pins = svg.querySelectorAll('[data-annot-type="stedsmerke"]')
  for (const el of pins) {
    // Bevarer eksisterende translate, bytter ut/setter rotate-segment
    const existing = el.getAttribute('transform') ?? ''
    const m = existing.match(/translate\([^)]+\)/)
    const trans = m ? m[0] : ''
    el.setAttribute('transform', `${trans} rotate(${rot})`)
  }
}

// Watch rotasjon — billig attributt-oppdatering, ingen full re-render.
watch(rotation, applyUprightLabels)

/**
 * Render alle synlige GPS-spor i et eget SVG-lag som ligger mellom kart-
 * innholdet og annotation/user-laget. Stilen styres av tracker.trackStyle
 * — 'line' (polyline med marsjerende prikker), 'footprints' eller
 * 'breadcrumbs'. Live-tracket (det som spilles inn nå) har ekstra
 * pulserende hode-markør så brukeren ser at opptaket lever.
 */
function renderTracks() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const ns = 'http://www.w3.org/2000/svg'
  let layer = svg.querySelector('#track-layer')
  if (!layer) {
    layer = document.createElementNS(ns, 'g')
    layer.setAttribute('id', 'track-layer')
    layer.setAttribute('data-layer', 'spor')
    layer.setAttribute('pointer-events', 'none')
    // Plasser før user-layer + annotation-layer hvis de finnes,
    // ellers append. Spor skal ligge UNDER GPS-dot/annoteringer.
    const userLayer = svg.querySelector('#user-layer')
    const annotLayer = svg.querySelector('#annotation-layer')
    const ref = userLayer ?? annotLayer
    if (ref) svg.insertBefore(layer, ref)
    else svg.appendChild(layer)
  }
  layer.replaceChildren()
  if (curveball.active.value) return

  // v8.9.5: paths inne i [data-layer] arver vector-effect: non-scaling-
  // stroke fra global SVG-CSS, så stroke-width tolkes i CSS-px. Del kun på
  // pinch-scale for å kompensere for CSS-transform-zoom. (Tidligere brukte
  // vi pxToUserUnits her — det ga ~10× for tykk linje på 4 km-kart.)
  const s = scale.value || 1
  const haloW = 7 / s
  const lineW = 3.5 / s
  // Circle/ellipse-radii er geometri, ikke stroke → fortsatt user-units
  const dotR  = pxToUserUnits(2.5)
  const footW = pxToUserUnits(5)

  const TRACK_COLOR = '#ec4899'         // magenta — kontrasterer mot ISOM
  const HALO_COLOR  = 'rgba(255,255,255,0.85)'

  const style = tracker.trackStyle.value
  for (const tr of tracker.tracks.value) {
    if (!tracker.visibleTrackIds.value.has(tr.id)) continue
    if (!tr.points || tr.points.length === 0) continue
    const isActive = tracker.isRecording.value && (tracker.activeTrack.value?.id === tr.id)
    const g = document.createElementNS(ns, 'g')
    g.setAttribute('data-track-id', tr.id)

    if (style === 'breadcrumbs') {
      // Diskrete prikker hver ~10 m. Bruk avstands-basert sampling så
      // tett-pakkede punkter ikke gir cluster.
      const pts = sampleByDistance(tr.points, 10)
      for (const p of pts) {
        const c = document.createElementNS(ns, 'circle')
        c.setAttribute('cx', p.x); c.setAttribute('cy', p.y)
        c.setAttribute('r', dotR)
        c.setAttribute('fill', TRACK_COLOR)
        c.setAttribute('stroke', HALO_COLOR)
        c.setAttribute('stroke-width', pxToUserUnits(1.5))
        g.appendChild(c)
      }
    } else if (style === 'footprints') {
      // Fotavtrykk: små elliptiske prikker alternerende venstre/høyre av
      // bevegelses-retningen, ~5 m mellomrom. Rotasjon følger lokal vinkel.
      const pts = sampleByDistance(tr.points, 5)
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        const next = pts[i + 1] ?? pts[i - 1] ?? p
        const dx = next.x - p.x
        const dy = next.y - p.y
        const angDeg = Math.atan2(dy, dx) * 180 / Math.PI
        const side = (i % 2 === 0) ? 1 : -1
        const off = footW * 0.6
        const perpAng = (angDeg + 90) * Math.PI / 180
        const fx = p.x + Math.cos(perpAng) * off * side
        const fy = p.y + Math.sin(perpAng) * off * side
        const fp = document.createElementNS(ns, 'ellipse')
        fp.setAttribute('cx', fx); fp.setAttribute('cy', fy)
        fp.setAttribute('rx', footW * 0.45)
        fp.setAttribute('ry', footW * 0.85)
        fp.setAttribute('transform', `rotate(${angDeg},${fx},${fy})`)
        fp.setAttribute('fill', TRACK_COLOR)
        fp.setAttribute('stroke', HALO_COLOR)
        fp.setAttribute('stroke-width', pxToUserUnits(1))
        fp.setAttribute('opacity', '0.9')
        g.appendChild(fp)
      }
    } else {
      // Default: to-lags polyline med marsjerende prikker. Halo bak gir
      // lesbarhet på både lyse og mørke kart-temaer.
      const d = pointsToPathD(tr.points)
      const halo = document.createElementNS(ns, 'path')
      halo.setAttribute('d', d)
      halo.setAttribute('fill', 'none')
      halo.setAttribute('stroke', HALO_COLOR)
      halo.setAttribute('stroke-width', haloW)
      halo.setAttribute('stroke-linecap', 'round')
      halo.setAttribute('stroke-linejoin', 'round')
      g.appendChild(halo)

      const line = document.createElementNS(ns, 'path')
      line.setAttribute('d', d)
      line.setAttribute('fill', 'none')
      line.setAttribute('stroke', TRACK_COLOR)
      line.setAttribute('stroke-width', lineW)
      line.setAttribute('stroke-linecap', 'round')
      line.setAttribute('stroke-linejoin', 'round')
      // Marsjerende prikker: stiplet + animasjon på offset. Dasharray
      // arver også non-scaling-stroke, så CSS-px / pinch-scale.
      const dash = 6 / s
      const gap = 8 / s
      line.setAttribute('stroke-dasharray', `${dash} ${gap}`)
      const anim = document.createElementNS(ns, 'animate')
      anim.setAttribute('attributeName', 'stroke-dashoffset')
      anim.setAttribute('from', String(dash + gap))
      anim.setAttribute('to', '0')
      anim.setAttribute('dur', '1.4s')
      anim.setAttribute('repeatCount', 'indefinite')
      line.appendChild(anim)
      g.appendChild(line)
    }

    // Live-puls på siste punkt mens opptaket pågår. Gjør det visuelt
    // tydelig at hovedet av sporet er "her og nå" og at appen henter
    // friske GPS-fix-er.
    if (isActive && tr.points.length > 0) {
      const last = tr.points[tr.points.length - 1]
      const headR = pxToUserUnits(8)
      const pulse = document.createElementNS(ns, 'circle')
      pulse.setAttribute('cx', last.x); pulse.setAttribute('cy', last.y)
      pulse.setAttribute('r', headR)
      pulse.setAttribute('fill', 'none')
      pulse.setAttribute('stroke', TRACK_COLOR)
      pulse.setAttribute('stroke-width', pxToUserUnits(2))
      const aR = document.createElementNS(ns, 'animate')
      aR.setAttribute('attributeName', 'r')
      aR.setAttribute('values', `${headR};${headR * 2.4};${headR}`)
      aR.setAttribute('dur', '1.6s'); aR.setAttribute('repeatCount', 'indefinite')
      pulse.appendChild(aR)
      const aO = document.createElementNS(ns, 'animate')
      aO.setAttribute('attributeName', 'opacity')
      aO.setAttribute('values', '0.9;0;0.9'); aO.setAttribute('dur', '1.6s')
      aO.setAttribute('repeatCount', 'indefinite')
      pulse.appendChild(aO)
      g.appendChild(pulse)
    }

    layer.appendChild(g)
  }
}

/** Forenkle path til "M x,y L x,y L ..." fra point-array. */
function pointsToPathD(points) {
  if (!points.length) return ''
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    d += ` L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`
  }
  return d
}

/** Sample punkter med min-avstand i SVG-meter. Beholder første og siste. */
function sampleByDistance(points, minDistM) {
  if (points.length <= 1) return points.slice()
  const out = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1]
    const dx = points[i].x - last.x
    const dy = points[i].y - last.y
    if (Math.hypot(dx, dy) >= minDistM) out.push(points[i])
  }
  // Sørg for at siste punkt alltid er med (viktig for live-puls)
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1])
  }
  return out
}

// Track-action-handlers for drawer
function onToggleRecording() {
  if (!userPos.isWatching) { userPos.start(); return }
  if (tracker.isRecording.value) tracker.stopRecording()
  else tracker.startRecording()
}
async function onDeleteTrack(id) {
  if (!confirm('Slett dette sporet?')) return
  await tracker.deleteTrack(id)
}
function onExportTrackGpx(tr) {
  if (!meta.value) return
  downloadGpx(tr, meta.value, mapTitle.value)
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
    await tracker.load()
    renderTracks()
    applyUprightLabels()
    renderMeasure()
    // Hill-shading er default ON — fire-and-forget. Lazy DEM-load skjer
    // internt hvis nødvendig (Vardåsen).
    applyHillshade()
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
  // v8.5.2: GPS-laget skal aldri sluke pinch-to-zoom-gester når brukerens
  // finger lander på prikken/ringen.
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
  // men cappes på ~28 CSS-px radius slik at dårlig GPS (urban / tog / tunnel)
  // ikke språker ringen utover halve skjermen og dømmer kart-innholdet.
  // v8.5.3: stroke-bredder via pxToUserUnits — non-scaling-stroke virker
  // ikke når SVG-en CSS-transformeres av pinch-zoom-wrapperen, så stroke
  // ble fete på høy zoom og det blå fyllet forsvant under den hvite kant-
  // linjen. Nå skaleres bredden eksplisitt på samme måte som radius.
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
    // Stedsmerke-bumper trigger Invaders-modus direkte ved multiball-trigger.
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
        <!-- v8.5.2: liten GPS-indikator-prikk i hjørnet når GPS er aktiv,
             så brukeren ser at knappen også refresher posisjonen. -->
        <span v-if="userPos.isWatching"
              class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_4px_rgba(56,189,248,0.8)]" />
      </button>
    </div>

    <!-- Kart-flate. Unified transform (translate ∘ rotate ∘ scale) på ett
         enkelt indre div. Lar finger-pivot styre rotasjons-/zoom-senter
         (v8.9.2). -->
    <div ref="wrapperRef" class="absolute inset-0 touch-none select-none"
         :class="annot.isAnnotateMode.value ? 'cursor-crosshair' : ''">
      <div class="w-full h-full relative" :style="mapTransformStyle">
        <div ref="svgHostRef" class="w-full h-full" @click="onMapClick"></div>
        <CurveBallLayer
          :flipp="curveball"
          :view-box="cbViewBox"
          @drop="onCurveBallContinue"/>
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

    <!-- Måleverktøy-indikator (v8.9.4). Live-readout direkte på kartet.
         v8.9.6: flyttet til top-left (under back-knappen) så den ikke ligger
         bak FAB-stacken. -->
    <div v-if="measureMode && !curveball.active.value"
         class="absolute top-16 left-3 z-20 px-3 py-2 rounded-md bg-emerald-600
                text-white text-[11px] font-medium shadow-lg pointer-events-none
                tabular-nums max-w-[55%]">
      <div class="text-[9px] uppercase tracking-wide text-emerald-100/90">Mål</div>
      <div class="text-[13px] font-semibold">{{ formatDistance(measureStats.distM) }}</div>
      <div v-if="measureClosed" class="text-[11px] text-emerald-100/95">
        {{ formatArea(measureStats.areaM2) }}
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

        <!-- Hurtigvalg: alltid synlig over fanene (v8.9.6). Tegnforklaring +
             GPS/kompass-toggles trengs hyppig uavhengig av aktiv fane. -->
        <div class="shrink-0 px-4 pb-2 grid grid-cols-3 gap-1.5">
          <button @click="router.push('/tegnforklaring')"
                  class="px-2 py-2 rounded-lg bg-white/5 border border-white/10 text-white/80
                         text-[11px] font-medium active:scale-[0.98] flex flex-col items-center gap-1">
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <line x1="7" y1="9" x2="17" y2="9"/>
              <line x1="7" y1="13" x2="17" y2="13"/>
              <line x1="7" y1="17" x2="13" y2="17"/>
            </svg>
            Tegnforklaring
          </button>
          <button @click="userPos.isWatching ? userPos.stop() : userPos.start()"
                  class="px-2 py-2 rounded-lg border text-[11px] font-medium active:scale-[0.98]
                         flex flex-col items-center gap-1"
                  :class="userPos.isWatching
                          ? 'bg-sky-500/20 border-sky-400/50 text-white'
                          : 'bg-white/5 border-white/10 text-white/80'">
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="11" r="3"/>
              <path d="M12 21 c-5 -8 -7 -11 -7 -14 a7 7 0 0 1 14 0 c0 3 -2 6 -7 14 z"/>
            </svg>
            {{ userPos.isWatching ? 'Følger GPS' : 'Start GPS' }}
          </button>
          <button @click="compass.isActive ? compass.stop() : compass.start()"
                  class="px-2 py-2 rounded-lg border text-[11px] font-medium active:scale-[0.98]
                         flex flex-col items-center gap-1"
                  :class="compass.isActive
                          ? 'bg-sky-500/20 border-sky-400/50 text-white'
                          : 'bg-white/5 border-white/10 text-white/80'">
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"/>
              <polygon points="12 5 14 12 12 13 10 12" fill="currentColor"/>
              <polygon points="12 19 14 12 12 11 10 12"/>
            </svg>
            {{ compass.isActive ? 'Kompass på' : 'Kompass' }}
          </button>
        </div>

        <!-- Tab-bar — horisontalt scrollbar når plassen krever det. -->
        <div class="shrink-0 px-4 pb-2 flex gap-1.5 overflow-x-auto map-tabs"
             style="scrollbar-width: none;">
          <button v-for="tab in visibleTabs" :key="tab.key"
                  @click="activeTab = tab.key"
                  class="px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap shrink-0
                         active:scale-95 transition border"
                  :class="activeTab === tab.key
                          ? 'bg-slate-200 border-slate-200 text-zinc-900'
                          : 'bg-white/5 border-white/10 text-white/70'">
            {{ tab.label }}
          </button>
        </div>

        <div class="flex-1 overflow-y-auto px-4 pb-6">
          <!-- ── Tab: Lag ─────────────────────────────────────────── -->
          <div v-show="activeTab === 'lag'">
            <div class="grid grid-cols-2 gap-2 mb-2">
              <button v-for="lay in LAYERS" :key="lay.key"
                      @click="toggleLayer(lay.key)"
                      class="px-3 py-2 rounded-lg border text-left active:scale-[0.98] transition"
                      :class="visibleLayers.has(lay.key)
                              ? 'bg-slate-400/25 border-slate-300/50 text-white'
                              : 'bg-white/5 border-white/10 text-white/45'">
                <span class="text-[12px]">{{ lay.label }}</span>
              </button>
            </div>
            <div class="text-[10px] text-white/40 leading-snug mt-2">
              Reliefskygge er DEM-derivert hill-shading rendret som grayscale-
              PNG inne i SVG-en med <code>mix-blend-mode: multiply</code>.
            </div>
          </div>

          <!-- ── Tab: Tema ────────────────────────────────────────── -->
          <div v-show="activeTab === 'tema'">
            <div class="grid grid-cols-3 gap-2 mb-3">
              <button v-for="t in THEMES" :key="t.key"
                      @click="onThemeTap(t.key)"
                      class="px-3 py-2 rounded-lg border text-[11px] active:scale-[0.98] transition text-center"
                      :class="currentTheme === t.key
                              ? 'bg-slate-400/25 border-slate-300/50 text-white font-medium'
                              : 'bg-white/5 border-white/10 text-white/65'">
                {{ t.label }}
              </button>
            </div>

            <!-- Curve Invaders-knapp er en easter egg som dukker opp først
                 når brukeren har valgt Curves-temaet. -->
            <button v-if="currentTheme === 'curves'"
                    @click="startCurveBall"
                    :disabled="cbDemFetching"
                    class="w-full mb-2 px-3 py-2.5 rounded-lg bg-gradient-to-r from-fuchsia-500/20 to-cyan-500/20
                           border border-fuchsia-400/40 text-white text-[12px]
                           active:scale-[0.98] flex items-center justify-center gap-2
                           disabled:opacity-60">
              <span v-if="cbDemFetching">⏳ {{ t('mapview.gameLoading') }}</span>
              <span v-else>{{ t('mapview.gameButton', { emoji: t('game.emoji'), gameName: t('game.name') }) }}</span>
            </button>
            <div v-if="cbDemError"
                 class="w-full mb-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-500/40
                        text-red-200 text-[11px] text-center">
              {{ cbDemError }}
            </div>
          </div>

          <!-- ── Tab: Annotering (kun bruker-kart) ───────────────── -->
          <div v-show="activeTab === 'annotering'">
            <div class="space-y-2 mb-3">
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

            <!-- Lay-toggles pr type — kun synlig når noe er plassert -->
            <template v-if="annot.annotations.value.length">
              <div class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Synlighet pr type</div>
              <div class="grid grid-cols-2 gap-2 mb-3">
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

              <div class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Alle plasserte</div>
              <div class="space-y-1 mb-2 max-h-56 overflow-y-auto pr-1">
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
            </template>
            <div v-else class="text-[10px] text-white/40 leading-snug">
              Velg et symbol over og tap på kartet for å plassere.
            </div>
          </div>

          <!-- ── Tab: Måling ─────────────────────────────────────── -->
          <div v-show="activeTab === 'maaling'">
            <div class="space-y-2 mb-2">
              <button v-if="!measureMode"
                      @click="startMeasure"
                      class="w-full px-3 py-2.5 rounded-lg border text-[12px] active:scale-[0.98]
                             bg-white/5 border-white/10 text-white/75 flex items-center justify-center gap-2">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 21 9 15 13 19 21 11"/>
                  <path d="M5 19 V21 H7 M19 11 V13 H21"/>
                </svg>
                Mål distanse og areal
              </button>
              <div v-else class="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 space-y-2">
                <div class="flex items-baseline justify-between">
                  <div class="text-[11px] text-emerald-100/85 uppercase tracking-wide">
                    Tap på kartet for å plassere punkter
                  </div>
                  <button @click="stopMeasure"
                          aria-label="Avslutt måling"
                          class="text-white/70 active:scale-90 text-[10px] px-1.5 py-0.5 rounded
                                 bg-white/10 hover:bg-white/15">
                    Lukk
                  </button>
                </div>
                <div class="text-white text-[14px] tabular-nums font-medium">
                  {{ formatDistance(measureStats.distM) }}
                  <span v-if="measureClosed" class="text-emerald-200/85">
                    · {{ formatArea(measureStats.areaM2) }}
                  </span>
                  <span v-if="measureVertices.length === 0"
                        class="text-white/45 text-[11px] font-normal">
                    (ingen punkter ennå)
                  </span>
                </div>
                <div class="flex gap-1.5">
                  <button @click="closeMeasure"
                          :disabled="measureVertices.length < 3 || measureClosed"
                          class="flex-1 px-2 py-1.5 rounded-md text-[11px] border active:scale-[0.98]
                                 bg-emerald-500/20 border-emerald-300/40 text-white
                                 disabled:opacity-40 disabled:cursor-not-allowed">
                    Lukk polygon
                  </button>
                  <button @click="undoMeasureVertex"
                          :disabled="!measureVertices.length"
                          class="flex-1 px-2 py-1.5 rounded-md text-[11px] border active:scale-[0.98]
                                 bg-white/5 border-white/15 text-white/75 disabled:opacity-40">
                    Angre
                  </button>
                  <button @click="clearMeasure"
                          :disabled="!measureVertices.length"
                          class="flex-1 px-2 py-1.5 rounded-md text-[11px] border active:scale-[0.98]
                                 bg-white/5 border-white/15 text-white/75 disabled:opacity-40">
                    Tøm
                  </button>
                </div>
              </div>
            </div>
            <div class="text-[10px] text-white/40 leading-snug">
              Distanse summeres som rette linjer mellom punkter. Areal beregnes
              med shoelace-formelen når polygonen er lukket. m² · ha · km² —
              det som passer best for areal-størrelsen.
            </div>
          </div>

          <!-- ── Tab: Sporing (kun bruker-kart) ─────────────────── -->
          <div v-show="activeTab === 'sporing'">
          <div class="space-y-2 mb-3">
            <button @click="onToggleRecording"
                    class="w-full px-3 py-2.5 rounded-lg border text-[12px] active:scale-[0.98] flex items-center justify-between gap-2"
                    :class="tracker.isRecording.value
                            ? 'bg-pink-500/25 border-pink-300/50 text-white'
                            : 'bg-white/5 border-white/10 text-white/75'">
              <span class="flex items-center gap-2">
                <span v-if="tracker.isRecording.value"
                      class="w-2 h-2 rounded-full bg-pink-400 animate-pulse"></span>
                <svg v-else viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3" fill="currentColor"/>
                </svg>
                {{ tracker.isRecording.value ? 'Stopp opptak' : (userPos.isWatching ? 'Start opptak' : 'Start GPS + opptak') }}
              </span>
              <span v-if="liveTrackStats" class="text-[11px] text-pink-100/85 tabular-nums">
                {{ formatDistance(liveTrackStats.meters) }} · {{ formatDuration(liveTrackStats.ms) }}
              </span>
            </button>

            <!-- Stil-velger: linje / fotspor / brødsmuler. Påvirker
                 alle synlige spor med en gang. -->
            <div class="grid grid-cols-3 gap-1.5">
              <button v-for="s in TRACK_STYLES" :key="s.key"
                      @click="tracker.setStyle(s.key)"
                      :title="s.desc"
                      class="px-2 py-1.5 rounded-md border text-[11px] active:scale-[0.98] transition"
                      :class="tracker.trackStyle.value === s.key
                              ? 'bg-pink-400/20 border-pink-300/50 text-white'
                              : 'bg-white/5 border-white/10 text-white/65'">
                {{ s.label }}
              </button>
            </div>
            <div class="text-[10px] text-white/40 leading-snug">
              Punkter samples ned til hver 5. m. Lave-nøyaktighets-fixer (over
              50 m) ignoreres så støy ikke blir sti. Spor lagres med kartet.
            </div>
          </div>

          <!-- Liste over lagrede spor + det aktive sporet. -->
          <div v-if="tracker.tracks.value.length"
               class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Mine spor</div>
          <div v-if="tracker.tracks.value.length"
               class="space-y-1.5 mb-3 max-h-56 overflow-y-auto pr-1">
            <div v-for="tr in tracker.tracks.value" :key="tr.id"
                 class="px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10">
              <div class="flex items-center gap-2">
                <button @click="tracker.toggleVisibility(tr.id)"
                        :aria-label="tracker.visibleTrackIds.value.has(tr.id) ? 'Skjul spor' : 'Vis spor'"
                        class="w-5 h-5 flex items-center justify-center rounded-sm shrink-0"
                        :class="tracker.visibleTrackIds.value.has(tr.id)
                                ? 'text-pink-300'
                                : 'text-white/30'">
                  <svg v-if="tracker.visibleTrackIds.value.has(tr.id)" viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 12 s4 -7 10 -7 s10 7 10 7 s-4 7 -10 7 s-10 -7 -10 -7"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <svg v-else viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 3 L21 21"/>
                    <path d="M10.5 6.2 Q12 6 13.5 6.2 Q19 7 22 12 Q21 13.5 19 15.2"/>
                    <path d="M2 12 Q5 7 9 6"/>
                  </svg>
                </button>
                <div class="flex-1 min-w-0">
                  <div class="text-[12px] text-white/85 truncate">
                    {{ tr.navn || ('Tur ' + new Date(tr.opprettet).toLocaleDateString('no-NO', { day: '2-digit', month: 'short' })) }}
                    <span v-if="tracker.isRecording.value && tracker.activeTrack.value?.id === tr.id"
                          class="ml-1 text-pink-300 text-[10px] uppercase">● opptak</span>
                  </div>
                  <div class="text-[10px] text-white/45 tabular-nums">
                    {{ formatDistance(trackLengthM(tr)) }} ·
                    {{ formatDuration(trackDurationMs(tr)) }} ·
                    {{ tr.points.length }} punkter
                  </div>
                </div>
                <button @click="onExportTrackGpx(tr)"
                        aria-label="Eksporter som GPX"
                        :disabled="!tr.points.length"
                        class="w-7 h-7 flex items-center justify-center rounded-md text-white/55
                               active:scale-90 active:bg-white/10 disabled:opacity-30">
                  <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 5 V19"/><polyline points="6 13 12 19 18 13"/>
                    <line x1="5" y1="21" x2="19" y2="21"/>
                  </svg>
                </button>
                <button @click="onDeleteTrack(tr.id)"
                        aria-label="Slett spor"
                        class="w-7 h-7 flex items-center justify-center rounded-md text-white/55
                               active:scale-90 active:bg-rose-500/20 active:text-rose-200">
                  <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                       stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
                  </svg>
                </button>
              </div>

              <!-- Høydeprofil-sparkline (v8.9.4). Tap for å zoome.
                   Krever ≥ 2 punkter og at DEM er lastet. -->
              <button v-if="profileFor(tr)"
                      @click="expandedTrackId = tr.id"
                      class="mt-1.5 w-full block rounded-sm overflow-hidden active:opacity-80"
                      aria-label="Vis høydeprofil i full størrelse">
                <svg viewBox="0 0 200 36" preserveAspectRatio="none"
                     class="w-full h-9 block">
                  <defs>
                    <linearGradient :id="'pf-grad-' + tr.id" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stop-color="#ec4899" stop-opacity="0.55"/>
                      <stop offset="100%" stop-color="#ec4899" stop-opacity="0.05"/>
                    </linearGradient>
                  </defs>
                  <path :d="buildProfilePath(profileFor(tr), 200, 36, 2).area"
                        :fill="'url(#pf-grad-' + tr.id + ')'"/>
                  <path :d="buildProfilePath(profileFor(tr), 200, 36, 2).line"
                        fill="none" stroke="#ec4899" stroke-width="1.2"
                        stroke-linecap="round" stroke-linejoin="round"
                        vector-effect="non-scaling-stroke"/>
                </svg>
                <div class="text-[10px] text-white/55 tabular-nums leading-tight px-0.5 mt-0.5 text-left">
                  ↗ {{ Math.round(profileFor(tr).totalAscent) }} m ·
                  ↘ {{ Math.round(profileFor(tr).totalDescent) }} m ·
                  {{ Math.round(profileFor(tr).minElev) }}–{{ Math.round(profileFor(tr).maxElev) }} moh
                </div>
              </button>
            </div>
          </div>

          <!-- GPS-debug-readout (synlig kun når GPS er på) -->
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
          </div>

          <!-- ── Tab: Eksport ─────────────────────────────────────── -->
          <div v-show="activeTab === 'eksport'">
            <div class="grid grid-cols-2 gap-2 mb-3">
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

            <div class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Debug</div>
            <button @click="diagnose = !diagnose"
                    class="w-full px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98] mb-2"
                    :class="diagnose
                            ? 'bg-slate-400/20 border-slate-300/50 text-white'
                            : 'bg-white/5 border-white/10 text-white/75'">
              {{ diagnose ? 'Diagnose: AV' : 'Diagnose-modus' }}
            </button>
            <div v-if="diagnose" class="text-[10px] text-white/55 leading-relaxed mb-3 px-1">
              Polygon-fargen viser kilden:
              <span class="inline-block w-3 h-3 rounded-sm align-middle" style="background: hsl(180, 80%, 55%);"></span> N50,
              <span class="inline-block w-3 h-3 rounded-sm align-middle" style="background: hsl(220, 80%, 60%);"></span> OSM way,
              <span class="inline-block w-3 h-3 rounded-sm align-middle" style="background: hsl(300, 80%, 60%);"></span> OSM relation,
              <span class="inline-block w-3 h-3 rounded-sm align-middle" style="background: hsl(45, 90%, 55%);"></span> merged.
            </div>
          </div>

          <!-- ── Tab: Om ──────────────────────────────────────────── -->
          <div v-show="activeTab === 'om'">
            <div class="text-white/70 text-[12px] leading-relaxed space-y-2">
              <p>
                <strong class="text-white">SVG Insights</strong> utforsker hva man kan
                bygge med ren SVG i nettleseren — kart, font-editor, foto-effekter.
              </p>
              <p>
                Dette kartet bruker ISOM 2017-2-inspirert symbolisering med mm-baserte
                streker for print-kvalitet. Kartdata © OpenStreetMap-bidragsytere
                (ODbL). Høydedata fra Kartverket (NHM_DTM / DOM).
              </p>
              <p>
                Reprojisert til UTM 32N (EPSG:25832-kompatibel) med 1 SVG-enhet = 1 m.
                Reliefskygge: Horn-formel hill-shading rendret som grayscale-PNG i
                SVG-en med <code class="text-white/85">mix-blend-mode: multiply</code>.
              </p>
              <!-- v8.9.9: Karttype-info + nullstill-knapp. Tidligere var dette
                   bare synlig som liten tekst nede i attribusjons-boksen og
                   ble lett oversett (rapportert 23. mai 2026). -->
              <div v-if="meta?.mapType" class="mt-3 pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                <span class="text-white/80">
                  Karttype: {{ meta.mapType === 'sea' ? '🌊 Sjøkart' : '🥾 Land-kart' }}
                </span>
                <button @click="clearMapTypePreference"
                        class="px-2 py-1 rounded-md bg-sky-500/15 border border-sky-400/40
                               text-sky-200 text-[11px] hover:bg-sky-500/25"
                        title="Nullstiller globalt karttype-valg. Du blir spurt på nytt neste gang du lager et kart.">
                  Nullstill valg
                </button>
              </div>
              <p class="text-white/45 text-[10px]">v{{ APP_VERSION }}</p>
            </div>
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

    <!-- Høydeprofil-modal (v8.9.4). Åpnes ved tap på sparkline i drawer-en.
         Viser stor profil + stats. Bottom-sheet stil. -->
    <div v-if="expandedTrackId"
         class="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-end justify-center"
         @click.self="expandedTrackId = null">
      <div class="w-full bg-zinc-900 border-t border-white/10 rounded-t-2xl p-4 max-h-[75dvh] overflow-y-auto">
        <template v-for="tr in tracker.tracks.value" :key="tr.id">
          <template v-if="tr.id === expandedTrackId">
            <div class="flex items-start justify-between mb-3">
              <div>
                <div class="text-white text-sm font-semibold">
                  {{ tr.navn || ('Tur ' + new Date(tr.opprettet).toLocaleDateString('no-NO', { day: '2-digit', month: 'short', year: 'numeric' })) }}
                </div>
                <div class="text-[11px] text-white/55 tabular-nums">
                  {{ formatDistance(trackLengthM(tr)) }} ·
                  {{ formatDuration(trackDurationMs(tr)) }} ·
                  {{ tr.points.length }} punkter
                </div>
              </div>
              <button @click="expandedTrackId = null"
                      aria-label="Lukk"
                      class="w-8 h-8 rounded-full bg-white/5 border border-white/10
                             text-white/65 flex items-center justify-center active:scale-90">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                     stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
                </svg>
              </button>
            </div>

            <template v-if="profileFor(tr)">
              <svg viewBox="0 0 600 180" preserveAspectRatio="none"
                   class="w-full h-44 block rounded-lg bg-zinc-950">
                <defs>
                  <linearGradient :id="'pf-big-grad-' + tr.id" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stop-color="#ec4899" stop-opacity="0.65"/>
                    <stop offset="100%" stop-color="#ec4899" stop-opacity="0.05"/>
                  </linearGradient>
                </defs>
                <!-- Horisontale grid-linjer (svake, for kontekst) -->
                <g stroke="rgba(255,255,255,0.07)" stroke-width="1">
                  <line v-for="i in 3" :key="i" x1="0" :y1="(i / 4) * 180" x2="600" :y2="(i / 4) * 180"/>
                </g>
                <path :d="buildProfilePath(profileFor(tr), 600, 180, 8).area"
                      :fill="'url(#pf-big-grad-' + tr.id + ')'"/>
                <path :d="buildProfilePath(profileFor(tr), 600, 180, 8).line"
                      fill="none" stroke="#ec4899" stroke-width="2"
                      stroke-linecap="round" stroke-linejoin="round"
                      vector-effect="non-scaling-stroke"/>
                <!-- Y-akse-labels: max + min høyde -->
                <text x="6" y="14" fill="#ec4899" font-size="11" font-weight="600"
                      style="font-family: ui-sans-serif, system-ui">
                  {{ Math.round(profileFor(tr).maxElev) }} moh
                </text>
                <text x="6" y="174" fill="#ec4899" font-size="11" font-weight="600"
                      style="font-family: ui-sans-serif, system-ui">
                  {{ Math.round(profileFor(tr).minElev) }} moh
                </text>
                <text x="594" y="14" fill="rgba(255,255,255,0.4)" font-size="10"
                      text-anchor="end" style="font-family: ui-sans-serif, system-ui">0 m</text>
                <text x="594" y="174" fill="rgba(255,255,255,0.4)" font-size="10"
                      text-anchor="end" style="font-family: ui-sans-serif, system-ui">
                  {{ formatDistance(profileFor(tr).totalDistM) }}
                </text>
              </svg>

              <div class="grid grid-cols-2 gap-2 mt-3 text-[12px]">
                <div class="rounded-md bg-white/5 border border-white/10 px-3 py-2">
                  <div class="text-white/45 text-[10px] uppercase tracking-wide">Total stigning</div>
                  <div class="text-white font-semibold tabular-nums">↗ {{ Math.round(profileFor(tr).totalAscent) }} m</div>
                </div>
                <div class="rounded-md bg-white/5 border border-white/10 px-3 py-2">
                  <div class="text-white/45 text-[10px] uppercase tracking-wide">Total fall</div>
                  <div class="text-white font-semibold tabular-nums">↘ {{ Math.round(profileFor(tr).totalDescent) }} m</div>
                </div>
                <div class="rounded-md bg-white/5 border border-white/10 px-3 py-2">
                  <div class="text-white/45 text-[10px] uppercase tracking-wide">Høyeste punkt</div>
                  <div class="text-white font-semibold tabular-nums">{{ Math.round(profileFor(tr).maxElev) }} moh</div>
                </div>
                <div class="rounded-md bg-white/5 border border-white/10 px-3 py-2">
                  <div class="text-white/45 text-[10px] uppercase tracking-wide">Laveste punkt</div>
                  <div class="text-white font-semibold tabular-nums">{{ Math.round(profileFor(tr).minElev) }} moh</div>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="rounded-md bg-amber-500/10 border border-amber-300/30 px-3 py-3 text-amber-100/90 text-[12px]">
                Høydeprofil ikke tilgjengelig — DEM kunne ikke leses for dette kartet.
              </div>
            </template>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drawer-enter-active, .drawer-leave-active { transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.drawer-enter-from, .drawer-leave-to       { transform: translateY(100%); }
/* Skjul scrollbar på tab-strip — fortsatt scrollbar med touch / wheel */
.map-tabs::-webkit-scrollbar { display: none; }
</style>

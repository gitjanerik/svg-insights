<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePinchZoom } from '../composables/usePinchZoom.js'
import { useUserPosition } from '../composables/useUserPosition.js'
import { useCompass } from '../composables/useCompass.js'
import { useDraggableDrawer } from '../composables/useDraggableDrawer.js'
import { useMapAnnotations, ANNOTATION_SYMBOLS } from '../composables/useMapAnnotations.js'
import { useMapSearch, findByName } from '../composables/useMapSearch.js'
import { useTrackRecorder, TRACK_STYLES } from '../composables/useTrackRecorder.js'
import { useScreenWakeLock } from '../composables/useScreenWakeLock.js'
import { trackLengthM, trackDurationMs, downloadGpx } from '../lib/gpxExport.js'
import AnnotationIcon from '../components/AnnotationIcon.vue'
import { loadMap as loadStoredMap, listMaps as listStoredMaps, deleteMap as deleteStoredMap } from '../lib/mapStorage.js'
import { isomCatalog, buildPointSymbolDef } from '../lib/symbolizer.js'
import { printDocument, exportSvgFile, exportPngFile, exportPdfFile } from '../lib/printExport.js'
import { unpackDem, findHighestPoint } from '../lib/demSampling.js'
import { computeHillshade, hillshadeToDataURL } from '../lib/hillshade.js'
import { sampleProfile, buildProfilePath } from '../lib/elevationProfile.js'
import { fetchDEM } from '../lib/demFetcher.js'
import { buildMapFromCenter, consumeMapFinalize } from '../lib/createMapFlow.js'
import { getPerfLog, clearPerfLog } from '../lib/perfLog.js'
import { svgToWgs84 } from '../lib/utm.js'
import { sampleElevation } from '../lib/demSampling.js'
import {
  bearingDeg, bearingToCompass, formatDistanceM,
  findNearestPlace,
} from '../lib/mapContext.js'
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
const searchInputRef = ref(null)

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
// 'spor' er et klient-side syntetisk lag (ikke fra mapBuilder). Relieff
// (hillshade) er ikke lenger en lag-toggle her — det styres av relieff-
// knotten i FAB-stacken (se STROKE_STEPS/RELIEF_STEPS lenger ned).
const LAYERS = [
  { key: 'skog',       label: 'Skog' },
  { key: 'aapen',      label: 'Åpen mark' },
  { key: 'aker',       label: 'Åker' },
  { key: 'myr',        label: 'Myr' },
  { key: 'vann',       label: 'Vann' },
  { key: 'bekk',       label: 'Bekk' },
  { key: 'kontur',     label: 'Høydekurver' },
  { key: 'naturreservat', label: 'Naturreservat' },
  { key: 'bygning',    label: 'Hus og hytter' },
  { key: 'bymasse',    label: 'Tett bebyggelse' },
  { key: 'kirke',      label: 'Kirker' },
  { key: 'parkering',  label: 'Parkering' },
  { key: 'holdeplass', label: 'Holdeplass' },
  { key: 'bro',        label: 'Bro' },
  { key: 'bom',        label: 'Bom / barriere' },
  { key: 'vei-stor',   label: 'Storveg' },
  { key: 'vei-liten',  label: 'Småveg' },
  { key: 'tog',        label: 'Jernbane' },
  { key: 'sti',        label: 'Sti' },
  { key: 'lysloype',   label: 'Lysløype' },
  { key: 'heistrase',  label: 'Heistrasé' },
  { key: 'slalombakke', label: 'Slalombakke' },
  { key: 'stein',      label: 'Stein / skjær' },
  { key: 'trig',       label: 'Trigpunkter' },
  { key: 'stupkant',   label: 'Stupkant' },
  { key: 'linje',      label: 'Gjerde / kraft' },
  { key: 'navn',       label: 'Navn' },
  // Stedsnavn delt i tre viktighets-nivåer (v9.1.20) — egne lag så de kan
  // toggles hver for seg (f.eks. landsby av, by på).
  { key: 'stedsnavn-major', label: 'By / tettsted' },
  { key: 'stedsnavn-mid',   label: 'Landsby / bydel' },
  { key: 'stedsnavn-minor', label: 'Grend / gård' },
  { key: 'spor',       label: 'GPS-spor' },
  // Sjø & padling — marine POI (fyr, sjømerker, skjær, marina, toalett,
  // drikkevann) + kai/molo/fareområde (data-layer 'sjo-poi'). Rendres i en
  // egen gruppert seksjon i Lag-fanen. Dybdepunkt/dybdekurver er IKKE her —
  // de er skjulte detalj-lag som kun vises i long-press-inset-en.
  { key: 'sjo-poi',    label: 'Sjø & padling' },
]
// Lag som hører til den marine «Sjø & padling»-seksjonen i drawer-en
// (skilles ut fra terreng-grid-en for ryddigere gruppering).
const MARINE_LAYER_KEYS = new Set(['sjo-poi'])
const landLayerButtons = LAYERS.filter(l => !MARINE_LAYER_KEYS.has(l.key))
const marineLayerButtons = LAYERS.filter(l => MARINE_LAYER_KEYS.has(l.key))

// v8.1.0: Stedsnavn-overlay er AV som default — det er et stort tekst-
// overlegg over kartet som brukeren slår på når de trenger områdenavn
// med stor skrift (matcher tradisjonell turkart-stil).
// v8.2.0: lysloype skjules som default (lite relevant for de fleste
// turkart-bbox), og stedsnavn vises som default (større områdenavn er
// nyttig kontekst).
// v9.1.31: ISOM 521 (frittstående bygg) er «Hus og hytter» (data-layer
// 'bygning'), ISOM 522 (tett bebyggelse pattern-fyll) er «Tett bebyggelse»
// (data-layer 'bymasse'). Bymasse er AV som default i alle kartstørrelser —
// pattern-fyllet dekker mye og er sjelden ønsket i en oversikt, mens
// frittstående hus/hytter er nyttig kontekst.
const DEFAULT_OFF_LAYERS = new Set(['lysloype', 'bymasse'])
const visibleLayers = ref(new Set(LAYERS.filter(l => !DEFAULT_OFF_LAYERS.has(l.key)).map(l => l.key)))
// Tema: 'light' (default ISOM), 'dark', 'mono-sepia', 'mono-indigo', 'mono-slate'.
// isDark er derivert for steder som styrer UI-farger (toppbar, drawer-bg).
const currentTheme = ref('light')
const isDark = computed(() => currentTheme.value !== 'light')
const THEMES = computed(() => Object.entries(isomCatalog.themes ?? {}).map(([k, v]) => ({ key: k, label: v.label ?? k })))
const diagnose = ref(false)

// Terreng-først: kartet ble vist med konturer+relieff straks, og OSM/detaljer
// fylles inn i bakgrunnen. Chip vises mens vi venter på full-byggingen.
const fillingInDetails = ref(false)
// Settes hvis bakgrunns-byggingen (Overpass) feilet → vis banner med «Prøv på
// nytt»-knapp i stedet for en teknisk, overflytende toast.
const detailsFailed = ref(false)
let componentAlive = true

// Datamengde lastet for kartet (SVG + lagret DEM). Vises i drawer-ens Debug og
// i long-press-info-arket så man ser hvor «tungt» kartet er.
const mapDataSize = ref({ svgBytes: 0, demBytes: 0 })
function formatBytes(n) {
  if (!n || n < 0) return '0'
  if (n >= 1024 * 1024) return (n / 1048576).toFixed(2).replace('.', ',') + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}
const mapDataLabel = computed(() => {
  const s = mapDataSize.value
  const parts = []
  if (s.svgBytes) parts.push(`${formatBytes(s.svgBytes)} SVG`)
  if (s.demBytes) parts.push(`${formatBytes(s.demBytes)} DEM`)
  return parts.join(' · ')
})

// Perf-logg-modal (byggetider). Brukeren på mobil kan ikke lese konsollen, så
// vi viser localStorage-loggen her med kopier-knapp.
const showPerfLog = ref(false)
const perfEntries = ref([])
const perfCopied = ref(false)
function openPerfLog() {
  perfEntries.value = getPerfLog().slice().reverse()  // nyeste øverst
  perfCopied.value = false
  showPerfLog.value = true
}
function perfLogText() {
  return getPerfLog()
    .map(e => `${new Date(e.t).toLocaleString('no-NO')}  ${e.msg}`)
    .join('\n')
}
async function copyPerfLog() {
  const text = perfLogText()
  try {
    await navigator.clipboard.writeText(text)
    perfCopied.value = true
    setTimeout(() => { perfCopied.value = false }, 2000)
  } catch {
    // Clipboard-API utilgjengelig (eldre WebView) — vis råtekst for manuell kopiering.
    window.prompt('Kopier perf-loggen:', text)
  }
}
function clearPerfLogAndRefresh() {
  clearPerfLog()
  perfEntries.value = []
}
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
  // v9.1.19: «Nullstill zoom» rører KUN zoom/pan/rotasjon — IKKE strek- og
  // relieff-knottene. Brukeren vil beholde sine valgte strek-/relieff-nivåer
  // når de bare vil sentrere/uvri kartet.
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
  // v9.1.10: et lag som nettopp ble slått PÅ kan ha labels med utdatert (eller
  // manglende) counter-rotation siden applyUprightLabels hopper over skjulte
  // lag. Re-orienter nå — billig pga koordinat-cache.
  applyUprightLabels()
  // Et lag (f.eks. et stedsnavn-nivå) kan nettopp ha blitt slått på/av — la
  // navn-LOD-en revurdere hvilke navn som er overflødige i utsnittet.
  scheduleNameLOD()
}

// Pinch/pan/rotate fryses i CurveBall-modus (kart skal stå i ro under spill).
// Pan/zoom er av under spillet OG mens et ferskt kart fyller inn stier og
// detaljer (terreng-først) eller mens første last pågår — brukeren skal ikke
// kunne interagere med (eller trigge nytt auto-kart fra) et halvbygd kart.
const pinchEnabled = computed(() =>
  !curveball.active.value && !fillingInDetails.value && !loading.value)
// panAtRest: la kartet dras også ved nullstilt zoom (se clampPan for canvas-rom).
const { scale, translateX, translateY, rotation, reset, panTo, animating, isGesturing } =
  usePinchZoom(wrapperRef, { enabled: pinchEnabled, panAtRest: true })

// Pan-clamp — 3×3-rutenett av kart-utsnitt (midtcellen = kartet). Det synlige
// sentrum kan flyttes inntil ÉN full kart-bredde/-høyde fra kart-senteret i hver
// retning: nok rom til å pan-e mot auto-kart-trigger i alle himmelretninger ved
// default zoom, men kartet kan aldri drifte helt bort. Vi klamper det synlige
// sentrum (rotasjons-trygt) og inverterer til translate; gjelder alle zoom-nivå.
function clampPan() {
  const m = meta.value
  const el = wrapperRef.value
  if (!m || !el) return
  const r = el.getBoundingClientRect()
  const w = r.width, h = r.height
  if (!w || !h) return
  const c = visibleCenterSvg()
  if (!c) return
  const cx = Math.min(Math.max(c.x, -m.widthM / 2), m.widthM * 1.5)
  const cy = Math.min(Math.max(c.y, -m.heightM / 2), m.heightM * 1.5)
  if (cx === c.x && cy === c.y) return   // innenfor → idempotent, ingen endring
  // Inverter visibleCenterSvg: finn translate som lander (cx,cy) på skjermsenter.
  const fit = Math.min(w / m.widthM, h / m.heightM)
  const offX = (w - m.widthM * fit) / 2
  const offY = (h - m.heightM * fit) / 2
  const s = scale.value || 1
  const rot = (rotation.value || 0) * Math.PI / 180
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const px = cx * fit + offX
  const py = cy * fit + offY
  const A = px * cos - py * sin
  const B = px * sin + py * cos
  translateX.value = w / 2 - A * s
  translateY.value = h / 2 - B * s
}
watch([scale, translateX, translateY, rotation], clampPan)

// v8.10.3: Toggle `.is-zooming` på SVG-host under aktiv gest så CSS-regelen
// for `vector-effect: non-scaling-stroke` overstyres til `none` — strokene
// re-tessellerer ikke i device-piksler per frame, og kartet får ~3-5×
// frame-rate-gevinst på store kart. Strokene "skalerer med" mens du zoomer
// (visuelt OK i 200 ms), og snapper tilbake til riktig bredde når gesten er over.
watch(isGesturing, (g) => {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  if (g) svg.classList.add('is-zooming')
  else svg.classList.remove('is-zooming')
  // v9.1.14 — Perf: skjul relieff-bildet under aktiv gest. Et fullkart-
  // <image> med mix-blend-mode må re-komponeres mot bakgrunnen hver frame
  // (blend-mode hindrer billig GPU-lag-isolasjon), så det er dyrt på mobil-
  // GPU under pan/zoom/rotasjon. Det dukker tilbake straks gesten slipper.
  const hs = svg.querySelector('#hillshade-layer')
  if (hs) hs.style.visibility = g ? 'hidden' : ''
  // v9.1.15 — Perf: stiplet strek (sti 505-508, gjerde/kraft, jernbane osv)
  // er den desidert dyreste å rastere på mobil-GPU under gest — på et 10 km-
  // kart blir den merge-de sti-pathen tusenvis av dash-segmenter som
  // reberegnes hver frame. Gjør ALLE kart-strekker solide mens gesten varer
  // (solide er allerede uendret), og bytt tilbake til CSS-dash etterpå.
  // Inline style overstyrer den katalog-genererte data-iso-CSS-en.
  const paths = svg.querySelectorAll('[data-layer] path')
  for (const p of paths) p.style.strokeDasharray = g ? 'none' : ''
})

// v8.10.4: Toggle `.zoomed-in` ved scale >= ZOOMED_IN_THRESHOLD så fine
// labels (kontur-tall, bekk-navn) bare rendres når brukeren faktisk kan
// lese dem. Ved fit-to-extent er de uleselig små men dyre å text-shape +
// halo-rendre. CSS i symbolizer.js gjør resten.
const ZOOMED_IN_THRESHOLD = 1.3
watch(scale, (s) => {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  if (s >= ZOOMED_IN_THRESHOLD) svg.classList.add('zoomed-in')
  else svg.classList.remove('zoomed-in')
}, { immediate: true })

// ── Strek- og relieff-knotter (FAB) ──────────────────────────────────
// To «volum-knotter» som har overtatt de gamle zoom-inn/ut-knappenes plass
// (zoom dekkes av pinch + dobbel-tap). Tap = ett hakk opp (wrapper til min
// etter max), lang-trykk = nullstill. «Sentrer»-knappen nullstiller begge.
// Verdiene huskes globalt i localStorage (gjelder alle kart).
//  • Strek-knotten skalerer all kartlinje-tykkelse via CSS-var --stroke-scale
//    (se symbolizer.js). Senter-glyfen tegnes i faktisk valgt tykkelse.
//  • Relieff-knotten styrer hillshade-opacity 0 → 0.72 og er nå eneste
//    kontroll for relieff (lag-toggle fjernet). Blend-modus velges per tema
//    (multiply på lyse, screen på mørke/art-tema) så relieffet «gløder» i
//    Curves istedenfor å bli gjørmete.
//  • Strek-hakkene er relative multiplikatorer; den effektive --stroke-scale
//    ganges i tillegg med en kartstørrelse-basis (strokeSizeBase) fordi store
//    kart har langt tettere kontur-tetthet — samme mm-strek blir et svart rot
//    ved zoom. Et 10 km-kart får derfor hele skalaen skjøvet tynnere enn et
//    1 km-kart, mens hint-boblen viser den faktiske effektive ×-verdien.
const STROKE_STEPS = [0.4, 0.6, 0.85, 1.2, 1.6, 2.2]
const STROKE_DEFAULT_IDX = 2  // 0.85× = 85% av tidligere default på små kart
const RELIEF_STEPS = [0, 0.18, 0.30, 0.42, 0.58, 0.72]
const RELIEF_DEFAULT_IDX = 3
// Ferske kart får minst dette relieff-nivået («litt relieff») hvis relieffet er
// skrudd HELT av (idx 0) — så et globalt persistert «av» ikke gjør alle nye
// kart blast. Et bevisst lavt nivå (idx 1 = 0.18) respekteres.
const FRESH_RELIEF_MIN_IDX = 2
const STROKE_LS_KEY = 'svg-insights-mapview-stroke-step'
const RELIEF_LS_KEY = 'svg-insights-mapview-relief-step'

function loadKnobStep(key, def, len) {
  try {
    const v = parseInt(localStorage.getItem(key), 10)
    if (Number.isInteger(v) && v >= 0 && v < len) return v
  } catch { /* noop */ }
  return def
}
// Kartstørrelse-basis: 1 km → 1.0, 10 km → 0.4 (lineær mellom). Klam utenfor.
// Gjør at samme knott-hakk gir tynnere streker på store kart der konturene
// ligger tett, så maks ikke blir et svart rot og default matcher ~1 km-følelsen.
function strokeSizeBase(widthM) {
  if (!Number.isFinite(widthM) || widthM <= 0) return 1
  const t = Math.min(1, Math.max(0, (widthM - 1000) / 9000))
  return 1 - 0.6 * t
}
const strokeStepIndex = ref(loadKnobStep(STROKE_LS_KEY, STROKE_DEFAULT_IDX, STROKE_STEPS.length))
const reliefStepIndex = ref(loadKnobStep(RELIEF_LS_KEY, RELIEF_DEFAULT_IDX, RELIEF_STEPS.length))
const strokeScale = computed(() => STROKE_STEPS[strokeStepIndex.value] * strokeSizeBase(meta.value?.widthM))
const reliefOpacity = computed(() => RELIEF_STEPS[reliefStepIndex.value])
const strokeFrac = computed(() => strokeStepIndex.value / (STROKE_STEPS.length - 1))
const reliefFrac = computed(() => reliefStepIndex.value / (RELIEF_STEPS.length - 1))

// Gauge-geometri: 270° sveip med gap nederst, i et 24×24 viewBox.
const KNOB_R = 8.5
function knobPolar(deg, r) {
  const a = deg * Math.PI / 180
  return [12 + r * Math.cos(a), 12 + r * Math.sin(a)]
}
function knobArc(frac, r = KNOB_R) {
  if (frac <= 0) return ''
  const sweep = 270 * frac
  const [x0, y0] = knobPolar(135, r)
  const [x1, y1] = knobPolar(135 + sweep, r)
  const large = sweep > 180 ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}
const knobTrackD = knobArc(1)
const strokeArcD = computed(() => knobArc(strokeFrac.value))
const reliefArcD = computed(() => knobArc(reliefFrac.value))
// Senter-strek tegnes i faktisk valgt tykkelse — selv-demonstrerende ikon.
const strokeGlyphW = computed(() => (0.9 + 3.0 * strokeFrac.value).toFixed(2))
const reliefGlyphOpacity = computed(() => (0.18 + 0.7 * reliefFrac.value).toFixed(2))

// Transient hint-boble ved justering.
const knobHint = ref('')
let knobHintTimer = null
function flashKnobHint(text) {
  knobHint.value = text
  if (knobHintTimer) clearTimeout(knobHintTimer)
  knobHintTimer = setTimeout(() => { knobHint.value = '' }, 1500)
}

function applyStrokeScale() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (svg) svg.style.setProperty('--stroke-scale', String(strokeScale.value))
}

watch(strokeStepIndex, () => {
  applyStrokeScale()
  try { localStorage.setItem(STROKE_LS_KEY, String(strokeStepIndex.value)) } catch { /* noop */ }
  flashKnobHint(`Strek ${strokeScale.value.toFixed(2)}×`)
})
watch(reliefStepIndex, () => {
  applyHillshade()
  try { localStorage.setItem(RELIEF_LS_KEY, String(reliefStepIndex.value)) } catch { /* noop */ }
  flashKnobHint(reliefOpacity.value === 0 ? 'Relieff av' : `Relieff ${Math.round(reliefOpacity.value * 100)}%`)
})

// Tap = step (wrap), lang-trykk (500 ms) = nullstill til default.
// `knobSettled` gjør at ett trykk gir nøyaktig ett hakk: et avsluttet trykk
// (committet step ELLER lang-trykk-reset) markeres settled, så et nytt
// avsluttende event ikke kan telle om igjen.
let knobTimer = null
let knobSettled = true
function knobDown(kind) {
  knobSettled = false
  if (knobTimer) clearTimeout(knobTimer)
  knobTimer = setTimeout(() => {
    knobSettled = true   // lang-trykk konsumerer trykket → ingen step ved release
    if (kind === 'stroke') strokeStepIndex.value = STROKE_DEFAULT_IDX
    else reliefStepIndex.value = RELIEF_DEFAULT_IDX
  }, 500)
}
// Bindes til BÅDE pointerup og pointercancel. Enkelte mobil-nettlesere
// (sett på Samsung Internet) sender `pointercancel` i stedet for `pointerup`
// når knappen krymper via `active:scale-95`. Da knobCancel bare ryddet timeren
// uten å telle, ble trykket «mistet» — reliefknotten hoppet over et hakk og
// tok det igjen ved neste trykk (tellefeilen). `knobSettled`-vakten gjør
// committen idempotent, så pointerup + pointercancel aldri teller dobbelt.
function knobUp(kind) {
  if (knobTimer) { clearTimeout(knobTimer); knobTimer = null }
  if (knobSettled) return
  knobSettled = true
  if (kind === 'stroke') strokeStepIndex.value = (strokeStepIndex.value + 1) % STROKE_STEPS.length
  else reliefStepIndex.value = (reliefStepIndex.value + 1) % RELIEF_STEPS.length
}

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
const mapTransformStyle = computed(() => {
  // v8.10.4 — Perf: will-change: transform under aktiv gest/anim hinter til
  // browseren at en composited layer skal opprettes for kart-divet, så
  // transform-oppdateringer skjer på GPU uten å trigge layout/paint av
  // SVG-content. Settes tilbake til 'auto' i hvile så vi ikke holder
  // GPU-memory unødvendig i bakgrunnen.
  const active = (isGesturing && isGesturing.value) || animating.value
  return {
    transform: `translate(${translateX.value}px, ${translateY.value}px) `
             + `rotate(${rotation.value}deg) scale(${scale.value})`,
    transformOrigin: '0 0',
    transition: animating.value ? 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
    willChange: active ? 'transform' : 'auto',
  }
})

const userPos = useUserPosition(() => meta.value)
const compass = useCompass()

// Annoteringsmodus — point-symboler over auto-generert kart
const mapId = computed(() => route.params.id ?? 'vardasen')
const annot = useMapAnnotations(mapId.value)
const showSymbolPalette = ref(false)
let lastSvgString = ''      // huskes til print-eksport

// Søk i kart — bygger indeks etter map-load, viser dropdown med treff og
// sentrerer på valgte stedsnavn. Highlight-ringen sitter til brukeren tømmer
// søket eller scroller bort.
const mapSearch = useMapSearch()
// Destrukturér refs så template auto-unwrapper dem (Vue auto-unwrapper kun
// top-level setup-refs, ikke properties på ett objekt).
const searchQuery = mapSearch.query
const searchResults = mapSearch.results
const searchIndex = mapSearch.index
const searchOpen = ref(false)
const highlightedFeature = ref(null)   // { name, x, y, kind } eller null

function openSearch() {
  searchOpen.value = true
  closeDrawer()
  // Fokuser input etter at Transition har latt elementet bli mountet
  nextTick(() => { searchInputRef.value?.focus() })
}
function closeSearch() {
  searchOpen.value = false
  mapSearch.clear()
}
function clearHighlight() {
  highlightedFeature.value = null
  renderHighlight()
}
function selectSearchResult(r) {
  highlightedFeature.value = { name: r.name, x: r.x, y: r.y, kind: r.kind }
  // Et navn som velges i søk skal alltid være synlig, selv om navn-LOD-en
  // hadde skjult det i oversikten. Lås det til synlig (til neste rebuild).
  if (r.el) {
    forcedVisibleNameEls.add(r.el)
    r.el.classList.remove('name-lod-off')
  }
  if (meta.value) {
    panTo(r.x, r.y, { vbWidth: meta.value.widthM, vbHeight: meta.value.heightM, targetScale: Math.max(scale.value, 2.5) })
  }
  searchOpen.value = false
  mapSearch.clear()
  renderHighlight()
}

// ── «Nærmeste …»-snarveier (parkering / toalett / holdeplass) ─────────────
// Highlighter samme rosa puls-ring som et fritekstsøk-treff, men finner
// nærmeste POI av en gitt type RELATIVT til long-press-punktet (PUNKT-arket).
// Et generelt søk gir ikke mening her — «nærmeste» må ha et referansepunkt.
const POI_KINDS = {
  parkering:  { label: 'Nærmeste parkering',  selector: '[data-layer="parkering"] g[transform]' },
  toalett:    { label: 'Nærmeste toalett',    selector: '[data-layer="sjo-poi"] g[data-iso="554"]' },
  holdeplass: { label: 'Nærmeste holdeplass', selector: '[data-layer="holdeplass"] g[transform]' },
}

// Antall POI pr type i det lastede kartet — styrer om snarvei-knappen er
// aktiv eller grået ut. Beregnes når SVG-en er lastet (kartet endrer seg ikke
// etterpå utenom highlight/spor-overlays).
const poiCounts = ref({ parkering: 0, toalett: 0, holdeplass: 0 })
function computePoiAvailability() {
  const svg = svgHostRef.value?.querySelector('svg')
  const next = { parkering: 0, toalett: 0, holdeplass: 0 }
  if (svg) {
    for (const kind of Object.keys(POI_KINDS)) {
      next[kind] = svg.querySelectorAll(POI_KINDS[kind].selector).length
    }
  }
  poiCounts.value = next
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

// Finn + highlight nærmeste POI av `kind` relativt til (ox, oy) i viewBox-meter.
function nearestPoi(kind, ox, oy) {
  const cfg = POI_KINDS[kind]
  const svg = svgHostRef.value?.querySelector('svg')
  if (!cfg || !svg || !meta.value || ox == null || oy == null) return

  let best = null, bestD2 = Infinity
  for (const el of svg.querySelectorAll(cfg.selector)) {
    const m = (el.getAttribute('transform') || '').match(/translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/)
    if (!m) continue
    const x = parseFloat(m[1]), y = parseFloat(m[2])
    const d2 = (x - ox) ** 2 + (y - oy) ** 2
    if (d2 < bestD2) { bestD2 = d2; best = { x, y, el } }
  }
  if (!best) return   // knappen er uansett grået ut når kartet mangler typen

  const name = best.el.getAttribute('data-name')
  const distLabel = fmtDist(Math.sqrt(bestD2))
  // To-linjers chip: stedsnavnet (om det finnes) på linje 1, type + avstand
  // fra markert punkt på linje 2. Uten navn løftes typen til linje 1.
  highlightedFeature.value = name
    ? { name, sub: `${cfg.label} · ${distLabel}`, x: best.x, y: best.y, kind }
    : { name: cfg.label, sub: `${distLabel} fra punktet`, x: best.x, y: best.y, kind }
  panTo(best.x, best.y, { vbWidth: meta.value.widthM, vbHeight: meta.value.heightM, targetScale: Math.max(scale.value, 2.5) })
  renderHighlight()
}

// Fra PUNKT-arket: nærmeste relativt til long-press-punktet, så lukk arket.
function nearestPoiFromPoint(kind) {
  const p = contextMenuPoint.value
  if (!p || !poiCounts.value[kind]) return
  nearestPoi(kind, p.svgX, p.svgY)
  closeContextMenu()
}

// ── Navn-LOD: skjul overflødige stedsnavn i tett-befolkede utsnitt ─────────
// Når et synlig kartutsnitt inneholder mer enn NAME_LOD_BUDGET søkbare navn,
// skjules de minst prioriterte. Vann/elver/bekker og «store» stedsnavn (by/
// tettsted) prioriteres og skjules aldri av denne mekanismen. Alle navn
// forblir søkbare — et treff som velges i søk tvinges synlig (over).
//
// Hensikten er ren ytelse/lesbarhet: ved innzooming krymper det synlige
// utsnittet, færre navn faller innenfor, og flere vises automatisk.
const NAME_LOD_BUDGET = 200
const forcedVisibleNameEls = new Set()
let nameLodTimer = null

// Prioritet: 0 = vises alltid (vann + store stedsnavn), høyere = skjules først.
function namePriority(entry) {
  if (entry.kind === 'vann-navn') return 0
  if (entry.categories && entry.categories.includes('vann')) return 0
  if (entry.kind === 'stedsnavn') {
    const rank = entry.el?.getAttribute('data-rank')
    if (rank === 'major') return 0
    if (rank === 'mid') return 1
    return 4              // grend/gård — minst viktig
  }
  if (entry.kind === 'peak') return 2
  return 3                // omrade-navn, hytte-navn, naturreservat-navn
}

function applyNameLOD() {
  const svg = svgHostRef.value?.querySelector('svg')
  const m = meta.value
  const idx = mapSearch.index.value
  if (!svg || !m || !idx || !idx.length) return
  const wrap = wrapperRef.value?.getBoundingClientRect()
  if (!wrap || !wrap.width || !wrap.height) return

  // Forward-transform viewBox-koordinat → wrapper-lokal skjermpiksel, samme
  // matte som usePinchZoom.panTo: SVG-en fyller wrapperen med
  // preserveAspectRatio="xMidYMid meet", deretter T(tx,ty)∘R(rot)∘S(s).
  const w = wrap.width, h = wrap.height
  const fit = Math.min(w / m.widthM, h / m.heightM)
  const offX = (w - m.widthM * fit) / 2
  const offY = (h - m.heightM * fit) / 2
  const s = scale.value || 1
  const rot = (rotation.value || 0) * Math.PI / 180
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const tx = translateX.value, ty = translateY.value
  const MARGIN = 80   // px slingringsmonn så navn rett utenfor kanten teller med

  const priority = []
  const reducible = []
  for (const e of idx) {
    if (!e.el) continue   // unavngitte vann-polygoner har ingen tekst å toggle
    const px = offX + e.x * fit
    const py = offY + e.y * fit
    const sx = tx + s * (px * cos - py * sin)
    const sy = ty + s * (px * sin + py * cos)
    if (sx < -MARGIN || sx > w + MARGIN || sy < -MARGIN || sy > h + MARGIN) {
      continue   // utenfor synlig utsnitt — teller ikke, rør ikke klassen
    }
    if (namePriority(e) === 0) priority.push(e)
    else reducible.push(e)
  }

  // Prioriterte vises alltid. Resten fyller opp til budsjettet, sortert etter
  // viktighet (så samme navn holder seg synlig mellom re-beregninger).
  reducible.sort((a, b) => namePriority(a) - namePriority(b) || a.name.localeCompare(b.name, 'no'))
  const budget = Math.max(0, NAME_LOD_BUDGET - priority.length)
  for (const e of priority) e.el.classList.remove('name-lod-off')
  reducible.forEach((e, i) => {
    const show = i < budget || forcedVisibleNameEls.has(e.el)
    e.el.classList.toggle('name-lod-off', !show)
  })
}

function scheduleNameLOD() {
  if (nameLodTimer) clearTimeout(nameLodTimer)
  nameLodTimer = setTimeout(applyNameLOD, 120)
}

// Re-beregn LOD når utsnittet endrer seg (zoom/pan/rotasjon, gest eller
// programmatisk). Debouncet så en pågående gest ikke beregner per frame.
watch([scale, translateX, translateY, rotation], scheduleNameLOD)

// Pulsering tegnes som SVG-circle i et eget overlay-lag, lik annoteringer.
// Holder konstant skjerm-størrelse ved å konvertere CSS-px til user-units via
// scale.value.
function renderHighlight() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const ns = 'http://www.w3.org/2000/svg'
  let layer = svg.querySelector('#search-highlight-layer')
  const h = highlightedFeature.value
  if (!h || curveball.active.value) {
    if (layer) layer.remove()
    return
  }
  if (!layer) {
    layer = document.createElementNS(ns, 'g')
    layer.setAttribute('id', 'search-highlight-layer')
    layer.setAttribute('data-layer', 'search-highlight')
    layer.setAttribute('pointer-events', 'none')
    svg.appendChild(layer)
  }
  layer.replaceChildren()
  const r1 = pxToUserUnits(18)
  const r2 = pxToUserUnits(34)
  const sw = pxToUserUnits(2.5)

  // Indre ring — solid stroke, sterk farge
  const inner = document.createElementNS(ns, 'circle')
  inner.setAttribute('cx', h.x); inner.setAttribute('cy', h.y)
  inner.setAttribute('r', r1)
  inner.setAttribute('fill', 'rgba(244, 114, 182, 0.18)')
  inner.setAttribute('stroke', '#f472b6')
  inner.setAttribute('stroke-width', String(sw))
  layer.appendChild(inner)

  // Ytre puls-ring — SMIL-animasjon, ekspanderer + fader
  const pulse = document.createElementNS(ns, 'circle')
  pulse.setAttribute('cx', h.x); pulse.setAttribute('cy', h.y)
  pulse.setAttribute('r', String(r1))
  pulse.setAttribute('fill', 'none')
  pulse.setAttribute('stroke', '#f472b6')
  pulse.setAttribute('stroke-width', String(sw))
  pulse.setAttribute('opacity', '0.8')
  const anR = document.createElementNS(ns, 'animate')
  anR.setAttribute('attributeName', 'r')
  anR.setAttribute('values', `${r1};${r2}`)
  anR.setAttribute('dur', '1.4s')
  anR.setAttribute('repeatCount', 'indefinite')
  pulse.appendChild(anR)
  const anO = document.createElementNS(ns, 'animate')
  anO.setAttribute('attributeName', 'opacity')
  anO.setAttribute('values', '0.85;0')
  anO.setAttribute('dur', '1.4s')
  anO.setAttribute('repeatCount', 'indefinite')
  pulse.appendChild(anO)
  layer.appendChild(pulse)
}

// Hold ringen på konstant skjerm-størrelse ved zoom. Re-render ved tema-/
// spillmodus-bytte.
watch(scale, () => { if (highlightedFeature.value) renderHighlight() })
watch(() => curveball.active.value, () => renderHighlight())

// ── Share-flow ────────────────────────────────────────────────────────────
// Bygger URL som tar mottaker til samme kart-utsnitt. Built-in kart pekes
// direkte på /kart/:id; brukers egne kart deles som /kart/nytt?lat=&km=&eq=
// så mottaker selv kan generere sin lokale kopi (SVG-en bor i IndexedDB
// hos sender). Optional ?hl=<navn> sender med highlight-ønsket.
const shareInfo = computed(() => {
  if (!meta.value) return null
  const m = meta.value
  const lat = (m.bbox.south + m.bbox.north) / 2
  const lon = (m.bbox.west + m.bbox.east) / 2
  const sizeKm = m.widthM ? +(m.widthM / 1000).toFixed(2) : 4
  const equidistanceM = m.equidistance ?? 20
  return { lat, lon, sizeKm, equidistanceM }
})

function buildShareUrl() {
  if (!shareInfo.value) return null
  const base = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`
  const id = route.params.id ?? 'vardasen'
  const isBuiltin = !!BUILTIN[id]
  const hl = highlightedFeature.value?.name ?? ''
  const params = new URLSearchParams()
  if (isBuiltin) {
    // Built-in: del direkte view-URL — mottaker ser nøyaktig samme kart.
    if (hl) params.set('hl', hl)
    const qs = params.toString()
    return `${base}/kart/${id}${qs ? `?${qs}` : ''}`
  }
  // Stored map: del bbox + ekvidistanse. Mottaker lander i picker som
  // pre-populerer feltene; etter generering navigeres til MapView med ?hl=.
  const s = shareInfo.value
  params.set('lat', s.lat.toFixed(5))
  params.set('lon', s.lon.toFixed(5))
  params.set('km', String(s.sizeKm))
  params.set('eq', String(s.equidistanceM))
  if (hl) params.set('hl', hl)
  return `${base}/kart/nytt?${params.toString()}`
}

const shareState = ref('idle')  // idle | sharing | copied | error
let shareResetTimer = null

async function onShareMap() {
  const url = buildShareUrl()
  if (!url) return
  const shareData = {
    title: mapTitle.value || 'SVG Insights — turkart',
    text: highlightedFeature.value?.name
      ? `${mapTitle.value} — markering: ${highlightedFeature.value.name}`
      : mapTitle.value,
    url,
  }
  // navigator.share åpner native iOS/Android-dialog der brukeren velger
  // app (Meldinger, WhatsApp, Mail, AirDrop osv). canShare() finnes på
  // moderne browsere men ikke alltid — try/catch dekker resten.
  if (typeof navigator.share === 'function') {
    shareState.value = 'sharing'
    try {
      if (typeof navigator.canShare === 'function' && !navigator.canShare(shareData)) {
        throw new Error('share-data-rejected')
      }
      await navigator.share(shareData)
      shareState.value = 'idle'
      return
    } catch (err) {
      // AbortError = bruker lukket sheet — det er ikke en feil
      if (err && err.name === 'AbortError') {
        shareState.value = 'idle'
        return
      }
      // Fall through til clipboard-fallback under
    }
  }
  // Fallback: kopier til utklippstavle. Brukes på desktop (uten share-sheet)
  // og når native share-API ikke aksepterer data (sjeldne tilfeller).
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
    } else {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    shareState.value = 'copied'
  } catch {
    shareState.value = 'error'
  }
  if (shareResetTimer) clearTimeout(shareResetTimer)
  shareResetTimer = setTimeout(() => { shareState.value = 'idle' }, 2200)
}

function maybeHighlightFromQuery() {
  const hl = route.query.hl
  if (!hl) return
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const match = findByName(mapSearch.index.value, String(hl))
  if (!match) return
  highlightedFeature.value = { name: match.name, x: match.x, y: match.y, kind: match.kind }
  if (meta.value) {
    panTo(match.x, match.y, { vbWidth: meta.value.widthM, vbHeight: meta.value.heightM, targetScale: 2.5 })
  }
  renderHighlight()
}

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

// Relieff-blend velges per tema: lyse bakgrunner mørkner naturlig med
// `multiply`, mens mørke/art-tema (Curves) får `screen` så terrenget lyser
// opp bak konturene istedenfor å drukne i multiply-gjørme.
function hexLuminance(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex ?? '')
  if (!m) return 1
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
function reliefBlendMode() {
  const bg = isomCatalog.themes?.[currentTheme.value]?.background
  return hexLuminance(bg) < 0.4 ? 'screen' : 'multiply'
}

async function applyHillshade() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg || !meta.value) return
  // v9.1.13: knaus er nå malt inn i hillshade-bildet (ett relieff-lag). Rydd
  // vekk et evt. gammelt separat knaus-lag fra tidligere klient-versjoner.
  svg.querySelector('#knaus-relief-layer')?.remove()
  const wantOn = reliefOpacity.value > 0
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
    // v9.1.17: ren hillshade. Knaus er flyttet tilbake til en vektor-<path>
    // i selve kart-SVG-en (mapBuilder, ISOM 213) — knivskarp og billig — så
    // relieff-bildet skygger nå kun terreng.
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
    img.setAttribute('pointer-events', 'none')
    img.setAttribute('image-rendering', 'auto')
  }
  if (insertBefore) svg.insertBefore(img, insertBefore)
  else svg.appendChild(img)
  img.setAttribute('x', '0'); img.setAttribute('y', '0')
  img.setAttribute('width', String(meta.value.widthM))
  img.setAttribute('height', String(meta.value.heightM))
  img.setAttribute('href', cachedHillshadeUrl)
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', cachedHillshadeUrl)
  // Styrt av relieff-knotten: opacity fra valgt nivå, blend per tema.
  img.setAttribute('opacity', String(reliefOpacity.value))
  img.style.mixBlendMode = reliefBlendMode()
}

// Re-render relieffet når DEM-en lastes eller temaet byttes (blend-modus
// avhenger av tema). Selve nivå-endringer håndteres av reliefStepIndex-watch.
watch([storedDem, currentTheme], () => { applyHillshade() })

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

// ── Long-press kontekstmeny ──────────────────────────────────────────────
// Long-press (~550ms hold uten bevegelse) eller høyreklikk på kartet åpner
// en bottom-sheet med koordinater, stedsinfo og handlinger (kopier, del,
// start måling, åpne i Google Maps/Street View, plasser annotering).
//
// Implementasjon: vi binder pointer-events på wrapperRef. Pinch-zoom binder
// touch-events (touchstart/move/end) via egne addEventListener, så de to
// håndterer-settene konkurrerer ikke. Vi sporer kun primær-pointer'en og
// avbryter timeren ved bevegelse (>10 px) eller en sekundær pointer (pinch).
const contextMenuOpen = ref(false)
const contextMenuPoint = ref(null)     // { svgX, svgY, clientX, clientY }
const contextSheetRef = ref(null)      // bottom-sheet-elementet (for into-focus)
const detailInsetRef = ref(null)       // mini-SVG detalj-inset i bottom-sheeten
const DETAIL_INSET_M = 1000            // 1×1 km roambart vindu rundt punktet
const LONG_PRESS_MS = 550
const LONG_PRESS_MOVE_PX = 10

let lpTimer = null
let lpPointerId = null
let lpStartX = 0
let lpStartY = 0
let lpEvent = null      // siste pointerdown-event så vi kan re-projisere ved fire

function clearLongPress() {
  if (lpTimer) { clearTimeout(lpTimer); lpTimer = null }
  lpPointerId = null
  lpEvent = null
}

function clientToSvgPoint(clientX, clientY) {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return null
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  return pt.matrixTransform(ctm.inverse())
}

function openContextMenuAt(clientX, clientY) {
  // Long-press skal være no-op mens spillet kjører, mens et annet overlay (søk,
  // on-the-fly) eier UI-en, eller mens et ferskt kart fortsatt fyller inn detaljer
  // (detalj-insetet ville ellers vist halvbygd data).
  if (curveball.active.value || buildingOnTheFly.value || searchOpen.value ||
      fillingInDetails.value) return
  const local = clientToSvgPoint(clientX, clientY)
  if (!local) return
  contextMenuPoint.value = {
    svgX: local.x, svgY: local.y,
    clientX, clientY,
  }
  contextMenuOpen.value = true
  closeDrawer()
  // v9.3.3: INGEN auto-pan av hovedkartet. Brukeren har allerede plassert/
  // zoomet/rotert kartet slik de vil — å flytte det ved long-press var
  // forvirrende og ødela oversikten. Punktet vises i pin + detalj-inset.
}

function closeContextMenu() {
  contextMenuOpen.value = false
  contextMenuPoint.value = null
  contextActionState.value = 'idle'
}

function onPointerDownLongPress(e) {
  // Kun primær single-pointer. Hvis en annen pointer allerede er aktiv (pinch),
  // avbryt timeren — det er en gest, ikke en long-press.
  if (lpPointerId != null) { clearLongPress(); return }
  // Ignorer høyreklikk her — den håndteres av contextmenu-eventet (som også
  // gir oss preventDefault på native browsermenyen).
  if (e.pointerType === 'mouse' && e.button !== 0) return
  // Ignorer tap inne på interaktive UI-elementer (knapper, drawer-håndtak).
  if (e.target.closest('button, input, textarea, select, a')) return
  lpPointerId = e.pointerId
  lpStartX = e.clientX
  lpStartY = e.clientY
  lpEvent = { clientX: e.clientX, clientY: e.clientY }
  lpTimer = setTimeout(() => {
    if (lpEvent) openContextMenuAt(lpEvent.clientX, lpEvent.clientY)
    clearLongPress()
  }, LONG_PRESS_MS)
}
function onPointerMoveLongPress(e) {
  if (lpPointerId == null || e.pointerId !== lpPointerId) return
  const dx = e.clientX - lpStartX
  const dy = e.clientY - lpStartY
  if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) clearLongPress()
}
function onPointerUpLongPress(e) {
  if (lpPointerId != null && e.pointerId === lpPointerId) clearLongPress()
}
function onContextMenuEvent(e) {
  // Høyreklikk på desktop. preventDefault stopper browser-menyen.
  if (curveball.active.value) return
  e.preventDefault()
  openContextMenuAt(e.clientX, e.clientY)
}

// Info-utregning når menyen er åpen. Cachet via computed slik at en åpen meny
// ikke re-evaluerer på hver pinch (kun når contextMenuPoint, searchIndex eller
// DEM endrer seg).
const contextMenuInfo = computed(() => {
  const p = contextMenuPoint.value
  if (!p || !meta.value) return null
  const m = meta.value
  // Klamp til kart-bounds — long-press kan treffe utenfor SVG-content
  // pga letterboxing ved bredt aspekt-ratio.
  const inside = p.svgX >= 0 && p.svgX <= m.widthM && p.svgY >= 0 && p.svgY <= m.heightM
  const { lat, lon } = svgToWgs84(p.svgX, p.svgY, m)
  const ele = (storedDem.value && inside)
    ? sampleElevation(storedDem.value, p.svgX, p.svgY)
    : NaN

  const place = inside ? findNearestPlace(mapSearch.index.value, p.svgX, p.svgY) : null

  // NB: «nærmeste sti/vei»-utregningen er bevisst fjernet (v9.1.22).
  // findNearestPath sampler hver path i sti/vei/bekk-lagene med
  // getPointAtLength — en synkron, layout-tvingende operasjon som blokkerte
  // hovedtråden i sekunder på den ekte (CI-bygde) Vardåsen og frøs store
  // bruker-kart helt. Informasjonen er uansett synlig direkte på kartet.

  // Avstand fra brukerens GPS-posisjon (kun synlig når GPS-en er aktiv
  // og brukeren er på kartet). Retning fra meg → punktet.
  let fromUser = null
  if (userPos.isWatching && userPos.svgX != null && userPos.svgY != null) {
    const dx = p.svgX - userPos.svgX
    const dy = p.svgY - userPos.svgY
    const distM = Math.hypot(dx, dy)
    const deg = bearingDeg(userPos.svgX, userPos.svgY, p.svgX, p.svgY)
    fromUser = { distM, deg, compass: bearingToCompass(deg) }
  }

  return {
    lat, lon, inside,
    elevationM: Number.isFinite(ele) ? ele : null,
    place,
    fromUser,
  }
})

const contextActionState = ref('idle')   // 'idle' | 'copied' | 'failed'
let contextActionTimer = null
function flashContextAction(state) {
  contextActionState.value = state
  if (contextActionTimer) clearTimeout(contextActionTimer)
  contextActionTimer = setTimeout(() => { contextActionState.value = 'idle' }, 1400)
}

function gmapsUrl(lat, lon) { return `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}` }
function streetViewUrl(lat, lon) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`
}

async function onCopyCoords() {
  const info = contextMenuInfo.value
  if (!info) return
  const text = `${info.lat.toFixed(6)}, ${info.lon.toFixed(6)}`
  try {
    await navigator.clipboard.writeText(text)
    flashContextAction('copied')
  } catch { flashContextAction('failed') }
}
async function onShareCoords() {
  const info = contextMenuInfo.value
  if (!info) return
  const url = gmapsUrl(info.lat, info.lon)
  const shareData = {
    title: 'Posisjon',
    text: `${info.lat.toFixed(6)}, ${info.lon.toFixed(6)}`,
    url,
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(shareData)
      return
    } catch (err) {
      if (err && err.name === 'AbortError') return
      // Fall gjennom til clipboard-fallback
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    flashContextAction('copied')
  } catch { flashContextAction('failed') }
}
function onStartMeasureHere() {
  const p = contextMenuPoint.value
  if (!p) return
  // Bytt til Måling-fanen så brukeren ser hva som skjer videre, åpne drawer
  // og legg første vertex på long-press-punktet.
  startMeasure()
  measureVertices.value = [{ x: p.svgX, y: p.svgY }]
  activeTab.value = 'maaling'
  closeContextMenu()
  openDrawer()
}
function onOpenGoogleMaps() {
  const info = contextMenuInfo.value
  if (!info) return
  window.open(gmapsUrl(info.lat, info.lon), '_blank', 'noopener')
}
function onOpenStreetView() {
  const info = contextMenuInfo.value
  if (!info) return
  window.open(streetViewUrl(info.lat, info.lon), '_blank', 'noopener')
}
function onPlaceAnnotationFromContext(symbolKey) {
  const p = contextMenuPoint.value
  const sym = ANNOTATION_SYMBOLS.find(s => s.symbolKey === symbolKey)
  if (!p || !sym) return
  annot.addPoint(sym.code, p.svgX, p.svgY)
  annot.persist()
  closeContextMenu()
}

// Tilgjengelighet pr handling. Sporing eller måling pågår → noen valg er
// blokkert (Start måling her, Plasser annotering — disse ville kollidere
// med den pågående modusen).
const ctxBusy = computed(() => measureMode.value || tracker.isRecording.value)
const ctxCanMeasure = computed(() => !ctxBusy.value)
const ctxCanAnnotate = computed(() => {
  const isBuiltin = (route.params.id ?? 'vardasen').startsWith('vardasen')
  return !isBuiltin && !ctxBusy.value
})

// Pin på long-press-punktet — vises i et eget SVG-lag mens menyen er åpen,
// så brukeren ser hvor handlingen utføres. Re-rendres ved zoom (skjerm-
// konstant størrelse) og når punktet endres.
function renderContextPin() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const ns = 'http://www.w3.org/2000/svg'
  let layer = svg.querySelector('#contextmenu-pin-layer')
  const p = contextMenuPoint.value
  if (!p || !contextMenuOpen.value) {
    if (layer) layer.remove()
    return
  }
  if (!layer) {
    layer = document.createElementNS(ns, 'g')
    layer.setAttribute('id', 'contextmenu-pin-layer')
    layer.setAttribute('data-layer', 'contextmenu-pin')
    layer.setAttribute('pointer-events', 'none')
    svg.appendChild(layer)
  }
  layer.replaceChildren()
  const r1 = pxToUserUnits(8)
  const r2 = pxToUserUnits(18)
  const sw = pxToUserUnits(2)
  // Solid kjerne
  const core = document.createElementNS(ns, 'circle')
  core.setAttribute('cx', p.svgX); core.setAttribute('cy', p.svgY)
  core.setAttribute('r', r1)
  core.setAttribute('fill', '#0ea5e9')
  core.setAttribute('stroke', '#fff')
  core.setAttribute('stroke-width', String(sw))
  layer.appendChild(core)
  // Pulserende ring
  const pulse = document.createElementNS(ns, 'circle')
  pulse.setAttribute('cx', p.svgX); pulse.setAttribute('cy', p.svgY)
  pulse.setAttribute('r', String(r1))
  pulse.setAttribute('fill', 'none')
  pulse.setAttribute('stroke', '#0ea5e9')
  pulse.setAttribute('stroke-width', String(sw))
  const anR = document.createElementNS(ns, 'animate')
  anR.setAttribute('attributeName', 'r')
  anR.setAttribute('values', `${r1};${r2}`)
  anR.setAttribute('dur', '1.4s'); anR.setAttribute('repeatCount', 'indefinite')
  pulse.appendChild(anR)
  const anO = document.createElementNS(ns, 'animate')
  anO.setAttribute('attributeName', 'opacity')
  anO.setAttribute('values', '0.85;0')
  anO.setAttribute('dur', '1.4s'); anO.setAttribute('repeatCount', 'indefinite')
  pulse.appendChild(anO)
  layer.appendChild(pulse)
}
watch([contextMenuOpen, contextMenuPoint, scale], renderContextPin)
watch(() => curveball.active.value, () => { if (curveball.active.value) closeContextMenu() })

// ── Long-press detalj-inset ──────────────────────────────────────────────
// Et 150×150 m utsnitt rundt long-press-punktet, rendret som et eget lite
// SVG i bottom-sheeten. Her skrur vi PÅ de skjulte detalj-lagene
// (data-detail="1": dybdepunkt-soundings + dybdekurver) som er for tette på
// hovedkartet. Fungerer uten GPS og uten manuell toggle — KISS. Bygges når
// sheeten åpnes; kloner kart-innholdet og setter viewBox til utsnittet.
function buildDetailInset() {
  const host = detailInsetRef.value
  if (!host) return
  host.replaceChildren()
  const src = svgHostRef.value?.querySelector('svg')
  const p = contextMenuPoint.value
  if (!src || !p) return
  const ns = 'http://www.w3.org/2000/svg'

  const svg = document.createElementNS(ns, 'svg')
  // viewBox settes av attachInsetPanZoom (start: 250×250 m sentrert = 25 %
  // av det 500 m roambare vinduet).
  svg.setAttribute('xmlns', ns)
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  svg.setAttribute('class', 'isom-map')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.style.touchAction = 'none'   // vi håndterer pan/zoom selv

  // Klon kart-innholdet (hopp over GPS-/pin-overlays).
  for (const child of Array.from(src.childNodes)) {
    if (child.nodeType === 1) {
      const id = child.getAttribute && child.getAttribute('id')
      if (id === 'user-layer' || id === 'contextmenu-pin-layer') continue
    }
    svg.appendChild(child.cloneNode(true))
  }

  // Skru PÅ de skjulte detalj-lagene + sørg for at sjø-POI vises i inset-en
  // uansett hovedkart-toggle, og at dybde-tall ikke er skjult av 'navn'-av.
  for (const g of svg.querySelectorAll('[data-detail="1"], [data-layer="sjo-poi"]')) {
    g.style.display = ''
    for (const el of g.querySelectorAll('*')) el.style.display = ''
  }

  // Vis ALLE navn i inset-en (på land er det rikelig plass ved denne zoomen):
  // overstyr både 'navn'-toggelen, stedsnavn-lagene og navn-LOD-en som ellers
  // skjuler overlappende stedsnavn på hovedkartet. Inset-en er en detalj-lupe
  // — her vil brukeren se alt som finnes.
  for (const g of svg.querySelectorAll('[data-layer="navn"], [data-layer^="stedsnavn"]')) {
    g.style.display = ''
  }
  for (const el of svg.querySelectorAll('[data-label]')) {
    el.style.display = ''
  }

  // Fadenkreuz på senterpunktet (samme posisjon som long-press-pin-en).
  const cross = document.createElementNS(ns, 'g')
  cross.setAttribute('pointer-events', 'none')
  const r = 6  // meter
  const mk = (d) => {
    const ln = document.createElementNS(ns, 'path')
    ln.setAttribute('d', d)
    ln.setAttribute('stroke', '#e11d48')
    ln.setAttribute('stroke-width', '1.4')
    ln.setAttribute('fill', 'none')
    ln.setAttribute('stroke-linecap', 'round')
    return ln
  }
  cross.appendChild(mk(`M${p.svgX - r},${p.svgY} L${p.svgX + r},${p.svgY}`))
  cross.appendChild(mk(`M${p.svgX},${p.svgY - r} L${p.svgX},${p.svgY + r}`))
  const ring = document.createElementNS(ns, 'circle')
  ring.setAttribute('cx', p.svgX); ring.setAttribute('cy', p.svgY)
  ring.setAttribute('r', 3.2)
  ring.setAttribute('fill', 'none')
  ring.setAttribute('stroke', '#e11d48')
  ring.setAttribute('stroke-width', '1.2')
  cross.appendChild(ring)
  svg.appendChild(cross)

  host.appendChild(svg)
  const mapW = meta.value?.widthM ?? DETAIL_INSET_M
  const mapH = meta.value?.heightM ?? DETAIL_INSET_M
  attachInsetPanZoom(svg, p.svgX, p.svgY, mapW, mapH)
}

// viewBox-basert pan + zoom (ingen rotasjon) på detalj-inset-en. Et 500×500 m
// vindu sentrert på long-press-punktet er roambart; start-visningen er
// 250×250 m (= 25 % av arealet). Vektor-skarp ved enhver zoom siden vi
// manipulerer viewBox, ikke en CSS-transform.
function attachInsetPanZoom(svg, cx, cy, mapW, mapH) {
  const ASPECT = 3 / 2                   // matcher inset-boksen (aspect-[3/2])
  const WINDOW = DETAIL_INSET_M          // 1×1 km roambar utstrekning (m)
  const MIN_W = 40                       // maks zoom-inn (synlig bredde)
  // Alt D — kamera-clamp: den roambare regionen er snittet av 1 km-vinduet
  // rundt punktet OG de ekte kartgrensene (0…mapW × 0…mapH). Slik ser man
  // aldri tomrom utenfor kartet; nær en kant glir visningen innover og den
  // røde kart-rammen viser naturlig hvor kartet slutter.
  const rxMin = Math.max(0, cx - WINDOW / 2)
  const rxMax = Math.min(mapW, cx + WINDOW / 2)
  const ryMin = Math.max(0, cy - WINDOW / 2)
  const ryMax = Math.min(mapH, cy + WINDOW / 2)
  const regionW = Math.max(1, rxMax - rxMin)
  const regionH = Math.max(1, ryMax - ryMin)
  // Maks synlig bredde: fyll regionen, men hold 3:2-aspekt (ikke større enn
  // regionen i noen retning).
  const maxVw = () => Math.min(regionW, regionH * ASPECT)

  // Start-visning: ~350 m synlig bredde (god for å lese dybdetall),
  // capped til regionen ved kanten. Zoom ut til 1 km, inn til 40 m.
  let vw = Math.min(maxVw(), 350)
  let vh = vw / ASPECT
  let vx = cx - vw / 2, vy = cy - vh / 2

  const clampApply = () => {
    vw = Math.max(MIN_W, Math.min(maxVw(), vw))
    vh = vw / ASPECT
    vx = Math.max(rxMin, Math.min(rxMax - vw, vx))
    vy = Math.max(ryMin, Math.min(ryMax - vh, vy))
    svg.setAttribute('viewBox', `${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`)
  }
  clampApply()

  const rect = () => svg.getBoundingClientRect()
  const zoomAt = (factor, clientX, clientY) => {
    const r = rect()
    if (!r.width || !r.height) return
    const relX = (clientX - r.left) / r.width
    const relY = (clientY - r.top) / r.height
    const fx = vx + relX * vw
    const fy = vy + relY * vh
    vw = vw / factor; vh = vw / ASPECT
    vx = fx - relX * vw
    vy = fy - relY * vh
    clampApply()
  }
  const panBy = (dxPx, dyPx) => {
    const r = rect()
    if (!r.width || !r.height) return
    vx -= (dxPx / r.width) * vw
    vy -= (dyPx / r.height) * vh
    clampApply()
  }
  const tdist = (e) => Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY)
  const tcenter = (e) => ({
    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
    y: (e.touches[0].clientY + e.touches[1].clientY) / 2 })

  svg.addEventListener('wheel', (e) => {
    e.preventDefault()
    zoomAt(e.deltaY > 0 ? 1 / 1.12 : 1.12, e.clientX, e.clientY)
  }, { passive: false })

  let dragging = false, lastX = 0, lastY = 0, pinchDist = 0
  svg.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { pinchDist = tdist(e); dragging = false }
    else if (e.touches.length === 1) { dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY }
  }, { passive: false })
  svg.addEventListener('touchmove', (e) => {
    e.preventDefault()
    if (e.touches.length === 2) {
      const d = tdist(e)
      if (pinchDist > 0) { const c = tcenter(e); zoomAt(d / pinchDist, c.x, c.y) }
      pinchDist = d
    } else if (e.touches.length === 1 && dragging) {
      panBy(e.touches[0].clientX - lastX, e.touches[0].clientY - lastY)
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY
    }
  }, { passive: false })
  svg.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinchDist = 0
    if (e.touches.length < 1) dragging = false
  })

  // Mus: dra for å panorere.
  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return
    dragging = true; lastX = e.clientX; lastY = e.clientY
    try { svg.setPointerCapture(e.pointerId) } catch { /* noop */ }
  })
  svg.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerType !== 'mouse') return
    panBy(e.clientX - lastX, e.clientY - lastY)
    lastX = e.clientX; lastY = e.clientY
  })
  svg.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') dragging = false })
}

watch([contextMenuOpen, contextMenuPoint], async () => {
  if (!contextMenuOpen.value) return
  await nextTick()
  buildDetailInset()
})

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
  // Ingen kart-interaksjon mens et ferskt kart fyller inn detaljer.
  if (fillingInDetails.value) return
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

// Sørg for at annoterings-symbolenes <symbol id="iso-sym-X"> finnes i kart-
// SVG-ens <defs>. Nødvendig fordi mapBuilder (v9.1.10+) kun emitterer defs
// for symboler som faktisk BRUKES av auto-features i body — annoterings-
// symboler (knaus/stein/brønn/bro) plasseres klient-side og er typisk ikke
// auto-brukt, så <use href="#iso-sym-knaus"> fant ingenting (kun stedsmerke,
// som har egen custom-rendering, virket). Vi injiserer de manglende defs-ene
// fra katalogen. Stedsmerke hoppes over (rendres via appendStedsmerkeSymbol).
function ensureAnnotationDefs(svg) {
  const ns = 'http://www.w3.org/2000/svg'
  let defs = svg.querySelector('defs')
  if (!defs) {
    defs = document.createElementNS(ns, 'defs')
    svg.insertBefore(defs, svg.firstChild)
  }
  for (const s of ANNOTATION_SYMBOLS) {
    if (s.symbolKey === 'stedsmerke') continue
    const id = `iso-sym-${s.symbolKey}`
    if (svg.querySelector(`[id="${id}"]`)) continue
    const spec = isomCatalog.pointSymbols?.[s.symbolKey]
    if (!spec) continue
    const parsed = new DOMParser().parseFromString(
      `<svg xmlns="${ns}">${buildPointSymbolDef(id, spec)}</svg>`, 'image/svg+xml')
    const symEl = parsed.querySelector('symbol')
    if (symEl) defs.appendChild(document.importNode(symEl, true))
  }
}

function renderAnnotations() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  ensureAnnotationDefs(svg)
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
  // v9.1.1: ingen border — pin-en er en ren rød silhuett (samme stil som
  // parkering-P). Tidligere mørkerød kontur dempet hodets distinkte form.
  const pinPosG = mk('g', {})
  const pinPathEl = mk('path', {
    d: pinPath(r),
    fill: '#dc2626',
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
    // v9.3.6 — Hopp over <text> som er en symbol-mal i <defs> (f.eks. «WC»-
    // teksten i ISOM 554-symbolet). Slike instansieres via <use> inne i en
    // <g data-upright="1">-gruppe som ALLEREDE counter-roteres lenger ned;
    // å rotere mal-teksten i tillegg ga dobbel counter-rotation, så WC endte
    // på -rotation (roterte «feil vei») i stedet for å stå rett opp.
    let inDefs = el.__indefs
    if (inDefs === undefined) {
      inDefs = !!el.closest('defs')
      el.__indefs = inDefs
    }
    if (inDefs) continue
    // v9.1.11 — Perf: cache BÅDE lag-referansen og x/y per element. closest()
    // og baseVal er dyrt; å kjøre dem for hver av 1000+ labels HVER rotasjons-
    // /kompass-frame ga jank (v9.1.10-regresjon: closest per frame). Statisk
    // per element, så vi regner det ut én gang og leser deretter bare den
    // billige inline `style.display` per frame.
    let layerG = el.__layer
    if (layerG === undefined) {
      layerG = el.closest('[data-layer]')
      el.__layer = layerG
    }
    // Hopp over labels i skjulte lag (stedsnavn default av → 1000+ noder
    // itereres ikke). Re-orienteres når laget slås på (applyLayerVisibility).
    if (layerG && layerG.style.display === 'none') continue
    let xVal = el.__ux
    if (xVal === undefined) {
      xVal = el.x?.baseVal?.[0]?.value ?? 0
      el.__ux = xVal
      el.__uy = el.y?.baseVal?.[0]?.value ?? 0
    }
    el.setAttribute('transform', `rotate(${rot} ${xVal} ${el.__uy})`)
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
  // Auto-genererte symboler markert med data-upright (foreløpig kun
  // parkerings-P) skal leses vannrett med skjermens topp — bruker samme
  // mønster som stedsmerke: bevar translate, bytt rotate-segmentet.
  const upright = svg.querySelectorAll('[data-upright="1"]')
  for (const el of upright) {
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

// Header-shortcut: ett trykk = GPS + sporing av/på.
// Idle → start GPS + start opptak (sist-brukte stil).
// GPS på, ikke opptak → start opptak.
// Opptak → stopp opptak (GPS forblir aktivt så ikonen viser posisjon).
function onHeaderTrackShortcut() {
  if (tracker.isRecording.value) {
    void tracker.stopRecording()
    return
  }
  if (!userPos.isWatching) userPos.start()
  tracker.startRecording()
}
async function onDeleteTrack(id) {
  if (!confirm('Slett dette sporet?')) return
  await tracker.deleteTrack(id)
}
function onExportTrackGpx(tr) {
  if (!meta.value) return
  downloadGpx(tr, meta.value, mapTitle.value)
}

// ── Auto-kart: regenerer når visnings-senter krysser 85%-terskelen ────────
// FAB-en er en på/av-bryter (default AV, alltid synlig, uavhengig av GPS).
// Når PÅ: når du panner/zoomer slik at skjermsenteret har flyttet seg ≥85 % av
// halv-bredden ut mot en kant, bygges et nytt kart med SAMME størrelse +
// ekvidistanse, sentrert der du ser. En trigger-ramme + trådkors tegnes på
// kartet så du ser når det vil skje («hold trådkorset innenfor rammen»).
//
// Spekulativ prefetch: når senteret passerer 50 %-sonen (men ikke 85 % ennå)
// gjetter vi hvor du havner (projiserer reise-retningen ut til rammen) og bygger
// kartet i bakgrunnen (Web Worker, jank-fritt). Krysser du så 85 % og gjettet
// stemmer, bruker vi det ferdige kartet → tilnærmet umiddelbart. Bommer gjettet
// (du snur), forkastes prefetch-en (worker termineres, kartet lagres aldri /
// slettes) og vi bygger ferskt.
const AUTO_MAP_THRESHOLD = 0.85   // andel av halv-bredden før ny-bygg trigges
const PREFETCH_THRESHOLD = 0.5    // andel der bakgrunns-bygging starter
const PREFETCH_MATCH_TOL_FRAC = 0.25  // hvor nær gjettet må være (× halv-bredde)
const autoMapEnabled = ref(false) // toggle-tilstand (default AV)
const buildingOnTheFly = ref(false)  // full-screen loader-flagg (gjenbrukes)
const buildingProgress = ref('')
const autoMapToast = ref('')      // transient melding (på/av, offline, flyttet)
let autoMapToastTimer = null
let autoMapOfflineNotified = false   // offline-toast vises kun én gang
let autoMapArmed = true              // hindrer umiddelbar re-trigger etter bygg
let autoMapCheckTimer = null
// Spekulativ prefetch i bakgrunnen: { predicted:{x,y}, promise, controller,
// aborted }. promise løses til { id, entry } fra buildMapFromCenter.
let autoMapPrefetch = null
// Om kartet som vises NÅ ble auto-generert (settes fra init-prefs). Styrer
// push-vs-replace + opprydding: fra brukerens opprinnelige kart pushes første
// auto-kart (tilbake-knappen → opprinnelig), videre auto-kart replace-r og
// sletter forrige auto-kart fra lagring (ingen opphopning).
const currentMapIsAuto = ref(false)

function showAutoMapToast(msg) {
  autoMapToast.value = msg
  if (autoMapToastTimer) clearTimeout(autoMapToastTimer)
  autoMapToastTimer = setTimeout(() => { autoMapToast.value = '' }, 3500)
}

function toggleAutoMap() {
  if (buildingOnTheFly.value) return
  autoMapEnabled.value = !autoMapEnabled.value
  if (autoMapEnabled.value) {
    autoMapArmed = true
    autoMapOfflineNotified = false
    showAutoMapToast('Auto-kart på — dra forbi rammen for nytt kart')
  } else {
    cancelPrefetch()
    showAutoMapToast('Auto-kart av')
  }
  renderAutoMapFrame()
}

// Viewbox-koordinaten (SVG-meter) som ligger midt på skjermen akkurat nå.
// Invers av forward-transformen i applyNameLOD/panTo: SVG fyller wrapperen med
// preserveAspectRatio="xMidYMid meet", deretter M = T(tx,ty)∘R(rot)∘S(s).
function visibleCenterSvg() {
  const m = meta.value
  const wrap = wrapperRef.value?.getBoundingClientRect()
  if (!m || !wrap || !wrap.width || !wrap.height) return null
  const w = wrap.width, h = wrap.height
  const fit = Math.min(w / m.widthM, h / m.heightM)
  const offX = (w - m.widthM * fit) / 2
  const offY = (h - m.heightM * fit) / 2
  const s = scale.value || 1
  const rot = (rotation.value || 0) * Math.PI / 180
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const tx = translateX.value, ty = translateY.value
  // Skjermsenter (wrapper-lokalt). Løs (X,Y) = T + s·R·(px,py) for (px,py),
  // deretter trekk fra letterbox-offset / del på fit for viewBox-koordinat.
  const A = (w / 2 - tx) / s
  const B = (h / 2 - ty) / s
  const px = A * cos + B * sin
  const py = -A * sin + B * cos
  return { x: (px - offX) / fit, y: (py - offY) / fit }
}

// Tegn (eller fjern) trigger-rammen som en stiplet rect i selve kart-SVG-en,
// i SVG-meter-rommet, så den panner/zoomer/roterer SAMMEN med kartet. Rammen
// er det indre 85 %-rektangelet (fra 7,5 % til 92,5 % på hver side).
function renderAutoMapFrame() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const existing = svg.querySelector('#auto-map-frame')
  if (!autoMapEnabled.value || !meta.value) {
    if (existing) existing.remove()
    return
  }
  const m = meta.value
  const inset = (1 - AUTO_MAP_THRESHOLD) / 2   // 0.075
  const x0 = inset * m.widthM
  const y0 = inset * m.heightM
  const rw = AUTO_MAP_THRESHOLD * m.widthM
  const rh = AUTO_MAP_THRESHOLD * m.heightM
  const ns = 'http://www.w3.org/2000/svg'
  let g = existing
  if (!g) {
    g = document.createElementNS(ns, 'g')
    g.setAttribute('id', 'auto-map-frame')
    g.setAttribute('pointer-events', 'none')
    const rect = document.createElementNS(ns, 'rect')
    rect.setAttribute('fill', 'none')
    rect.setAttribute('stroke', '#10b981')
    rect.setAttribute('stroke-width', '2')
    rect.setAttribute('stroke-dasharray', '10 8')
    rect.setAttribute('stroke-linecap', 'round')
    rect.setAttribute('vector-effect', 'non-scaling-stroke')
    rect.setAttribute('opacity', '0.85')
    g.appendChild(rect)
    svg.appendChild(g)
  }
  const rect = g.querySelector('rect')
  rect.setAttribute('x', String(x0))
  rect.setAttribute('y', String(y0))
  rect.setAttribute('width', String(rw))
  rect.setAttribute('height', String(rh))
}

// Debouncet sjekk: kjør etter at gesten har satt seg (ikke per frame).
function scheduleAutoMapCheck() {
  if (!autoMapEnabled.value) return
  if (autoMapCheckTimer) clearTimeout(autoMapCheckTimer)
  autoMapCheckTimer = setTimeout(() => {
    if (isGesturing && isGesturing.value) { scheduleAutoMapCheck(); return }
    checkAutoMapTrigger()
  }, 400)
}
watch([scale, translateX, translateY, rotation], scheduleAutoMapCheck)

// Felles gate: ikke kjør auto-kart-logikk når et annet modus eier UI-en
// (måling, annotering, spill, søk, åpen drawer) — da er skjermsenteret dekket
// eller irrelevant.
function autoMapModeBusy() {
  return curveball.active.value || annot.isAnnotateMode.value ||
         measureMode.value || searchOpen.value || showControls.value
}

function autoMapDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Projiser reise-retningen (kart-senter → synlig-senter) ut til 85%-rammen og
// returner punktet der den treffer — vårt gjett på hvor du krysser terskelen.
function predictTriggerCenter(c) {
  const m = meta.value
  const cx = m.widthM / 2, cy = m.heightM / 2
  const dx = c.x - cx, dy = c.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const bx = AUTO_MAP_THRESHOLD * m.widthM / 2
  const by = AUTO_MAP_THRESHOLD * m.heightM / 2
  const sx = dx !== 0 ? bx / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? by / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: cx + s * dx, y: cy + s * dy }
}

// Bygge-parametre for et auto-kart sentrert på et SVG-punkt (samme størrelse +
// ekvidistanse som dagens kart).
function autoMapBuildOpts(centerSvg) {
  const m = meta.value
  const { lat, lon } = svgToWgs84(centerSvg.x, centerSvg.y, m)
  const stamp = new Date().toLocaleDateString('no-NO', { day: '2-digit', month: 'short' })
  return {
    center: { lat, lon, name: 'Auto-kart' },
    halfKm: +(m.widthM / 2000).toFixed(3),
    equidistanceM: m.equidistance ?? 20,
    navn: `Tur ${stamp}`,
  }
}

// Forwarde tilstand til det nye kartet via sessionStorage (consume-on-read):
// tema + lag, faktisk GPS-status, at auto-modus forblir PÅ, at kartet er auto-
// generert, bevart zoom/rotasjon, og «flyttet sentrum»-toast.
function writeAutoMapPrefs(id) {
  try {
    sessionStorage.setItem(`mapview-init-prefs:${id}`, JSON.stringify({
      theme: currentTheme.value,
      layers: Array.from(visibleLayers.value),
      autoStartGps: userPos.isWatching,
      autoMapEnabled: true,
      isAutoMap: true,
      scale: scale.value,
      rotation: rotation.value,
      movedCenterToast: true,
    }))
  } catch { /* noop */ }
}

// Start en bakgrunns-bygging mot et gjettet senter. Worker-basert (jank-fritt),
// avbrytbar via AbortController.
function startPrefetch(predicted) {
  const controller = new AbortController()
  const opts = autoMapBuildOpts(predicted)
  const entry = { predicted, controller, aborted: false, failed: false, promise: null }
  entry.promise = buildMapFromCenter({ ...opts, signal: controller.signal })
  // En feilet/avbrutt bakgrunns-bygging (typisk forbigående Overpass-feil) skal
  // IKKE «poisone» neste trigger: marker som feilet og fjern den som aktiv
  // prefetch, så triggeren bygger ferskt i stedet for å vente på en rejected
  // promise. (Neste maybePrefetch i 50–85%-sonen starter evt. en ny.)
  entry.promise.catch(() => {
    entry.failed = true
    if (autoMapPrefetch === entry) autoMapPrefetch = null
  })
  autoMapPrefetch = entry
}

// Forkast en pågående/ferdig prefetch: terminer workeren (stopper CPU) og slett
// kartet hvis det rakk å bli lagret før avbruddet.
function cancelPrefetch() {
  const p = autoMapPrefetch
  autoMapPrefetch = null
  if (!p) return
  p.aborted = true
  try { p.controller.abort() } catch { /* noop */ }
  p.promise.then(r => { if (r?.id) deleteStoredMap(r.id).catch(() => {}) }).catch(() => {})
}

// Vurder å starte/erstatte en prefetch når senteret er i 50–85%-sonen.
function maybePrefetch(c) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  const m = meta.value
  const predicted = predictTriggerCenter(c)
  if (autoMapPrefetch) {
    // Behold hvis gjettet fortsatt er nært; bytt hvis retningen endret seg mye.
    if (autoMapDist(autoMapPrefetch.predicted, predicted) < PREFETCH_MATCH_TOL_FRAC * m.widthM / 2) return
    cancelPrefetch()
  }
  startPrefetch(predicted)
}

function checkAutoMapTrigger() {
  if (!autoMapEnabled.value || !autoMapArmed || buildingOnTheFly.value) return
  // Ikke trigg/prefetch mens et ferskt kart fortsatt fyller inn detaljer.
  if (fillingInDetails.value) return
  if (autoMapModeBusy()) return
  const m = meta.value
  const c = visibleCenterSvg()
  if (!m || !c) return
  const dx = Math.abs(c.x - m.widthM / 2)
  const dy = Math.abs(c.y - m.heightM / 2)
  const past85 = dx >= AUTO_MAP_THRESHOLD * m.widthM / 2 ||
                 dy >= AUTO_MAP_THRESHOLD * m.heightM / 2
  if (past85) { void triggerAutoMap(c); return }
  const past50 = dx >= PREFETCH_THRESHOLD * m.widthM / 2 ||
                 dy >= PREFETCH_THRESHOLD * m.heightM / 2
  if (past50) maybePrefetch(c)
}

async function triggerAutoMap(centerSvg) {
  const m = meta.value
  if (!m) return
  // Offline-gate: bygging krever nett (OSM Overpass + Kartverket WCS uten
  // fallback). Suppress stille, men forklar én gang med en diskret toast.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    cancelPrefetch()
    if (!autoMapOfflineNotified) {
      autoMapOfflineNotified = true
      showAutoMapToast('Offline — kan ikke lage nytt kart')
    }
    return
  }
  autoMapArmed = false   // ikke trigg igjen mens denne byggingen pågår
  const wasAuto = currentMapIsAuto.value
  const prevId = mapId.value
  buildingOnTheFly.value = true
  buildingProgress.value = 'Forbereder …'
  closeDrawer()
  closeSearch()
  try {
    // Bruk en treffende prefetch hvis gjettet er nær det faktiske krysningspunktet
    // (og den ikke er avbrutt/feilet).
    const hit = autoMapPrefetch && !autoMapPrefetch.aborted && !autoMapPrefetch.failed &&
      autoMapDist(autoMapPrefetch.predicted, centerSvg) < PREFETCH_MATCH_TOL_FRAC * m.widthM / 2
        ? autoMapPrefetch : null
    let id = null
    if (hit) {
      autoMapPrefetch = null
      buildingProgress.value = 'Henter forhåndslastet kart …'
      // Skulle den ferdige prefetch-en likevel ha rejected (forbigående feil),
      // faller vi tilbake til ferskt bygg under — aldri «ingen kart» når online.
      try { id = (await hit.promise).id } catch { id = null }
    }
    if (!id) {
      cancelPrefetch()   // forkast evt. bom/feilet prefetch
      buildingProgress.value = 'Forbereder …'
      const r = await buildMapFromCenter({
        ...autoMapBuildOpts(centerSvg),
        terrainFirst: true,   // vis terreng straks, fyll inn OSM i bakgrunnen
        onProgress: (msg) => { buildingProgress.value = msg },
      })
      id = r.id
    }
    writeAutoMapPrefs(id)
    // «replace, behold opprinnelig»: fra et auto-kart erstatter vi history-
    // oppføringen og sletter forrige auto-kart fra lagring; fra brukerens
    // opprinnelige kart pusher vi (tilbake-knappen tar deg til opprinnelig).
    if (wasAuto) {
      try { await deleteStoredMap(prevId) } catch { /* noop */ }
      router.replace({ name: 'kart-vis', params: { id } })
    } else {
      router.push({ name: 'kart-vis', params: { id } })
    }
  } catch (e) {
    console.error('Auto-kart-bygging feilet:', e)
    buildingOnTheFly.value = false
    buildingProgress.value = ''
    autoMapArmed = true
    if (!autoMapOfflineNotified) {
      autoMapOfflineNotified = true
      showAutoMapToast('Kunne ikke lage nytt kart')
    }
  }
  // Merk: ved suksess lar vi buildingOnTheFly stå true til komponenten rives av
  // navigasjonen, så loaderen holder seg synlig under overgangen.
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

async function loadMap({ silent = false } = {}) {
  // silent = re-render av samme kart (terreng → full) uten full-skjerm-loader;
  // beholder zoom/pan og hopper over init-prefs (alt konsumert ved første last).
  if (!silent) loading.value = true
  loadError.value = null
  try {
    const id = route.params.id ?? 'vardasen'
    let text
    let demBytes = 0
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
        demBytes = stored.dem.buffer?.byteLength ?? 0
      }
      storedHighestPoint.value = stored.highestPoint ?? null
    }
    // Datamengde for dette kartet (vises i drawer-ens Debug + long-press-arket).
    // SVG-en er hoved-payloaden; DEM-en lagres separat (pakket Float32-buffer).
    mapDataSize.value = { svgBytes: new Blob([text]).size, demBytes }
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
    }
    // Forbruk init-prefs fra auto-kart / on-the-fly (tema + synlige lag, GPS,
    // auto-modus, bevart zoom/rotasjon). Én gang per ny mapId.
    let pendingAutoStartGps = false
    let pendingRestoreView = null   // {scale, rotation} — bevar visning over hopp
    let pendingMovedToast = false
    try {
      const k = `mapview-init-prefs:${mapId.value}`
      const raw = sessionStorage.getItem(k)
      if (raw) {
        sessionStorage.removeItem(k)
        const prefs = JSON.parse(raw)
        if (prefs.theme) currentTheme.value = prefs.theme
        if (Array.isArray(prefs.layers)) visibleLayers.value = new Set(prefs.layers)
        if (prefs.autoStartGps) pendingAutoStartGps = true
        if (prefs.autoMapEnabled) autoMapEnabled.value = true
        if (prefs.isAutoMap) currentMapIsAuto.value = true
        if (typeof prefs.scale === 'number' || typeof prefs.rotation === 'number') {
          pendingRestoreView = { scale: prefs.scale ?? 1, rotation: prefs.rotation ?? 0 }
        }
        if (prefs.movedCenterToast) pendingMovedToast = true
      }
    } catch { /* noop */ }
    // Fersk-kart-baseline: garanter «litt kontur + litt relieff» på nye kart så
    // de ikke blir blast hvis relieff er globalt skrudd av. Consume-on-read.
    if (!silent) {
      try {
        const fk = `mapview-freshlook:${mapId.value}`
        if (sessionStorage.getItem(fk)) {
          sessionStorage.removeItem(fk)
          if (reliefStepIndex.value === 0) reliefStepIndex.value = FRESH_RELIEF_MIN_IDX
          if (!visibleLayers.value.has('kontur')) {
            visibleLayers.value = new Set(visibleLayers.value).add('kontur')
          }
        }
      } catch { /* noop */ }
    }
    setupHostSvg(root)
    loading.value = false
    await nextTick()
    applyLayerVisibility()
    applyTheme()
    applyStrokeScale()
    userPos.recompute()
    // Auto-start GPS når init-prefs ber om det (kommer fra on-the-fly-
    // snarveien i MapHomeView, der bruker ikke har annen vei til å slå
    // GPS på). Trygt å kalle flere ganger — start() er idempotent.
    if (pendingAutoStartGps) userPos.start()
    await annot.load()
    renderAnnotations()
    await tracker.load()
    renderTracks()
    applyUprightLabels()
    renderMeasure()
    // Hill-shading (med innbakt knaus-relieff) er default ON — fire-and-forget.
    // Lazy DEM-load skjer internt hvis nødvendig (Vardåsen).
    applyHillshade()
    // Bygg søkeindeks fra ferdig-loaded SVG-DOM. Må skje etter at SVG-en er
    // i host-en (getBBox()+getCTM() krever attached element).
    mapSearch.rebuild(svgHostRef.value?.querySelector('svg'))
    // Tell POI pr type så «nærmeste»-snarveiene i PUNKT-arket kan gråes ut
    // når kartet mangler typen (f.eks. ingen holdeplass).
    computePoiAvailability()
    // Indeksen er ny → gamle el-referanser i forced-settet er foreldede.
    forcedVisibleNameEls.clear()
    // Kjør navn-LOD nå som indeksen finnes (skjuler overflødige navn i tette
    // utsnitt). Kjøres synkront her; videre på zoom/pan via watch.
    applyNameLOD()
    // Auto-highlight hvis ?hl=<navn> i URL (delings-flow).
    maybeHighlightFromQuery()
    // Auto-kart: gjenopprett visning + ramme etter et trigget hopp. Bevart
    // zoom/rotasjon legges på rundt det NYE kartets sentrum (panTo sentrerer
    // kart-senter under skjermsenter), så trådkorset peker på samme punkt du
    // var på vei mot — og dx/dy ≈ 0, ingen umiddelbar re-trigger.
    if (autoMapEnabled.value) renderAutoMapFrame()
    if (pendingRestoreView) {
      rotation.value = pendingRestoreView.rotation
      await nextTick()
      panTo(meta.value.widthM / 2, meta.value.heightM / 2, {
        vbWidth: meta.value.widthM, vbHeight: meta.value.heightM,
        targetScale: pendingRestoreView.scale, keepRotation: true,
      })
    }
    autoMapArmed = true
    if (pendingMovedToast) showAutoMapToast('Nytt kart — flyttet sentrum hit')
    // Terreng-først: hvis dette kartet ble vist som terreng-skjelett, konsumér
    // finalize-promisen og re-render (stille) når full SVG med OSM er klar.
    if (!silent) consumeTerrainFinalize()
  } catch (e) {
    loading.value = false
    loadError.value = e.message ?? 'Kunne ikke laste kart'
  }
}

// Vent på terreng-først-finalize (full bygging i bakgrunnen) og re-render når
// klar. Beholder gjeldende zoom/pan (silent re-load). Tåler at brukeren har
// navigert videre (componentAlive-sjekk).
function consumeTerrainFinalize() {
  const fin = consumeMapFinalize(mapId.value)
  if (!fin) return
  fillingInDetails.value = true
  detailsFailed.value = false
  fin.then(() => {
    if (!componentAlive) return
    return loadMap({ silent: true })
  }).catch(() => {
    // Bakgrunns-byggingen feilet (oftest Overpass nede). Vis en lesbar banner
    // med en «Prøv på nytt»-knapp i stedet for en teknisk toast.
    if (componentAlive) detailsFailed.value = true
  }).finally(() => {
    if (componentAlive) fillingInDetails.value = false
  })
}

// «Prøv på nytt» fra detalj-feil-banneret: bygg kartet på nytt fra samme senter
// (samme størrelse/ekvidistanse/navn), erstatt det delvise kartet.
async function retryMapDetails() {
  if (!meta.value || buildingOnTheFly.value) return
  detailsFailed.value = false
  const prevId = mapId.value
  const centerSvg = { x: meta.value.widthM / 2, y: meta.value.heightM / 2 }
  buildingOnTheFly.value = true
  buildingProgress.value = 'Prøver på nytt …'
  try {
    const { lat, lon } = svgToWgs84(centerSvg.x, centerSvg.y, meta.value)
    const { id } = await buildMapFromCenter({
      center: { lat, lon, name: mapTitle.value },
      halfKm: +(meta.value.widthM / 2000).toFixed(3),
      equidistanceM: meta.value.equidistance ?? 20,
      navn: mapTitle.value,
      terrainFirst: true,
      onProgress: (msg) => { buildingProgress.value = msg },
    })
    try {
      sessionStorage.setItem(`mapview-init-prefs:${id}`, JSON.stringify({
        theme: currentTheme.value,
        layers: Array.from(visibleLayers.value),
        autoStartGps: userPos.isWatching,
        autoMapEnabled: autoMapEnabled.value,
        isAutoMap: currentMapIsAuto.value,
        scale: scale.value,
        rotation: rotation.value,
      }))
    } catch { /* noop */ }
    if (prevId && prevId !== 'vardasen') { try { await deleteStoredMap(prevId) } catch { /* noop */ } }
    router.replace({ name: 'kart-vis', params: { id } })
  } catch (e) {
    console.error('Regenerering feilet:', e)
    buildingOnTheFly.value = false
    buildingProgress.value = ''
    detailsFailed.value = true
  }
}

function setupHostSvg(sourceRoot) {
  const ns = 'http://www.w3.org/2000/svg'
  const host = svgHostRef.value
  host.replaceChildren()
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', sourceRoot.getAttribute('viewBox'))
  svg.setAttribute('xmlns', ns)
  // v8.9.26: xmlns:xlink må deklareres her — hill-shading og dybde-skygge
  // legger til `xlink:href` på <image>-elementer via setAttributeNS, og
  // uten denne deklarasjonen på root får serialisert eksport "Namespace
  // prefix xlink for href on image is not defined" i Chrome (Android).
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
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
  // v8.10.4: SVG-en er ny-bygget her — applikér evt. allerede-aktive
  // perf-klasser (.zoomed-in / .is-zooming) basert på nåværende state,
  // siden watcheren bare reagerer på endringer.
  if (scale.value >= ZOOMED_IN_THRESHOLD) svg.classList.add('zoomed-in')
  if (isGesturing && isGesturing.value) svg.classList.add('is-zooming')
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
    `
  } else if (style) {
    style.remove()
  }
}
watch(diagnose, applyDiagnoseMode)

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

// v9.1.2: «Du er utenfor dette kartet» kan dismisses med en X. Resettes
// hver gang brukeren går tilbake innenfor kart-bounds — så hvis hen
// forlater kartet på nytt, dukker meldingen opp igjen.
const outsideMapDismissed = ref(false)
const showOutsideMapBanner = computed(() =>
  userPos.isOutsideMap && !outsideMapDismissed.value
)
function dismissOutsideMap() { outsideMapDismissed.value = true }
watch(() => userPos.isOutsideMap, (out) => { if (!out) outsideMapDismissed.value = false })

// Screen Wake Lock — holder skjermen våken når brukeren bruker kartet til
// orientering ute. Persisteres i localStorage (default PÅ). Re-requestes
// automatisk når fanen blir synlig igjen siden browseren alltid slipper
// wake-locks ved fane-bytte.
const screenWake = useScreenWakeLock()

// Lås dokument-scroll mens kartet er åpent. Roten er h-[100dvh]
// overflow-hidden, men på mobil kan body likevel få en scroll-offset:
// når nettleserens adresselinje kollapser/utvides endrer 100dvh seg, og en
// residual body-scroll skyver hele kart-containeren (toppbar + kompass) opp
// og ut av synsfeltet. router.scrollBehavior nullstiller kun ved navigasjon,
// ikke under interaksjon inne i viewet (f.eks. ved long-press), så vi låser
// body-scroll eksplisitt her og frigjør den igjen ved unmount.
let prevHtmlOverflow = ''
let prevBodyOverflow = ''
function lockBodyScroll() {
  const html = document.documentElement
  prevHtmlOverflow = html.style.overflow
  prevBodyOverflow = document.body.style.overflow
  html.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  // Nullstill enhver residual offset så toppbaren garantert er synlig.
  window.scrollTo(0, 0)
}
function unlockBodyScroll() {
  document.documentElement.style.overflow = prevHtmlOverflow
  document.body.style.overflow = prevBodyOverflow
}

onMounted(() => {
  lockBodyScroll()
  measureWrapper()
  window.addEventListener('resize', measureWrapper)
  window.addEventListener('resize', updateMapRect)
  window.addEventListener('resize', scheduleNameLOD)
  window.addEventListener('orientationchange', updateMapRect)
  loadMap()
  loadUserMapsForTournament()
  maybeRestoreTournament()
  maybeAutostartFromShare()
  screenWake.start()
})

onUnmounted(() => {
  unlockBodyScroll()
  stopGpsTick()
  screenWake.stop()
  componentAlive = false
  window.removeEventListener('resize', scheduleNameLOD)
  if (nameLodTimer) clearTimeout(nameLodTimer)
  if (autoMapCheckTimer) clearTimeout(autoMapCheckTimer)
  if (autoMapToastTimer) clearTimeout(autoMapToastTimer)
  cancelPrefetch()
})
</script>

<template>
  <div class="kart-ui relative w-full h-[100dvh] overflow-hidden"
       :class="isDark ? 'bg-zinc-900' : 'bg-stone-100'">

    <!-- Toppbar. v8.7.1: skjult i Curve Invaders-modus — den lå tidligere
         halvveis bak game-HUD-en, og hamburger-knappen i høyre hjørne var
         delvis klikkbar med uønskede effekter (drawer åpnet seg midt i
         spillet). Skjuler hele toppbaren, matcher kompass-rosen og andre
         map-only UI som allerede har samme v-if. -->
    <div v-if="!curveball.active.value"
         class="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-3
                pointer-events-none">
      <div class="flex items-center gap-2 pointer-events-auto">
        <button @click="router.push('/kart')"
                aria-label="Tilbake til kart-lista"
                class="rounded-full w-10 h-10 flex items-center justify-center
                       bg-zinc-950 text-white shadow-lg active:scale-95 transition">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button @click="onHeaderTrackShortcut"
                :aria-label="tracker.isRecording.value ? 'Stopp sporing' : 'Start GPS og sporing'"
                class="rounded-full w-10 h-10 flex items-center justify-center
                       shadow-lg active:scale-95 transition relative"
                :class="tracker.isRecording.value
                        ? 'bg-pink-500 text-white'
                        : (userPos.isWatching
                            ? 'bg-sky-500 text-white'
                            : 'bg-zinc-950 text-white')">
          <!-- Recording: «stopp»-firkant. Idle: «play»-trekant (peker til høyre)
               så den klassiske start/stopp-semantikken er åpenbar uansett om
               GPS er på (blå knapp = GPS aktiv, klar til å starte ny tur). -->
          <svg v-if="tracker.isRecording.value" viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1.5"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor">
            <polygon points="8,5 8,19 19,12"/>
          </svg>
        </button>
      </div>

      <div class="pointer-events-none px-3 py-1.5 rounded-full bg-zinc-950
                  text-[12px] text-white font-medium shadow-lg max-w-[42%] truncate">
        {{ mapTitle }}
      </div>

      <div class="flex items-center gap-2 pointer-events-auto">
        <button @click="openSearch" aria-label="Søk i kart"
                class="rounded-full w-10 h-10 flex items-center justify-center
                       bg-zinc-950 text-white shadow-lg active:scale-95 transition">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"/>
            <line x1="20" y1="20" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        <button @click="openDrawer" aria-label="Innstillinger"
                class="rounded-full w-10 h-10 flex items-center justify-center
                       bg-zinc-950 text-white shadow-lg active:scale-95 transition">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="6" x2="20" y2="6"/>
            <line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="18" x2="20" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Søke-overlay — synlig når searchOpen=true. Lukker drawer og legger
         seg under topbar slik at brukeren kan se kartet bak. -->
    <Transition name="search-fade">
      <div v-if="searchOpen && !curveball.active.value"
           class="absolute top-16 left-3 right-3 z-40 rounded-2xl bg-zinc-950/95 backdrop-blur
                  border border-white/10 shadow-2xl overflow-hidden flex flex-col"
           style="max-height: calc(100dvh - 6rem);">
        <div class="px-3 py-2.5 flex items-center gap-2 border-b border-white/10">
          <svg viewBox="0 0 24 24" class="w-4 h-4 text-white/55 shrink-0" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"/>
            <line x1="20" y1="20" x2="16.65" y2="16.65"/>
          </svg>
          <input v-model="searchQuery" type="search" autocomplete="off"
                 autocorrect="off" autocapitalize="off" spellcheck="false"
                 placeholder="Søk i kart — steder, vann, øyer …"
                 ref="searchInputRef"
                 class="flex-1 bg-transparent text-[14px] text-white placeholder-white/35
                        focus:outline-none"/>
          <button @click="closeSearch" aria-label="Lukk søk"
                  class="w-7 h-7 -mr-1 rounded-full flex items-center justify-center
                         text-white/65 active:bg-white/10">
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                 stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto">
          <div v-if="searchQuery && searchResults.length === 0"
               class="px-4 py-6 text-center text-[12px] text-white/45">
            Ingen treff på «{{ searchQuery }}»
          </div>
          <div v-else-if="!searchQuery"
               class="px-4 py-4 text-[11px] text-white/45 leading-relaxed">
            Søker i alle stedsnavn, vann, topper og områder ({{ searchIndex.length }} treffbare).
            Skriv «vann», «innsjø» eller «tjern» for å se alle ferskvann i utsnittet.
          </div>
          <button v-for="r in searchResults" :key="r.id"
                  @click="selectSearchResult(r)"
                  class="w-full text-left px-3 py-2.5 active:bg-white/10 transition border-b
                         border-white/8 last:border-0 flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-medium text-white truncate">{{ r.name }}</div>
              <div class="text-[10px] text-white/45 uppercase tracking-wide">{{ r.label }}</div>
            </div>
            <svg viewBox="0 0 24 24" class="w-3.5 h-3.5 text-white/35 shrink-0" fill="none"
                 stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      </div>
    </Transition>

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

    <!-- FAB-stack: on-the-fly / zoom inn / zoom ut / sentrer. Synlig både når
         drawer er åpen og lukket. Når drawer er åpen flyttes FAB-en opp over
         drawer-toppen så den ikke dekker innstillinger. z-40 sikrer at FAB-en
         ligger over drawer (z-30). Skjult i CurveBall-modus og når søke-
         overlayet er åpent (begge bruker z-40 og ville ellers stacke). -->
    <div v-if="!curveball.active.value && !searchOpen"
         class="absolute right-3 z-40 flex flex-col gap-2 pointer-events-auto select-none transition-[bottom] duration-200"
         :style="{
           bottom: showControls
             ? 'calc(45dvh + 0.75rem)'
             : 'calc(env(safe-area-inset-bottom, 0px) + 5rem)'
         }">
      <!-- Transient hint-boble når strek-/relieff-knottene justeres. -->
      <Transition name="hint-fade">
        <div v-if="knobHint"
             class="absolute right-14 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg
                    bg-zinc-950/95 text-white text-[11px] font-medium leading-tight shadow-lg
                    whitespace-nowrap pointer-events-none border border-white/10">
          {{ knobHint }}
        </div>
      </Transition>
      <!-- Auto-kart-bryter: alltid synlig, default AV. PÅ (grønn) viser en
           trigger-ramme + trådkors på kartet; panner du forbi rammen bygges et
           nytt kart med samme størrelse, sentrert der du ser. Toast forklarer
           på/av, offline og «flyttet sentrum». -->
      <div class="relative">
        <button @click="toggleAutoMap"
                :aria-label="autoMapEnabled ? 'Auto-kart på — slå av' : 'Auto-kart av — slå på'"
                class="w-12 h-12 rounded-full shadow-lg flex items-center justify-center
                       active:scale-95 transition relative"
                :class="autoMapEnabled
                        ? 'bg-emerald-500 text-white'
                        : 'bg-zinc-950 text-white/70'">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <!-- kartblad + pluss-merke i hjørnet -->
            <path d="M3 6 L9 4 L15 6 L21 4 V18 L15 20 L9 18 L3 20 Z"/>
            <path d="M9 4 V18 M15 6 V20"/>
            <circle cx="18" cy="6" r="3.5" fill="currentColor" stroke="none" opacity="0.95"/>
            <line x1="18" y1="4.3" x2="18" y2="7.7" stroke="#0e1116" stroke-width="1.6"/>
            <line x1="16.3" y1="6" x2="19.7" y2="6" stroke="#0e1116" stroke-width="1.6"/>
          </svg>
        </button>
        <!-- Toast — på/av, offline-varsel, «flyttet sentrum» -->
        <Transition name="hint-fade">
          <div v-if="autoMapToast"
               class="absolute right-14 top-1/2 -translate-y-1/2 px-3 py-2 rounded-lg
                      bg-zinc-950/95 text-white text-[11px] leading-tight shadow-lg
                      whitespace-nowrap pointer-events-none border border-white/10">
            {{ autoMapToast }}
          </div>
        </Transition>
      </div>
      <!-- Strek-knott: tap = tykkere (wrapper til tynnest etter tykkest),
           lang-trykk = nullstill. Bua viser nivå; senter-streken tegnes i
           faktisk valgt tykkelse (selv-demonstrerende). -->
      <button @pointerdown="knobDown('stroke')" @pointerup="knobUp('stroke')"
              @pointercancel="knobUp('stroke')"
              aria-label="Strektykkelse — tap for å justere, hold for å nullstille"
              class="w-12 h-12 rounded-full bg-zinc-950 text-white shadow-lg touch-none
                     flex items-center justify-center active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-7 h-7" fill="none">
          <path :d="knobTrackD" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" opacity="0.22"/>
          <path :d="strokeArcD" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>
          <line x1="7.5" y1="12" x2="16.5" y2="12" stroke="currentColor"
                :stroke-width="strokeGlyphW" stroke-linecap="round"/>
        </svg>
      </button>
      <!-- Relieff-knott: tap = mer relieff (wrapper til av etter max),
           lang-trykk = nullstill. Senter-bumpens skygge følger nivået. -->
      <button @pointerdown="knobDown('relief')" @pointerup="knobUp('relief')"
              @pointercancel="knobUp('relief')"
              aria-label="Relieff-styrke — tap for å justere, hold for å nullstille"
              class="w-12 h-12 rounded-full bg-zinc-950 text-white shadow-lg touch-none
                     flex items-center justify-center active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-7 h-7" fill="none">
          <path :d="knobTrackD" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" opacity="0.22"/>
          <path :d="reliefArcD" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/>
          <path d="M6.5 15.5 L9.5 10 L11.8 12.8 L14.3 8.5 L17.5 15.5 Z"
                fill="currentColor" :fill-opacity="reliefGlyphOpacity"
                stroke="currentColor" stroke-width="0.8" stroke-linejoin="round"/>
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
         :class="annot.isAnnotateMode.value ? 'cursor-crosshair' : ''"
         @pointerdown="onPointerDownLongPress"
         @pointermove="onPointerMoveLongPress"
         @pointerup="onPointerUpLongPress"
         @pointercancel="onPointerUpLongPress"
         @contextmenu="onContextMenuEvent">
      <div class="w-full h-full relative" :style="mapTransformStyle">
        <div ref="svgHostRef" class="w-full h-full" @click="onMapClick"></div>
        <CurveBallLayer
          :flipp="curveball"
          :view-box="cbViewBox"
          @drop="onCurveBallContinue"/>
      </div>
    </div>

    <!-- Auto-kart trådkors: fast i skjermsenter når auto-modus er PÅ. Sammen
         med trigger-rammen (tegnet i kartet) viser det «hold trådkorset
         innenfor rammen» — krysser det rammen bygges et nytt kart. pointer-
         events-none så det aldri sluker kart-gester. Skjult i spill/søk. -->
    <div v-if="autoMapEnabled && !curveball.active.value && !searchOpen"
         class="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <svg viewBox="0 0 48 48" class="w-12 h-12 drop-shadow"
           fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round">
        <circle cx="24" cy="24" r="9" opacity="0.9"/>
        <line x1="24" y1="4"  x2="24" y2="15"/>
        <line x1="24" y1="33" x2="24" y2="44"/>
        <line x1="4"  y1="24" x2="15" y2="24"/>
        <line x1="33" y1="24" x2="44" y2="24"/>
        <circle cx="24" cy="24" r="1.8" fill="#10b981" stroke="none"/>
      </svg>
    </div>

    <!-- Terreng-først: kartet viser konturer+relieff straks; chip viser at
         stier og detaljer fylles inn i bakgrunnen (Overpass laster). -->
    <Transition name="chip-fade">
      <div v-if="fillingInDetails && !curveball.active.value && !searchOpen"
           class="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-2xl
                  bg-zinc-950/90 text-white text-[12px] font-medium shadow-lg backdrop-blur
                  flex items-center gap-2 pointer-events-none border border-white/10">
        <span class="w-3.5 h-3.5 rounded-full border-2 border-white/25 border-t-white/80 animate-spin shrink-0"></span>
        <span>Fyller inn stier og detaljer …</span>
      </div>
    </Transition>

    <!-- Highlight-chip — vises når et søkeresultat eller ?hl= har satt en
         markør. Tap fjerner highlight og dropper søkemodus. Skjules under
         Curve Invaders så den ikke kolliderer med game-HUD-en. -->
    <Transition name="chip-fade">
      <div v-if="highlightedFeature && !curveball.active.value && !searchOpen"
           class="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-2xl
                  bg-pink-500/95 text-white text-[12px] font-medium shadow-lg
                  flex items-center gap-2 max-w-[85%] pointer-events-auto">
        <svg viewBox="0 0 24 24" class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="10" r="3"/>
          <path d="M12 21 c-5 -8 -7 -11 -7 -14 a7 7 0 0 1 14 0 c0 3 -2 6 -7 14 z"/>
        </svg>
        <span class="min-w-0 flex flex-col leading-tight">
          <span class="truncate font-semibold">{{ highlightedFeature.name }}</span>
          <span v-if="highlightedFeature.sub"
                class="truncate text-[11px] font-normal text-white/85">{{ highlightedFeature.sub }}</span>
        </span>
        <button @click="clearHighlight" aria-label="Fjern markering"
                class="w-5 h-5 -mr-1 rounded-full flex items-center justify-center
                       text-white/90 active:bg-white/20 shrink-0">
          <svg viewBox="0 0 24 24" class="w-3 h-3" fill="none" stroke="currentColor"
               stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>
      </div>
    </Transition>

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
         bak FAB-stacken. v9.1.2: X-knapp øverst til høyre avslutter målingen
         direkte fra kartet uten å åpne drawer-en. -->
    <div v-if="measureMode && !curveball.active.value"
         class="absolute top-16 left-3 z-20 rounded-md bg-emerald-600
                text-white text-[11px] font-medium shadow-lg
                tabular-nums max-w-[55%] flex items-start gap-1.5 pl-3 pr-1 py-2">
      <div class="flex-1 min-w-0">
        <div class="text-[9px] uppercase tracking-wide text-emerald-100/90">Mål</div>
        <div class="text-[13px] font-semibold">{{ formatDistance(measureStats.distM) }}</div>
        <div v-if="measureClosed" class="text-[11px] text-emerald-100/95">
          {{ formatArea(measureStats.areaM2) }}
        </div>
      </div>
      <button @click="stopMeasure" aria-label="Avslutt måling"
              class="-mt-0.5 -mr-0.5 w-6 h-6 flex items-center justify-center rounded-md
                     text-white/90 active:scale-90 active:bg-white/10 shrink-0">
        <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
             stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
        </svg>
      </button>
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
         class="absolute bottom-32 left-1/2 -translate-x-1/2 z-20 max-w-[90%] px-3 py-2
                rounded-lg backdrop-blur bg-amber-600/95 border border-slate-300/40
                text-white text-[12px] shadow-lg text-center whitespace-nowrap">
      {{ userPos.error }}
    </div>
    <div v-else-if="!loading && showOutsideMapBanner"
         class="absolute bottom-32 left-1/2 -translate-x-1/2 z-20 max-w-[90%]
                rounded-lg backdrop-blur bg-amber-600/95 border border-slate-300/40
                text-white text-[12px] shadow-lg flex items-center gap-1.5 pl-3 pr-1 py-2">
      <span>Du er utenfor dette kartet.</span>
      <button @click="dismissOutsideMap" aria-label="Greit, skjønner"
              class="w-6 h-6 -my-0.5 flex items-center justify-center rounded-md
                     text-white/90 active:scale-90 active:bg-white/10 shrink-0">
        <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
             stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Detalj-feil-banner: bakgrunns-byggingen (stier/veier fra Overpass)
         feilet, så kartet viser bare terreng. Lesbart, bryter på flere linjer,
         med «Prøv på nytt»-knapp som bygger kartet på nytt. -->
    <div v-if="detailsFailed && !loading && !curveball.active.value"
         class="absolute bottom-32 left-3 right-20 z-20 max-w-[420px]
                rounded-lg backdrop-blur bg-amber-600/95 border border-amber-300/40
                text-white text-[12px] shadow-lg p-3">
      <div class="flex items-start gap-2">
        <div class="flex-1 min-w-0 leading-snug">
          Fikk ikke lastet stier og detaljer. Kartet viser bare terreng nå.
        </div>
        <button @click="detailsFailed = false" aria-label="Lukk"
                class="w-6 h-6 -mt-0.5 -mr-1 flex items-center justify-center rounded-md
                       text-white/90 active:scale-90 active:bg-white/10 shrink-0">
          <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
               stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>
      </div>
      <button @click="retryMapDetails"
              class="mt-2 w-full px-3 py-1.5 rounded-md bg-white/15 border border-white/25
                     text-white text-[12px] font-medium active:scale-[0.98]">
        Prøv på nytt
      </button>
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

    <!-- Skala + ekvidistanse + ISOM-info (skjult i CurveBall-modus og under
         aktivt søk så den ikke ligger under treff-listen). -->
    <div v-if="!loading && !curveball.active.value && !searchOpen"
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

    <!-- Attribusjon (skjult i CurveBall-modus og under aktivt søk) -->
    <div v-if="!loading && !curveball.active.value && !searchOpen"
         class="absolute bottom-3 right-3 z-20 px-2 py-1 rounded-md bg-zinc-950
                text-white/85 text-[9px] leading-tight pointer-events-none shadow-lg max-w-[180px]">
      © OpenStreetMap-bidragsytere<br>
      <span class="text-white/50">{{ meta?.isomVersion ? `ISOM ${meta.isomVersion}` : '' }}</span><br>
      <span class="text-white/50">DEM: {{ meta?.demSource ?? '—' }}</span>
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
              <button v-for="lay in landLayerButtons" :key="lay.key"
                      @click="toggleLayer(lay.key)"
                      class="px-3 py-2 rounded-lg border text-left active:scale-[0.98] transition"
                      :class="visibleLayers.has(lay.key)
                              ? 'bg-slate-400/25 border-slate-300/50 text-white'
                              : 'bg-white/5 border-white/10 text-white/45'">
                <span class="text-[12px]">{{ lay.label }}</span>
              </button>
            </div>
            <!-- Gruppert seksjon: Sjø & padling -->
            <div class="mt-3 mb-1 text-[11px] font-semibold text-sky-300/80 uppercase tracking-wide">
              Sjø &amp; padling
            </div>
            <div class="grid grid-cols-2 gap-2 mb-1">
              <button v-for="lay in marineLayerButtons" :key="lay.key"
                      @click="toggleLayer(lay.key)"
                      class="px-3 py-2 rounded-lg border text-left active:scale-[0.98] transition"
                      :class="visibleLayers.has(lay.key)
                              ? 'bg-sky-400/25 border-sky-300/50 text-white'
                              : 'bg-white/5 border-white/10 text-white/45'">
                <span class="text-[12px]">{{ lay.label }}</span>
              </button>
            </div>
            <div class="text-[10px] text-white/40 leading-snug mb-2">
              Fyr, sjømerker, skjær, småbåthavner, landingssteder, toalett og
              drikkevann. Dybdetall vises ved å holde inne et punkt på kartet.
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
            <div v-if="tracker.isRecording.value"
                 class="text-[10px] leading-snug rounded-md px-2 py-1.5 bg-pink-500/10
                        border border-pink-300/20 text-pink-100/85">
              <span v-if="tracker.wakeLockActive.value">
                Skjermen holdes våken så GPS ikke stopper. Hold appen åpen
                under turen — nettleseren kan ikke spore i bakgrunnen.
              </span>
              <span v-else>
                Hold appen åpen og skjermen våken under turen — nettleseren
                kan ikke spore i bakgrunnen, og GPS-en stopper når skjermen
                sovner.
              </span>
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
            <!-- Del kart — bruker Web Share API på iOS/Android med fallback
                 til clipboard. Inkluderer ?hl=<navn> hvis et søkeresultat er
                 highlightet, slik at mottaker ser samme markering. -->
            <button @click="onShareMap"
                    class="w-full mb-3 px-3 py-2.5 rounded-lg border text-[12px] active:scale-[0.98]
                           flex items-center justify-center gap-2 transition"
                    :class="shareState === 'copied'
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-100'
                            : 'bg-sky-500/15 border-sky-400/40 text-sky-100'">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <template v-if="shareState === 'copied'">
                  <polyline points="20 6 9 17 4 12"/>
                </template>
                <template v-else>
                  <circle cx="18" cy="5" r="3"/>
                  <circle cx="6" cy="12" r="3"/>
                  <circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </template>
              </svg>
              <span class="font-medium">
                <template v-if="shareState === 'copied'">Lenke kopiert ✓</template>
                <template v-else-if="shareState === 'sharing'">Åpner delings-dialog …</template>
                <template v-else-if="shareState === 'error'">Kunne ikke dele — prøv igjen</template>
                <template v-else>Del kart</template>
              </span>
            </button>
            <div v-if="highlightedFeature"
                 class="text-[10px] text-white/55 leading-snug mb-3 px-1 -mt-1">
              Markering: <span class="text-pink-300 font-medium">{{ highlightedFeature.name }}</span>
              · sendes som <code class="text-white/70">?hl=</code> i lenken.
            </div>

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

            <div class="flex items-baseline justify-between gap-2 mb-2">
              <span class="text-white/55 text-[11px] uppercase tracking-wide">Debug</span>
              <span v-if="mapDataLabel" class="text-white/45 text-[11px] tabular-nums">{{ mapDataLabel }}</span>
            </div>
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
            <!-- Byggetider (perf): viser localStorage-loggen så den kan kopieres
                 og deles — mobil-konsollen er upraktisk. -->
            <button @click="openPerfLog"
                    class="w-full px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98]
                           bg-white/5 border-white/10 text-white/75">
              Byggetider (perf-logg)
            </button>
          </div>

          <!-- ── Tab: Om ──────────────────────────────────────────── -->
          <div v-show="activeTab === 'om'">
            <!-- Innstillinger: hold skjerm våken. Default PÅ — nyttig når
                 brukeren bruker kartet til orientering ute og ikke vil at
                 telefonen skal låse skjermen midt i navigasjonen. -->
            <div v-if="screenWake.supported"
                 class="rounded-lg bg-white/5 px-3 py-2.5 mb-3 flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <div class="text-[13px] text-white font-medium">Hold skjerm våken</div>
                <div class="text-[11px] text-white/55 leading-snug">
                  Hindrer at telefonen låser skjermen mens du bruker kartet. Slipper automatisk etter 2 min uten berøring så batteriet spares — tar seg igjen straks du tar på kartet. Slå av helt om du vil.
                </div>
              </div>
              <button @click="screenWake.setEnabled(!screenWake.enabled.value)"
                      :aria-pressed="screenWake.enabled.value"
                      :aria-label="screenWake.enabled.value ? 'Slå av skjerm-våken' : 'Slå på skjerm-våken'"
                      class="relative w-11 h-6 rounded-full transition-colors shrink-0"
                      :class="screenWake.enabled.value ? 'bg-emerald-500' : 'bg-white/15'">
                <span class="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                      :class="screenWake.enabled.value ? 'left-5' : 'left-0.5'" />
              </button>
            </div>
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

    <!-- Long-press kontekstmeny (bottom-sheet). Åpnes ved long-press eller
         høyreklikk på kartet. Viser koordinater, høyde, nærmeste sted/sti,
         og handlinger for det valgte punktet. -->
    <Transition name="overlay-fade">
      <!-- Ingen backdrop-blur her: kontekstmenyen legger en evig-pulserende
           SMIL-pin (renderContextPin) i kart-SVG-en BAK dette overlayet.
           backdrop-filter:blur tvinger re-blurring av hele den komplekse
           kart-SVG-en på HVER animasjons-frame → mobil-kompositoren låser seg
           (frys på store/innebygde kart, men ikke på små 1×1). Vanlig
           halv-opak dimming er billig og fryser ikke. -->
      <div v-if="contextMenuOpen && contextMenuInfo"
           class="absolute inset-0 z-40 bg-black/60 flex items-end justify-center"
           @click.self="closeContextMenu">
        <div ref="contextSheetRef"
             class="w-full bg-zinc-900 border-t border-white/10 rounded-t-2xl
                    max-h-[65dvh] overflow-y-auto"
             :style="{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)' }">
          <!-- Header: koordinater + lukk -->
          <div class="sticky top-0 px-4 pt-3 pb-2.5 bg-zinc-900/95 backdrop-blur
                      border-b border-white/8 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[10px] uppercase tracking-wide text-white/45">Punkt</div>
              <div class="text-white text-[13px] font-mono tabular-nums">
                {{ contextMenuInfo.lat.toFixed(5) }}, {{ contextMenuInfo.lon.toFixed(5) }}
              </div>
              <div v-if="!contextMenuInfo.inside" class="text-[10px] text-amber-300 mt-0.5">
                Utenfor kart-utsnittet
              </div>
            </div>
            <button @click="closeContextMenu"
                    aria-label="Lukk"
                    class="w-8 h-8 -mr-1 -mt-0.5 rounded-full flex items-center justify-center
                           bg-white/5 border border-white/10 text-white/70 active:scale-90 shrink-0">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                   stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
              </svg>
            </button>
          </div>

          <!-- Detalj-inset: roambart 500×500 m utsnitt (start 250 m) med alle
               detaljer (dybdetall, dybdekurver, sjø-POI) avslørt. Pan + zoom,
               ingen rotasjon. Fungerer uten GPS. -->
          <div class="px-4 pt-3">
            <div class="flex items-baseline justify-between mb-1">
              <span class="text-[10px] uppercase tracking-wide text-white/45">
                Detaljer · {{ DETAIL_INSET_M }} × {{ DETAIL_INSET_M }} m
              </span>
              <span class="text-[10px] text-white/30">dra · knip for zoom</span>
            </div>
            <div ref="detailInsetRef"
                 class="w-full aspect-[3/2] max-w-[480px] mx-auto rounded-lg overflow-hidden
                        border border-white/10 bg-[#fefae0] touch-none"></div>
          </div>

          <!-- Info-seksjon: høyde / sted / sti / avstand-fra-deg -->
          <div class="px-4 pt-3 space-y-1.5">
            <div v-if="contextMenuInfo.elevationM != null"
                 class="flex items-baseline gap-2 text-[12px]">
              <span class="text-white/45 w-20 shrink-0">Høyde</span>
              <span class="text-white font-medium tabular-nums">
                {{ Math.round(contextMenuInfo.elevationM) }} moh
              </span>
            </div>
            <div v-if="contextMenuInfo.place"
                 class="flex items-baseline gap-2 text-[12px]">
              <span class="text-white/45 w-20 shrink-0">Nærmest</span>
              <span class="text-white truncate">
                {{ contextMenuInfo.place.name }}
                <span class="text-white/55 tabular-nums">
                  · {{ formatDistanceM(contextMenuInfo.place.distM) }}
                </span>
              </span>
            </div>
            <div v-if="contextMenuInfo.fromUser"
                 class="flex items-baseline gap-2 text-[12px]">
              <span class="text-white/45 w-20 shrink-0">Fra deg</span>
              <span class="text-white">
                {{ contextMenuInfo.fromUser.compass }}
                <span class="text-white/55 tabular-nums">
                  · {{ formatDistanceM(contextMenuInfo.fromUser.distM) }}
                </span>
              </span>
            </div>
            <div v-if="mapDataLabel" class="flex items-baseline gap-2 text-[12px]">
              <span class="text-white/45 w-20 shrink-0">Kartdata</span>
              <span class="text-white/85 tabular-nums">{{ mapDataLabel }}</span>
            </div>
          </div>

          <!-- Handlinger -->
          <div class="px-4 pt-4 grid grid-cols-2 gap-2">
            <button @click="onCopyCoords"
                    class="px-3 py-2.5 rounded-lg border text-[12px] active:scale-[0.98]
                           flex items-center gap-2 transition"
                    :class="contextActionState === 'copied'
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-100'
                            : contextActionState === 'failed'
                              ? 'bg-rose-500/20 border-rose-400/50 text-rose-100'
                              : 'bg-white/5 border-white/10 text-white/80'">
              <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="11" height="11" rx="2"/>
                <path d="M5 15 V5 a2 2 0 0 1 2 -2 h10"/>
              </svg>
              <span>{{ contextActionState === 'copied' ? 'Kopiert ✓' : 'Kopier koordinater' }}</span>
            </button>
            <button @click="onShareCoords"
                    class="px-3 py-2.5 rounded-lg border text-[12px] active:scale-[0.98]
                           flex items-center gap-2 bg-white/5 border-white/10 text-white/80">
              <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="18" cy="5" r="3"/>
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              <span>Del koordinater</span>
            </button>
            <button @click="onShareMap"
                    class="px-3 py-2.5 rounded-lg border text-[12px] active:scale-[0.98]
                           flex items-center gap-2 bg-white/5 border-white/10 text-white/80">
              <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6 L9 4 L15 6 L21 4 V18 L15 20 L9 18 L3 20 Z"/>
                <path d="M9 4 V18 M15 6 V20"/>
              </svg>
              <span>Del kart</span>
            </button>
            <button v-if="ctxCanMeasure" @click="onStartMeasureHere"
                    class="px-3 py-2.5 rounded-lg border text-[12px] active:scale-[0.98]
                           flex items-center gap-2 bg-white/5 border-white/10 text-white/80">
              <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 21 9 15 13 19 21 11"/>
                <path d="M5 19 V21 H7 M19 11 V13 H21"/>
              </svg>
              <span>Start måling her</span>
            </button>
            <button @click="onOpenGoogleMaps"
                    class="px-3 py-2.5 rounded-lg border text-[12px] active:scale-[0.98]
                           flex items-center gap-2 bg-white/5 border-white/10 text-white/80">
              <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="10" r="3"/>
                <path d="M12 21 c-5 -8 -7 -11 -7 -14 a7 7 0 0 1 14 0 c0 3 -2 6 -7 14 z"/>
              </svg>
              <span>Google Maps</span>
            </button>
            <button @click="onOpenStreetView"
                    class="px-3 py-2.5 rounded-lg border text-[12px] active:scale-[0.98]
                           flex items-center gap-2 bg-white/5 border-white/10 text-white/80">
              <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="9" r="3"/>
                <path d="M12 12 v9"/>
                <path d="M6 18 c2 -1.5 4 -2 6 -2 s4 0.5 6 2"/>
              </svg>
              <span>Street View</span>
            </button>
          </div>

          <!-- Nærmeste POI relativt til DETTE punktet. Highlighter med rosa
               puls-ring (samme som søk). Knappen gråes ut når kartet ikke har
               typen (f.eks. ingen holdeplass i utsnittet). -->
          <div class="px-4 pt-4 pb-1 text-white/55 text-[10px] uppercase tracking-wide">
            Nærmeste herfra
          </div>
          <div class="px-4 pb-1 grid grid-cols-3 gap-2">
            <button @click="nearestPoiFromPoint('parkering')" :disabled="!poiCounts.parkering"
                    class="flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border transition
                           bg-white/5 border-white/10 text-white/80 active:scale-[0.98]
                           disabled:opacity-35 disabled:active:scale-100">
              <span class="w-7 h-7 rounded-md bg-[#1f5d8a] text-white text-[13px] font-bold
                           flex items-center justify-center shrink-0">P</span>
              <span class="text-[11px]">Parkering</span>
            </button>
            <button @click="nearestPoiFromPoint('toalett')" :disabled="!poiCounts.toalett"
                    class="flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border transition
                           bg-white/5 border-white/10 text-white/80 active:scale-[0.98]
                           disabled:opacity-35 disabled:active:scale-100">
              <span class="w-7 h-7 rounded-md bg-[#1f5d8a] text-white text-[9px] font-bold
                           flex items-center justify-center shrink-0">WC</span>
              <span class="text-[11px]">Toalett</span>
            </button>
            <button @click="nearestPoiFromPoint('holdeplass')" :disabled="!poiCounts.holdeplass"
                    class="flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border transition
                           bg-white/5 border-white/10 text-white/80 active:scale-[0.98]
                           disabled:opacity-35 disabled:active:scale-100">
              <span class="w-7 h-7 rounded-md bg-[#1f5d8a] flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="#fff">
                  <path d="M6 3 h12 a2 2 0 0 1 2 2 v9 a2 2 0 0 1 -2 2 v1.5 a1 1 0 0 1 -2 0 V18 H8 v1.5 a1 1 0 0 1 -2 0 V16 a2 2 0 0 1 -2 -2 V5 a2 2 0 0 1 2 -2 Z"/>
                  <rect x="6.5" y="6" width="11" height="5" rx="0.6" fill="#1f5d8a"/>
                  <circle cx="8.5" cy="14" r="1.2" fill="#1f5d8a"/>
                  <circle cx="15.5" cy="14" r="1.2" fill="#1f5d8a"/>
                </svg>
              </span>
              <span class="text-[11px]">Buss / tog</span>
            </button>
          </div>

          <!-- Plasser annotering — kun for bruker-kart, og ikke mens
               sporing/måling pågår. -->
          <template v-if="ctxCanAnnotate">
            <div class="px-4 pt-4 pb-1 text-white/55 text-[10px] uppercase tracking-wide">
              Plasser annotering
            </div>
            <div class="px-4 pb-4 grid grid-cols-2 gap-2">
              <button v-for="s in ANNOTATION_SYMBOLS" :key="s.code"
                      @click="onPlaceAnnotationFromContext(s.symbolKey)"
                      class="px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98]
                             flex items-center gap-2 bg-white/5 border-white/10 text-white/80">
                <AnnotationIcon :symbol-key="s.symbolKey"/>
                <span class="truncate">{{ s.label }}</span>
              </button>
            </div>
          </template>
          <div v-else class="px-4 pt-3 pb-4 text-[10px] text-white/40 leading-snug">
            <template v-if="ctxBusy">
              Avslutt pågående {{ measureMode ? 'måling' : 'sporing' }} for flere valg.
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Perf-logg-modal: byggetider fra localStorage, med kopier-knapp så de
         kan deles (mobil-konsollen er upraktisk). Bottom-sheet stil. -->
    <div v-if="showPerfLog"
         class="absolute inset-0 z-[55] bg-black/60 backdrop-blur-sm flex items-end justify-center"
         @click.self="showPerfLog = false">
      <div class="w-full max-w-[560px] bg-zinc-900 border-t border-white/10 rounded-t-2xl p-4 max-h-[75dvh] flex flex-col">
        <div class="flex items-center justify-between mb-3">
          <div class="text-white text-sm font-semibold">Byggetider (perf-logg)</div>
          <button @click="showPerfLog = false" aria-label="Lukk"
                  class="w-8 h-8 rounded-full bg-white/5 border border-white/10
                         text-white/65 flex items-center justify-center active:scale-90">
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
                 stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="flex gap-2 mb-3">
          <button @click="copyPerfLog"
                  class="flex-1 px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98]"
                  :class="perfCopied
                          ? 'bg-emerald-500/20 border-emerald-400/50 text-white'
                          : 'bg-white/5 border-white/10 text-white/80'">
            {{ perfCopied ? 'Kopiert ✓' : 'Kopier alt' }}
          </button>
          <button @click="clearPerfLogAndRefresh"
                  class="px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98]
                         bg-white/5 border-white/10 text-white/60">
            Tøm
          </button>
        </div>

        <div v-if="!perfEntries.length" class="text-[12px] text-white/50 py-6 text-center">
          Ingen byggetider ennå. Lag et nytt kart (auto-kart eller «lag her»), så dukker tallene opp her.
        </div>
        <div v-else class="overflow-y-auto -mx-1 px-1">
          <div v-for="(e, i) in perfEntries" :key="i"
               class="mb-2 rounded-lg bg-zinc-950/70 border border-white/5 px-2.5 py-2">
            <div class="text-[9px] text-white/40 tabular-nums mb-0.5">
              {{ new Date(e.t).toLocaleString('no-NO') }}
            </div>
            <div class="text-[11px] text-emerald-200/90 font-mono break-all leading-snug">{{ e.msg }}</div>
          </div>
        </div>
      </div>
    </div>

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
                <text x="6" y="14" fill="#ec4899" font-size="11" font-weight="600">
                  {{ Math.round(profileFor(tr).maxElev) }} moh
                </text>
                <text x="6" y="174" fill="#ec4899" font-size="11" font-weight="600">
                  {{ Math.round(profileFor(tr).minElev) }} moh
                </text>
                <text x="594" y="14" fill="rgba(255,255,255,0.4)" font-size="10"
                      text-anchor="end">0 m</text>
                <text x="594" y="174" fill="rgba(255,255,255,0.4)" font-size="10"
                      text-anchor="end">
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

    <!-- Full-screen loader for on-the-fly kart-bygging. z-[60] over alt
         annet inkludert drawer + søk så ingen tilfeldige klikk lekker. -->
    <Transition name="overlay-fade">
      <div v-if="buildingOnTheFly"
           class="absolute inset-0 z-[60] bg-zinc-950/92 backdrop-blur-sm
                  flex flex-col items-center justify-center text-white">
        <div class="w-16 h-16 mb-4">
          <svg viewBox="0 0 50 50" class="w-full h-full animate-spin"
               fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round">
            <circle cx="25" cy="25" r="20" stroke-opacity="0.18"/>
            <path d="M25 5 a20 20 0 0 1 20 20"/>
          </svg>
        </div>
        <div class="text-[16px] font-semibold mb-1">Oppretter kart</div>
        <div class="text-[12px] text-white/65 px-6 text-center max-w-[280px]
                    min-h-[18px] leading-snug">
          {{ buildingProgress }}
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.drawer-enter-active, .drawer-leave-active { transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.drawer-enter-from, .drawer-leave-to       { transform: translateY(100%); }
/* Skjul scrollbar på tab-strip — fortsatt scrollbar med touch / wheel */
.map-tabs::-webkit-scrollbar { display: none; }
/* Søke-overlay — kort fade + svak slide ovenfra */
.search-fade-enter-active, .search-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.search-fade-enter-from, .search-fade-leave-to {
  opacity: 0; transform: translateY(-6px);
}
/* Highlight-chip — kun fade, så Tailwinds -translate-x-1/2 bevares */
.chip-fade-enter-active, .chip-fade-leave-active { transition: opacity 0.18s ease; }
.chip-fade-enter-from, .chip-fade-leave-to       { opacity: 0; }
/* On-the-fly inaktiv-hint og full-screen loader */
.hint-fade-enter-active, .hint-fade-leave-active { transition: opacity 0.18s ease; }
.hint-fade-enter-from, .hint-fade-leave-to       { opacity: 0; }
.overlay-fade-enter-active, .overlay-fade-leave-active { transition: opacity 0.22s ease; }
.overlay-fade-enter-from, .overlay-fade-leave-to       { opacity: 0; }
</style>

<!-- Ikke-scoped: kart-SVG-en injiseres via createElementNS (utenfor template-
      scope), så scoped-regler treffer den ikke. Navn-LOD-en (applyNameLOD)
     setter .name-lod-off på overflødige stedsnavn-tekster i tette utsnitt.
     Regelen lever her — ikke i symbolizer-CSS-en inni SVG-en — så den IKKE
     følger med ved SVG-eksport/print (der vil vi ha alle navn). -->
<style>
.isom-map .name-lod-off { display: none !important; }
</style>

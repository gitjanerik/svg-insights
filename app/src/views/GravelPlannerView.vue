<script setup>
// Ruteplanlegger (v12.1.0) — grusvei-turplanlegging for MC over lange
// avstander. UX fra Claude Design-handoff: to moduser via segmentkontroll —
//   «Utforsk»: grusvei-overlay i synlig utsnitt (Overpass, zoom-gatet)
//   «Planlegg»: A→B med tre ruteforslag fra BRouter (Mest grus / Balansert /
//   Kortest), fargekodet per segment, grus/asfalt-bar, stat-fliser (tid /
//   grus-strekk / luftlinje), GPX og lagrede ruter.
// Interaksjonskoden (pan/pinch/wheel/tiles) er forket fra MapPickerView —
// picker-en er halfKm-drevet med 8 km-tak; her trengs fri heltalls-zoom z5–z15.
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { tileMosaic, metersPerPixel } from '../lib/tileBackground.js'
import { lonLatToWorldPx, lonLatToScreenPx, screenPxToLonLat, viewBbox, bboxAreaKm2, TILE_SIZE } from '../lib/webMercator.js'
import { buildGravelQuery, extractGravelWays, bboxContains, padBbox, MIN_OVERLAY_ZOOM, MAX_OVERLAY_AREA_KM2 } from '../lib/gravelOverlay.js'
import { fetchOverpassWithRetry } from '../lib/overpassClient.js'
import { simplifyDP } from '../lib/pathUtils.js'
import { useNominatim } from '../composables/useNominatim.js'
import { useGravelPlanner } from '../composables/useGravelPlanner.js'
import { useDraggableDrawer } from '../composables/useDraggableDrawer.js'

const router = useRouter()
const planner = useGravelPlanner()
const {
  pointA, pointB, route, proposals, selectedId, routeState, routeError, savedRoutes,
} = planner

// Forslags-farger (design): Mest grus oransje, Balansert lilla, Kortest rød.
const PROPOSAL_COLORS = { 'mest-grus': '#e8802b', balansert: '#8b5cf6', kortest: '#ef4444' }

// ── Modus: Utforsk (overlay) / Planlegg (A→B) ───────────────────────────────
const mode = ref('utforsk')

// Planlegg-arket er en drabar drawer med samme UX som turkartets infodrawer:
// 45 dvh standard, dra i midtstilt håndtak for maksimér/standard/minimér.
// Minimert viser håndtak + kompakt tittel-/oppsummeringslinje, så brukeren
// kan se hele kartet og dra arket opp igjen. Kun maksimert dimmer kartet.
const SHEET_PEEK_PX = 92
// maxTopGapPx MÅ være større enn toppbaren (~106 px, z-30 over drawerens
// z-20) — med turkartets 56 px havnet håndtaket BAK toppbaren i maksimert
// tilstand og kunne ikke gripes (fanget av E2E).
const sheetDrawer = useDraggableDrawer({ expandedHeight: 0.45, minimizedPeek: SHEET_PEEK_PX, maxTopGapPx: 150, allowMinimize: true })
watch(mode, (m) => { if (m === 'planlegg') sheetDrawer.reset() })

// ── Kart-tilstand ───────────────────────────────────────────────────────────
const VIEW_LS_KEY = 'svg-insights-ruteplanlegger-view'
const ZOOM_MIN = 5
const ZOOM_MAX = 15

function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_LS_KEY) ?? 'null')
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon) && Number.isFinite(v.zoom)) {
      return { lat: v.lat, lon: v.lon, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v.zoom))) }
    }
  } catch { /* noop */ }
  // Default: Sør-Norge-oversikt.
  return { lat: 61.0, lon: 9.5, zoom: 6 }
}
const initial = loadView()
const center = ref({ lat: initial.lat, lon: initial.lon })
const zoom = ref(initial.zoom)
watch([center, zoom], () => {
  try { localStorage.setItem(VIEW_LS_KEY, JSON.stringify({ lat: center.value.lat, lon: center.value.lon, zoom: zoom.value })) } catch { /* noop */ }
})

const mapRef = ref(null)
const mapSize = ref({ w: 0, h: 0 })
function measureMap() {
  const r = mapRef.value?.getBoundingClientRect()
  if (r) mapSize.value = { w: r.width, h: r.height }
}

const view = computed(() => ({
  centerLat: center.value.lat, centerLon: center.value.lon,
  zoom: zoom.value, wPx: mapSize.value.w, hPx: mapSize.value.h,
}))

const tiles = computed(() => {
  if (!mapSize.value.w) return []
  return tileMosaic(center.value.lat, center.value.lon, zoom.value, mapSize.value)
})

// Kartverket-topo dekker bare Norge — feilede fliser skjules så OSM-underlaget
// viser gjennom (samme mønster som MapPickerView).
function onTopoTileError(e) {
  e.target.style.display = 'none'
}

// ── Pan / pinch / wheel / tap (forket fra MapPickerView, fri zoom) ─────────
let lastDist = 0
let pinching = false
let panning = false
let panStart = null
let pinchRatio = 1
let tapStart = null

function panShiftToCenter(dxPx, dyPx) {
  const mPerPx = metersPerPixel(center.value.lat, zoom.value)
  const dLat = (dyPx * mPerPx) / 111111
  const dLon = -(dxPx * mPerPx) / (111111 * Math.cos(center.value.lat * Math.PI / 180))
  return { dLat, dLon }
}

function stepZoom(delta, focusPx) {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.value + delta))
  if (next === zoom.value) return
  // Zoom rundt fokuspunktet (finger/markør): hold geo-punktet under fokus fast.
  if (focusPx && mapSize.value.w) {
    const geo = screenPxToLonLat(focusPx.x, focusPx.y, view.value)
    zoom.value = next
    const after = lonLatToScreenPx(geo.lon, geo.lat, view.value)
    const { dLat, dLon } = panShiftToCenter(focusPx.x - after.x, focusPx.y - after.y)
    center.value = { lat: center.value.lat + dLat, lon: center.value.lon + dLon }
  } else {
    zoom.value = next
  }
}

function localPoint(clientX, clientY) {
  const r = mapRef.value?.getBoundingClientRect()
  return r ? { x: clientX - r.left, y: clientY - r.top } : null
}

function touchDist(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX
  const dy = e.touches[0].clientY - e.touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

// Interaktive barn (zoom-knapper o.l.) skal ikke starte pan/tap på kartet —
// uten denne satte et tap på zoom-knappen et A/B-veipunkt (review-funn).
function onInteractiveChild(e) {
  return e.target instanceof Element && e.target.closest('button')
}

function onTouchStart(e) {
  if (onInteractiveChild(e)) return
  if (e.touches.length === 2) {
    pinching = true; panning = false; tapStart = null
    lastDist = touchDist(e); pinchRatio = 1
    e.preventDefault()
  } else if (e.touches.length === 1) {
    panning = true; pinching = false
    const t = e.touches[0]
    panStart = { x: t.clientX, y: t.clientY, lat: center.value.lat, lon: center.value.lon }
    tapStart = { x: t.clientX, y: t.clientY, t: Date.now() }
  }
}
function onTouchMove(e) {
  if (pinching && e.touches.length === 2) {
    e.preventDefault()
    const d = touchDist(e)
    pinchRatio *= d / lastDist
    lastDist = d
    // Diskret zoom-trapp: step når akkumulert ratio passerer terskel, re-anchor.
    const mid = localPoint(
      (e.touches[0].clientX + e.touches[1].clientX) / 2,
      (e.touches[0].clientY + e.touches[1].clientY) / 2,
    )
    if (pinchRatio > 1.4) { stepZoom(1, mid); pinchRatio = 1 }
    else if (pinchRatio < 0.7) { stepZoom(-1, mid); pinchRatio = 1 }
  } else if (panning && e.touches.length === 1 && panStart) {
    e.preventDefault()
    const dxPx = e.touches[0].clientX - panStart.x
    const dyPx = e.touches[0].clientY - panStart.y
    if (tapStart && Math.hypot(dxPx, dyPx) > 8) tapStart = null
    const { dLat, dLon } = panShiftToCenter(dxPx, dyPx)
    center.value = { lat: panStart.lat + dLat, lon: panStart.lon + dLon }
  }
}
function onTouchEnd(e) {
  if (e.touches.length < 2) { pinching = false; pinchRatio = 1 }
  if (e.touches.length < 1) {
    if (tapStart && Date.now() - tapStart.t < 400) {
      const p = localPoint(tapStart.x, tapStart.y)
      if (p) onMapTap(p)
    }
    panning = false; panStart = null; tapStart = null
  }
}
function onMouseDown(e) {
  if (e.button !== 0 || onInteractiveChild(e)) return
  panning = true
  panStart = { x: e.clientX, y: e.clientY, lat: center.value.lat, lon: center.value.lon }
  tapStart = { x: e.clientX, y: e.clientY, t: Date.now() }
  e.preventDefault()
}
function onMouseMove(e) {
  if (!panning || !panStart) return
  e.preventDefault()
  const dxPx = e.clientX - panStart.x
  const dyPx = e.clientY - panStart.y
  if (tapStart && Math.hypot(dxPx, dyPx) > 8) tapStart = null
  const { dLat, dLon } = panShiftToCenter(dxPx, dyPx)
  center.value = { lat: panStart.lat + dLat, lon: panStart.lon + dLon }
}
function onMouseUp(e) {
  if (panning && tapStart && Date.now() - tapStart.t < 400) {
    const p = localPoint(e.clientX, e.clientY)
    if (p) onMapTap(p)
  }
  panning = false; panStart = null; tapStart = null
}
let wheelThrottle = 0
function onWheel(e) {
  e.preventDefault()
  const now = Date.now()
  if (now - wheelThrottle < 150) return
  wheelThrottle = now
  stepZoom(e.deltaY > 0 ? -1 : 1, localPoint(e.clientX, e.clientY))
}

// ── Fra/Til-valg: søk, GPS, bytt, tap-to-set ────────────────────────────────
const searchA = useNominatim()
const searchB = useNominatim()
const activeSearch = ref(null)       // 'A' | 'B' | null — hvilken dropdown vises
const armedField = ref(null)         // 'A' | 'B' | null — «velg i kartet»

function labelFor(p) {
  return p?.name ?? (p ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : '')
}

function setPoint(field, p, { pan = false } = {}) {
  if (field === 'A') { pointA.value = p; searchA.query.value = p ? labelFor(p) : '' }
  else { pointB.value = p; searchB.query.value = p ? labelFor(p) : '' }
  activeSearch.value = null
  armedField.value = null
  if (pan && p) {
    center.value = { lat: p.lat, lon: p.lon }
    if (zoom.value < 9) zoom.value = 9
  }
}

function swapPoints() {
  const a = pointA.value
  setPoint('A', pointB.value)
  setPoint('B', a)
}

function selectResult(field, r) {
  setPoint(field, { lat: r.lat, lon: r.lon, name: r.shortName ?? r.name }, { pan: true })
}

// Dropdown vises kun når brukeren faktisk har skrevet noe annet enn valgt
// punkts etikett — setPoint skriver query programmatisk, og uten denne vakta
// trigget det et Nominatim-søk på etiketten og gjenåpnet stale treff ved fokus.
function showDropdown(field) {
  const s = field === 'A' ? searchA : searchB
  const p = field === 'A' ? pointA.value : pointB.value
  return activeSearch.value === field && s.results.value.length > 0 && s.query.value !== labelFor(p)
}

function onMapTap(px) {
  if (mode.value !== 'planlegg') return
  // Tap setter armert felt, ellers første tomme (A først, så B).
  const field = armedField.value ?? (!pointA.value ? 'A' : (!pointB.value ? 'B' : null))
  if (!field) return
  const geo = screenPxToLonLat(px.x, px.y, view.value)
  setPoint(field, {
    lat: geo.lat, lon: geo.lon,
    name: `Punkt ${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}`,
  })
}

const gpsState = ref({ status: 'idle', error: '' })
function onGpsForA() {
  if (!navigator.geolocation) { gpsState.value = { status: 'idle', error: 'GPS er ikke tilgjengelig' }; return }
  gpsState.value = { status: 'locating', error: '' }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gpsState.value = { status: 'idle', error: '' }
      setPoint('A', { lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'Min posisjon' }, { pan: true })
    },
    () => { gpsState.value = { status: 'idle', error: 'Fikk ikke posisjon — sjekk stedstillatelsen' } },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  )
}

// ── Grusvei-overlay (Utforsk-modus): hent + tegn ────────────────────────────
const overlayState = ref('idle')     // 'idle' | 'loading' | 'error'
const overlayWays = ref([])          // [{id, kind, worldPts:[[x,y]…]}] i world-px ved fetchZoom
const overlayFetchZoom = ref(null)
let overlayFetchedBbox = null
let overlayAbort = null
let overlayDebounce = null

const overlayGated = computed(() =>
  zoom.value < MIN_OVERLAY_ZOOM ||
  (mapSize.value.w > 0 && bboxAreaKm2(viewBbox(view.value)) > MAX_OVERLAY_AREA_KM2))

async function refreshOverlay() {
  if (!mapSize.value.w || mode.value !== 'utforsk') return
  if (overlayGated.value) {
    overlayAbort?.abort()
    overlayWays.value = []
    overlayFetchedBbox = null
    overlayState.value = 'idle'
    return
  }
  const visible = viewBbox(view.value)
  const sameBand = overlayFetchZoom.value != null && Math.abs(zoom.value - overlayFetchZoom.value) < 2
  if (sameBand && bboxContains(overlayFetchedBbox, visible)) return   // dekket — kun re-projisering
  overlayAbort?.abort()
  const ac = new AbortController()
  overlayAbort = ac
  overlayState.value = 'loading'
  const fetchBbox = padBbox(visible, 1.5)
  const fetchZoom = zoom.value
  try {
    const json = await fetchOverpassWithRetry(
      'data=' + encodeURIComponent(buildGravelQuery(fetchBbox)),
      { signal: ac.signal, timeoutMs: 25000 },
    )
    if (ac.signal.aborted) return
    overlayWays.value = extractGravelWays(json).map((w) => ({
      id: w.id,
      kind: w.kind,
      worldPts: simplifyDP(
        w.points.map(([lon, lat]) => { const p = lonLatToWorldPx(lon, lat, fetchZoom); return [p.x, p.y] }),
        0.75,
      ),
    }))
    overlayFetchedBbox = fetchBbox
    overlayFetchZoom.value = fetchZoom
    overlayState.value = 'idle'
  } catch (e) {
    if (ac.signal.aborted) return
    console.warn('[Ruteplanlegger] overlay-henting feilet:', e?.message ?? e)
    overlayState.value = 'error'
    setTimeout(() => { if (overlayState.value === 'error') overlayState.value = 'idle' }, 4000)
  }
}

watch([center, zoom, mapSize, mode], () => {
  if (overlayDebounce) clearTimeout(overlayDebounce)
  overlayDebounce = setTimeout(refreshOverlay, 400)
}, { deep: true })

// world-px (fetchZoom) → skjerm-px path-streng for gjeldende view.
const overlayPaths = computed(() => {
  if (mode.value !== 'utforsk' || !overlayWays.value.length || !mapSize.value.w) return []
  const scale = Math.pow(2, zoom.value - overlayFetchZoom.value)
  const c = lonLatToWorldPx(center.value.lon, center.value.lat, zoom.value)
  const ox = mapSize.value.w / 2 - c.x
  const oy = mapSize.value.h / 2 - c.y
  return overlayWays.value.map((w) => ({
    id: w.id,
    kind: w.kind,
    d: 'M' + w.worldPts.map(([x, y]) => `${(x * scale + ox).toFixed(1)} ${(y * scale + oy).toFixed(1)}`).join(' L'),
  }))
})

// ── Rute-tegning (Planlegg-modus) ───────────────────────────────────────────
const routePaths = computed(() => {
  const r = route.value
  if (mode.value !== 'planlegg' || !r || !mapSize.value.w) return []
  const toPx = ([lon, lat]) => {
    const p = lonLatToScreenPx(lon, lat, view.value)
    return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  }
  if (!r.segments) {
    return [{ key: 'hele', gravel: true, d: 'M' + r.points.map(toPx).join(' L') }]
  }
  return r.segments
    .filter((s) => s.toIdx > s.fromIdx)
    .map((s, i) => ({
      key: `${i}-${s.fromIdx}`,
      gravel: s.gravel,
      d: 'M' + r.points.slice(s.fromIdx, s.toIdx + 1).map(toPx).join(' L'),
    }))
})

const markerA = computed(() => mode.value === 'planlegg' && pointA.value && mapSize.value.w
  ? lonLatToScreenPx(pointA.value.lon, pointA.value.lat, view.value) : null)
const markerB = computed(() => mode.value === 'planlegg' && pointB.value && mapSize.value.w
  ? lonLatToScreenPx(pointB.value.lon, pointB.value.lat, view.value) : null)

// ── Rute-kort, forslag + lagring ────────────────────────────────────────────
const showSaved = ref(false)
// Refresh lista hver gang arket åpnes — ruter kan være lagret i en annen
// fane/økt siden mount.
watch(showSaved, (open) => { if (open) void planner.refreshSaved() })
const saveName = ref('')
const savingName = ref(false)
const savedFlash = ref('')
const confirmDeleteId = ref(null)
const confirmDeleteAll = ref(false)

function fmtKm(m) {
  if (m == null) return '–'
  const km = m / 1000
  return km >= 100 ? km.toFixed(0) : km.toFixed(1)
}
function fmtTid(s) {
  if (!s) return null
  const min = Math.round(s / 60)
  const t = Math.floor(min / 60)
  return t > 0 ? `${t} t ${String(min % 60).padStart(2, '0')} min` : `${min} min`
}
function fmtGrus(share) {
  return share != null ? `${Math.round(share * 100)} %` : null
}

async function onFindRoute() {
  activeSearch.value = null
  await planner.computeRoute()
  if (route.value?.points?.length && mapSize.value.w) {
    // Sentrer på rutas midtpunkt (grov innramming — brukeren justerer selv).
    const mid = route.value.points[Math.floor(route.value.points.length / 2)]
    center.value = { lat: mid[1], lon: mid[0] }
    sheetDrawer.reset()   // resultatet åpner i standard-høyde
  }
}

function startSave() {
  saveName.value = route.value?.navn ??
    `${pointA.value?.name ?? 'A'} – ${pointB.value?.name ?? 'B'}`
  savingName.value = true
}
const saveBusy = ref(false)
async function confirmSave() {
  if (saveBusy.value) return   // dobbel-tap skal ikke lagre duplikat
  saveBusy.value = true
  try {
    const rec = await planner.saveCurrentRoute(saveName.value.trim())
    savingName.value = false
    if (rec) { savedFlash.value = 'Ruta er lagret'; setTimeout(() => { savedFlash.value = '' }, 2000) }
  } catch (e) {
    console.warn('[Ruteplanlegger] lagring feilet:', e?.message ?? e)
    savedFlash.value = 'Lagring feilet — prøv igjen'
    setTimeout(() => { savedFlash.value = '' }, 3000)
  } finally {
    saveBusy.value = false
  }
}

function onOpenSaved(rec) {
  planner.openSaved(rec)
  showSaved.value = false
  mode.value = 'planlegg'
  sheetDrawer.reset()
  const mid = rec.points[Math.floor(rec.points.length / 2)]
  if (mid) center.value = { lat: mid[1], lon: mid[0] }
  if (zoom.value < 8) zoom.value = 8
  searchA.query.value = labelFor(pointA.value)
  searchB.query.value = labelFor(pointB.value)
}

async function onDeleteSaved(id) {
  if (confirmDeleteId.value !== id) { confirmDeleteId.value = id; return }
  confirmDeleteId.value = null
  await planner.deleteSaved(id)
}
async function onDeleteAll() {
  if (!confirmDeleteAll.value) { confirmDeleteAll.value = true; return }
  confirmDeleteAll.value = false
  await planner.deleteAllSaved()
}

function onReset() {
  planner.clearRoute()
  setPoint('A', null)
  setPoint('B', null)
}

const isOffline = ref(!navigator.onLine)
const onlineHandler = () => { isOffline.value = false }
const offlineHandler = () => { isOffline.value = true }

let mapResizeObs = null
onMounted(() => {
  nextTick(() => {
    measureMap()
    // ResizeObserver fanger layout-endringer window-resize ikke ser
    // (adressefelt-kollaps på mobil, rotasjon, framtidige layout-skift).
    if (mapRef.value && typeof ResizeObserver !== 'undefined') {
      mapResizeObs = new ResizeObserver(measureMap)
      mapResizeObs.observe(mapRef.value)
    }
  })
  window.addEventListener('resize', measureMap)
  window.addEventListener('online', onlineHandler)
  window.addEventListener('offline', offlineHandler)
  void planner.refreshSaved()
})
onUnmounted(() => {
  mapResizeObs?.disconnect()
  window.removeEventListener('resize', measureMap)
  window.removeEventListener('online', onlineHandler)
  window.removeEventListener('offline', offlineHandler)
  overlayAbort?.abort()
  if (overlayDebounce) clearTimeout(overlayDebounce)
})
</script>

<template>
  <div class="relative h-[100dvh] bg-[#0e1116] text-white/90 overflow-hidden flex flex-col">

    <!-- Toppbar: tilbake · tittel · lagrede ruter (badge) -->
    <div class="shrink-0 z-30 bg-zinc-950/90 backdrop-blur border-b border-white/10">
      <div class="flex items-center gap-2 px-3 py-2.5">
        <button @click="router.push('/')" aria-label="Tilbake"
                class="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 border border-white/10
                       text-white/70 active:scale-95 transition shrink-0">
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="flex-1 text-center text-[15px] font-semibold text-white truncate">Ruteplanlegger</div>
        <button @click="showSaved = true" aria-label="Lagrede ruter"
                class="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 border border-white/10
                       text-white/70 active:scale-95 transition shrink-0 relative">
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <span v-if="savedRoutes.length"
                class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-sky-500 text-[9px]
                       font-bold text-white flex items-center justify-center">{{ savedRoutes.length }}</span>
        </button>
      </div>
      <!-- Modus-segmentkontroll: Utforsk / Planlegg -->
      <div class="px-3 pb-2.5 flex justify-center">
        <div class="inline-flex rounded-full bg-white/[0.06] border border-white/10 p-1" role="group" aria-label="Modus">
          <button @click="mode = 'utforsk'" :aria-pressed="mode === 'utforsk'"
                  class="px-4 py-1.5 rounded-full text-[12px] font-medium transition flex items-center gap-1.5"
                  :class="mode === 'utforsk' ? 'bg-emerald-500 text-white' : 'text-white/60'">
            <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/></svg>
            Utforsk
          </button>
          <button @click="mode = 'planlegg'" :aria-pressed="mode === 'planlegg'"
                  class="px-4 py-1.5 rounded-full text-[12px] font-medium transition flex items-center gap-1.5"
                  :class="mode === 'planlegg' ? 'bg-emerald-500 text-white' : 'text-white/60'">
            <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round"><path d="M4 19 L10 7 L15 15 L20 5"/></svg>
            Planlegg
          </button>
        </div>
      </div>
    </div>

    <!-- Kart -->
    <div ref="mapRef"
         class="relative flex-1 overflow-hidden bg-zinc-800 cursor-move touch-none select-none"
         @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchEnd"
         @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp"
         @wheel="onWheel">
      <!-- OSM-underlag (global dekning) + Kartverket-topo over (skjules ved feil) -->
      <img v-for="t in tiles" :key="'osm-' + t.url" :src="t.osmUrl" alt=""
           class="absolute pointer-events-none select-none"
           :style="{ left: t.leftPx + 'px', top: t.topPx + 'px', width: TILE_SIZE + 'px', height: TILE_SIZE + 'px' }"
           draggable="false" />
      <img v-for="t in tiles" :key="t.url" :src="t.url" alt=""
           class="absolute pointer-events-none select-none"
           :style="{ left: t.leftPx + 'px', top: t.topPx + 'px', width: TILE_SIZE + 'px', height: TILE_SIZE + 'px' }"
           draggable="false" @error="onTopoTileError" />

      <!-- Grusvei-overlay + rute (skjerm-px-rom, samme som tilene) -->
      <svg class="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
        <path v-for="w in overlayPaths" :key="'ov-' + w.id" :d="w.d" fill="none"
              stroke="#c2703d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
              :stroke-dasharray="w.kind === 'assumed' ? '6 4' : undefined" opacity="0.85" />
        <template v-if="routePaths.length">
          <path v-for="s in routePaths" :key="'halo-' + s.key" :d="s.d" fill="none"
                stroke="#0e1116" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" />
          <path v-for="s in routePaths" :key="'rt-' + s.key" :d="s.d" fill="none"
                :stroke="s.gravel ? '#e8802b' : '#94a3b8'" stroke-width="4.5"
                stroke-linecap="round" stroke-linejoin="round" />
        </template>
      </svg>

      <!-- A/B-markører -->
      <div v-if="markerA" class="absolute pointer-events-none -translate-x-1/2 -translate-y-full"
           :style="{ left: markerA.x + 'px', top: markerA.y + 'px' }">
        <div class="w-6 h-6 rounded-full bg-emerald-500 border-2 border-white shadow-lg flex items-center
                    justify-center text-[11px] font-bold text-white">A</div>
      </div>
      <div v-if="markerB" class="absolute pointer-events-none -translate-x-1/2 -translate-y-full"
           :style="{ left: markerB.x + 'px', top: markerB.y + 'px' }">
        <div class="w-6 h-6 rounded-full bg-rose-500 border-2 border-white shadow-lg flex items-center
                    justify-center text-[11px] font-bold text-white">B</div>
      </div>

      <!-- Zoom-knapper + nivå-badge -->
      <div class="absolute right-3 top-3 z-10 flex flex-col items-center gap-1.5">
        <button @click.stop="stepZoom(1)" aria-label="Zoom inn"
                class="w-9 h-9 rounded-lg bg-zinc-950/90 border border-white/15 text-white text-lg font-medium
                       flex items-center justify-center active:scale-95 transition">+</button>
        <button @click.stop="stepZoom(-1)" aria-label="Zoom ut"
                class="w-9 h-9 rounded-lg bg-zinc-950/90 border border-white/15 text-white text-lg font-medium
                       flex items-center justify-center active:scale-95 transition">−</button>
        <div class="px-1.5 py-0.5 rounded-md bg-zinc-950/85 border border-white/15 text-white/60 text-[10px]
                    tabular-nums pointer-events-none">z{{ zoom }}</div>
      </div>

      <!-- Status-chips: armert tap-to-set / overlay-gate / lasting / feil -->
      <div class="absolute left-1/2 -translate-x-1/2 top-3 z-10 flex flex-col items-center gap-1.5 pointer-events-none">
        <div v-if="mode === 'planlegg' && armedField"
             class="px-3 py-1.5 rounded-full bg-sky-500/90 text-white text-[12px] font-medium shadow-lg">
          Trykk i kartet for å sette {{ armedField === 'A' ? 'start' : 'mål' }}
        </div>
        <div v-else-if="mode === 'utforsk' && overlayGated"
             class="px-3 py-1.5 rounded-full bg-zinc-950/85 border border-white/15 text-white/75 text-[11px] shadow">
          Zoom inn for å se grusveier
        </div>
        <div v-if="overlayState === 'loading'"
             class="px-3 py-1.5 rounded-full bg-zinc-950/85 border border-white/15 text-white/75 text-[11px]
                    shadow flex items-center gap-2">
          <span class="w-3 h-3 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></span>
          Henter grusveier …
        </div>
        <div v-if="overlayState === 'error'"
             class="px-3 py-1.5 rounded-full bg-amber-500/90 text-zinc-950 text-[11px] font-medium shadow">
          Fikk ikke lastet grusvei-laget
        </div>
      </div>

      <!-- Tegnforklaring (Utforsk-modus) -->
      <div v-if="mode === 'utforsk' && overlayPaths.length"
           class="absolute left-3 bottom-3 z-10 rounded-lg bg-zinc-950/85 border border-white/15 px-2.5 py-2
                  pointer-events-none">
        <div class="text-[9px] uppercase tracking-wide text-white/45 mb-1">Grusveier</div>
        <div class="text-[10px] text-white/75 space-y-1">
          <div class="flex items-center gap-1.5">
            <span class="inline-block w-5 h-0 border-t-[3px] border-[#c2703d] rounded"></span> Bekreftet grus
          </div>
          <div class="flex items-center gap-1.5">
            <span class="inline-block w-5 h-0 border-t-[3px] border-dashed border-[#c2703d] rounded"></span>
            Antatt grus (skogsbilvei)
          </div>
        </div>
      </div>

      <!-- Attribusjon -->
      <div class="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-zinc-900/85 text-white/60 text-[8px]
                  border border-white/15 leading-tight pointer-events-none z-10">
        © Kartverket · © OpenStreetMap-bidragsytere · Ruting: BRouter (brouter.de)
      </div>
    </div>

    <!-- Feilbanner (ruting / offline) -->
    <div v-if="isOffline || routeState === 'error'"
         class="absolute left-3 right-3 bottom-24 z-30 max-w-[560px] mx-auto rounded-xl border px-4 py-3
                text-[13px] shadow-2xl"
         :class="isOffline ? 'bg-zinc-900/95 border-white/15 text-white/80'
                           : 'bg-rose-950/95 border-rose-500/40 text-rose-100'">
      <template v-if="isOffline">Ruteplanleggeren krever nettilkobling.</template>
      <template v-else>
        {{ routeError }}
        <button @click="onFindRoute" class="ml-2 underline underline-offset-2 font-medium">Prøv igjen</button>
      </template>
    </div>

    <!-- PLANLEGG: drabar drawer (samme UX som turkartets infodrawer) — bytter
         mellom Fra/Til-skjema og rute-resultat. Kun maksimert dimmer/sperrer
         kartet; ellers er kartet interaktivt bak (tap-to-set virker med
         drawer i standard/minimert høyde). -->
    <div v-if="mode === 'planlegg'"
         class="absolute inset-0 z-20 flex items-end justify-center transition-colors duration-200"
         :class="sheetDrawer.isMaximized.value ? 'bg-black/60' : 'bg-transparent pointer-events-none'"
         @click.self="sheetDrawer.reset()">
      <div class="w-full max-w-[560px] bg-zinc-900 border-t border-white/10 rounded-t-2xl flex flex-col pointer-events-auto"
           :style="sheetDrawer.drawerHeightStyle.value">
        <!-- Dra-håndtak: samme hit-flate og følsomhet som infodraweren. -->
        <div class="shrink-0 touch-none cursor-grab active:cursor-grabbing pt-3.5 pb-2 flex justify-center"
             @pointerdown="sheetDrawer.onPointerDown($event)"
             @pointermove="sheetDrawer.onPointerMove($event)"
             @pointerup="sheetDrawer.onPointerUp($event)"
             @pointercancel="sheetDrawer.onPointerUp($event)">
          <div class="w-12 h-1.5 rounded-full bg-white/40"
               :style="{ opacity: sheetDrawer.handleOpacity.value }"></div>
        </div>
        <!-- Kompakt header — synlig også i minimert peek -->
        <div class="shrink-0 px-4 pb-2">
          <template v-if="route && routeState !== 'routing'">
            <div class="text-[10px] uppercase tracking-wide text-white/45">Grusrute</div>
            <div class="flex items-baseline gap-2 mt-0.5">
              <span class="text-[26px] leading-none font-bold text-white tabular-nums">{{ fmtKm(route.lengthM) }} km</span>
              <span v-if="fmtGrus(route.gravelShare)" class="text-[14px] font-semibold text-[#e8802b]">
                · Grus {{ fmtGrus(route.gravelShare) }}</span>
              <span v-else class="text-[12px] text-white/45">· Grusandel utilgjengelig</span>
            </div>
          </template>
          <template v-else>
            <div class="text-[14px] font-semibold text-white">Planlegg grusrute</div>
          </template>
        </div>
        <!-- Innhold (skjules i minimert peek) -->
        <div v-show="!sheetDrawer.isMinimized.value"
             class="flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]">

        <!-- Fra/Til-skjema -->
        <template v-if="!route || routeState === 'routing'">
        <div v-for="field in ['A', 'B']" :key="field" class="relative">
          <div v-if="field === 'B'" class="flex justify-center -my-1 relative z-10">
            <button @click="swapPoints" aria-label="Bytt start og mål"
                    class="w-8 h-8 rounded-full bg-zinc-800 border border-white/15 text-white/70
                           flex items-center justify-center active:scale-90 transition">
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 4v13M8 4 5 7M8 4l3 3"/><path d="M16 20V7m0 13 3-3m-3 3-3-3"/>
              </svg>
            </button>
          </div>
          <div class="flex items-center gap-2 rounded-xl bg-white/[0.05] border border-white/10 px-3 py-1"
               :class="field === 'B' ? '' : 'mb-0'">
            <span class="w-2.5 h-2.5 shrink-0 rounded-full"
                  :class="field === 'A' ? 'bg-emerald-500' : 'bg-rose-500'"></span>
            <input :value="field === 'A' ? searchA.query.value : searchB.query.value"
                   @input="(field === 'A' ? searchA : searchB).query.value = $event.target.value; activeSearch = field"
                   @focus="activeSearch = field"
                   type="search" autocomplete="off"
                   :placeholder="field === 'A' ? 'Fra — startsted' : 'Til — destinasjon'"
                   class="flex-1 min-w-0 py-2 bg-transparent text-[13px] placeholder-white/35
                          focus:outline-none" />
            <button v-if="field === 'A'" @click="onGpsForA" aria-label="Bruk min posisjon som start"
                    :disabled="gpsState.status === 'locating'"
                    class="w-8 h-8 shrink-0 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300
                           flex items-center justify-center active:scale-95 transition disabled:opacity-50">
              <svg viewBox="0 0 24 24" class="w-4 h-4" :class="gpsState.status === 'locating' ? 'animate-spin' : ''"
                   fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <template v-if="gpsState.status === 'locating'"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></template>
                <template v-else>
                  <circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>
                  <line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/>
                  <line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/>
                </template>
              </svg>
            </button>
            <button @click="armedField = armedField === field ? null : field"
                    :aria-pressed="armedField === field"
                    :aria-label="`Velg ${field === 'A' ? 'start' : 'mål'} i kartet`"
                    class="w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center active:scale-95 transition"
                    :class="armedField === field ? 'bg-sky-500/25 border-sky-400/50 text-sky-200' : 'bg-white/5 border-white/10 text-white/60'">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
            </button>
          </div>
          <!-- Nominatim-treff (åpner OPPOVER så de ikke drukner under sheeten) -->
          <div v-if="showDropdown(field)"
               class="absolute left-0 right-0 bottom-full mb-1 rounded-xl bg-zinc-900/98 backdrop-blur
                      border border-white/10 shadow-2xl max-h-[36dvh] overflow-y-auto z-30">
            <button v-for="r in (field === 'A' ? searchA : searchB).results.value" :key="r.id"
                    @click="selectResult(field, r)"
                    class="w-full text-left px-3 py-2 active:bg-white/10 transition border-b border-white/8 last:border-0">
              <div class="text-[13px] font-medium text-white truncate">{{ r.shortName }}</div>
              <div class="text-[11px] text-white/50 truncate">{{ r.name }}</div>
            </button>
          </div>
        </div>
        <div v-if="gpsState.error" class="mt-1.5 text-[11px] text-amber-300">{{ gpsState.error }}</div>
        <button @click="onFindRoute" :disabled="!pointA || !pointB || routeState === 'routing'"
                class="w-full mt-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold border transition
                       active:scale-[0.99] disabled:opacity-40
                       bg-emerald-500/20 border-emerald-400/50 text-emerald-100 flex items-center justify-center gap-2">
          <span v-if="routeState === 'routing'"
                class="w-4 h-4 border-2 border-emerald-200/30 border-t-emerald-100 rounded-full animate-spin"></span>
          {{ routeState === 'routing' ? 'Beregner tre ruteforslag …' : 'Finn grusrute' }}
        </button>
        </template>

        <!-- Rute-resultat (GRUSRUTE-headeren ligger i drawer-headeren over) -->
        <template v-else>
        <div class="text-[12px] text-white/50 truncate">
          <template v-if="route.usedFallbackProfile">Standard grusprofil · </template>
          {{ route.navn ?? `${labelFor(pointA)} → ${labelFor(pointB)}` }}
        </div>

        <!-- Ruteforslag -->
        <template v-if="proposals.length > 1">
          <div class="flex items-center justify-between mt-3 mb-1.5">
            <div class="text-[10px] uppercase tracking-wide text-white/45">{{ proposals.length }} ruteforslag</div>
            <div v-if="route.directM" class="text-[11px] text-white/45 tabular-nums">Luftlinje {{ fmtKm(route.directM) }} km</div>
          </div>
          <button v-for="p in proposals" :key="p.id" @click="planner.selectProposal(p.id)"
                  class="w-full rounded-lg px-3 py-2.5 mb-1.5 flex items-center gap-3 text-left border transition
                         active:scale-[0.99]"
                  :class="selectedId === p.id ? 'bg-white/[0.08] border-white/25' : 'bg-white/[0.03] border-white/10'">
            <span class="w-2.5 h-2.5 shrink-0 rounded-full" :style="{ background: PROPOSAL_COLORS[p.id] ?? '#e8802b' }"></span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-[13px] text-white font-medium">{{ p.label }}</span>
                <span v-if="p.badge" class="px-1.5 py-0.5 rounded-md bg-sky-500/25 border border-sky-400/40
                             text-sky-200 text-[9px] font-bold tracking-wide">{{ p.badge }}</span>
              </div>
              <div class="text-[11px] text-white/50 tabular-nums">
                {{ fmtKm(p.lengthM) }} km<template v-if="fmtGrus(p.gravelShare)"> · Grus {{ fmtGrus(p.gravelShare) }}</template><template v-if="fmtTid(p.totalTimeS)"> · {{ fmtTid(p.totalTimeS) }}</template>
              </div>
            </div>
            <svg v-if="selectedId === p.id" viewBox="0 0 24 24" class="w-4 h-4 text-emerald-400 shrink-0"
                 fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
                 stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </template>

        <!-- Grus/asfalt-bar -->
        <template v-if="route.gravelShare != null">
          <div class="mt-2 h-2 rounded-full overflow-hidden bg-[#94a3b8]/60 flex">
            <div class="h-full bg-[#e8802b]" :style="{ width: Math.round(route.gravelShare * 100) + '%' }"></div>
          </div>
          <div class="flex justify-between mt-1 text-[11px] text-white/55">
            <span><span class="inline-block w-2 h-2 rounded-sm bg-[#e8802b] mr-1"></span>Grus {{ fmtGrus(route.gravelShare) }}</span>
            <span><span class="inline-block w-2 h-2 rounded-sm bg-[#94a3b8] mr-1"></span>Asfalt {{ Math.round((1 - route.gravelShare) * 100) }} %</span>
          </div>
        </template>

        <!-- Stat-fliser -->
        <div class="grid grid-cols-3 gap-2 mt-3">
          <div class="rounded-lg bg-white/5 px-2.5 py-2">
            <div class="text-[10px] text-white/45">Estimert tid</div>
            <div class="text-[13px] font-semibold text-white tabular-nums">{{ fmtTid(route.totalTimeS) ?? '–' }}</div>
          </div>
          <div class="rounded-lg bg-white/5 px-2.5 py-2">
            <div class="text-[10px] text-white/45">Grus-strekk</div>
            <div class="text-[13px] font-semibold text-white tabular-nums">
              {{ route.gravelM != null ? fmtKm(route.gravelM) + ' km' : '–' }}</div>
          </div>
          <div class="rounded-lg bg-white/5 px-2.5 py-2">
            <div class="text-[10px] text-white/45">Luftlinje</div>
            <div class="text-[13px] font-semibold text-white tabular-nums">
              {{ route.directM != null ? fmtKm(route.directM) + ' km' : '–' }}</div>
          </div>
        </div>

        <!-- Handlinger -->
        <div class="flex gap-1.5 mt-3">
          <button @click="planner.exportGpx()" aria-label="Last ned GPX"
                  class="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border bg-white/5 border-white/15
                         text-white/80 active:scale-95 transition">GPX</button>
          <button @click="startSave" aria-label="Lagre rute"
                  class="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border bg-emerald-500/15
                         border-emerald-400/40 text-emerald-100 active:scale-95 transition">Lagre</button>
          <button @click="onReset" aria-label="Nullstill rute"
                  class="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border bg-white/5 border-white/15
                         text-white/60 active:scale-95 transition">Nullstill</button>
        </div>
        <div v-if="savingName" class="mt-2 flex gap-2">
          <input v-model="saveName" type="text" placeholder="Navn på ruta"
                 class="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/[0.06] border border-white/15 text-[13px]
                        placeholder-white/30 focus:outline-none focus:border-emerald-300/50 transition" />
          <button @click="confirmSave"
                  class="px-4 py-2 rounded-lg text-[12px] font-semibold bg-emerald-500 text-white
                         active:scale-95 transition">Lagre</button>
          <button @click="savingName = false"
                  class="px-3 py-2 rounded-lg text-[12px] border bg-white/5 border-white/15 text-white/60
                         active:scale-95 transition">Avbryt</button>
        </div>
        <div v-if="savedFlash" class="mt-1.5 text-center text-[11px] text-emerald-300">{{ savedFlash }}</div>
        </template>

        </div>
      </div>
    </div>

    <!-- Mine ruter (slide-over) -->
    <Transition name="overlay-fade">
      <div v-if="showSaved" class="absolute inset-0 z-40 flex items-end justify-center bg-black/60"
           @click.self="showSaved = false">
        <div class="w-full max-w-[560px] bg-zinc-900 border-t border-white/10 rounded-t-2xl max-h-[70dvh] flex flex-col">
          <div class="shrink-0 px-4 pt-3.5 pb-2.5 border-b border-white/8 flex items-center justify-between gap-3">
            <div class="text-white text-[14px] font-semibold">Mine ruter
              <span v-if="savedRoutes.length" class="text-white/45 font-normal text-[12px]">· {{ savedRoutes.length }} ruter</span>
            </div>
            <button @click="showSaved = false" aria-label="Lukk"
                    class="w-8 h-8 shrink-0 rounded-full flex items-center justify-center bg-white/5
                           border border-white/10 text-white/60 active:scale-90 transition">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto px-4 py-3">
            <div v-if="!savedRoutes.length" class="text-[13px] text-white/50 text-center py-6">
              Ingen lagrede ruter ennå. Beregn en rute i Planlegg-modus og trykk «Lagre».
            </div>
            <div v-for="rec in savedRoutes" :key="rec.id"
                 class="rounded-lg bg-white/5 px-3 py-2.5 mb-2 flex items-center gap-3">
              <div class="shrink-0 w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center
                          justify-center text-white/60">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round"><path d="M5 19 C5 13 10 13 12 11 C14 9 19 9 19 5"/>
                  <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none"/>
                  <circle cx="19" cy="5" r="1.5" fill="currentColor" stroke="none"/></svg>
              </div>
              <button @click="onOpenSaved(rec)" class="flex-1 min-w-0 text-left active:opacity-70 transition">
                <div class="text-[13px] text-white font-medium truncate">{{ rec.navn }}</div>
                <div class="text-[11px] text-white/50 tabular-nums">
                  {{ fmtKm(rec.lengthM) }} km<template v-if="rec.gravelShare != null"> · Grus {{ Math.round(rec.gravelShare * 100) }} %</template><template v-if="fmtTid(rec.totalTimeS)"> · {{ fmtTid(rec.totalTimeS) }}</template>
                </div>
                <div class="text-[10px] text-white/35 tabular-nums">
                  {{ new Date(rec.opprettet).toLocaleDateString('no-NO') }} ·
                  {{ new Date(rec.opprettet).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' }) }}
                </div>
              </button>
              <button @click="onDeleteSaved(rec.id)"
                      :aria-label="confirmDeleteId === rec.id ? 'Bekreft sletting' : 'Slett rute'"
                      class="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border active:scale-95 transition"
                      :class="confirmDeleteId === rec.id
                              ? 'bg-rose-500/20 border-rose-400/50 text-rose-200'
                              : 'bg-white/5 border-white/10 text-white/50'">
                {{ confirmDeleteId === rec.id ? 'Sikker?' : 'Slett' }}
              </button>
            </div>
            <button v-if="savedRoutes.length > 1" @click="onDeleteAll"
                    class="w-full mt-1 px-3 py-2.5 rounded-xl text-[13px] font-medium border transition
                           active:scale-[0.99]"
                    :class="confirmDeleteAll
                            ? 'bg-rose-500/25 border-rose-400/60 text-rose-100'
                            : 'bg-rose-500/10 border-rose-400/30 text-rose-300'">
              {{ confirmDeleteAll ? `Bekreft: slett alle ${savedRoutes.length} rutene` : `Slett alle (${savedRoutes.length}) ruter` }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.overlay-fade-enter-active, .overlay-fade-leave-active { transition: opacity 0.22s ease; }
.overlay-fade-enter-from, .overlay-fade-leave-to { opacity: 0; }
.overlay-fade-leave-active { pointer-events: none; }
</style>

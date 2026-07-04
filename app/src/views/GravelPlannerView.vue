<script setup>
// Ruteplanlegger (v12.1.0) — grusvei-turplanlegging for MC over lange
// avstander. ÉN modus (v12.1.11 — Utforsk/Planlegg-segmentkontrollen er
// fjernet): grusvei-overlayen (Overpass, zoom-gatet) vises alltid ved
// innzooming, og A→B-planlegging med tre ruteforslag fra BRouter (Mest grus /
// Balansert / Kortest) skjer i samme bilde — fargekodet per segment,
// grus/asfalt-bar, stat-fliser (tid / grus-strekk / luftlinje), GPX og
// lagrede ruter.
// Interaksjonskoden (pan/pinch/wheel/tiles) er forket fra MapPickerView —
// picker-en er halfKm-drevet med 8 km-tak; her trengs fri heltalls-zoom z5–z15.
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { tileMosaic, metersPerPixel } from '../lib/tileBackground.js'
import { lonLatToWorldPx, worldPxToLonLat, lonLatToScreenPx, screenPxToLonLat, viewBbox, bboxAreaKm2, TILE_SIZE } from '../lib/webMercator.js'
import { buildGravelQuery, extractGravelWays, extractBarrierNodes, extractParkingSpots, bboxContains, padBbox, MIN_OVERLAY_ZOOM, MAX_OVERLAY_AREA_KM2 } from '../lib/gravelOverlay.js'
import { thinParkering, PARKERING_MIN_SEP_M } from '../lib/parkingRules.js'
import { buildUtNoUrl } from '../lib/utNoLink.js'
import { gmapsUrl, streetViewUrl, buildVegkartUrl } from '../lib/externalMapLinks.js'
import { fetchOverpassWithRetry } from '../lib/overpassClient.js'
import { simplifyDP } from '../lib/pathUtils.js'
import { estimateMcTimeS, fmtAvstandM, MAX_SNAP_DIST_M } from '../lib/brouterClient.js'
import { useNominatim } from '../composables/useNominatim.js'
import { useGravelPlanner } from '../composables/useGravelPlanner.js'
import { useRouteElevation } from '../composables/useRouteElevation.js'
import { useDraggableDrawer } from '../composables/useDraggableDrawer.js'
import { usePwaInstall } from '../composables/usePwaInstall.js'
import RouteElevationProfile from '../components/RouteElevationProfile.vue'

const router = useRouter()
const currentRoute = useRoute()
const planner = useGravelPlanner()
const {
  pointA, pointB, route, proposals, selectedId, routeState, routeError, savedRoutes,
} = planner

// Høydeprofil for valgt rute: BRouter-høyder når geometrien har dem,
// Kartverket-DTM-fallback for lagrede ruter (uten høyde i lagringen).
const { profile: elevProfile, state: elevState, source: elevSource } = useRouteElevation(route)

// Forslags-farger (design) pr profil-id: grus-maks oransje, balansert lilla,
// bilprofil rød. (Brukervendte navn er nøytrale «Rute 1–3» + data-badges.)
const PROPOSAL_COLORS = { 'mest-grus': '#e8802b', balansert: '#8b5cf6', kortest: '#ef4444' }

// ── Planlegg-skuff: samme drag-UX som turkartets skuffer (useDraggableDrawer:
// standard 45 dvh, minimert peek med håndtak + header, maksimert med 56 px
// kart-stripe igjen i toppen, retnings-basert snap-følsomhet). ──────────────
const MAX_DRAWER_TOP_GAP_PX = 56
const PLANNER_DRAWER_PEEK_PX = 76
const drawer = useDraggableDrawer({
  expandedHeight: 0.45,
  minimizedPeek: PLANNER_DRAWER_PEEK_PX,
  maxTopGapPx: MAX_DRAWER_TOP_GAP_PX,
  allowMinimize: true,
})
// «Mine ruter» er også en dra-bar skuff (v12.1.4) — samme tre snap-punkter.
// Kun maksimert tilstand dimmer kartet (samme mønster som FAB-panelene i
// turkartet); ellers kan man titte på kartet bak lista.
const savedDrawer = useDraggableDrawer({
  expandedHeight: 0.45,
  minimizedPeek: PLANNER_DRAWER_PEEK_PX,
  maxTopGapPx: MAX_DRAWER_TOP_GAP_PX,
  allowMinimize: true,
})

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
// Skuffen ligger i flex-flyten, så kart-flaten endrer størrelse kontinuerlig
// mens den dras — ResizeObserver holder projeksjonene i synk (window-resize
// alene fanger ikke dette).
let mapResizeObs = null

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
// Mobil-nettlesere syntetiserer mousedown/mouseup ETTER touchend — uten denne
// sperren ble ett fysisk tap til TO onMapTap-kall (A og B på nøyaktig samme
// punkt, A «gjemt» under B). Mouse-handlerne ignorerer alt like etter touch.
let lastTouchEndAt = 0
const SYNTH_MOUSE_SUPPRESS_MS = 800

// ── UT.no-pin: hold inne et punkt (long-press, 600 ms uten bevegelse) eller
// høyreklikk → pin med koordinater + «Åpne i UT.no»-lenke. Kort tap er
// fortsatt A/B-setting (< 400 ms); spennet 400–600 ms gjør ingenting, så de
// to gestene ikke kolliderer. Pinnen følger kartet ved pan/zoom (geo-ankret),
// og et vanlig tap lukker den uten å sette A/B.
const LONG_PRESS_MS = 600
const utNoPin = ref(null)            // { lat, lon } | null
let longPressTimer = null

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
}

function openUtNoPinAt(px) {
  const geo = screenPxToLonLat(px.x, px.y, view.value)
  utNoPin.value = { lat: geo.lat, lon: geo.lon }
  try { navigator.vibrate?.(15) } catch { /* noop */ }
}

function armLongPress(clientX, clientY) {
  cancelLongPress()
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    const p = localPoint(clientX, clientY)
    if (!p) return
    openUtNoPinAt(p)
    // Gesten er konsumert: ikke pan videre, og ikke tolk slippet som tap.
    panning = false; panStart = null; tapStart = null
  }, LONG_PRESS_MS)
}

function onContextMenu(e) {
  const p = localPoint(e.clientX, e.clientY)
  if (!p) return
  cancelLongPress()
  panning = false; panStart = null; tapStart = null
  openUtNoPinAt(p)
}

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

function onTouchStart(e) {
  if (e.touches.length === 2) {
    pinching = true; panning = false; tapStart = null
    cancelLongPress()
    lastDist = touchDist(e); pinchRatio = 1
    e.preventDefault()
  } else if (e.touches.length === 1) {
    panning = true; pinching = false
    const t = e.touches[0]
    panStart = { x: t.clientX, y: t.clientY, lat: center.value.lat, lon: center.value.lon }
    tapStart = { x: t.clientX, y: t.clientY, t: Date.now() }
    armLongPress(t.clientX, t.clientY)
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
    if (tapStart && Math.hypot(dxPx, dyPx) > 8) { tapStart = null; cancelLongPress() }
    const { dLat, dLon } = panShiftToCenter(dxPx, dyPx)
    center.value = { lat: panStart.lat + dLat, lon: panStart.lon + dLon }
  }
}
function onTouchEnd(e) {
  cancelLongPress()
  if (e.touches.length < 2) { pinching = false; pinchRatio = 1 }
  if (e.touches.length < 1) {
    lastTouchEndAt = Date.now()
    if (tapStart && Date.now() - tapStart.t < 400) {
      const p = localPoint(tapStart.x, tapStart.y)
      if (p) onMapTap(p)
    }
    panning = false; panStart = null; tapStart = null
  }
}
function onMouseDown(e) {
  if (e.button !== 0) return
  if (Date.now() - lastTouchEndAt < SYNTH_MOUSE_SUPPRESS_MS) return
  panning = true
  panStart = { x: e.clientX, y: e.clientY, lat: center.value.lat, lon: center.value.lon }
  tapStart = { x: e.clientX, y: e.clientY, t: Date.now() }
  armLongPress(e.clientX, e.clientY)
  e.preventDefault()
}
function onMouseMove(e) {
  if (!panning || !panStart) return
  e.preventDefault()
  const dxPx = e.clientX - panStart.x
  const dyPx = e.clientY - panStart.y
  if (tapStart && Math.hypot(dxPx, dyPx) > 8) { tapStart = null; cancelLongPress() }
  const { dLat, dLon } = panShiftToCenter(dxPx, dyPx)
  center.value = { lat: panStart.lat + dLat, lon: panStart.lon + dLon }
}
function onMouseUp(e) {
  cancelLongPress()
  if (Date.now() - lastTouchEndAt < SYNTH_MOUSE_SUPPRESS_MS) return
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

// Cooldown mellom tap-to-set: minst 1 s mellom at A og B settes fra kartet,
// så et dobbelt-registrert tap aldri setter begge på samme punkt.
let lastMapTapSetAt = 0
const MAP_TAP_COOLDOWN_MS = 1000

function onMapTap(px) {
  // Åpen UT.no-pin: tap lukker pinnen i stedet for å sette A/B.
  if (utNoPin.value) { utNoPin.value = null; return }
  if (routeInvite.value) return
  if (Date.now() - lastMapTapSetAt < MAP_TAP_COOLDOWN_MS) return
  // Tap setter armert felt, ellers første tomme (A først, så B).
  const field = armedField.value ?? (!pointA.value ? 'A' : (!pointB.value ? 'B' : null))
  if (!field) return
  const geo = screenPxToLonLat(px.x, px.y, view.value)
  lastMapTapSetAt = Date.now()
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

// ── Kartlag-toggles (v12.1.16): bekreftet grus / antatt grus / parkering ────
// Grus-togglene filtrerer klient-side (dataene er alltid hentet); parkering
// er default AV og hentes først når laget skrus på (samme Overpass-kall som
// grusveiene, se buildGravelQuery includeParking).
const LAYERS_LS_KEY = 'svg-insights-ruteplanlegger-lag'
const LAYER_DEFAULTS = { surfaced: true, assumed: true, parking: false }
function loadLayers() {
  try {
    const v = JSON.parse(localStorage.getItem(LAYERS_LS_KEY) ?? 'null')
    if (v && typeof v === 'object') return { ...LAYER_DEFAULTS, ...v }
  } catch { /* noop */ }
  return { ...LAYER_DEFAULTS }
}
const layers = ref(loadLayers())
watch(layers, () => {
  try { localStorage.setItem(LAYERS_LS_KEY, JSON.stringify(layers.value)) } catch { /* noop */ }
}, { deep: true })
function toggleLayer(key) {
  layers.value = { ...layers.value, [key]: !layers.value[key] }
}
// Panelet er kollapset til en liten lag-knapp som default (v12.1.17 — det
// alltid-åpne panelet spiste kartflate og kolliderte visuelt med P-markører,
// se mobil-skjermbildet). Åpen tilstand persisteres ikke — kartet skal alltid
// starte ryddig.
const layersPanelOpen = ref(false)

// ── Grusvei-overlay: hent + tegn (alltid aktiv, zoom-gatet) ─────────────────
const overlayState = ref('idle')     // 'idle' | 'loading' | 'error'
const overlayWays = ref([])          // [{id, kind, worldPts:[[x,y]…]}] i world-px ved fetchZoom
const overlayBarriers = ref([])      // stengte bommer: [{id, worldPt:[x,y]}] ved fetchZoom
const overlayParking = ref([])       // [{id, lat, lon, p:{x,y} meter, utfart}] — uttynnes pr zoom
const overlayHasParking = ref(false) // om forrige henting inkluderte parkering
const overlayFetchZoom = ref(null)
let overlayFetchedBbox = null
let overlayAbort = null
let overlayDebounce = null

const overlayGated = computed(() =>
  zoom.value < MIN_OVERLAY_ZOOM ||
  (mapSize.value.w > 0 && bboxAreaKm2(viewBbox(view.value)) > MAX_OVERLAY_AREA_KM2))

async function refreshOverlay() {
  if (!mapSize.value.w) return
  if (overlayGated.value) {
    overlayAbort?.abort()
    overlayWays.value = []
    overlayBarriers.value = []
    overlayParking.value = []
    overlayHasParking.value = false
    overlayFetchedBbox = null
    overlayState.value = 'idle'
    return
  }
  const visible = viewBbox(view.value)
  const sameBand = overlayFetchZoom.value != null && Math.abs(zoom.value - overlayFetchZoom.value) < 2
  // Dekket av forrige henting → kun re-projisering. Unntak: parkering-laget
  // er skrudd på etter en henting UTEN parkering — da må vi hente på nytt.
  const parkingSatisfied = !layers.value.parking || overlayHasParking.value
  if (sameBand && bboxContains(overlayFetchedBbox, visible) && parkingSatisfied) return
  overlayAbort?.abort()
  const ac = new AbortController()
  overlayAbort = ac
  overlayState.value = 'loading'
  const fetchBbox = padBbox(visible, 1.5)
  const fetchZoom = zoom.value
  const includeParking = layers.value.parking
  try {
    const json = await fetchOverpassWithRetry(
      'data=' + encodeURIComponent(buildGravelQuery(fetchBbox, { includeParking })),
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
    // Stengte bommer på de samme veiene («grusvei bak bom») — markeres i
    // kartet; ruteprofilene (v6) nekter samtidig å rute gjennom dem.
    overlayBarriers.value = extractBarrierNodes(json)
      .filter((b) => b.kind === 'closed')
      .map((b) => { const p = lonLatToWorldPx(b.lon, b.lat, fetchZoom); return { id: b.id, worldPt: [p.x, p.y] } })
    overlayParking.value = includeParking ? extractParkingSpots(json) : []
    overlayHasParking.value = includeParking
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

watch([center, zoom, mapSize], () => {
  if (overlayDebounce) clearTimeout(overlayDebounce)
  overlayDebounce = setTimeout(refreshOverlay, 400)
}, { deep: true })

// Parkering-laget skrus på etter en henting uten parkering → hent på nytt
// (refreshOverlay ser selv at cachen ikke dekker parkering).
watch(() => layers.value.parking, (on) => {
  if (on && !overlayHasParking.value) void refreshOverlay()
})

// world-px (fetchZoom) → skjerm-px path-streng for gjeldende view.
const overlayPaths = computed(() => {
  if (!overlayWays.value.length || !mapSize.value.w) return []
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

// Kartlag-filtrert variant til tegning: kind ('surfaced'|'assumed') matcher
// toggle-nøklene direkte.
const visibleOverlayPaths = computed(() =>
  overlayPaths.value.filter((w) => layers.value[w.kind] !== false))

// Parkering i skjerm-px: turkartets uttynningsregel (thinParkering — utfart
// vises ALLTID, vanlige P min 50 m fra hverandre), generalisert til zoombar
// visning ved at min-avstanden aldri er mindre enn ~28 skjerm-px, så P-skilt
// ikke smelter sammen ved utzooming. Kulles til synlig flate (+30 px margin).
const PARKING_MIN_SEP_PX = 28
const parkingMarkers = computed(() => {
  if (!layers.value.parking || !overlayParking.value.length || !mapSize.value.w) return []
  const mPerPx = metersPerPixel(center.value.lat, zoom.value)
  const minSepM = Math.max(PARKERING_MIN_SEP_M, mPerPx * PARKING_MIN_SEP_PX)
  const { w, h } = mapSize.value
  const out = []
  for (const s of thinParkering(overlayParking.value, minSepM)) {
    const p = lonLatToScreenPx(s.lon, s.lat, view.value)
    if (p.x < -30 || p.y < -30 || p.x > w + 30 || p.y > h + 30) continue
    out.push({ id: s.id, x: p.x, y: p.y, utfart: s.utfart })
  }
  return out
})

// Fire frittstående hjørne-braketter rundt utfarts-P (samme visuelle språk
// som turkartets 534u — sorte braketter, se mapBuilder for begrunnelsen).
function utfartBracketPath(x, y) {
  const o = 12, l = 5
  return `M${x - o + l} ${y - o} L${x - o} ${y - o} L${x - o} ${y - o + l}` +
         ` M${x + o - l} ${y - o} L${x + o} ${y - o} L${x + o} ${y - o + l}` +
         ` M${x - o + l} ${y + o} L${x - o} ${y + o} L${x - o} ${y + o - l}` +
         ` M${x + o - l} ${y + o} L${x + o} ${y + o} L${x + o} ${y + o - l}`
}

// Stengte bommer i skjerm-px (samme projisering som overlayPaths).
const overlayBarrierPts = computed(() => {
  if (!overlayBarriers.value.length || !mapSize.value.w || overlayFetchZoom.value == null) return []
  const scale = Math.pow(2, zoom.value - overlayFetchZoom.value)
  const c = lonLatToWorldPx(center.value.lon, center.value.lat, zoom.value)
  const ox = mapSize.value.w / 2 - c.x
  const oy = mapSize.value.h / 2 - c.y
  return overlayBarriers.value.map((b) => ({
    id: b.id,
    x: b.worldPt[0] * scale + ox,
    y: b.worldPt[1] * scale + oy,
  }))
})

// ── Rute-tegning ────────────────────────────────────────────────────────────
const routePaths = computed(() => {
  const r = route.value
  if (!r || !mapSize.value.w) return []
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

// UT.no-pin i skjerm-px (geo-ankret — følger kartet) + ferdig bygde lenker.
// UT.no og Vegkart tar med gjeldende zoom så de åpner samme utsnitt;
// Google Maps/Street View er punkt-lenker (samme som turkartets ark).
const utNoPinPx = computed(() => utNoPin.value && mapSize.value.w
  ? lonLatToScreenPx(utNoPin.value.lon, utNoPin.value.lat, view.value) : null)
const pinLinks = computed(() => {
  const p = utNoPin.value
  if (!p) return []
  return [
    { label: 'UT.no', href: buildUtNoUrl({ lat: p.lat, lon: p.lon, zoom: zoom.value }) },
    { label: 'Vegkart (Vegvesen.no)', href: buildVegkartUrl({ lat: p.lat, lon: p.lon, zoom: zoom.value }) },
    { label: 'Google Maps', href: gmapsUrl(p.lat, p.lon) },
    { label: 'Street View', href: streetViewUrl(p.lat, p.lon) },
  ].filter((l) => l.href)
})

const markerA = computed(() => pointA.value && mapSize.value.w
  ? lonLatToScreenPx(pointA.value.lon, pointA.value.lat, view.value) : null)
const markerB = computed(() => pointB.value && mapSize.value.w
  ? lonLatToScreenPx(pointB.value.lon, pointB.value.lat, view.value) : null)

// Stiplede forbindelseslinjer A → rutestart / ruteslutt → B når BRouter måtte
// snappe punktet et stykke bort til nærmeste kjørbare vei — gapet skal SYNES
// i kartet, ikke bare stå i et varsel.
const snapConnectorPaths = computed(() => {
  const r = route.value
  if (!r?.points?.length || !mapSize.value.w) return []
  const out = []
  const ends = [
    [pointA.value, r.points[0], r.snapStartM],
    [pointB.value, r.points[r.points.length - 1], r.snapEndM],
  ]
  for (const [wp, pt, gapM] of ends) {
    if (!wp || !(gapM > 30)) continue
    const a = lonLatToScreenPx(wp.lon, wp.lat, view.value)
    const b = lonLatToScreenPx(pt[0], pt[1], view.value)
    out.push(`M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`)
  }
  return out
})

// Amber-varsel i rutekortet når ruta ikke starter/slutter ved A/B.
const snapWarning = computed(() => {
  const r = route.value
  if (!r) return null
  const parts = []
  if (r.snapStartM > MAX_SNAP_DIST_M) parts.push(`starter ${fmtAvstandM(r.snapStartM)} fra A`)
  if (r.snapEndM > MAX_SNAP_DIST_M) parts.push(`slutter ${fmtAvstandM(r.snapEndM)} fra B`)
  if (!parts.length) return null
  return `Ruta ${parts.join(' og ')} — nærmeste kjørbare vei ligger et stykke fra punktet ditt (stiplet linje i kartet).`
})

// ── Rute-kort, forslag + lagring ────────────────────────────────────────────
const showSaved = ref(false)
// Refresh lista hver gang arket åpnes — ruter kan være lagret i en annen
// fane/økt siden mount. Skuffen starter alltid i standard-høyde.
watch(showSaved, (open) => {
  if (open) {
    savedDrawer.reset()
    void planner.refreshSaved()
  }
})
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
// Lagrede ruter fra før v12.1.10 mangler estimatedTimeS — regn ut fra
// grusandelen (samme modell som parseRoute bruker).
function recTidS(rec) {
  return rec.estimatedTimeS ?? estimateMcTimeS(rec.lengthM, {
    gravelM: rec.gravelShare != null ? rec.gravelShare * rec.lengthM : null,
  })
}

// ── «Vis hele ruten»-FAB: nullstill zoom/senter så hele ruta (inkl. A/B)
// rammes inn med margin — mye utzooming på lange ruter. ────────────────────
function fitPointsView(lonLatPts) {
  if (!lonLatPts?.length || !mapSize.value.w) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [lon, lat] of lonLatPts) {
    const p = lonLatToWorldPx(lon, lat, 0)
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const spanX = Math.max(maxX - minX, 1e-9)
  const spanY = Math.max(maxY - minY, 1e-9)
  // Skuffen flyter over kartets nedre del — sikt innrammingen på den synlige
  // flaten over skuffen, og skyv senteret slik at innholdet sentreres der.
  const obstructPx = Math.min(drawer.visibleHeightPx.value, mapSize.value.h * 0.7)
  const effH = Math.max(80, mapSize.value.h - obstructPx)
  // Største heltalls-zoom der world-px-spennet (zoom 0 × 2^z) får 15 % margin.
  const margin = 0.85
  const zFit = Math.floor(Math.min(
    Math.log2((mapSize.value.w * margin) / spanX),
    Math.log2((effH * margin) / spanY),
  ))
  zoom.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zFit))
  const scale = Math.pow(2, zoom.value)
  const c = worldPxToLonLat(
    ((minX + maxX) / 2) * scale,
    ((minY + maxY) / 2) * scale + obstructPx / 2,
    zoom.value,
  )
  center.value = { lat: c.lat, lon: c.lon }
}

function fitRouteView() {
  const pts = [...(route.value?.points?.map((p) => [p[0], p[1]]) ?? [])]
  for (const m of [pointA.value, pointB.value]) if (m) pts.push([m.lon, m.lat])
  fitPointsView(pts)
}

async function onFindRoute() {
  activeSearch.value = null
  // Mottaker av delt rute kan ha huket av «Installer appen» i banneret —
  // trigg install-prompten først (best-effort, samme mønster som kartvelgeren).
  if (installRequested.value && canInstall.value) {
    try { await promptInstall() } catch { /* avvist / utilgjengelig — rut likevel */ }
  }
  await planner.computeRoute()
  if (route.value) {
    if (routeInvite.value?.proposalId) planner.selectProposal(routeInvite.value.proposalId)
    // Delingsmodus er fullført når ruta er beregnet — fjern banneret og
    // lås opp UI-et (mottakeren står nå med en vanlig rute).
    if (routeInvite.value) dismissRouteInvite()
    drawer.reset()
    nextTick(() => { measureMap(); fitRouteView() })
  }
}

// ── Deling av rute: sender-side URL + mottaker-banner (speiler turkartets
// «Del kart»-flyt — navigator.share med clipboard-fallback, og hos mottaker
// et banner med «installer som app»-sjekkboks når appen ikke er standalone). ─
const { canInstall, isStandalone, promptInstall } = usePwaInstall()
const installRequested = ref(false)
const showInstallInfo = ref(false)
const routeInvite = ref(null)     // { navn, proposalId } | null
const shareState = ref('idle')    // 'idle' | 'copied' | 'error'
let shareResetTimer = null

function buildRouteShareUrl({ a, b, navn, proposalId }) {
  if (!a || !b) return null
  const base = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`
  const params = new URLSearchParams({
    alat: a.lat.toFixed(6), alon: a.lon.toFixed(6),
    blat: b.lat.toFixed(6), blon: b.lon.toFixed(6),
  })
  if (a.name) params.set('an', String(a.name).slice(0, 60))
  if (b.name) params.set('bn', String(b.name).slice(0, 60))
  if (navn) params.set('rn', String(navn).slice(0, 60))
  if (proposalId) params.set('p', proposalId)
  return `${base}/ruteplanlegger?${params.toString()}`
}

async function performShare(url, title, text) {
  if (!url) return
  const shareData = { title, text, url }
  if (typeof navigator.share === 'function') {
    try {
      if (typeof navigator.canShare === 'function' && !navigator.canShare(shareData)) {
        throw new Error('share-data-rejected')
      }
      await navigator.share(shareData)
      return
    } catch (err) {
      if (err?.name === 'AbortError') return
      // fall gjennom til clipboard-fallback
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    shareState.value = 'copied'
  } catch {
    shareState.value = 'error'
  }
  if (shareResetTimer) clearTimeout(shareResetTimer)
  shareResetTimer = setTimeout(() => { shareState.value = 'idle' }, 2200)
}

function onShareRoute() {
  const r = route.value
  if (!r) return
  const navn = r.navn ?? `${labelFor(pointA.value)} → ${labelFor(pointB.value)}`
  void performShare(
    buildRouteShareUrl({ a: pointA.value, b: pointB.value, navn, proposalId: r.id }),
    'SVG Insights — grusrute',
    `Grusrute: ${navn}`,
  )
}

function onShareSaved(rec) {
  const a = rec.waypoints?.[0]
  const b = rec.waypoints?.at(-1)
  void performShare(
    buildRouteShareUrl({ a, b, navn: rec.navn, proposalId: rec.proposalId }),
    'SVG Insights — grusrute',
    `Grusrute: ${rec.navn}`,
  )
}

// Mottaker: ?alat/alon/blat/blon(+an/bn/rn/p) → prefill A/B, vis banner.
// Ruta beregnes først når mottakeren trykker «Finn grusrute» (ett BRouter-kall
// per brukerhandling — samme fair-use-holdning som ellers).
function parseRouteInvite() {
  const q = currentRoute.query
  const alat = parseFloat(q.alat); const alon = parseFloat(q.alon)
  const blat = parseFloat(q.blat); const blon = parseFloat(q.blon)
  if (![alat, alon, blat, blon].every(Number.isFinite)) return null
  return {
    a: { lat: alat, lon: alon, name: q.an ? String(q.an).slice(0, 60) : 'Delt start' },
    b: { lat: blat, lon: blon, name: q.bn ? String(q.bn).slice(0, 60) : 'Delt mål' },
    navn: q.rn ? String(q.rn).slice(0, 60) : null,
    proposalId: q.p ? String(q.p) : null,
  }
}

function dismissRouteInvite() {
  routeInvite.value = null
  installRequested.value = false
  router.replace({ query: {} })
}

const saveNameInput = ref(null)
function startSave() {
  saveName.value = route.value?.navn ??
    `${pointA.value?.name ?? 'A'} – ${pointB.value?.name ?? 'B'}`
  savingName.value = true
  nextTick(() => saveNameInput.value?.focus())
}
async function confirmSave() {
  const rec = await planner.saveCurrentRoute(saveName.value.trim())
  savingName.value = false
  if (rec) { savedFlash.value = 'Ruta er lagret'; setTimeout(() => { savedFlash.value = '' }, 2000) }
}

function onOpenSaved(rec) {
  planner.openSaved(rec)
  showSaved.value = false
  searchA.query.value = labelFor(pointA.value)
  searchB.query.value = labelFor(pointB.value)
  drawer.reset()
  nextTick(() => { measureMap(); fitPointsView(rec.points) })
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

// Lås dokument-scroll mens planleggeren er åpen (samme fiks som MapView):
// roten er h-[100dvh] overflow-hidden, men på mobil kan body likevel få en
// residual scroll-offset (SPA-navigasjon, tastatur-fokus i søkefeltene,
// adresselinje-kollaps) som skyver toppbaren ut av synsfeltet.
let prevHtmlOverflow = ''
let prevBodyOverflow = ''
function lockBodyScroll() {
  const html = document.documentElement
  prevHtmlOverflow = html.style.overflow
  prevBodyOverflow = document.body.style.overflow
  html.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
  window.scrollTo(0, 0)
}
function unlockBodyScroll() {
  document.documentElement.style.overflow = prevHtmlOverflow
  document.body.style.overflow = prevBodyOverflow
}

onMounted(() => {
  lockBodyScroll()
  nextTick(() => {
    measureMap()
    if (typeof ResizeObserver !== 'undefined' && mapRef.value) {
      mapResizeObs = new ResizeObserver(measureMap)
      mapResizeObs.observe(mapRef.value)
    }
    // Delt rute i URL-en: prefill A/B og ram inn punktene.
    const invite = parseRouteInvite()
    if (invite) {
      routeInvite.value = invite
      setPoint('A', invite.a)
      setPoint('B', invite.b)
      nextTick(() => {
        measureMap()
        fitPointsView([[invite.a.lon, invite.a.lat], [invite.b.lon, invite.b.lat]])
      })
    }
  })
  window.addEventListener('resize', measureMap)
  window.addEventListener('online', onlineHandler)
  window.addEventListener('offline', offlineHandler)
  void planner.refreshSaved()
})
onUnmounted(() => {
  unlockBodyScroll()
  mapResizeObs?.disconnect()
  window.removeEventListener('resize', measureMap)
  window.removeEventListener('online', onlineHandler)
  window.removeEventListener('offline', offlineHandler)
  overlayAbort?.abort()
  if (overlayDebounce) clearTimeout(overlayDebounce)
  if (shareResetTimer) clearTimeout(shareResetTimer)
  cancelLongPress()
})
</script>

<template>
  <div class="relative h-[100dvh] bg-[#0e1116] text-white/90 overflow-hidden flex flex-col">

    <!-- Toppbar: tilbake · tittel · lagrede ruter (badge) -->
    <div class="shrink-0 z-30 bg-zinc-950/90 backdrop-blur border-b border-white/10">
      <div class="flex items-center gap-2 px-3 py-2.5">
        <button @click="router.push('/')" aria-label="Tilbake" :disabled="!!routeInvite"
                class="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 border border-white/10
                       text-white/70 active:scale-95 transition shrink-0 disabled:opacity-35">
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="flex-1 text-center text-[15px] font-semibold text-white truncate">Ruteplanlegger</div>
        <button @click="showSaved = true" aria-label="Lagrede ruter" :disabled="!!routeInvite"
                class="w-9 h-9 rounded-full flex items-center justify-center bg-white/5 border border-white/10
                       text-white/70 active:scale-95 transition shrink-0 relative disabled:opacity-35">
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <span v-if="savedRoutes.length"
                class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-sky-500 text-[9px]
                       font-bold text-white flex items-center justify-center">{{ savedRoutes.length }}</span>
        </button>
      </div>
    </div>

    <!-- Kart -->
    <div ref="mapRef"
         class="relative flex-1 overflow-hidden bg-zinc-800 cursor-move touch-none select-none"
         @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchEnd"
         @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp"
         @wheel="onWheel" @contextmenu.prevent="onContextMenu">
      <!-- OSM-underlag (global dekning) + Kartverket-topo over (skjules ved feil) -->
      <img v-for="t in tiles" :key="'osm-' + t.url" :src="t.osmUrl" alt=""
           class="absolute pointer-events-none select-none"
           :style="{ left: t.leftPx + 'px', top: t.topPx + 'px', width: TILE_SIZE + 'px', height: TILE_SIZE + 'px' }"
           draggable="false" />
      <img v-for="t in tiles" :key="t.url" :src="t.url" alt=""
           class="absolute pointer-events-none select-none"
           :style="{ left: t.leftPx + 'px', top: t.topPx + 'px', width: TILE_SIZE + 'px', height: TILE_SIZE + 'px' }"
           draggable="false" @error="onTopoTileError" />

      <!-- Grusvei-overlay + rute (skjerm-px-rom, samme som tilene).
           Bekreftet grus: heltrukket. Antatt grus: stiplet — SAMME farge og
           bredde som bekreftet (v12.1.14; den tynnere/lysere varianten leste
           som en annen veitype, ikke som usikkerhet). Stiplingen alene
           skiller klassene, og virker også for fargeblinde.
           Hvit halo UNDER begge (v12.1.11) løfter dem fra topoens småveier;
           antatt-haloen bruker samme dasharray på samme path så dashene
           ligger perfekt oppå hverandre og gapene forblir gjennomsiktige.
           Farge (v12.1.12): cyan — oransje smeltet sammen med topoens
           stier/skiløyper og rute-oransjen (#e8802b); cyan finnes ikke i
           Kartverket-topoen og skiller også overlay fra beregnet rute. -->
      <svg class="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
        <path v-for="w in visibleOverlayPaths" :key="'ovh-' + w.id" :d="w.d" fill="none"
              stroke="#ffffff" stroke-width="5.5"
              stroke-linecap="round" stroke-linejoin="round"
              :stroke-dasharray="w.kind === 'assumed' ? '4 7' : undefined"
              opacity="0.85" />
        <path v-for="w in visibleOverlayPaths" :key="'ov-' + w.id" :d="w.d" fill="none"
              stroke="#0e7490" stroke-width="3.5"
              stroke-linecap="round" stroke-linejoin="round"
              :stroke-dasharray="w.kind === 'assumed' ? '4 7' : undefined"
              opacity="0.95" />
        <!-- Stengte bommer (v12.1.15): mini «innkjøring forbudt»-skilt der
             grusveien har bom/sperring uten lovlig motor-tilgang. -->
        <g v-for="b in overlayBarrierPts" :key="'bar-' + b.id" aria-hidden="true">
          <circle :cx="b.x" :cy="b.y" r="5.5" fill="#dc2626" stroke="#ffffff" stroke-width="1.5" />
          <rect :x="b.x - 3.2" :y="b.y - 1" width="6.4" height="2" rx="1" fill="#ffffff" />
        </g>
        <!-- Parkering (v12.1.16, samme regler som turkartets 534/534u): blått
             P-skilt; utfartsparkering får fire sorte hjørne-braketter (med
             hvit halo så de leses mot mørk topo). -->
        <g v-for="pk in parkingMarkers" :key="'pk-' + pk.id" aria-hidden="true">
          <template v-if="pk.utfart">
            <path :d="utfartBracketPath(pk.x, pk.y)" fill="none" stroke="#ffffff"
                  stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
            <path :d="utfartBracketPath(pk.x, pk.y)" fill="none" stroke="#111827"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </template>
          <rect :x="pk.x - 8" :y="pk.y - 8" width="16" height="16" rx="3.5"
                fill="#1d4ed8" stroke="#ffffff" stroke-width="1.5" />
          <text :x="pk.x" :y="pk.y + 4.5" text-anchor="middle" fill="#ffffff"
                font-size="12" font-weight="700"
                font-family="system-ui, -apple-system, sans-serif">P</text>
        </g>
        <template v-if="routePaths.length">
          <path v-for="s in routePaths" :key="'halo-' + s.key" :d="s.d" fill="none"
                stroke="#0e1116" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" />
          <path v-for="s in routePaths" :key="'rt-' + s.key" :d="s.d" fill="none"
                :stroke="s.gravel ? '#e8802b' : '#94a3b8'" stroke-width="4.5"
                stroke-linecap="round" stroke-linejoin="round" />
          <path v-for="(d, i) in snapConnectorPaths" :key="'snap-' + i" :d="d" fill="none"
                stroke="#fbbf24" stroke-width="2.5" stroke-dasharray="2 7"
                stroke-linecap="round" opacity="0.9" />
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

      <!-- UT.no-pin (v12.1.16): long-press / høyreklikk i kartet. Geo-ankret
           trådkors + kort med koordinater og «Åpne i UT.no»-lenke som tar med
           gjeldende zoom (ut.no/kart#zoom/lat/lon). Tap i kartet lukker. -->
      <template v-if="utNoPin && utNoPinPx">
        <div class="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2"
             :style="{ left: utNoPinPx.x + 'px', top: utNoPinPx.y + 'px' }">
          <div class="w-5 h-5 rounded-full border-2 border-sky-400 bg-sky-400/25 shadow-lg
                      flex items-center justify-center">
            <div class="w-1.5 h-1.5 rounded-full bg-sky-300"></div>
          </div>
        </div>
        <div class="absolute z-20" @mousedown.stop @touchstart.stop @wheel.stop @contextmenu.stop.prevent
             :style="{ left: utNoPinPx.x + 'px', top: (utNoPinPx.y - 16) + 'px',
                       transform: 'translate(-50%, -100%)' }">
          <div class="rounded-xl bg-zinc-950/95 backdrop-blur border border-white/15 shadow-2xl
                      px-3 py-2.5 w-max">
            <div class="flex items-center gap-3">
              <div class="text-[10px] text-white/55 tabular-nums">
                {{ utNoPin.lat.toFixed(5) }}, {{ utNoPin.lon.toFixed(5) }}
              </div>
              <button @click="utNoPin = null" aria-label="Lukk"
                      class="w-6 h-6 -mr-1 rounded-full flex items-center justify-center text-white/50
                             hover:text-white/80 active:scale-90 transition">
                <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
              </button>
            </div>
            <div class="mt-1.5 space-y-1">
              <a v-for="l in pinLinks" :key="l.label" :href="l.href"
                 target="_blank" rel="noopener noreferrer" @click="utNoPin = null"
                 class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-[12px]
                        font-medium border bg-white/[0.06] border-white/15 text-white/85
                        active:scale-[0.98] transition">
                Åpne i {{ l.label }}
                <svg viewBox="0 0 24 24" class="w-3.5 h-3.5 shrink-0 text-white/50" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
            </div>
          </div>
          <!-- liten pil ned mot pinnen -->
          <div class="mx-auto w-2.5 h-2.5 -mt-[5px] rotate-45 bg-zinc-950/95 border-r border-b border-white/15"></div>
        </div>
      </template>

      <!-- Zoom-knapper + nivå-badge. mousedown/touchstart stoppes så knappe-
           trykk ikke tolkes som kart-tap (tap-to-set for A/B). -->
      <div class="absolute right-3 top-3 z-10 flex flex-col items-center gap-1.5"
           @mousedown.stop @touchstart.stop>
        <button @click.stop="stepZoom(1)" aria-label="Zoom inn"
                class="w-9 h-9 rounded-lg bg-zinc-950/90 border border-white/15 text-white text-lg font-medium
                       flex items-center justify-center active:scale-95 transition">+</button>
        <button @click.stop="stepZoom(-1)" aria-label="Zoom ut"
                class="w-9 h-9 rounded-lg bg-zinc-950/90 border border-white/15 text-white text-lg font-medium
                       flex items-center justify-center active:scale-95 transition">−</button>
        <div class="px-1.5 py-0.5 rounded-md bg-zinc-950/85 border border-white/15 text-white/60 text-[10px]
                    tabular-nums pointer-events-none">z{{ zoom }}</div>
      </div>

      <!-- FAB: nullstill zoom og vis hele ruten.
           Følger skuffens overkant siden skuffen flyter over kartet. -->
      <button v-if="route" @click.stop="fitRouteView"
              @mousedown.stop @touchstart.stop
              aria-label="Vis hele ruten"
              :style="{ bottom: (drawer.visibleHeightPx.value + 12) + 'px' }"
              class="absolute right-3 z-10 w-12 h-12 rounded-full bg-zinc-950/90 border
                     border-white/15 text-white shadow-lg flex items-center justify-center
                     active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/>
          <path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/>
          <path d="M8 15 C9.5 12 14.5 12 16 9" opacity="0.9"/>
        </svg>
      </button>

      <!-- Mottaker av delt rute: banner som flyter OPPÅ kartet (v12.1.3 — lå
           før i flyten og dyttet kartet ned). Delingsmodus låser resten av
           UI-et (toppbar-knapper, modus-pille, Fra/Til) til CTA eller X —
           men kart-pan/zoom og skuff-drag er fortsatt fritt. -->
      <div v-if="routeInvite" class="absolute top-3 left-3 right-3 z-30 flex justify-center"
           @mousedown.stop @touchstart.stop @wheel.stop>
        <div class="relative w-full max-w-[560px] rounded-xl border border-sky-300/40 bg-zinc-950/92
                    backdrop-blur px-4 py-3 shadow-2xl">
          <button @click="dismissRouteInvite" aria-label="Avbryt delt rute"
                  class="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center
                         text-sky-200/70 hover:text-sky-100 hover:bg-sky-400/15 active:scale-95 transition">
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <div class="flex items-center gap-3 pr-8">
            <div class="shrink-0 w-10 h-10 rounded-full bg-sky-400/20 border border-sky-300/40
                        flex items-center justify-center text-sky-200">
              <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-semibold text-sky-100">Noen har delt en grusrute med deg!</div>
              <div v-if="routeInvite.navn" class="text-[11px] text-sky-100/75 truncate">
                Rute: {{ routeInvite.navn }}
              </div>
            </div>
          </div>
          <div class="mt-2 text-[11px] text-white/70 leading-relaxed">
            Start og mål er fylt inn. Trykk «Finn grusrute», så beregnes den samme grusruta for deg. God tur!
          </div>
          <div v-if="!isStandalone" class="mt-3 pt-3 border-t border-sky-300/15">
            <label class="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" v-model="installRequested"
                     class="mt-0.5 w-4 h-4 shrink-0 accent-sky-400 cursor-pointer" />
              <span class="flex-1 text-[11px] text-sky-100/85 leading-relaxed">
                Installer appen for en bedre opplevelse
                <button type="button" @click.prevent="showInstallInfo = !showInstallInfo"
                        aria-label="Hva betyr det?" :aria-expanded="showInstallInfo"
                        class="inline-flex items-center justify-center align-middle ml-1
                               w-4 h-4 rounded-full border border-sky-300/50 text-sky-200/90
                               text-[9px] font-bold leading-none active:scale-90 transition">
                  i
                </button>
              </span>
            </label>
            <Transition name="overlay-fade">
              <div v-if="showInstallInfo"
                   class="mt-2 ml-[26px] text-[10px] text-sky-100/60 leading-relaxed">
                Installasjon legger appen på hjemskjermen din, så den åpner i fullskjerm og fungerer
                offline. Du kan også gjøre dette senere fra forsiden.
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <!-- Status-chips: armert tap-to-set / overlay-gate / lasting / feil
           (modus-pillen er fjernet i v12.1.11 — chipsene flyter øverst) -->
      <div class="absolute left-1/2 -translate-x-1/2 top-3 z-10 flex flex-col items-center gap-1.5 pointer-events-none">
        <div v-if="armedField"
             class="px-3 py-1.5 rounded-full bg-sky-500/90 text-white text-[12px] font-medium shadow-lg">
          Trykk i kartet for å sette {{ armedField === 'A' ? 'start' : 'mål' }}
        </div>
        <div v-else-if="overlayGated && !route"
             class="px-3 py-1.5 rounded-full bg-zinc-950/85 border border-white/15 text-white/75 text-[11px] shadow">
          Zoom inn for å se grusveier
        </div>
        <div v-if="overlayState === 'loading'"
             class="px-3 py-1.5 rounded-full bg-zinc-950/85 border border-white/15 text-white/75 text-[11px]
                    shadow flex items-center gap-2">
          <span class="w-3 h-3 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></span>
          Henter kartlag …
        </div>
        <div v-if="overlayState === 'error'"
             class="px-3 py-1.5 rounded-full bg-amber-500/90 text-zinc-950 text-[11px] font-medium shadow">
          Fikk ikke lastet grusvei-laget
        </div>
      </div>

      <!-- Kartlag (v12.1.16, kollapset v12.1.17): tegnforklaring OG lag-velger
           i ett — hver rad er en toggle (bekreftet grus / antatt grus /
           parkering). Default vises bare en liten lag-knapp; panelet åpnes on
           demand og lukkes med X. Solid bakgrunn + z-20 så kart-markører aldri
           skinner gjennom. Valg huskes i localStorage. -->
      <button v-if="!overlayGated && !layersPanelOpen" @click.stop="layersPanelOpen = true"
              @mousedown.stop @touchstart.stop
              aria-label="Kartlag" :aria-expanded="false"
              :style="{ bottom: (drawer.visibleHeightPx.value + 12) + 'px' }"
              class="absolute left-3 z-20 w-10 h-10 rounded-lg bg-zinc-950/90 border border-white/15
                     text-white/80 shadow-lg flex items-center justify-center active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-4.5 h-4.5" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 22 8.5 12 15 2 8.5"/>
          <polyline points="2 14 12 20.5 22 14"/>
        </svg>
      </button>
      <div v-else-if="!overlayGated"
           :style="{ bottom: (drawer.visibleHeightPx.value + 12) + 'px' }"
           class="absolute left-3 z-20 rounded-lg bg-zinc-950/95 backdrop-blur border border-white/15
                  px-2.5 py-2 shadow-xl"
           @mousedown.stop @touchstart.stop @wheel.stop>
        <div class="flex items-center justify-between gap-4 mb-1">
          <div class="text-[9px] uppercase tracking-wide text-white/45">Kartlag</div>
          <button @click.stop="layersPanelOpen = false" aria-label="Lukk kartlag"
                  class="w-5 h-5 -mr-1 rounded-full flex items-center justify-center text-white/50
                         hover:text-white/80 active:scale-90 transition">
            <svg viewBox="0 0 24 24" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.4"
                 stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          </button>
        </div>
        <div class="text-[10px] text-white/75 space-y-0.5">
          <button @click="toggleLayer('surfaced')" :aria-pressed="layers.surfaced"
                  class="flex items-center gap-1.5 w-full text-left py-0.5 active:opacity-60 transition"
                  :class="layers.surfaced ? '' : 'opacity-40'">
            <span class="inline-block w-5 h-0 border-t-[3.5px] border-[#0e7490] rounded shrink-0"></span>
            <span class="flex-1 pr-1">Bekreftet grus</span>
            <span class="w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center"
                  :class="layers.surfaced ? 'bg-sky-500 border-sky-400' : 'border-white/30'">
              <svg v-if="layers.surfaced" viewBox="0 0 24 24" class="w-2.5 h-2.5 text-white" fill="none"
                   stroke="currentColor" stroke-width="3.5" stroke-linecap="round"
                   stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
          </button>
          <button @click="toggleLayer('assumed')" :aria-pressed="layers.assumed"
                  class="flex items-center gap-1.5 w-full text-left py-0.5 active:opacity-60 transition"
                  :class="layers.assumed ? '' : 'opacity-40'">
            <span class="inline-block w-5 h-0 border-t-[3.5px] border-dashed border-[#0e7490] rounded shrink-0"></span>
            <span class="flex-1 pr-1">Antatt grus (skogsbilvei)</span>
            <span class="w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center"
                  :class="layers.assumed ? 'bg-sky-500 border-sky-400' : 'border-white/30'">
              <svg v-if="layers.assumed" viewBox="0 0 24 24" class="w-2.5 h-2.5 text-white" fill="none"
                   stroke="currentColor" stroke-width="3.5" stroke-linecap="round"
                   stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
          </button>
          <button @click="toggleLayer('parking')" :aria-pressed="layers.parking"
                  class="flex items-center gap-1.5 w-full text-left py-0.5 active:opacity-60 transition"
                  :class="layers.parking ? '' : 'opacity-40'">
            <span class="inline-flex w-5 justify-center shrink-0">
              <span class="w-3.5 h-3.5 rounded-[3px] bg-[#1d4ed8] border border-white text-white
                           text-[8px] font-bold flex items-center justify-center leading-none">P</span>
            </span>
            <span class="flex-1 pr-1">Parkering</span>
            <span class="w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center"
                  :class="layers.parking ? 'bg-sky-500 border-sky-400' : 'border-white/30'">
              <svg v-if="layers.parking" viewBox="0 0 24 24" class="w-2.5 h-2.5 text-white" fill="none"
                   stroke="currentColor" stroke-width="3.5" stroke-linecap="round"
                   stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
          </button>
          <div v-if="overlayBarrierPts.length && (layers.surfaced || layers.assumed)"
               class="flex items-center gap-1.5 py-0.5 pointer-events-none">
            <span class="inline-flex w-5 justify-center shrink-0">
              <span class="w-3 h-3 rounded-full bg-[#dc2626] border border-white flex items-center justify-center">
                <span class="block w-1.5 h-[2px] rounded bg-white"></span>
              </span>
            </span>
            Bom — stengt for motorkjøretøy
          </div>
        </div>
      </div>

      <!-- Attribusjon (løftes over skuffen) -->
      <div class="absolute right-1 px-1.5 py-0.5 rounded bg-zinc-900/85 text-white/60 text-[8px]
                  border border-white/15 leading-tight pointer-events-none z-10"
           :style="{ bottom: (drawer.visibleHeightPx.value + 4) + 'px' }">
        © Kartverket · © OpenStreetMap-bidragsytere · Ruting: BRouter (brouter.de)
      </div>
    </div>

    <!-- Feilbanner (ruting / offline) — flyter over skuffen uansett høyde -->
    <div v-if="isOffline || routeState === 'error'"
         class="absolute left-3 right-3 z-30 max-w-[560px] mx-auto rounded-xl border px-4 py-3
                text-[13px] shadow-2xl"
         :style="{ bottom: (drawer.visibleHeightPx.value + 12) + 'px' }"
         :class="isOffline ? 'bg-zinc-900/95 border-white/15 text-white/80'
                           : 'bg-rose-950/95 border-rose-500/40 text-rose-100'">
      <template v-if="isOffline">Ruteplanleggeren krever nettilkobling.</template>
      <template v-else>
        {{ routeError }}
        <button @click="onFindRoute" class="ml-2 underline underline-offset-2 font-medium">Prøv igjen</button>
      </template>
    </div>

    <!-- Dra-bar bunn-skuff (samme UX som turkartets skuffer): dra i håndtaket
         for å minimere (peek med håndtak + header) eller maksimere
         (kart-stripe på 56 px igjen i toppen). Alltid synlig (v12.1.11). -->
    <!-- Skuffen flyter OVER kartet (absolute, v12.1.6) i stedet for å ligge i
         flex-flyten: kartflaten er da konstant uansett om skuffen er åpen,
         minimert eller maksimert. -->
    <div
         class="absolute inset-x-0 bottom-0 z-20 backdrop-blur-md bg-zinc-900/92 border-t border-white/10
                rounded-t-2xl flex flex-col overflow-hidden shadow-2xl"
         :style="drawer.drawerHeightStyle.value">
      <div class="shrink-0 select-none touch-none cursor-grab active:cursor-grabbing"
           @pointerdown="drawer.onPointerDown($event)"
           @pointermove="drawer.onPointerMove($event)"
           @pointerup="drawer.onPointerUp($event)"
           @pointercancel="drawer.onPointerUp($event)">
        <div class="pt-3 pb-1.5 flex justify-center">
          <div class="w-12 h-1.5 rounded-full bg-white/40"
               :style="{ opacity: drawer.handleOpacity.value }"></div>
        </div>
        <!-- Header i drag-sonen: synlig også minimert -->
        <div class="px-4 pb-2 w-full max-w-[560px] mx-auto">
          <template v-if="route && routeState !== 'routing'">
            <div class="text-[10px] uppercase tracking-wide text-white/45">Grusrute</div>
            <div class="flex items-baseline gap-2 mt-0.5">
              <span class="text-[26px] leading-none font-bold text-white tabular-nums">{{ fmtKm(route.lengthM) }} km</span>
              <span v-if="fmtGrus(route.gravelShare)" class="text-[14px] font-semibold text-[#e8802b]">
                · Grus {{ fmtGrus(route.gravelShare) }}</span>
              <span v-else class="text-[12px] text-white/45">· Grusandel utilgjengelig</span>
            </div>
          </template>
          <div v-else class="text-[14px] font-semibold text-white pt-1.5">Planlegg grusrute</div>
        </div>
      </div>

      <!-- Fra/Til-skjema (før rute / under beregning) -->
      <div v-if="!route || routeState === 'routing'"
           class="flex-1 overflow-y-auto px-4 pt-1
                  pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]">
      <div class="max-w-[560px] mx-auto">
        <!-- Hvordan-hint: to trykk i kartet setter A og B; grusvei-overlayen
             vises direkte i kartet ved innzooming. Skjules i delingsmodus
             (der er punktene låst og banneret forklarer flyten). -->
        <div v-if="!routeInvite"
             class="mb-2.5 px-3 py-2 rounded-lg bg-sky-500/[0.07] border border-sky-400/15
                    text-[11px] text-white/60 leading-snug">
          Trykk i kartet for å sette start
          <span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500
                       text-white text-[9px] font-bold align-middle">A</span>
          og trykk en gang til for mål
          <span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-rose-500
                       text-white text-[9px] font-bold align-middle">B</span>
          — eller bruk søk/GPS. Tips: zoom inn, så viser kartet hvor det er grus
          (heltrukket) og mulig grus (stiplet). Hold inne et punkt i kartet for å
          åpne det i UT.no, Vegkart eller Google Maps.
        </div>
        <div v-for="field in ['A', 'B']" :key="field" class="relative">
          <div v-if="field === 'B'" class="flex justify-center -my-1 relative z-10">
            <button @click="swapPoints" aria-label="Bytt start og mål" :disabled="!!routeInvite"
                    class="w-8 h-8 rounded-full bg-zinc-800 border border-white/15 text-white/70
                           flex items-center justify-center active:scale-90 transition disabled:opacity-35">
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
                   @input="routeInvite || ((field === 'A' ? searchA : searchB).query.value = $event.target.value, activeSearch = field)"
                   @focus="activeSearch = routeInvite ? null : field"
                   type="search" autocomplete="off" :readonly="!!routeInvite"
                   :placeholder="field === 'A' ? 'Fra — startsted' : 'Til — destinasjon'"
                   class="flex-1 min-w-0 py-2 bg-transparent text-[13px] placeholder-white/35
                          focus:outline-none" />
            <!-- Angre: fjern satt punkt (skjult i delingsmodus) -->
            <button v-if="(field === 'A' ? pointA : pointB) && !routeInvite"
                    @click="setPoint(field, null)"
                    :aria-label="`Fjern ${field === 'A' ? 'start' : 'mål'}`"
                    class="w-8 h-8 shrink-0 rounded-lg bg-white/5 border border-white/10 text-white/50
                           flex items-center justify-center active:scale-95 transition">
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            </button>
            <button v-if="field === 'A'" @click="onGpsForA" aria-label="Bruk min posisjon som start"
                    :disabled="gpsState.status === 'locating' || !!routeInvite"
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
                    :aria-pressed="armedField === field" :disabled="!!routeInvite"
                    :aria-label="`Velg ${field === 'A' ? 'start' : 'mål'} i kartet`"
                    class="w-8 h-8 shrink-0 rounded-lg border flex items-center justify-center
                           active:scale-95 transition disabled:opacity-35"
                    :class="armedField === field ? 'bg-sky-500/25 border-sky-400/50 text-sky-200' : 'bg-white/5 border-white/10 text-white/60'">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
            </button>
          </div>
          <!-- Nominatim-treff (åpner NEDOVER — skuffens innhold scroller, så
               treff over feltet ville klippes mot scroll-toppen) -->
          <div v-if="activeSearch === field && (field === 'A' ? searchA : searchB).results.value.length"
               class="absolute left-0 right-0 top-full mt-1 rounded-xl bg-zinc-900/98 backdrop-blur
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
          {{ routeState === 'routing' ? 'Beregner tre ruteforslag …'
             : (installRequested && canInstall ? 'Installer som app og finn grusrute' : 'Finn grusrute') }}
        </button>
      </div>
      </div>

      <!-- Rute-resultat (tre forslag + stat-fliser) -->
      <div v-else class="flex-1 overflow-y-auto px-4
                  pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]">
      <div class="max-w-[560px] mx-auto">
        <div class="text-[12px] text-white/50 truncate">
          {{ route.navn ?? `${labelFor(pointA)} → ${labelFor(pointB)}` }}
        </div>
        <!-- Fallback-varsel: grusprofilen kunne ikke brukes → standard
             bilprofil (lovlige kjøreveier, men ingen grus-prioritering). -->
        <div v-if="route.usedFallbackProfile"
             class="mt-2 px-3 py-2 rounded-lg bg-amber-500/[0.08] border border-amber-400/20
                    text-amber-200/85 text-[11px] leading-snug">
          Grusprofilen kunne ikke lastes hos rutetjenesten — ruta bruker standard bilprofil.
          Lovlige kjøreveier, men uten grus-prioritering. Prøv igjen senere for full grusrute.
          <div v-if="route.fallbackReason" class="mt-1 text-[10px] text-amber-200/55 break-words">
            Teknisk årsak: {{ route.fallbackReason }}
          </div>
        </div>

        <!-- Snap-varsel: ruta traff ikke A/B eksakt — vis hvor stort gapet er. -->
        <div v-if="snapWarning"
             class="mt-2 px-3 py-2 rounded-lg bg-amber-500/[0.08] border border-amber-400/20
                    text-amber-200/85 text-[11px] leading-snug">
          {{ snapWarning }}
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
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[13px] text-white font-medium">{{ p.label }}</span>
                <span v-for="b in p.badges" :key="b.text"
                      class="px-1.5 py-0.5 rounded-md border text-[9px] font-bold tracking-wide"
                      :class="b.tone === 'green'
                              ? 'bg-emerald-500/25 border-emerald-400/40 text-emerald-200'
                              : 'bg-sky-500/25 border-sky-400/40 text-sky-200'">{{ b.text }}</span>
              </div>
              <div class="text-[11px] text-white/50 tabular-nums">
                {{ fmtKm(p.lengthM) }} km<template v-if="fmtGrus(p.gravelShare)"> · Grus {{ fmtGrus(p.gravelShare) }}</template><template v-if="fmtTid(p.estimatedTimeS)"> · {{ fmtTid(p.estimatedTimeS) }}</template>
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
            <div class="text-[13px] font-semibold text-white tabular-nums">{{ fmtTid(route.estimatedTimeS) ?? '–' }}</div>
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

        <!-- Høydeprofil (v12.1.14) — interaktiv SVG: dra i grafen for å lese
             km/moh, linja er fargekodet grus/asfalt som kartet. -->
        <RouteElevationProfile class="mt-2" :profile="elevProfile" :state="elevState" :source="elevSource" />

        <!-- Handlinger. Lagre-trykket bytter radene til et tydelig
             navngivnings-steg («Lagre …»-ellipsen signaliserer at et steg
             følger) i stedet for å stable en uventet tekstboks under.
             Eksport (GPX/SVG/Del) og rute-handlinger (Lagre/Nullstill) på
             hver sin rad — fem knapper på én rad ble for trangt på mobil. -->
        <div v-if="!savingName" class="mt-3 space-y-1.5">
          <div class="flex gap-1.5">
            <button @click="planner.exportGpx()" aria-label="Last ned GPX"
                    class="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border bg-white/5 border-white/15
                           text-white/80 active:scale-95 transition">GPX</button>
            <button @click="planner.exportSvg(elevProfile)" aria-label="Last ned stilisert SVG"
                    class="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border bg-white/5 border-white/15
                           text-white/80 active:scale-95 transition">SVG</button>
            <button @click="onShareRoute" aria-label="Del rute"
                    class="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border bg-white/5 border-white/15
                           text-white/80 active:scale-95 transition">
              {{ shareState === 'copied' ? 'Kopiert!' : (shareState === 'error' ? 'Feilet' : 'Del') }}</button>
          </div>
          <div class="flex gap-1.5">
            <button @click="startSave" aria-label="Lagre rute"
                    class="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border bg-emerald-500/15
                           border-emerald-400/40 text-emerald-100 active:scale-95 transition">Lagre …</button>
            <button @click="onReset" aria-label="Nullstill rute"
                    class="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium border bg-white/5 border-white/15
                           text-white/60 active:scale-95 transition">Nullstill</button>
          </div>
        </div>
        <div v-else class="mt-3 rounded-xl bg-white/[0.04] border border-emerald-400/25 px-3 py-2.5">
          <div class="text-[11px] text-emerald-200/80 font-medium mb-1.5">Gi ruta et navn</div>
          <input ref="saveNameInput" v-model="saveName" type="text" placeholder="Navn på ruta"
                 @keyup.enter="confirmSave"
                 class="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/15 text-[13px]
                        placeholder-white/30 focus:outline-none focus:border-emerald-300/50 transition" />
          <div class="flex gap-1.5 mt-2">
            <button @click="confirmSave"
                    class="flex-1 px-4 py-2 rounded-lg text-[12px] font-semibold bg-emerald-500 text-white
                           active:scale-95 transition">Lagre rute</button>
            <button @click="savingName = false"
                    class="px-4 py-2 rounded-lg text-[12px] border bg-white/5 border-white/15 text-white/60
                           active:scale-95 transition">Avbryt</button>
          </div>
        </div>
        <div v-if="savedFlash" class="mt-1.5 text-center text-[11px] text-emerald-300">{{ savedFlash }}</div>
      </div>
      </div>
    </div>

    <!-- Mine ruter — dra-bar skuff med samme design/UX som infodraweren i
         turkart (v12.1.4): avrundede topphjørner, håndtak, minimer/standard/
         maksimer. Kun maksimert tilstand dimmer kartet bak. -->
    <Transition name="overlay-fade">
      <div v-if="showSaved" class="absolute inset-0 z-40 pointer-events-none">
        <div v-if="savedDrawer.isMaximized.value"
             class="absolute inset-0 bg-black/60 pointer-events-auto"
             @click="showSaved = false"></div>
        <div class="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[560px] pointer-events-auto
                    backdrop-blur-md bg-zinc-900/95 border-t border-white/10 rounded-t-2xl
                    flex flex-col overflow-hidden shadow-2xl"
             :style="savedDrawer.drawerHeightStyle.value">
          <div class="shrink-0 select-none touch-none cursor-grab active:cursor-grabbing"
               @pointerdown="savedDrawer.onPointerDown($event)"
               @pointermove="savedDrawer.onPointerMove($event)"
               @pointerup="savedDrawer.onPointerUp($event)"
               @pointercancel="savedDrawer.onPointerUp($event)">
            <div class="pt-3 pb-1.5 flex justify-center">
              <div class="w-12 h-1.5 rounded-full bg-white/40"
                   :style="{ opacity: savedDrawer.handleOpacity.value }"></div>
            </div>
            <div class="px-4 pb-2.5 flex items-center justify-between gap-3">
              <div class="text-white text-[14px] font-semibold">Mine ruter
                <span v-if="savedRoutes.length" class="text-white/45 font-normal text-[12px]">· {{ savedRoutes.length }} ruter</span>
              </div>
              <button @pointerdown.stop @click.stop="showSaved = false" aria-label="Lukk"
                      class="w-8 h-8 shrink-0 rounded-full flex items-center justify-center bg-white/5
                             border border-white/10 text-white/60 active:scale-90 transition">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
              </button>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto px-4 pb-3 border-t border-white/8 pt-3">
            <!-- Vises kun med mange lagrede ruter. Handler om ryddighet og at
                 veinettet endrer seg (ruter kan trenge re-beregning), ikke MB
                 — samme varseltype som i lagrede turkart. -->
            <div v-if="savedRoutes.length > 9"
                 class="mb-2 px-3 py-2 rounded-lg bg-amber-500/[0.08] border border-amber-400/20
                        text-amber-200/80 text-[11px] leading-snug">
              Du har mange og potensielt utdaterte ruter. Veinettet endrer seg over tid — slett
              ruter du ikke trenger lenger, og beregn viktige ruter på nytt før tur.
            </div>
            <div v-if="!savedRoutes.length" class="text-[13px] text-white/50 text-center py-6">
              Ingen lagrede ruter ennå. Beregn en rute og trykk «Lagre».
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
                  {{ fmtKm(rec.lengthM) }} km<template v-if="rec.gravelShare != null"> · Grus {{ Math.round(rec.gravelShare * 100) }} %</template><template v-if="fmtTid(recTidS(rec))"> · {{ fmtTid(recTidS(rec)) }}</template>
                </div>
                <div class="text-[10px] text-white/35 tabular-nums">
                  {{ new Date(rec.opprettet).toLocaleDateString('no-NO') }} ·
                  {{ new Date(rec.opprettet).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' }) }}
                </div>
              </button>
              <button @click="onShareSaved(rec)" aria-label="Del rute"
                      class="shrink-0 w-9 h-9 rounded-lg border bg-white/5 border-white/10 text-white/60
                             flex items-center justify-center active:scale-95 transition">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
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

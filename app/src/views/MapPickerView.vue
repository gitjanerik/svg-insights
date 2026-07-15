<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useNominatim } from '../composables/useNominatim.js'
import { useSearchKeyboard } from '../composables/useSearchKeyboard.js'
import { bboxFromCenter, viewportAspect, PRINT_ASPECT } from '../lib/mapBuilder.js'
import { buildMapFromCenter } from '../lib/createMapFlow.js'
import { tileMosaic, zoomForKm, metersPerPixel } from '../lib/tileBackground.js'
import { usePwaInstall } from '../composables/usePwaInstall.js'
import { t } from '../lib/i18n.js'

const router = useRouter()
const route = useRoute()

// v9.1.x: PWA-install fra del-kart-banneret. Hvis mottakeren ikke alt
// kjører appen i standalone-modus tilbyr vi å installere den når de
// genererer det delte kartet — gir fullskjerm + offline.
const { canInstall, isStandalone, promptInstall } = usePwaInstall()
const installRequested = ref(false)   // checkbox i del-kart-banneret
const showInstallInfo = ref(false)    // info-tooltip toggle

// Standard utgangspunkt: Oslo
const DEFAULT_CENTER = { lat: 59.9139, lon: 10.7522, name: 'Oslo' }

const center = ref({ ...DEFAULT_CENTER })
const halfKm = ref(2.0)  // halv-bredde av bbox i km (E/V). Kart blir 2*halfKm bredt
// Skjerm-format (høyde/bredde): kartet strekkes N/S til dette så det fyller
// fullskjerm uten letterbox (v10.1.10). Settes på mount + resize. buildMapFrom-
// Center utleder samme aspekt selv, så previewen viser det faktiske utsnittet.
const mapAspect = ref(viewportAspect())
const equidistanceM = ref(20)  // høydekurve-intervall, 5/10/20/25/50 m
const customName = ref('')

// Format-velger (trippel toggle). Styrer utsnittets høyde/bredde-forhold;
// bredden styres uansett av slideren, høyden utledes av valgt aspekt.
//   'square'   → kvadrat (aspect = 1) — default
//   'portrait' → skjerm-format (mobilskjerm, ~1:2,2) — tidligere default
//   'print'    → stående A-format (√2 ≈ 1,4142) for ren utskrift / PDF / SVG
const FORMAT_OPTIONS = [
  { value: 'square',   label: 'Kvadratisk', sub: '' },
  { value: 'portrait', label: 'Portrett',   sub: 'mobilskjerm' },
  { value: 'print',    label: 'Utskrift',   sub: 'A4' },
]
const format = ref('square')
const effectiveAspect = computed(() => {
  if (format.value === 'portrait') return mapAspect.value
  if (format.value === 'print') return PRINT_ASPECT
  return 1
})

// v8.5.1: Sentrer på GPS. Forhindrer at brukeren ender med et kart sentrert
// på Nominatim-koordinaten for stedsnavnet (som kan ligge en stund vekk fra
// hvor brukeren faktisk står), og dermed får GPS-prikken utenfor sitt eget
// kart når de bruker det. Ingen watcher — én engangs hent på request.
const gpsState = ref({ status: 'idle', error: null })  // idle | locating | ok | error

function onCenterOnMe() {
  if (controlsLocked.value) return
  if (!navigator.geolocation) {
    gpsState.value = { status: 'error', error: 'Nettleseren støtter ikke GPS' }
    return
  }
  gpsState.value = { status: 'locating', error: null }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude
      const lon = pos.coords.longitude
      center.value = { lat, lon, name: customName.value || 'Min posisjon' }
      gpsState.value = { status: 'ok', error: null }
    },
    (err) => {
      const map = {
        1: 'GPS-tillatelse avvist',
        2: 'GPS-posisjon ikke tilgjengelig',
        3: 'GPS-forespørsel tok for lang tid',
      }
      gpsState.value = { status: 'error', error: map[err.code] ?? 'GPS-feil' }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  )
}

const shareInvite = ref(null) // { hl } — del-flyt fra delingslenke

// Et delt kart (shareInvite) låser alle utsnitt-valg (sted, navn, størrelse,
// ekvidistanse, preview drag/pinch). Poenget med deling er at mottakeren ser
// nøyaktig det samme som senderen — «se det jeg ser» — så bbox, størrelse og
// ekvidistanse skal ikke kunne endres.
const controlsLocked = computed(() => shareInvite.value !== null)

const lockedSearchPlaceholder = computed(() => t('picker.searchLockedPlaceholderShared'))
const lockedPreviewHint = computed(() => t('picker.previewLockedHintShared'))

function dismissShareInvite() {
  shareInvite.value = null
  installRequested.value = false
  showInstallInfo.value = false
  router.replace({ name: 'kart-nytt', query: {} })
}

// Del-flyt: URL har ?lat=&lon= (+ optional km/eq/hl). Pre-populerer feltene
// og returnerer en "shareInvite" struct som rendrer et beskjedent banner.
// Returner { hl } slik at generateMap kan forwarde highlight til MapView.
function parseShareInvite() {
  const q = route.query
  if (!q || !q.lat || !q.lon) return null
  const lat = parseFloat(q.lat)
  const lon = parseFloat(q.lon)
  const km = parseFloat(q.km)
  const eq = parseInt(q.eq, 10)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  center.value = { lat, lon, name: q.hl ? String(q.hl).slice(0, 60) : '' }
  // Eldre delte lenker kan ha km opptil 12 — clamp til dagens 8 km-tak.
  if (Number.isFinite(km) && km >= 1 && km <= 12) halfKm.value = Math.min(km, 8) / 2
  if (Number.isFinite(eq) && [5, 10, 20, 25, 50].includes(eq)) equidistanceM.value = eq
  format.value = 'portrait'
  if (q.hl) customName.value = String(q.hl).slice(0, 60)
  // «Del kart og sted»: slat/slon er stedets eksakte koordinater. Forwardes
  // til MapView så mottakeren får en rosa markering på nøyaktig samme punkt.
  const slat = parseFloat(q.slat)
  const slon = parseFloat(q.slon)
  const hasPlace = Number.isFinite(slat) && Number.isFinite(slon)
  return {
    hl: q.hl ? String(q.hl).slice(0, 60) : null,
    slat: hasPlace ? slat : null,
    slon: hasPlace ? slon : null,
    hasPlace,
  }
}

const EQUIDISTANCE_OPTIONS = [
  { value: 5,   label: '5 m',   desc: 'ISOM-orientering — krever 1m DTM' },
  { value: 10,  label: '10 m',  desc: 'tett — for små områder' },
  { value: 20,  label: '20 m',  desc: 'turkart-standard' },
  { value: 25,  label: '25 m',  desc: 'norsk N50-standard' },
  { value: 50,  label: '50 m',  desc: 'oversikt — for store områder' },
]

// v10.1.x: minste tillatte ekvidistanse skaleres med bbox-bredde. Tett
// kontur-rendering er meningsløst på store kart (overlappende streker,
// rotete kart uten lesbarhet). Maks kartstørrelse er nå 12×12 km, men terskel-
// tabellen topper på 20 m: store kart (≥ 6 km, inkl. de nye 7–12 km) beholder
// 20/25/50 m som aktive valg, slik at 25 og 50 m alltid er tilgjengelig:
//   bredde <  4 km  → alle valg (5/10/20/25/50)
//   4 ≤ bredde < 6  → min 10 m (5 m utelukket)
//   bredde ≥ 6 km   → min 20 m (5/10 m utelukket). 20/25/50 m forblir valgbare.
const minEquidistance = computed(() => {
  const km = halfKm.value * 2
  if (km >= 6) return 20
  if (km >= 4) return 10
  return 5
})

// Forklarende tooltip når et ekvidistanse-valg er utelukket av gjeldende bredde.
function widthHintFor(value) {
  if (value === 5)  return 'Krever bredde < 4 km'
  if (value === 10) return 'Krever bredde < 6 km'
  return ''
}

// Auto-bump ekvidistanse n&aring;r bredde &oslash;kes forbi en grense og
// gjeldende valg blir ulovlig.
watch(minEquidistance, (minEq) => {
  if (equidistanceM.value < minEq) {
    equidistanceM.value = minEq
  }
})

const { query, results, isSearching, error: searchError } = useNominatim()

const showResults = computed(() =>
  query.value.trim().length >= 2 && (results.value.length > 0 || isSearching.value)
)

function selectResult(r) {
  center.value = { lat: r.lat, lon: r.lon, name: r.shortName }
  customName.value = r.shortName
  query.value = ''
  results.value = []
}

// Tastaturnavigasjon (desktop): pil ned/opp markerer, Enter velger, Escape
// nullstiller søkefeltet. Fokus blir i input-en så Escape alltid virker.
const { activeIndex: searchActiveIndex, onKeydown: onSearchKeydown } = useSearchKeyboard(results, {
  onSelect: selectResult,
  onClear: () => { query.value = ''; results.value = [] },
  optionId: (i) => `mappicker-opt-${i}`,
})

const bbox = computed(() => bboxFromCenter(center.value.lat, center.value.lon, halfKm.value, effectiveAspect.value))

const sizeKm = computed(() => (halfKm.value * 2).toFixed(1))
// Høyde i km (N/S-strekk) for label-en — bredde × høyde, ikke kvadrat lenger.
const sizeHeightKm = computed(() => (halfKm.value * 2 * effectiveAspect.value).toFixed(1))

// 'idle' | 'fetching' | 'building' | 'saving' | 'error'
const buildState = ref('idle')
const buildError = ref(null)
const buildProgress = ref('')

async function generateMap() {
  // v9.1.x: Hvis mottakeren har huket av «Installer kartappen» i del-kart-
  // banneret, trigg install-prompten først (best-effort). Vi venter på
  // brukerens valg og bygger kartet uansett utfall — på iOS/uten støtte er
  // canInstall false og vi går rett videre.
  if (installRequested.value && canInstall.value) {
    try { await promptInstall() } catch { /* avvist / utilgjengelig — bygg likevel */ }
  }

  buildState.value = 'fetching'
  buildError.value = null
  buildProgress.value = `Henter kartdata for ${sizeKm.value} × ${sizeKm.value} km …`

  try {
    const navn = customName.value.trim() || center.value.name || 'Uten navn'
    const { id } = await buildMapFromCenter({
      center: center.value,
      halfKm: halfKm.value,
      aspect: effectiveAspect.value,   // følg previewen (A-format når «tilpass til utskrift» er på)
      equidistanceM: equidistanceM.value,
      navn,
      terrainFirst: true,   // vis terreng straks, fyll inn OSM i bakgrunnen
      onProgress: (msg) => {
        buildProgress.value = msg
        // Heuristikk for state-overgang basert på status-tekst — beholder
        // tidligere oppførsel der buildState gikk fetching → building → saving.
        if (msg.startsWith('Bygger')) buildState.value = 'building'
        else if (msg.startsWith('Lagrer')) buildState.value = 'saving'
      },
    })
    // v8.10.0: Forwarde delings-highlight slik at mottaker ser samme markering
    // som sender hadde valgt. Brukes når shareInvite er aktiv (ikke
    // utfordrings-share).
    const nav = { name: 'kart-vis', params: { id } }
    const inv = shareInvite.value
    if (inv?.hl || inv?.hasPlace) {
      nav.query = {}
      if (inv.hl) nav.query.hl = inv.hl
      if (inv.hasPlace) { nav.query.slat = String(inv.slat); nav.query.slon = String(inv.slon) }
    }
    router.push(nav)
  } catch (e) {
    buildState.value = 'error'
    buildError.value = e.message ?? 'Bygging feilet'
  }
}

// ── Preview med ekte Kartverket-tiler som bakgrunn ─────────────────────────
const previewRef = ref(null)
const previewSize = ref({ w: 0, h: 0 })
// Zoom-en må romme den STØRSTE aksen (høyden ved portrett-aspekt) i den
// kvadratiske previewen, ellers stikker bbox-rammen utenfor toppen/bunnen.
const previewZoom = computed(() => zoomForKm(halfKm.value * 2 * effectiveAspect.value + 2))

function measurePreview() {
  const r = previewRef.value?.getBoundingClientRect()
  if (r) previewSize.value = { w: r.width, h: r.height }
  // Oppdater skjerm-aspektet så previewen følger rotasjon/vindusendring.
  mapAspect.value = viewportAspect()
}

const tiles = computed(() => {
  if (!previewSize.value.w) return []
  return tileMosaic(
    center.value.lat, center.value.lon,
    previewZoom.value, previewSize.value
  )
})

// Kartverket-topo dekker bare Norge. Feiler en flis (utenfor dekning), skjul
// den så OSM-underlaget viser gjennom — slik blir svensk side ikke blank.
function onTopoTileError(e) {
  e.target.style.display = 'none'
}

// Pixel-størrelse av bbox-overlegget innen preview-en
const bboxOverlayPx = computed(() => {
  if (!previewSize.value.w) return { w: 0, h: 0 }
  const mPerPx = metersPerPixel(center.value.lat, previewZoom.value)
  const widthM = halfKm.value * 2 * 1000
  const heightM = widthM * effectiveAspect.value   // N/S-strekk = portrett-rammen
  return {
    w: widthM / mPerPx,
    h: heightM / mPerPx,
  }
})

// Pan + pinch på preview-en. Bruker drar kartet under den faste rammen.
// 1-touch (eller mus) = pan kartet (oppdaterer center.lat/lon). 2-touch
// = pinch-zoom (oppdaterer halfKm).
let lastDist = 0
let pinching = false
let panning = false
let panStart = null

function panShiftToCenter(dxPx, dyPx) {
  // Når kartet flyttes høyre med dxPx skal sentrum-punktet flyttes
  // VENSTRE i geografisk rom (kartet under flyttes til venstre).
  // I tile-rom: y øker nedover = lat synker.
  const mPerPx = metersPerPixel(center.value.lat, previewZoom.value)
  const dLat = (dyPx * mPerPx) / 111111
  const dLon = -(dxPx * mPerPx) / (111111 * Math.cos(center.value.lat * Math.PI / 180))
  return { dLat, dLon }
}

function onPreviewTouchStart(e) {
  if (controlsLocked.value) return
  if (e.touches.length === 2) {
    pinching = true
    panning = false
    lastDist = touchDist(e)
    e.preventDefault()
  } else if (e.touches.length === 1) {
    panning = true
    pinching = false
    panStart = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      lat: center.value.lat,
      lon: center.value.lon,
    }
  }
}
function onPreviewTouchMove(e) {
  if (controlsLocked.value) return
  if (pinching && e.touches.length === 2) {
    e.preventDefault()
    const d = touchDist(e)
    const ratio = d / lastDist
    const next = halfKm.value / ratio
    halfKm.value = Math.max(0.5, Math.min(4, next))
    lastDist = d
  } else if (panning && e.touches.length === 1 && panStart) {
    e.preventDefault()
    const dxPx = e.touches[0].clientX - panStart.x
    const dyPx = e.touches[0].clientY - panStart.y
    const { dLat, dLon } = panShiftToCenter(dxPx, dyPx)
    center.value = { ...center.value, lat: panStart.lat + dLat, lon: panStart.lon + dLon }
  }
}
function onPreviewTouchEnd(e) {
  if (e.touches.length < 2) pinching = false
  if (e.touches.length < 1) { panning = false; panStart = null }
}
function touchDist(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX
  const dy = e.touches[0].clientY - e.touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

// Desktop: musedrag = pan
function onPreviewMouseDown(e) {
  if (controlsLocked.value) return
  if (e.button !== 0) return
  panning = true
  panStart = {
    x: e.clientX, y: e.clientY,
    lat: center.value.lat, lon: center.value.lon,
  }
  e.preventDefault()
}
function onPreviewMouseMove(e) {
  if (controlsLocked.value) return
  if (!panning || !panStart) return
  e.preventDefault()
  const dxPx = e.clientX - panStart.x
  const dyPx = e.clientY - panStart.y
  const { dLat, dLon } = panShiftToCenter(dxPx, dyPx)
  center.value = { ...center.value, lat: panStart.lat + dLat, lon: panStart.lon + dLon }
}
function onPreviewMouseUp() {
  panning = false
  panStart = null
}
// Desktop: scroll-hjul = zoom (pinch-ekvivalent)
function onPreviewWheel(e) {
  if (controlsLocked.value) return
  e.preventDefault()
  const delta = e.deltaY > 0 ? 1.1 : 0.9
  const next = halfKm.value * delta
  halfKm.value = Math.max(0.5, Math.min(4, next))
}

onMounted(() => {
  shareInvite.value = parseShareInvite()
  nextTick(() => measurePreview())
  window.addEventListener('resize', measurePreview)
})
</script>

<template>
  <div class="kart-ui relative w-full min-h-[100dvh] flex flex-col bg-[#0e1116] text-white/90">

    <!-- Toppbar -->
    <div class="relative shrink-0 px-3 py-3 flex items-center justify-between
                bg-zinc-900/80 border-b border-white/10 z-30">
      <button @click="router.push('/kart')"
              class="rounded-full w-10 h-10 flex items-center justify-center
                     bg-white/[0.04] border border-white/10 active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="text-[14px] font-semibold">Nytt turkart</div>
      <div class="w-10 h-10"/>
    </div>

    <!-- v8.10.0: Banner ved «Del kart»-lenke (uten utfordring). v9.1.x:
         utsnitt/størrelse/ekvidistanse er nå låst (controlsLocked) slik at
         mottakeren får en nøyaktig kopi — «se det jeg ser». ?hl=<navn>
         forwardes til MapView etter generering. Hvis appen ikke kjører i
         standalone-modus tilbys installasjon via checkbox under teksten. -->
    <div v-if="shareInvite"
         class="relative mx-4 mt-4 rounded-xl border border-sky-300/40 bg-sky-500/10 px-4 py-3">
      <button @click="dismissShareInvite"
              :aria-label="t('share.invite.cancel')"
              class="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center
                     text-sky-200/70 hover:text-sky-100 hover:bg-sky-400/15
                     active:scale-95 transition">
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
            <circle cx="18" cy="5" r="3"/>
            <circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold text-sky-100">
            {{ shareInvite.hasPlace ? t('share.invite.titlePlace') : t('share.invite.title') }}
          </div>
          <div v-if="shareInvite.hl" class="text-[11px] text-sky-100/75 truncate">
            {{ t('share.invite.marking', { name: shareInvite.hl }) }}
          </div>
        </div>
      </div>
      <div class="mt-2 text-[11px] text-white/70 leading-relaxed">
        {{ shareInvite.hasPlace ? t('share.invite.bodyPlace') : t('share.invite.body') }}
      </div>

      <!-- v9.1.x: Install-hint. Vises kun når appen IKKE alt kjører som PWA
           (standalone). Checkbox endrer CTA til «Installer som app og lag
           kart»; info-knappen forklarer kort hva installasjon innebærer. -->
      <div v-if="!isStandalone" class="mt-3 pt-3 border-t border-sky-300/15">
        <label class="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" v-model="installRequested"
                 class="mt-0.5 w-4 h-4 shrink-0 accent-sky-400 cursor-pointer" />
          <span class="flex-1 text-[11px] text-sky-100/85 leading-relaxed">
            {{ t('share.invite.installCheckbox') }}
            <button type="button" @click.prevent="showInstallInfo = !showInstallInfo"
                    :aria-label="t('share.invite.installInfoLabel')"
                    :aria-expanded="showInstallInfo"
                    class="inline-flex items-center justify-center align-middle ml-1
                           w-4 h-4 rounded-full border border-sky-300/50 text-sky-200/90
                           text-[9px] font-bold leading-none active:scale-90 transition">
              i
            </button>
          </span>
        </label>
        <Transition name="fade">
          <div v-if="showInstallInfo"
               class="mt-2 ml-[26px] text-[10px] text-sky-100/60 leading-relaxed">
            {{ t('share.invite.installInfo') }}
          </div>
        </Transition>
      </div>
    </div>


    <!-- Søkefelt. v9.1.x: skjult i delingsmodus — mottakeren skal bare se og
         lage det delte kartet, ikke søke/velge sted. -->
    <div v-if="!shareInvite" class="px-4 pt-4 pb-3 relative z-20">
      <label class="text-white/65 text-[11px] uppercase tracking-wide block mb-2">Sted, postnummer eller adresse</label>
      <div class="relative">
        <svg viewBox="0 0 24 24" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50"
             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>
        </svg>
        <input v-model="query" type="search" autocomplete="off" autocorrect="off"
               :readonly="controlsLocked" :disabled="controlsLocked"
               @keydown="onSearchKeydown"
               role="combobox" aria-autocomplete="list" :aria-expanded="showResults"
               aria-controls="mappicker-results"
               :aria-activedescendant="searchActiveIndex >= 0 ? `mappicker-opt-${searchActiveIndex}` : undefined"
               :placeholder="controlsLocked ? lockedSearchPlaceholder : 'f.eks. Sognsvann, 0855, Vardåsen Asker'"
               class="w-full pl-10 pr-3 py-3 rounded-xl bg-white/[0.06] border border-white/15
                      text-[14px] placeholder-white/30 focus:outline-none focus:bg-white/12
                      focus:border-slate-300/50 transition disabled:opacity-50 disabled:cursor-not-allowed" />
        <div v-if="isSearching"
             class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/15
                    border-t-white/70 rounded-full animate-spin" />
      </div>

      <!-- Søkeresultater -->
      <Transition name="fade">
        <div v-if="showResults" id="mappicker-results" role="listbox"
             class="absolute left-4 right-4 mt-1 rounded-xl bg-zinc-900/98 backdrop-blur
                    border border-white/10 shadow-2xl max-h-[50dvh] overflow-y-auto z-30">
          <div v-if="results.length === 0 && !isSearching"
               class="px-4 py-3 text-[13px] text-white/50">Ingen treff</div>
          <button v-for="(r, index) in results" :key="r.id"
                  :id="`mappicker-opt-${index}`" role="option"
                  :aria-selected="index === searchActiveIndex"
                  @click="selectResult(r)"
                  @mousemove="searchActiveIndex = index"
                  class="w-full text-left px-4 py-2.5 transition border-b
                         border-white/8 last:border-0"
                  :class="index === searchActiveIndex ? 'bg-white/12' : 'active:bg-white/10'">
            <div class="text-[13px] font-medium text-white truncate">{{ r.shortName }}</div>
            <div class="text-[11px] text-white/50 truncate">{{ r.name }}</div>
          </button>
        </div>
      </Transition>

      <div v-if="searchError" class="mt-2 text-[11px] text-slate-300">{{ searchError }}</div>

      <!-- v8.5.1: GPS-snarvei. Sentrer kartet på din n&aring;v&aelig;rende posisjon i
           stedet for &aring; m&aring;tte s&oslash;ke etter stedsnavn (som ofte ligger annen-
           hvor i bygda enn der du faktisk st&aring;r). -->
      <button v-if="!controlsLocked"
              @click="onCenterOnMe"
              :disabled="gpsState.status === 'locating'"
              class="mt-2 w-full px-3 py-2 rounded-lg border border-white/15
                     bg-white/[0.04] text-white/80 text-[12px] font-medium
                     active:bg-white/[0.08] active:scale-[0.99] transition
                     disabled:opacity-60 flex items-center justify-center gap-2">
        <svg v-if="gpsState.status === 'locating'"
             viewBox="0 0 24 24" class="w-4 h-4 animate-spin" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
          <line x1="12" y1="1" x2="12" y2="5"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="1" y1="12" x2="5" y2="12"/>
          <line x1="19" y1="12" x2="23" y2="12"/>
        </svg>
        <span v-if="gpsState.status === 'locating'">Henter posisjon …</span>
        <span v-else>Sentrer kartet på meg (GPS)</span>
      </button>
      <div v-if="gpsState.error"
           class="mt-2 text-[11px] text-amber-300">{{ gpsState.error }}</div>
    </div>

    <!-- Valgt sted. v9.1.x: skjult i delingsmodus — navn/koordinater er låst
         til det delte kartet, ingen grunn til å vise redigerings-feltet. -->
    <div v-if="!shareInvite" class="px-4 pb-2">
      <div class="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3">
        <div class="text-[11px] text-white/50 uppercase tracking-wide mb-1">Sentrum av kart</div>
        <input v-model="customName"
               type="text" placeholder="Navn på kart"
               :readonly="controlsLocked"
               class="w-full bg-transparent text-[15px] font-semibold focus:outline-none
                      placeholder-white/25 read-only:opacity-70" />
        <div class="mt-1 text-[11px] text-white/45 tabular-nums">
          {{ center.lat.toFixed(4) }}°N, {{ center.lon.toFixed(4) }}°E
        </div>
      </div>
    </div>

    <!-- Mini-preview + bbox. v9.x: Bredde + Høydekurver er flyttet OVER
         forhåndsvisningen slik at brukeren ser (og kan justere) valgene før
         hen ruller ned til CTA-knappen nederst. -->
    <div class="px-4 pb-3 flex flex-col gap-3">
      <!-- Slider for størrelse -->
      <div class="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] text-white/50 uppercase tracking-wide">Bredde</div>
          <div class="text-[13px] font-medium tabular-nums">{{ sizeKm }} km</div>
        </div>
        <input type="range" min="0.5" max="4" step="0.25" v-model.number="halfKm"
               :disabled="controlsLocked"
               class="w-full accent-slate-400 disabled:opacity-50 disabled:cursor-not-allowed" />
        <div class="flex justify-between text-[10px] text-white/40 mt-1">
          <span>1 km</span><span>4,5 km</span><span>8 km</span>
        </div>
      </div>

      <!-- Ekvidistanse-velger -->
      <div class="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] text-white/50 uppercase tracking-wide">Høydekurver</div>
          <div class="text-[13px] font-medium tabular-nums">hver {{ equidistanceM }} m</div>
        </div>
        <div class="grid grid-cols-5 gap-1.5">
          <button v-for="opt in EQUIDISTANCE_OPTIONS" :key="opt.value"
                  :disabled="controlsLocked || opt.value < minEquidistance"
                  :title="opt.value < minEquidistance ? widthHintFor(opt.value) : opt.desc"
                  @click="equidistanceM = opt.value"
                  class="px-2 py-1.5 rounded-md border text-[11px] font-medium active:scale-95 transition
                         disabled:cursor-not-allowed disabled:opacity-40"
                  :class="equidistanceM === opt.value
                          ? 'bg-slate-400/20 border-slate-300/60 text-slate-100'
                          : 'bg-white/5 border-white/10 text-white/65'">
            {{ opt.label }}
          </button>
        </div>
        <div class="text-[10px] text-white/40 mt-1.5">
          {{ EQUIDISTANCE_OPTIONS.find(o => o.value === equidistanceM)?.desc }}
        </div>
      </div>

      <!-- Format-velger (trippel toggle). Styrer utsnittets høyde/bredde-forhold:
           Kvadratisk (default), Portrett (mobilskjerm) eller Utskrift (stående
           A-format √2 for ren utskrift / PDF / SVG). Previewen og det genererte
           kartet følger valget. -->
      <div class="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3">
        <div class="text-[11px] text-white/50 uppercase tracking-wide mb-2">Format</div>
        <div class="grid grid-cols-3 gap-1.5">
          <button v-for="opt in FORMAT_OPTIONS" :key="opt.value"
                  :disabled="controlsLocked"
                  @click="format = opt.value"
                  class="px-2 py-1.5 rounded-md border text-[12px] font-medium active:scale-95 transition
                         flex flex-col items-center justify-center gap-0.5
                         disabled:cursor-not-allowed disabled:opacity-40"
                  :class="format === opt.value
                          ? 'bg-slate-400/20 border-slate-300/60 text-slate-100'
                          : 'bg-white/5 border-white/10 text-white/65'">
            <span>{{ opt.label }}</span>
            <span v-if="opt.sub" class="text-[9px] font-normal text-white/45 leading-none">{{ opt.sub }}</span>
          </button>
        </div>
      </div>

      <div v-if="!shareInvite" class="text-white/65 text-[11px] uppercase tracking-wide">
        <template v-if="controlsLocked">{{ lockedPreviewHint }}</template>
        <template v-else>Forhåndsvisning — dra kartet for å plassere, pinch / scroll for størrelse</template>
      </div>
      <!-- v8.2.2: preview-containeren er et kvadrat; netto-rammen (ROI) inni
           viser det FAKTISKE utsnittet — kvadrat, portrett eller A-format alt
           etter Format-valget (bboxOverlayPx følger effectiveAspect).
           Bruttokartet (tile-mosaikken) fyller hele kvadratet på 100% opacity —
           ingen lysegrå semitransparent maskering rundt netto-rammen. Netto-
           rammen er bare en stiplet kontur med subtilt fokus (drop-shadow +
           indre kant). -->
      <!-- v9.1.x: når utsnittet er låst (delt kart / utfordring) skal touch/scroll
           OVER kartet rulle siden — ikke pan/pinch/rotere forhåndsvisningen.
           Derfor `touch-auto` ved lås, `touch-none` (fang gesten) ellers.
           Touch-/wheel-handlerne early-returner alt på controlsLocked. -->
      <div ref="previewRef"
           class="aspect-square w-full rounded-xl bg-zinc-800 border border-white/10 overflow-hidden
                  relative"
           :class="controlsLocked ? 'cursor-not-allowed opacity-90 touch-auto' : 'cursor-move touch-none'"
           @touchstart="onPreviewTouchStart"
           @touchmove="onPreviewTouchMove"
           @touchend="onPreviewTouchEnd"
           @touchcancel="onPreviewTouchEnd"
           @mousedown="onPreviewMouseDown"
           @mousemove="onPreviewMouseMove"
           @mouseup="onPreviewMouseUp"
           @mouseleave="onPreviewMouseUp"
           @wheel="onPreviewWheel">
        <!-- OSM-underlag: dekker globalt (også Sverige) så grensenære utsnitt
             ikke blir blanke der Kartverket-topo mangler. -->
        <img v-for="t in tiles" :key="'osm-' + t.url"
             :src="t.osmUrl" alt=""
             class="absolute pointer-events-none select-none"
             :style="{ left: t.leftPx + 'px', top: t.topPx + 'px', width: '256px', height: '256px' }"
             draggable="false" />
        <!-- Ekte Kartverket-tiler OVER OSM. Tiles flyttes når bruker drar
             (center oppdateres → tile-mosaikken regenereres rundt ny lat/lon).
             Skjules ved feil (utenfor norsk dekning) → OSM-underlaget viser. -->
        <img v-for="t in tiles" :key="t.url"
             :src="t.url" alt=""
             class="absolute pointer-events-none select-none"
             :style="{ left: t.leftPx + 'px', top: t.topPx + 'px', width: '256px', height: '256px' }"
             draggable="false" @error="onTopoTileError" />

        <!-- Netto-frame fast i sentrum (portrett — følger skjerm-formatet så
             kartet fyller fullskjerm). Brukeren drar kartet UNDER rammen for å
             velge utsnitt. Pinch / scroll endrer størrelse. Ingen dark-mask
             rundt — bruttokartet skal være synlig på 100% opacity. -->
        <div class="absolute pointer-events-none border-2 border-white rounded-sm
                    shadow-[0_0_0_2px_rgba(0,0,0,0.5)]"
             :style="{
               width:  bboxOverlayPx.w + 'px',
               height: bboxOverlayPx.h + 'px',
               left:   (previewSize.w - bboxOverlayPx.w) / 2 + 'px',
               top:    (previewSize.h - bboxOverlayPx.h) / 2 + 'px',
               transition: 'width 200ms cubic-bezier(0.2,0.8,0.2,1), height 200ms cubic-bezier(0.2,0.8,0.2,1)',
             }">
          <!-- Senter-kryss -->
          <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none">
            <div class="absolute top-1/2 left-0 right-0 h-0.5 bg-white/85 -translate-y-1/2 shadow-[0_0_2px_rgba(0,0,0,0.7)]"></div>
            <div class="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/85 -translate-x-1/2 shadow-[0_0_2px_rgba(0,0,0,0.7)]"></div>
          </div>
        </div>

        <div class="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-zinc-900 text-[11px]
                    text-white border border-white/30 font-medium shadow-lg z-10">
          {{ sizeKm }} × {{ sizeHeightKm }} km
        </div>
        <div class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-zinc-900/85 text-white/70 text-[8px]
                    text-white/75 border border-white/15 leading-tight pointer-events-none">
          © Kartverket
        </div>
      </div>
    </div>

    <!-- Bygg-knapp. -->
    <div class="sticky bottom-0 z-30 shrink-0 p-4 pb-6 bg-zinc-900/95 backdrop-blur border-t border-white/10">
      <button @click="generateMap" :disabled="buildState !== 'idle' && buildState !== 'error'"
              class="w-full py-4 rounded-xl text-white font-semibold flex items-center justify-center gap-2
                     active:scale-[0.99] transition disabled:opacity-60
                     bg-slate-600 hover:bg-slate-500 disabled:bg-slate-800">
        <div v-if="buildState !== 'idle' && buildState !== 'error'"
             class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
        <span v-if="buildState !== 'idle' && buildState !== 'error'">{{ buildProgress }}</span>
        <template v-else>
          <!-- v9.1.x: når mottakeren har huket av install i del-kart-banneret
               bytter CTA-en til «Installer som app og lag kart» med last-ned-ikon. -->
          <svg v-if="installRequested" viewBox="0 0 24 24" class="w-4 h-4" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/>
            <rect x="3" y="17" width="18" height="4" rx="1"/>
          </svg>
          <span>{{ installRequested ? t('picker.makeMapInstall') : t('picker.makeMap') }}</span>
        </template>
      </button>
      <div v-if="buildError"
           class="mt-3 px-3 py-2 rounded-lg bg-slate-500/20 border border-slate-300/30
                  text-slate-100 text-[11px]">
        {{ buildError }}
      </div>
      <div class="mt-3 text-[10px] text-white/40 text-center">
        Henter data fra OpenStreetMap (ODbL) via Overpass API.
        <span class="text-white/25">·</span>
        <button @click="router.push({ name: 'kart-vis', params: { id: 'vardasen' } })"
                class="underline decoration-dotted underline-offset-2 hover:text-white/70 transition">
          Åpne innebygd kart
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

input[type="range"]::-webkit-slider-runnable-track {
  height: 4px; border-radius: 999px;
  background: rgba(255,255,255,0.15);
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px; height: 18px; border-radius: 999px;
  background: #a78bfa; margin-top: -7px;
  border: 2px solid #fff;
  box-shadow: 0 2px 8px rgba(167,139,250,0.5);
}
</style>

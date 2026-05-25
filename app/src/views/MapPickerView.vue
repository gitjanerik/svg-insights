<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useNominatim } from '../composables/useNominatim.js'
import { bboxFromCenter } from '../lib/mapBuilder.js'
import { buildMapFromCenter } from '../lib/createMapFlow.js'
import { tileMosaic, zoomForKm, metersPerPixel } from '../lib/tileBackground.js'
import { t } from '../lib/i18n.js'

const router = useRouter()
const route = useRoute()

// Standard utgangspunkt: Oslo
const DEFAULT_CENTER = { lat: 59.9139, lon: 10.7522, name: 'Oslo' }

const center = ref({ ...DEFAULT_CENTER })
const halfKm = ref(2.0)  // halv-bredde av bbox i km. Kart blir 2*halfKm × 2*halfKm
const equidistanceM = ref(20)  // høydekurve-intervall, 5/10/20/25/50 m
const customName = ref('')

// v8.5.1: Sentrer på GPS. Forhindrer at brukeren ender med et kart sentrert
// på Nominatim-koordinaten for stedsnavnet (som kan ligge en stund vekk fra
// hvor brukeren faktisk står), og dermed får GPS-prikken utenfor sitt eget
// kart når de bruker det. Ingen watcher — én engangs hent på request.
const gpsState = ref({ status: 'idle', error: null })  // idle | locating | ok | error

function onCenterOnMe() {
  if (isLocked.value) return
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

// v7.4.0: Delings-utfordring. Hvis URL har ?n=ABC&lat=...&lon=...&km=...&eq=...
// så kommer brukeren fra en delings-lenke — pre-populer alle felter og vis
// banner med info om hvem som har utfordret + spillforklaring.
const challenge = ref(null)   // { name, score, level } eller null
const shareInvite = ref(null) // { hl } — del-flyt uten utfordring

// v7.4.2: i utfordringsmodus skal alle valg (sted, navn, størrelse, ekvi-
// distanse, preview drag/pinch) være read-only. Brukeren skal akkurat det
// kartet som ble delt — ikke noe annet. Bruk én computed-flag overalt.
// shareInvite låser IKKE — mottaker kan justere bbox/eq før kartet genereres.
const isLocked = computed(() => challenge.value !== null)

function cancelChallenge() {
  // Fjerner banneret + lås, og clearer URL-query så f.eks. F5 ikke gir
  // utfordring igjen. Gir brukeren mulighet til å gjøre vanlig kart-bygg.
  challenge.value = null
  customName.value = ''
  router.replace({ name: 'kart-nytt', query: {} })
}

function dismissShareInvite() {
  shareInvite.value = null
  router.replace({ name: 'kart-nytt', query: {} })
}

// HTML-escape for trygg interpolering i v-html (kun for utfordrernavn)
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

// Utfordrings-intro renderet med <strong> rundt spillnavnet. Bruker v-html
// fordi vi vil bolde gameName uten å forurense i18n-stringen med markup.
const challengeIntroHtml = computed(() => {
  if (!challenge.value) return ''
  return t('challenge.intro', {
    gameName: `<strong class="text-white">${escapeHtml(t('game.name'))}</strong>`,
    startBtn: escapeHtml(t('button.startGame')),
    name: escapeHtml(challenge.value.name),
  })
})

function parseShareQuery() {
  const q = route.query
  if (!q || !q.lat || !q.lon || !q.n) return null
  const lat = parseFloat(q.lat)
  const lon = parseFloat(q.lon)
  const km = parseFloat(q.km)
  const eq = parseInt(q.eq, 10)
  const score = parseInt(q.score, 10)
  const lv = parseInt(q.lv, 10)
  // v8.4.0: utfordrerens Map Master-prestasjoner (Cartographer-rang). Valgfri
  // — eldre lenker uten 'mm' tolkes som 0.
  const mm = parseInt(q.mm, 10)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  // Pre-populer kart-oppsett. customName settes så challenger-navn synes
  // i lagrede-kart-listen senere.
  center.value = { lat, lon, name: '' }
  if (Number.isFinite(km) && km >= 1 && km <= 10) halfKm.value = km / 2
  if (Number.isFinite(eq) && [5, 10, 20, 25, 50].includes(eq)) equidistanceM.value = eq
  const name = String(q.n).slice(0, 3).toUpperCase()
  customName.value = t('challenge.from', { name })
  return {
    name,
    score: Number.isFinite(score) ? score : null,
    level: Number.isFinite(lv) ? lv : null,
    mapMasters: Number.isFinite(mm) && mm >= 0 ? mm : 0,
  }
}

// v8.10.0: Ren del-flyt (uten Curve Invaders-utfordring). URL har ?lat=&lon=
// (+ optional km/eq/hl) men IKKE ?n=. Pre-populerer feltene som
// parseShareQuery gjør, men returnerer en lettere "shareInvite" struct som
// rendrer et beskjedent banner istedenfor det amber utfordrings-banneret.
// Returner { hl } slik at generateMap kan forwarde highlight til MapView.
function parseShareInvite() {
  const q = route.query
  if (!q || !q.lat || !q.lon || q.n) return null
  const lat = parseFloat(q.lat)
  const lon = parseFloat(q.lon)
  const km = parseFloat(q.km)
  const eq = parseInt(q.eq, 10)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  center.value = { lat, lon, name: q.hl ? String(q.hl).slice(0, 60) : '' }
  if (Number.isFinite(km) && km >= 1 && km <= 10) halfKm.value = km / 2
  if (Number.isFinite(eq) && [5, 10, 20, 25, 50].includes(eq)) equidistanceM.value = eq
  if (q.hl) customName.value = String(q.hl).slice(0, 60)
  return { hl: q.hl ? String(q.hl).slice(0, 60) : null }
}

const EQUIDISTANCE_OPTIONS = [
  { value: 5,   label: '5 m',   desc: 'ISOM-orientering — krever 1m DTM' },
  { value: 10,  label: '10 m',  desc: 'tett — for små områder' },
  { value: 20,  label: '20 m',  desc: 'turkart-standard' },
  { value: 25,  label: '25 m',  desc: 'norsk N50-standard' },
  { value: 50,  label: '50 m',  desc: 'oversikt — for store områder' },
]

// v8.2.3: minste tillatte ekvidistanse skaleres med bbox-bredde. Tett
// kontur-rendering er meningsløst på store kart (overlappende streker,
// rotete kart uten lesbarhet). Regler:
//   bredde <  4 km  → alle valg (5/10/20/25/50)
//   4 ≤ bredde < 8  → min 10 m (5 m utelukket)
//   8 ≤ bredde < 10 → min 20 m (5/10 m utelukket)
//   bredde ≥ 10 km  → min 25 m (5/10/20 m utelukket)
const minEquidistance = computed(() => {
  const km = halfKm.value * 2
  if (km >= 10) return 25
  if (km >= 8) return 20
  if (km >= 4) return 10
  return 5
})

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

const bbox = computed(() => bboxFromCenter(center.value.lat, center.value.lon, halfKm.value))

const sizeKm = computed(() => (halfKm.value * 2).toFixed(1))

// 'idle' | 'fetching' | 'building' | 'saving' | 'error'
const buildState = ref('idle')
const buildError = ref(null)
const buildProgress = ref('')

async function generateMap() {
  buildState.value = 'fetching'
  buildError.value = null
  buildProgress.value = `Henter kartdata for ${sizeKm.value} × ${sizeKm.value} km …`

  try {
    const navn = customName.value.trim() || center.value.name || 'Uten navn'
    const { id } = await buildMapFromCenter({
      center: center.value,
      halfKm: halfKm.value,
      equidistanceM: equidistanceM.value,
      navn,
      onProgress: (msg) => {
        buildProgress.value = msg
        // Heuristikk for state-overgang basert på status-tekst — beholder
        // tidligere oppførsel der buildState gikk fetching → building → saving.
        if (msg.startsWith('Bygger')) buildState.value = 'building'
        else if (msg.startsWith('Lagrer')) buildState.value = 'saving'
      },
    })
    if (challenge.value) {
      try {
        sessionStorage.setItem('curveball-autostart-mapId', id)
        sessionStorage.removeItem('flippkart-autostart-mapId')
      } catch { /* QuotaExceeded */ }
    }
    // v8.10.0: Forwarde delings-highlight slik at mottaker ser samme markering
    // som sender hadde valgt. Brukes når shareInvite er aktiv (ikke
    // utfordrings-share).
    const nav = { name: 'kart-vis', params: { id } }
    if (shareInvite.value?.hl) nav.query = { hl: shareInvite.value.hl }
    router.push(nav)
  } catch (e) {
    buildState.value = 'error'
    buildError.value = e.message ?? 'Bygging feilet'
  }
}

// ── Preview med ekte Kartverket-tiler som bakgrunn ─────────────────────────
const previewRef = ref(null)
const previewSize = ref({ w: 0, h: 0 })
const previewZoom = computed(() => zoomForKm(halfKm.value * 2 + 2))

function measurePreview() {
  const r = previewRef.value?.getBoundingClientRect()
  if (r) previewSize.value = { w: r.width, h: r.height }
}

const tiles = computed(() => {
  if (!previewSize.value.w) return []
  return tileMosaic(
    center.value.lat, center.value.lon,
    previewZoom.value, previewSize.value
  )
})

// Pixel-størrelse av bbox-overlegget innen preview-en
const bboxOverlayPx = computed(() => {
  if (!previewSize.value.w) return { w: 0, h: 0 }
  const mPerPx = metersPerPixel(center.value.lat, previewZoom.value)
  const sizeM = halfKm.value * 2 * 1000
  return {
    w: sizeM / mPerPx,
    h: sizeM / mPerPx,
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
  if (isLocked.value) return
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
  if (isLocked.value) return
  if (pinching && e.touches.length === 2) {
    e.preventDefault()
    const d = touchDist(e)
    const ratio = d / lastDist
    const next = halfKm.value / ratio
    halfKm.value = Math.max(0.5, Math.min(5, next))
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
  if (isLocked.value) return
  if (e.button !== 0) return
  panning = true
  panStart = {
    x: e.clientX, y: e.clientY,
    lat: center.value.lat, lon: center.value.lon,
  }
  e.preventDefault()
}
function onPreviewMouseMove(e) {
  if (isLocked.value) return
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
  if (isLocked.value) return
  e.preventDefault()
  const delta = e.deltaY > 0 ? 1.1 : 0.9
  const next = halfKm.value * delta
  halfKm.value = Math.max(0.5, Math.min(5, next))
}

onMounted(() => {
  challenge.value = parseShareQuery()
  if (!challenge.value) shareInvite.value = parseShareInvite()
  nextTick(() => measurePreview())
  window.addEventListener('resize', measurePreview)
})
</script>

<template>
  <div class="relative w-full min-h-[100dvh] flex flex-col bg-[#0e1116] text-white/90">

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

    <!-- v8.10.0: Banner ved «Del kart»-lenke (uten utfordring). Mottaker
         kan justere bbox/eq før kartet genereres — banneret er bare et hint
         om hva senderen pekte på. ?hl=<navn> forwardes til MapView etter
         generering. -->
    <div v-if="shareInvite"
         class="relative mx-4 mt-4 rounded-xl border border-sky-300/40 bg-sky-500/10 px-4 py-3">
      <button @click="dismissShareInvite"
              aria-label="Avbryt delt kart"
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
          <div class="text-[13px] font-semibold text-sky-100">Delt kart-utsnitt</div>
          <div v-if="shareInvite.hl" class="text-[11px] text-sky-100/75">
            Markering: <span class="text-white font-medium">{{ shareInvite.hl }}</span>
          </div>
          <div v-else class="text-[11px] text-sky-100/75">
            Senderen pekte på dette området.
          </div>
        </div>
      </div>
      <div class="mt-2 text-[11px] text-white/70 leading-relaxed">
        Bbox og ekvidistanse er pre-fylt fra lenken. Du kan justere før du
        trykker «Lag turkart» — kartet bygges lokalt i din egen nettleser.
      </div>
    </div>

    <!-- v7.4.0: Banner ved share-link — pre-populer felter, vis utfordrer +
         spillforklaring så mottaker forstår hva de er invitert til.
         v7.4.2: alle valg låst (read-only). Eget X-button kansellerer
         utfordringen og frigjør feltene. -->
    <div v-if="challenge"
         class="relative mx-4 mt-4 rounded-xl border border-amber-300/40 bg-amber-500/10 px-4 py-3">
      <button @click="cancelChallenge"
              :aria-label="t('challenge.cancel')"
              class="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center
                     text-amber-200/70 hover:text-amber-100 hover:bg-amber-400/15
                     active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="flex items-center gap-3 pr-8">
        <div class="shrink-0 w-10 h-10 rounded-full bg-amber-400/20 border border-amber-300/40
                    flex items-center justify-center text-amber-200 text-base font-bold tracking-widest">
          {{ challenge.name }}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-semibold text-amber-100">
            {{ t('challenge.from', { name: challenge.name }) }}
          </div>
          <div v-if="challenge.score !== null" class="text-[11px] text-amber-100/70">
            <template v-if="challenge.level">
              {{ t('challenge.scoreLevel', { score: challenge.score.toLocaleString('no-NO'), level: challenge.level }) }}
            </template>
            <template v-else>
              {{ t('challenge.score', { score: challenge.score.toLocaleString('no-NO') }) }}
            </template>
          </div>
          <div v-if="challenge.mapMasters > 0" class="text-[11px] text-amber-300/85 mt-0.5">
            {{ challenge.mapMasters }} × MAP MASTER ·
            Cartographer Lv {{ String(challenge.mapMasters).padStart(2, '0') }}
          </div>
        </div>
      </div>
      <div class="mt-2.5 text-[11px] text-white/70 leading-relaxed"
           v-html="challengeIntroHtml"></div>
      <div class="mt-2 text-[10px] text-white/45">
        {{ t('challenge.locked') }}
      </div>
    </div>

    <!-- Søkefelt -->
    <div class="px-4 pt-4 pb-3 relative z-20">
      <label class="text-white/65 text-[11px] uppercase tracking-wide block mb-2">Sted, postnummer eller adresse</label>
      <div class="relative">
        <svg viewBox="0 0 24 24" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50"
             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>
        </svg>
        <input v-model="query" type="search" autocomplete="off" autocorrect="off"
               :readonly="isLocked" :disabled="isLocked"
               :placeholder="isLocked ? t('picker.searchLockedPlaceholder') : 'f.eks. Sognsvann, 0855, Vardåsen Asker'"
               class="w-full pl-10 pr-3 py-3 rounded-xl bg-white/[0.06] border border-white/15
                      text-[14px] placeholder-white/30 focus:outline-none focus:bg-white/12
                      focus:border-slate-300/50 transition disabled:opacity-50 disabled:cursor-not-allowed" />
        <div v-if="isSearching"
             class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/15
                    border-t-white/70 rounded-full animate-spin" />
      </div>

      <!-- Søkeresultater -->
      <Transition name="fade">
        <div v-if="showResults"
             class="absolute left-4 right-4 mt-1 rounded-xl bg-zinc-900/98 backdrop-blur
                    border border-white/10 shadow-2xl max-h-[50dvh] overflow-y-auto z-30">
          <div v-if="results.length === 0 && !isSearching"
               class="px-4 py-3 text-[13px] text-white/50">Ingen treff</div>
          <button v-for="r in results" :key="r.id"
                  @click="selectResult(r)"
                  class="w-full text-left px-4 py-2.5 active:bg-white/10 transition border-b
                         border-white/8 last:border-0">
            <div class="text-[13px] font-medium text-white truncate">{{ r.shortName }}</div>
            <div class="text-[11px] text-white/50 truncate">{{ r.name }}</div>
          </button>
        </div>
      </Transition>

      <div v-if="searchError" class="mt-2 text-[11px] text-slate-300">{{ searchError }}</div>

      <!-- v8.5.1: GPS-snarvei. Sentrer kartet på din n&aring;v&aelig;rende posisjon i
           stedet for &aring; m&aring;tte s&oslash;ke etter stedsnavn (som ofte ligger annen-
           hvor i bygda enn der du faktisk st&aring;r). -->
      <button v-if="!isLocked"
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

    <!-- Valgt sted -->
    <div class="px-4 pb-2">
      <div class="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3">
        <div class="text-[11px] text-white/50 uppercase tracking-wide mb-1">Sentrum av kart</div>
        <div class="flex items-baseline justify-between gap-3">
          <input v-model="customName"
                 type="text" placeholder="Navn på kart"
                 :readonly="isLocked"
                 class="flex-1 bg-transparent text-[15px] font-semibold focus:outline-none
                        placeholder-white/25 read-only:opacity-70" />
          <div class="text-[10px] text-white/50 tabular-nums shrink-0">
            {{ center.lat.toFixed(4) }}°N, {{ center.lon.toFixed(4) }}°E
          </div>
        </div>
      </div>
    </div>

    <!-- Mini-preview + bbox -->
    <div class="px-4 pb-3 flex flex-col gap-3">
      <div class="text-white/65 text-[11px] uppercase tracking-wide">
        <template v-if="isLocked">{{ t('picker.previewLockedHint') }}</template>
        <template v-else>Forhåndsvisning — dra kartet for å plassere, pinch / scroll for størrelse</template>
      </div>
      <!-- v8.2.2: preview er nå et kvadrat slik at brukeren tydelig ser at
           sluttkartet blir kvadratisk. Bruttokartet (tile-mosaikken) fyller
           hele kvadratet på 100% opacity — ingen lysegrå semitransparent
           maskering rundt netto-rammen. Netto-rammen er bare en stiplet
           kontur med subtilt fokus (drop-shadow + indre kant). -->
      <div ref="previewRef"
           class="aspect-square w-full rounded-xl bg-zinc-800 border border-white/10 overflow-hidden
                  relative touch-none"
           :class="isLocked ? 'cursor-not-allowed opacity-90' : 'cursor-move'"
           @touchstart="onPreviewTouchStart"
           @touchmove="onPreviewTouchMove"
           @touchend="onPreviewTouchEnd"
           @touchcancel="onPreviewTouchEnd"
           @mousedown="onPreviewMouseDown"
           @mousemove="onPreviewMouseMove"
           @mouseup="onPreviewMouseUp"
           @mouseleave="onPreviewMouseUp"
           @wheel="onPreviewWheel">
        <!-- Ekte Kartverket-tiler som bakgrunn. Tiles flyttes når bruker drar
             (center oppdateres → tile-mosaikken regenereres rundt ny lat/lon). -->
        <img v-for="t in tiles" :key="t.url"
             :src="t.url" alt=""
             class="absolute pointer-events-none select-none"
             :style="{ left: t.leftPx + 'px', top: t.topPx + 'px', width: '256px', height: '256px' }"
             draggable="false" />

        <!-- Kvadratisk netto-frame fast i sentrum. Brukeren drar kartet UNDER
             rammen for å velge utsnitt. Pinch / scroll endrer størrelse. Ingen
             dark-mask rundt — bruttokartet skal være synlig på 100% opacity. -->
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
          {{ sizeKm }} × {{ sizeKm }} km
        </div>
        <div class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-zinc-900/85 text-white/70 text-[8px]
                    text-white/75 border border-white/15 leading-tight pointer-events-none">
          © Kartverket
        </div>
      </div>

      <!-- Slider for størrelse -->
      <div class="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] text-white/50 uppercase tracking-wide">Bredde</div>
          <div class="text-[13px] font-medium tabular-nums">{{ sizeKm }} km</div>
        </div>
        <input type="range" min="0.5" max="5" step="0.25" v-model.number="halfKm"
               :disabled="isLocked"
               class="w-full accent-slate-400 disabled:opacity-50 disabled:cursor-not-allowed" />
        <div class="flex justify-between text-[10px] text-white/40 mt-1">
          <span>1 km</span><span>4 km</span><span>10 km</span>
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
                  :disabled="isLocked || opt.value < minEquidistance"
                  :title="opt.value < minEquidistance
                          ? `Krever bredde < ${opt.value === 5 ? 4 : opt.value === 10 ? 8 : 10} km`
                          : opt.desc"
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
    </div>

    <!-- Bygg-knapp. v7.4.2: i utfordringsmodus heter den «Start Curve Invaders» —
         samme handler kjører bygg + auto-start-flagg, så MapView lander direkte
         i spillet med Curves-tema aktivert. v8.0.0: tekst kommer fra i18n.
         v8.0.1: brand-skrivemåte endret til «Curve Invaders» (med mellomrom). -->
    <div class="shrink-0 p-4 pb-6 bg-zinc-900/95 border-t border-white/10">
      <button @click="generateMap" :disabled="buildState !== 'idle' && buildState !== 'error'"
              class="w-full py-4 rounded-xl text-white font-semibold flex items-center justify-center gap-2
                     active:scale-[0.99] transition disabled:opacity-60"
              :class="isLocked
                      ? 'bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900'
                      : 'bg-slate-600 hover:bg-slate-500 disabled:bg-slate-800'">
        <div v-if="buildState !== 'idle' && buildState !== 'error'"
             class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
        <span v-if="buildState !== 'idle' && buildState !== 'error'">{{ buildProgress }}</span>
        <template v-else>
          <svg v-if="isLocked" viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
          <span>{{ isLocked ? t('button.startGame') : t('picker.makeMap') }}</span>
        </template>
      </button>
      <div v-if="buildError"
           class="mt-3 px-3 py-2 rounded-lg bg-slate-500/20 border border-slate-300/30
                  text-slate-100 text-[11px]">
        {{ buildError }}
      </div>
      <div class="mt-3 text-[10px] text-white/40 text-center">
        Henter data fra OpenStreetMap (ODbL) via Overpass API.
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

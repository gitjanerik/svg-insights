<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useNominatim } from '../composables/useNominatim.js'
import { fetchOverpass, buildSvg, bboxFromCenter } from '../lib/mapBuilder.js'
import { fetchN50Water } from '../lib/n50Fetcher.js'
import { fetchSjokart, sjokartToElements } from '../lib/sjokartFetcher.js'
import { isOsmWaterSalty } from '../lib/symbolizer.js'
import { fetchDEM } from '../lib/demFetcher.js'
import { wgs84ToUtm32 } from '../lib/utm.js'
import { saveMap, generateMapId } from '../lib/mapStorage.js'
import { tileMosaic, zoomForKm, metersPerPixel } from '../lib/tileBackground.js'

const router = useRouter()

// Standard utgangspunkt: Oslo
const DEFAULT_CENTER = { lat: 59.9139, lon: 10.7522, name: 'Oslo' }

const center = ref({ ...DEFAULT_CENTER })
const halfKm = ref(2.0)  // halv-bredde av bbox i km. Kart blir 2*halfKm × 2*halfKm
// Pixel-offset for bbox-frame innenfor preview. Bruker kan dra rammen
// vertikalt/horisontalt for å velge utsnitt uten å endre søke-senter.
const bboxOffsetPx = ref({ x: 0, y: 0 })
const equidistanceM = ref(20)  // høydekurve-intervall, 10/20/50/100 m
const customName = ref('')

const EQUIDISTANCE_OPTIONS = [
  { value: 5,   label: '5 m',   desc: 'ISOM-orientering — krever 1m DTM' },
  { value: 10,  label: '10 m',  desc: 'tett — for små områder' },
  { value: 20,  label: '20 m',  desc: 'turkart-standard' },
  { value: 50,  label: '50 m',  desc: 'oversikt' },
  { value: 100, label: '100 m', desc: 'glissen — for store områder' },
]

const { query, results, isSearching, error: searchError } = useNominatim()

const showResults = computed(() =>
  query.value.trim().length >= 2 && (results.value.length > 0 || isSearching.value)
)

function selectResult(r) {
  center.value = { lat: r.lat, lon: r.lon, name: r.shortName }
  customName.value = r.shortName
  query.value = ''
  results.value = []
  // Nytt søk → nullstill drag-offset
  bboxOffsetPx.value = { x: 0, y: 0 }
}

// Effektivt bbox-senter inkluderer drag-offset i lat/lon-rom.
const effectiveCenter = computed(() => {
  if (bboxOffsetPx.value.x === 0 && bboxOffsetPx.value.y === 0) return center.value
  const mPerPx = metersPerPixel(center.value.lat, previewZoom.value)
  const dx_m = bboxOffsetPx.value.x * mPerPx
  const dy_m = bboxOffsetPx.value.y * mPerPx
  // Tile-rom: y øker nedover. Lat øker nordover (oppover). Så positiv dy
  // = sørover = lat synker.
  const dLat = -dy_m / 111111
  const dLon = dx_m / (111111 * Math.cos(center.value.lat * Math.PI / 180))
  return {
    ...center.value,
    lat: center.value.lat + dLat,
    lon: center.value.lon + dLon,
  }
})

const bbox = computed(() => bboxFromCenter(effectiveCenter.value.lat, effectiveCenter.value.lon, halfKm.value))

const sizeKm = computed(() => (halfKm.value * 2).toFixed(1))

const buildState = ref('idle')   // 'idle' | 'fetching' | 'building' | 'saving' | 'error'
const buildError = ref(null)
const buildProgress = ref('')

async function generateMap() {
  buildState.value = 'fetching'
  buildError.value = null
  buildProgress.value = `Henter kartdata for ${sizeKm.value} × ${sizeKm.value} km …`

  try {
    // 1. Hent OSM (rik data) + N50-vann + Sjøkart (kyst/dybdedata).
    //    Tre parallelle kilder. Vann-prioritet i fallende rekkefølge:
    //      a) N50 Havflate / Innsjø / ElvBekk (autoritativt for innland)
    //      b) Sjøkart Dybdeareal (autoritativt for kyst — fyller hull
    //         der N50 Havflate mangler i åpne hav-områder)
    //      c) OSM `natural=water` som siste fallback
    //    Sjøkart gir dessuten dybdekonturer, skjær/grunner og lanterner
    //    som vi rendrer med dedikerte ISOM-koder.
    const [osmData, n50Water, sjokart] = await Promise.all([
      fetchOverpass(bbox.value),
      fetchN50Water(bbox.value).catch(e => {
        console.warn('N50-vann ikke tilgjengelig:', e.message)
        return []
      }),
      fetchSjokart(bbox.value).catch(e => {
        console.warn('Sjøkart ikke tilgjengelig:', e.message)
        return null
      }),
    ])
    const sjokartEls = sjokart ? sjokartToElements(sjokart) : []
    // Granulær autoritets-deteksjon. Vi differensierer mellom ferskvann
    // (innsjø/tjern/elv) og saltvann (sjø/fjord). Tidligere filter (v6.10.0)
    // skrudde av ALL OSM natural=water så snart N50 hadde noen ting — også
    // hvis N50 bare hadde innsjøer i et bbox med fjord. Da forsvant
    // Oslofjord-relationen og kart endte kremgul i Oslo. Nå filtreres OSM
    // pr type bare hvis tilsvarende autoritativ kilde finnes.
    const n50HasFreshwater = n50Water.some(el =>
      (el.tags?.natural === 'water' && el.tags?.salt !== 'yes') ||
      el.tags?.waterway === 'stream'
    )
    const n50HasSea = n50Water.some(el =>
      el.tags?.water === 'sea' || el.tags?.salt === 'yes'
    )
    const sjokartHasSea = sjokartEls.some(el =>
      el.type === 'way' && el.tags?.sjokart === 'dybdeareal'
    )
    const haveAuthoritativeSea = n50HasSea || sjokartHasSea

    // Detekter om vi må falle tilbake til coastline-rekonstruksjon. Må
    // beregnes FØR filteret slik at vi kan ekskludere OSM-saltvann-
    // polygoner i coastline-mode (de er da redundant og kan bløde blå
    // over mainland-masken hvis de mangler riktige inner-holes).
    const hasCoastline = osmData.elements.some(el =>
      el.type === 'way' && el.tags?.natural === 'coastline'
    )
    const useCoastlineFallback = hasCoastline && !haveAuthoritativeSea

    // v6.12.1: «Confirmed inland»-deteksjon. Hvis N50 har ferskvann
    // (innsjø/elv), N50 har INGEN sjø (Havflate), OG ingen OSM coastline,
    // så er vi trygt inne i innland. OSM-relations som er tagget
    // place=sea/natural=bay/etc kan strekke seg langt opp i elveos-
    // områder (Drammensfjorden-relationen dekker Drammenselva forbi
    // Drammen Sentrum og inn i Gulskogen) → de blør sjøblå over ren
    // land. Tilsvarende kan Sjøkart Dybdeareal returnere bbox-overlapp
    // fra fjord-hodet selv om actual bbox er inland.
    //
    // Merk: vi bruker n50HasSea (ikke haveAuthoritativeSea) som
    // sjø-signal, fordi Sjøkart selv kan være kilden til lekkasjen.
    // N50 Havflate er den eneste 100% autoritative sjø-detektoren.
    const isConfirmedInland = n50HasFreshwater && !n50HasSea && !hasCoastline

    let removedSaltwater = 0
    let removedInlandSjokart = 0
    const elements = osmData.elements.filter(el => {
      const t = el.tags ?? {}
      const isWaterPolygon = t.natural === 'water' || !!t.water ||
                             t.natural === 'bay' || t.natural === 'strait' ||
                             t.place === 'sea' || t.place === 'ocean'
      if (isWaterPolygon) {
        if (isOsmWaterSalty(t)) {
          // Drop OSM-saltvann i coastline-mode ELLER når bbox er
          // bekreftet inland — i begge tilfeller er saltvann-tagget
          // OSM-data feil eller redundant her.
          if (useCoastlineFallback || isConfirmedInland) { removedSaltwater++; return false }
          return !haveAuthoritativeSea
        }
        return !n50HasFreshwater
      }
      if (t.waterway === 'stream' || t.waterway === 'ditch') {
        return !n50HasFreshwater
      }
      return true
    })
    if (n50Water.length > 0) elements.push(...n50Water)

    // Filtrer Sjøkart-polygoner i confirmed-inland-bbox. Sjøkart-WFS kan
    // returnere bbox-clipped fjord-data som strekker seg inn i innland
    // (særlig ved fjord-hoder som Drammen). Lanterner/skjær er sjø-only
    // features og dropper også. Beholder dybdepunkt-tekst som er
    // tilnærmet harmløst hvis det skulle dukke opp.
    let sjokartFiltered = sjokartEls
    if (isConfirmedInland && sjokartEls.length > 0) {
      const before = sjokartEls.length
      sjokartFiltered = sjokartEls.filter(el => !el.tags?.sjokart)
      removedInlandSjokart = before - sjokartFiltered.length
    }
    if (sjokartFiltered.length > 0) elements.push(...sjokartFiltered)

    const filteredOsmCount = osmData.elements.length - (elements.length - n50Water.length - sjokartFiltered.length)
    console.log(`[Vann] N50 ferskvann=${n50HasFreshwater} sjø=${n50HasSea} | Sjøkart sjø=${sjokartHasSea} | OSM coastline=${hasCoastline} | coastline-fallback=${useCoastlineFallback} | confirmed-inland=${isConfirmedInland} | filtrerte ${filteredOsmCount} OSM-vann-elementer (${removedSaltwater} saltvann i coastline/inland-mode), ${removedInlandSjokart} Sjøkart-features inland`)

    const sourceParts = ['OSM']
    if (n50Water.length > 0) sourceParts.push(`N50 (${n50Water.length} vann${n50HasSea ? ', m/sjø' : ''})`)
    if (sjokart && sjokart.source) {
      const sjk = (sjokart.dybdeareal?.length ?? 0)
      const dyb = (sjokart.dybdekontur?.length ?? 0)
      const grn = (sjokart.grunne?.length ?? 0)
      const lnt = (sjokart.lanterne?.length ?? 0)
      sourceParts.push(`Sjøkart (${sjk} sjø, ${dyb} dybdekurver, ${grn} grunner, ${lnt} lanterner)`)
    }
    if (!haveAuthoritativeSea) sourceParts.push('OSM natural=water beholdt for sjø')
    if (useCoastlineFallback) sourceParts.push('coastline-rekonstruksjon aktiv')
    const source = sourceParts.join(' + ')
    buildProgress.value = `Bygger SVG fra ${elements.length} elementer (kilde: ${source}) …`
    buildState.value = 'building'

    // 2. Generer DEM (syntetisk for nå)
    const sw = wgs84ToUtm32(bbox.value.south, bbox.value.west)
    const ne = wgs84ToUtm32(bbox.value.north, bbox.value.east)
    const utmBbox = {
      minE: Math.min(sw.e, ne.e), maxE: Math.max(sw.e, ne.e),
      minN: Math.min(sw.n, ne.n), maxN: Math.max(sw.n, ne.n),
    }
    buildProgress.value = `Henter høydedata fra Kartverket …`
    await new Promise(r => setTimeout(r, 30))
    // Forsøk ekte WCS — kan CORS-feile i nettleser. Hvis så, dropper
    // mapBuilder konturer (skipContoursIfSynthetic) heller enn å vise
    // falske konsentriske ringer fra syntetisk Gaussian-modell.
    const dem = await fetchDEM(bbox.value, utmBbox, { resolutionM: 10, useReal: true })

    // 3. Bygg SVG med konturer
    const { svg, counts, meta } = buildSvg(elements, bbox.value, {
      dem, contourIntervalM: equidistanceM.value, scaleDenom: 10000,
      // Hvis WCS faller tilbake til syntetisk: ingen falske konsentriske
      // ringer i kartet. Bedre uten konturer enn villedende konturer.
      skipContoursIfSynthetic: true,
      useCoastlineFallback,
    })
    buildProgress.value = `Lagrer kart …`
    buildState.value = 'saving'

    const id = generateMapId()
    const navn = customName.value.trim() || center.value.name || 'Uten navn'
    const entry = {
      id,
      navn,
      bbox: bbox.value,
      center: { ...center.value },
      halfKm: halfKm.value,
      counts,
      svg,
      source,
      annotations: [],
      opprettet: Date.now(),
    }
    await saveMap(entry)
    router.push({ name: 'kart-vis', params: { id } })
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

let lastDist = 0
let pinching = false
const bboxDragging = ref(false)
let bboxDragStart = null

function onBboxPointerDown(e) {
  // 1-touch / 1-mouse drag for å panne rammen. 2-touch lar parent håndtere
  // pinch (vi bobler ikke opp ved single pointer).
  if (e.pointerType === 'touch' && e.isPrimary === false) return
  bboxDragging.value = true
  bboxDragStart = {
    x: e.clientX,
    y: e.clientY,
    offX: bboxOffsetPx.value.x,
    offY: bboxOffsetPx.value.y,
  }
  e.target.setPointerCapture?.(e.pointerId)
  e.stopPropagation()
}
function onBboxPointerMove(e) {
  if (!bboxDragging.value || !bboxDragStart) return
  e.preventDefault()
  e.stopPropagation()
  // Begrens offset så rammen ikke kan dras helt ut av preview-vinduet.
  const halfW = bboxOverlayPx.value.w / 2
  const halfH = bboxOverlayPx.value.h / 2
  const maxX = (previewSize.value.w / 2) - halfW * 0.4
  const maxY = (previewSize.value.h / 2) - halfH * 0.4
  const nx = bboxDragStart.offX + (e.clientX - bboxDragStart.x)
  const ny = bboxDragStart.offY + (e.clientY - bboxDragStart.y)
  bboxOffsetPx.value = {
    x: Math.max(-maxX, Math.min(maxX, nx)),
    y: Math.max(-maxY, Math.min(maxY, ny)),
  }
}
function onBboxPointerUp(e) {
  if (!bboxDragging.value) return
  bboxDragging.value = false
  bboxDragStart = null
  e.target.releasePointerCapture?.(e.pointerId)
}

function onPreviewTouchStart(e) {
  if (e.touches.length === 2) {
    pinching = true
    lastDist = touchDist(e)
    e.preventDefault()
  }
}
function onPreviewTouchMove(e) {
  if (!pinching || e.touches.length !== 2) return
  e.preventDefault()
  const d = touchDist(e)
  const ratio = d / lastDist
  const next = halfKm.value / ratio
  halfKm.value = Math.max(0.5, Math.min(5, next))
  lastDist = d
}
function onPreviewTouchEnd(e) {
  if (e.touches.length < 2) pinching = false
}
function touchDist(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX
  const dy = e.touches[0].clientY - e.touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

onMounted(() => {
  nextTick(() => measurePreview())
  window.addEventListener('resize', measurePreview)
})
</script>

<template>
  <div class="relative w-full min-h-[100dvh] flex flex-col bg-stone-50 text-zinc-900">

    <!-- Toppbar -->
    <div class="relative shrink-0 px-3 py-3 flex items-center justify-between
                bg-white border-b border-zinc-200 z-30">
      <button @click="router.push('/kart')"
              class="rounded-full w-10 h-10 flex items-center justify-center
                     bg-white border border-zinc-200 active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="text-[14px] font-semibold">Nytt turkart</div>
      <div class="w-10 h-10"/>
    </div>

    <!-- Søkefelt -->
    <div class="px-4 pt-4 pb-3 relative z-20">
      <label class="text-zinc-600 text-[11px] uppercase tracking-wide block mb-2">Sted, postnummer eller adresse</label>
      <div class="relative">
        <svg viewBox="0 0 24 24" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>
        </svg>
        <input v-model="query" type="search" autocomplete="off" autocorrect="off"
               placeholder="f.eks. Sognsvann, 0855, Vardåsen Asker"
               class="w-full pl-10 pr-3 py-3 rounded-xl bg-white border border-zinc-300
                      text-[14px] placeholder-white/30 focus:outline-none focus:bg-white/12
                      focus:border-amber-700/50 transition" />
        <div v-if="isSearching"
             class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-zinc-300
                    border-t-white/70 rounded-full animate-spin" />
      </div>

      <!-- Søkeresultater -->
      <Transition name="fade">
        <div v-if="showResults"
             class="absolute left-4 right-4 mt-1 rounded-xl bg-zinc-900/98 backdrop-blur
                    border border-zinc-200 shadow-2xl max-h-[50dvh] overflow-y-auto z-30">
          <div v-if="results.length === 0 && !isSearching"
               class="px-4 py-3 text-[13px] text-zinc-500">Ingen treff</div>
          <button v-for="r in results" :key="r.id"
                  @click="selectResult(r)"
                  class="w-full text-left px-4 py-2.5 active:bg-zinc-100 transition border-b
                         border-zinc-100 last:border-0">
            <div class="text-[13px] font-medium text-white truncate">{{ r.shortName }}</div>
            <div class="text-[11px] text-zinc-500 truncate">{{ r.name }}</div>
          </button>
        </div>
      </Transition>

      <div v-if="searchError" class="mt-2 text-[11px] text-amber-300">{{ searchError }}</div>
    </div>

    <!-- Valgt sted -->
    <div class="px-4 pb-2">
      <div class="rounded-xl bg-white border border-zinc-200 px-4 py-3">
        <div class="text-[11px] text-zinc-500 uppercase tracking-wide mb-1">Sentrum av kart</div>
        <div class="flex items-baseline justify-between gap-3">
          <input v-model="customName"
                 type="text" placeholder="Navn på kart"
                 class="flex-1 bg-transparent text-[15px] font-semibold focus:outline-none
                        placeholder-white/25" />
          <div class="text-[10px] text-zinc-500 tabular-nums shrink-0">
            {{ center.lat.toFixed(4) }}°N, {{ center.lon.toFixed(4) }}°E
          </div>
        </div>
      </div>
    </div>

    <!-- Mini-preview + bbox -->
    <div class="flex-1 px-4 pb-3 flex flex-col gap-3 min-h-0">
      <div class="text-zinc-600 text-[11px] uppercase tracking-wide">
        Forhåndsvisning — dra rammen for å flytte, pinch for størrelse
      </div>
      <div ref="previewRef"
           class="flex-1 min-h-[220px] rounded-xl bg-stone-200 border border-zinc-200 overflow-hidden
                  relative touch-none"
           @touchstart="onPreviewTouchStart"
           @touchmove="onPreviewTouchMove"
           @touchend="onPreviewTouchEnd"
           @touchcancel="onPreviewTouchEnd">
        <!-- Ekte Kartverket-tiler som bakgrunn -->
        <img v-for="t in tiles" :key="t.url"
             :src="t.url" alt=""
             class="absolute pointer-events-none select-none"
             :style="{ left: t.leftPx + 'px', top: t.topPx + 'px', width: '256px', height: '256px' }"
             draggable="false" />

        <!-- Bbox-overlegg, draggable. Brukeren kan flytte rammen fritt
             vertikalt og horisontalt for å velge utsnittet. -->
        <div class="absolute border-2 border-amber-700 rounded-sm cursor-move
                    shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
             :style="{
               width:  bboxOverlayPx.w + 'px',
               height: bboxOverlayPx.h + 'px',
               left:   ((previewSize.w - bboxOverlayPx.w) / 2 + bboxOffsetPx.x) + 'px',
               top:    ((previewSize.h - bboxOverlayPx.h) / 2 + bboxOffsetPx.y) + 'px',
               transition: bboxDragging ? 'none' : 'width 200ms cubic-bezier(0.2,0.8,0.2,1), height 200ms cubic-bezier(0.2,0.8,0.2,1)',
               touchAction: 'none',
             }"
             @pointerdown="onBboxPointerDown"
             @pointermove="onBboxPointerMove"
             @pointerup="onBboxPointerUp"
             @pointercancel="onBboxPointerUp">
          <div class="absolute inset-0 border border-violet-300/60 rounded-sm pointer-events-none"></div>
          <!-- Senter-kryss -->
          <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none">
            <div class="absolute top-1/2 left-0 right-0 h-0.5 bg-amber-700 -translate-y-1/2"></div>
            <div class="absolute left-1/2 top-0 bottom-0 w-0.5 bg-amber-700 -translate-x-1/2"></div>
          </div>
        </div>

        <div class="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-zinc-900 text-[11px]
                    text-white border border-zinc-400 font-medium shadow-lg z-10">
          {{ sizeKm }} × {{ sizeKm }} km
        </div>
        <div class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-zinc-100/95 text-zinc-700 text-[8px]
                    text-zinc-700 border border-zinc-300 leading-tight pointer-events-none">
          © Kartverket
        </div>
      </div>

      <!-- Slider for størrelse -->
      <div class="rounded-xl bg-white border border-zinc-200 px-4 py-3">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] text-zinc-500 uppercase tracking-wide">Bredde</div>
          <div class="text-[13px] font-medium tabular-nums">{{ sizeKm }} km</div>
        </div>
        <input type="range" min="0.5" max="5" step="0.25" v-model.number="halfKm"
               class="w-full accent-amber-700" />
        <div class="flex justify-between text-[10px] text-zinc-400 mt-1">
          <span>1 km</span><span>4 km</span><span>10 km</span>
        </div>
      </div>

      <!-- Ekvidistanse-velger -->
      <div class="rounded-xl bg-white border border-zinc-200 px-4 py-3">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] text-zinc-500 uppercase tracking-wide">Høydekurver</div>
          <div class="text-[13px] font-medium tabular-nums">hver {{ equidistanceM }} m</div>
        </div>
        <div class="grid grid-cols-5 gap-1.5">
          <button v-for="opt in EQUIDISTANCE_OPTIONS" :key="opt.value"
                  @click="equidistanceM = opt.value"
                  class="px-2 py-1.5 rounded-md border text-[11px] font-medium active:scale-95 transition"
                  :class="equidistanceM === opt.value
                          ? 'bg-amber-100 border-amber-400 text-amber-900'
                          : 'bg-white border-zinc-200 text-zinc-600'">
            {{ opt.label }}
          </button>
        </div>
        <div class="text-[10px] text-zinc-400 mt-1.5">
          {{ EQUIDISTANCE_OPTIONS.find(o => o.value === equidistanceM)?.desc }}
        </div>
      </div>
    </div>

    <!-- Bygg-knapp -->
    <div class="shrink-0 p-4 pb-6 bg-zinc-900/95 border-t border-zinc-200">
      <button @click="generateMap" :disabled="buildState !== 'idle' && buildState !== 'error'"
              class="w-full py-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900/50
                     disabled:opacity-60 text-white font-semibold flex items-center justify-center gap-2
                     active:scale-[0.99] transition">
        <div v-if="buildState !== 'idle' && buildState !== 'error'"
             class="w-4 h-4 border-2 border-zinc-400 border-t-white rounded-full animate-spin"/>
        <span>{{ buildState === 'idle' || buildState === 'error' ? 'Lag turkart' : buildProgress }}</span>
      </button>
      <div v-if="buildError"
           class="mt-3 px-3 py-2 rounded-lg bg-amber-600/30 border border-amber-300/30
                  text-amber-100 text-[11px]">
        {{ buildError }}
      </div>
      <div class="mt-3 text-[10px] text-zinc-400 text-center">
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

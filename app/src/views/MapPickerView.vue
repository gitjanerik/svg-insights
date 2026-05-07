<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useNominatim } from '../composables/useNominatim.js'
import { fetchOverpass, buildSvg, bboxFromCenter } from '../lib/mapBuilder.js'
import { fetchN50OrFallback } from '../lib/n50Fetcher.js'
import { fetchDEM } from '../lib/demFetcher.js'
import { wgs84ToUtm32 } from '../lib/utm.js'
import { saveMap, generateMapId } from '../lib/mapStorage.js'
import { tileMosaic, zoomForKm, metersPerPixel } from '../lib/tileBackground.js'

const router = useRouter()

// Standard utgangspunkt: Oslo
const DEFAULT_CENTER = { lat: 59.9139, lon: 10.7522, name: 'Oslo' }

const center = ref({ ...DEFAULT_CENTER })
const halfKm = ref(2.0)  // halv-bredde av bbox i km. Kart blir 2*halfKm × 2*halfKm
const customName = ref('')

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

const buildState = ref('idle')   // 'idle' | 'fetching' | 'building' | 'saving' | 'error'
const buildError = ref(null)
const buildProgress = ref('')

async function generateMap() {
  buildState.value = 'fetching'
  buildError.value = null
  buildProgress.value = `Henter kartdata for ${sizeKm.value} × ${sizeKm.value} km …`

  try {
    // 1. Hent OSM-data (eller N50 hvis tilgjengelig)
    const { source, elements } = await fetchN50OrFallback(bbox.value)
    buildProgress.value = `Bygger SVG fra ${elements.length} elementer (kilde: ${source}) …`
    buildState.value = 'building'

    // 2. Generer DEM (syntetisk for nå)
    const sw = wgs84ToUtm32(bbox.value.south, bbox.value.west)
    const ne = wgs84ToUtm32(bbox.value.north, bbox.value.east)
    const utmBbox = {
      minE: Math.min(sw.e, ne.e), maxE: Math.max(sw.e, ne.e),
      minN: Math.min(sw.n, ne.n), maxN: Math.max(sw.n, ne.n),
    }
    buildProgress.value = `Genererer høydekurver …`
    await new Promise(r => setTimeout(r, 30))
    const dem = await fetchDEM(bbox.value, utmBbox, { resolutionM: 20 })

    // 3. Bygg SVG med konturer
    const { svg, counts, meta } = buildSvg(elements, bbox.value, {
      dem, contourIntervalM: 50, scaleDenom: 10000,
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
  <div class="relative w-full min-h-[100dvh] flex flex-col bg-zinc-950 text-white">

    <!-- Toppbar -->
    <div class="relative shrink-0 px-3 py-3 flex items-center justify-between
                bg-zinc-900/95 border-b border-white/10 z-30">
      <button @click="router.push('/kart')"
              class="rounded-full w-10 h-10 flex items-center justify-center
                     bg-white/5 border border-white/10 active:scale-95 transition">
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
      <label class="text-white/55 text-[11px] uppercase tracking-wide block mb-2">Sted, postnummer eller adresse</label>
      <div class="relative">
        <svg viewBox="0 0 24 24" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40"
             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/>
        </svg>
        <input v-model="query" type="search" autocomplete="off" autocorrect="off"
               placeholder="f.eks. Sognsvann, 0855, Vardåsen Asker"
               class="w-full pl-10 pr-3 py-3 rounded-xl bg-white/8 border border-white/15
                      text-[14px] placeholder-white/30 focus:outline-none focus:bg-white/12
                      focus:border-violet-400/50 transition" />
        <div v-if="isSearching"
             class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-white/20
                    border-t-white/70 rounded-full animate-spin" />
      </div>

      <!-- Søkeresultater -->
      <Transition name="fade">
        <div v-if="showResults"
             class="absolute left-4 right-4 mt-1 rounded-xl bg-zinc-900/98 backdrop-blur
                    border border-white/15 shadow-2xl max-h-[50dvh] overflow-y-auto z-30">
          <div v-if="results.length === 0 && !isSearching"
               class="px-4 py-3 text-[13px] text-white/45">Ingen treff</div>
          <button v-for="r in results" :key="r.id"
                  @click="selectResult(r)"
                  class="w-full text-left px-4 py-2.5 active:bg-white/10 transition border-b
                         border-white/5 last:border-0">
            <div class="text-[13px] font-medium text-white truncate">{{ r.shortName }}</div>
            <div class="text-[11px] text-white/45 truncate">{{ r.name }}</div>
          </button>
        </div>
      </Transition>

      <div v-if="searchError" class="mt-2 text-[11px] text-amber-300">{{ searchError }}</div>
    </div>

    <!-- Valgt sted -->
    <div class="px-4 pb-2">
      <div class="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
        <div class="text-[11px] text-white/45 uppercase tracking-wide mb-1">Sentrum av kart</div>
        <div class="flex items-baseline justify-between gap-3">
          <input v-model="customName"
                 type="text" placeholder="Navn på kart"
                 class="flex-1 bg-transparent text-[15px] font-semibold focus:outline-none
                        placeholder-white/25" />
          <div class="text-[10px] text-white/40 tabular-nums shrink-0">
            {{ center.lat.toFixed(4) }}°N, {{ center.lon.toFixed(4) }}°E
          </div>
        </div>
      </div>
    </div>

    <!-- Mini-preview + bbox -->
    <div class="flex-1 px-4 pb-3 flex flex-col gap-3 min-h-0">
      <div class="text-white/55 text-[11px] uppercase tracking-wide">
        Forhåndsvisning — pinch for å justere størrelse
      </div>
      <div ref="previewRef"
           class="flex-1 min-h-[220px] rounded-xl bg-stone-200 border border-white/10 overflow-hidden
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

        <!-- Bbox-overlegg sentrert -->
        <div class="absolute pointer-events-none border-2 border-violet-400
                    rounded-sm shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
             :style="{
               width:  bboxOverlayPx.w + 'px',
               height: bboxOverlayPx.h + 'px',
               left:   (previewSize.w - bboxOverlayPx.w) / 2 + 'px',
               top:    (previewSize.h - bboxOverlayPx.h) / 2 + 'px',
               transition: 'all 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
             }">
          <div class="absolute inset-0 border border-violet-300/60 rounded-sm pointer-events-none"></div>
          <!-- Senter-kryss -->
          <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4">
            <div class="absolute top-1/2 left-0 right-0 h-0.5 bg-violet-300 -translate-y-1/2"></div>
            <div class="absolute left-1/2 top-0 bottom-0 w-0.5 bg-violet-300 -translate-x-1/2"></div>
          </div>
        </div>

        <div class="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-zinc-900 text-[11px]
                    text-white border border-white/30 font-medium shadow-lg z-10">
          {{ sizeKm }} × {{ sizeKm }} km
        </div>
        <div class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-zinc-900/85 text-[8px]
                    text-white/70 border border-white/20 leading-tight pointer-events-none">
          © Kartverket
        </div>
      </div>

      <!-- Slider for størrelse -->
      <div class="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[11px] text-white/45 uppercase tracking-wide">Bredde</div>
          <div class="text-[13px] font-medium tabular-nums">{{ sizeKm }} km</div>
        </div>
        <input type="range" min="0.5" max="5" step="0.25" v-model.number="halfKm"
               class="w-full accent-violet-500" />
        <div class="flex justify-between text-[10px] text-white/35 mt-1">
          <span>1 km</span><span>4 km</span><span>10 km</span>
        </div>
      </div>
    </div>

    <!-- Bygg-knapp -->
    <div class="shrink-0 p-4 pb-6 bg-zinc-900/95 border-t border-white/10">
      <button @click="generateMap" :disabled="buildState !== 'idle' && buildState !== 'error'"
              class="w-full py-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900/50
                     disabled:opacity-60 text-white font-semibold flex items-center justify-center gap-2
                     active:scale-[0.99] transition">
        <div v-if="buildState !== 'idle' && buildState !== 'error'"
             class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
        <span>{{ buildState === 'idle' || buildState === 'error' ? 'Lag turkart' : buildProgress }}</span>
      </button>
      <div v-if="buildError"
           class="mt-3 px-3 py-2 rounded-lg bg-amber-600/30 border border-amber-300/30
                  text-amber-100 text-[11px]">
        {{ buildError }}
      </div>
      <div class="mt-3 text-[10px] text-white/35 text-center">
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

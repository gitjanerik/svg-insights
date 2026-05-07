<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useNominatim } from '../composables/useNominatim.js'
import { fetchOverpass, buildSvg, bboxFromCenter } from '../lib/mapBuilder.js'
import { saveMap, generateMapId } from '../lib/mapStorage.js'

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
  buildProgress.value = `Henter OSM-data for ${sizeKm.value} × ${sizeKm.value} km …`

  try {
    const data = await fetchOverpass(bbox.value)
    buildProgress.value = `Bygger SVG fra ${data.elements.length} elementer …`
    buildState.value = 'building'
    // Gi browser et beat for å oppdatere UI før synkron build
    await new Promise(r => setTimeout(r, 30))

    const { svg, counts } = buildSvg(data.elements, bbox.value)
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
      opprettet: Date.now(),
    }
    await saveMap(entry)
    router.push({ name: 'kart-vis', params: { id } })
  } catch (e) {
    buildState.value = 'error'
    buildError.value = e.message ?? 'Bygging feilet'
  }
}

// ── Mini-preview SVG av valgt utsnitt ─────────────────────────────────────
// Bruker en latitude-aware kvadrat-form som visualiserer hva brukeren har
// valgt. Pinch-zoom her endrer halfKm i stedet for visuell skala.
const previewRef = ref(null)
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
  // Pinche ut → zoom ut → større halvkm; pinche inn → mindre område
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
           class="flex-1 min-h-[200px] rounded-xl bg-stone-200 border border-white/10 overflow-hidden
                  relative touch-none"
           @touchstart="onPreviewTouchStart"
           @touchmove="onPreviewTouchMove"
           @touchend="onPreviewTouchEnd"
           @touchcancel="onPreviewTouchEnd">
        <!-- Stilisert turkart-preview: lyse "land", litt grønn rundt, en blå strek for elv -->
        <svg viewBox="-50 -50 100 100" class="absolute inset-0 w-full h-full"
             preserveAspectRatio="xMidYMid meet">
          <!-- Skog rundt -->
          <rect x="-50" y="-50" width="100" height="100" fill="#cde3b8"/>
          <!-- Et åpent felt -->
          <ellipse cx="0" cy="-10" rx="35" ry="20" fill="#e8edc4"/>
          <!-- Vannflate -->
          <path d="M-20,15 Q-10,5 -5,15 Q5,25 15,18 Q25,10 20,25 Z" fill="#a8d4e8" stroke="#4a9bbf" stroke-width="0.4"/>
          <!-- Bbox-overlegg som viser valgt utsnitt -->
          <g :style="{ transform: `scale(${1 / Math.max(halfKm, 0.5)})`, transformOrigin: '0 0', transition: 'transform 200ms' }">
            <rect x="-50" y="-50" width="100" height="100" fill="none"
                  stroke="#a78bfa" stroke-width="2" stroke-dasharray="3 2"/>
            <line x1="-3" y1="0" x2="3" y2="0" stroke="#a78bfa" stroke-width="1.5"/>
            <line x1="0" y1="-3" x2="0" y2="3" stroke="#a78bfa" stroke-width="1.5"/>
          </g>
        </svg>

        <div class="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-zinc-900/85 text-[11px]
                    text-white/90 backdrop-blur border border-white/15 font-medium">
          {{ sizeKm }} × {{ sizeKm }} km
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

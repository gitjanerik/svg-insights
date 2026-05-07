<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { usePinchZoom } from '../composables/usePinchZoom.js'
import { useUserPosition } from '../composables/useUserPosition.js'
import { useCompass } from '../composables/useCompass.js'
import { useDraggableDrawer } from '../composables/useDraggableDrawer.js'

const router = useRouter()
const wrapperRef = ref(null)
const svgHostRef = ref(null)

const loading = ref(true)
const loadError = ref(null)
const meta = ref(null)

const LAYERS = [
  { key: 'skog',      label: 'Skog' },
  { key: 'eng',       label: 'Eng' },
  { key: 'aker',      label: 'Aker' },
  { key: 'myr',       label: 'Myr' },
  { key: 'vann',      label: 'Vann' },
  { key: 'bekk',      label: 'Bekk' },
  { key: 'bygning',   label: 'Bygninger' },
  { key: 'vei-stor',  label: 'Storveg' },
  { key: 'vei-liten', label: 'Småveg' },
  { key: 'sti',       label: 'Sti' },
  { key: 'navn',      label: 'Navn' },
]

const visibleLayers = ref(new Set(LAYERS.map(l => l.key)))
const isDark = ref(false)
const showControls = ref(false)

const drawer = useDraggableDrawer({ expandedHeight: 0.55, minimizedPeek: 32 })

function openDrawer() {
  showControls.value = true
  drawer.reset()
}
function closeDrawer() {
  showControls.value = false
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
    const g = root.querySelector(`[data-layer="${lay.key}"]`)
    if (g) g.style.display = visibleLayers.value.has(lay.key) ? '' : 'none'
  }
}

const { scale, translateX, translateY, reset } = usePinchZoom(wrapperRef)

const transformStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transformOrigin: '50% 50%',
}))

const userPos = useUserPosition(() => meta.value)
const compass = useCompass()

async function loadMap() {
  loading.value = true
  loadError.value = null
  try {
    const url = `${import.meta.env.BASE_URL}maps/vardasen.svg`
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
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
      source: m.source,
    }
    setupHostSvg(root)
    loading.value = false
    await nextTick()
    applyLayerVisibility()
    applyDarkMode()
    userPos.recompute()
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
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  for (const child of Array.from(sourceRoot.childNodes)) {
    svg.appendChild(child.cloneNode(true))
  }
  const userLayer = document.createElementNS(ns, 'g')
  userLayer.setAttribute('id', 'user-layer')
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

  const ring = document.createElementNS(ns, 'circle')
  ring.setAttribute('cx', x)
  ring.setAttribute('cy', y)
  ring.setAttribute('r', Math.max(8, acc))
  ring.setAttribute('fill', 'rgba(56, 189, 248, 0.18)')
  ring.setAttribute('stroke', 'rgba(56, 189, 248, 0.55)')
  ring.setAttribute('stroke-width', '1')
  ring.setAttribute('vector-effect', 'non-scaling-stroke')
  layer.appendChild(ring)

  if (Number.isFinite(heading)) {
    const cone = document.createElementNS(ns, 'path')
    const r = Math.max(20, acc * 1.5)
    const ang = (heading - 90) * Math.PI / 180
    const ang1 = ang - 0.35
    const ang2 = ang + 0.35
    const x1 = x + Math.cos(ang1) * r
    const y1 = y + Math.sin(ang1) * r
    const x2 = x + Math.cos(ang2) * r
    const y2 = y + Math.sin(ang2) * r
    cone.setAttribute('d', `M${x},${y} L${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} Z`)
    cone.setAttribute('fill', 'rgba(56, 189, 248, 0.35)')
    layer.appendChild(cone)
  }

  const dot = document.createElementNS(ns, 'circle')
  dot.setAttribute('cx', x)
  dot.setAttribute('cy', y)
  dot.setAttribute('r', '6')
  dot.setAttribute('fill', '#0ea5e9')
  dot.setAttribute('stroke', '#fff')
  dot.setAttribute('stroke-width', '2')
  dot.setAttribute('vector-effect', 'non-scaling-stroke')
  layer.appendChild(dot)
}

const equidistanceLabel = computed(() => {
  if (!meta.value) return ''
  const eq = meta.value.equidistance
  if (eq) return `Ekvidistanse ${eq} m`
  return 'Ekvidistanse: ikke tilgjengelig'
})

const wrapperSize = ref({ w: 0, h: 0 })
function measureWrapper() {
  const r = wrapperRef.value?.getBoundingClientRect()
  if (r) wrapperSize.value = { w: r.width, h: r.height }
}

// Maks-bredde slik at skala-baren ikke renner ut av høyre side
const SCALE_BAR_MAX_PX = 180

const scaleBar = computed(() => {
  if (!meta.value) return { px: 0, label: '' }
  const { w, h } = wrapperSize.value
  if (!w || !h) return { px: 0, label: '' }
  const fit = Math.min(w / meta.value.widthM, h / meta.value.heightM)
  const pxPerMeter = fit * scale.value
  // Velg distanse som passer innenfor maks-bredde
  const candidates = [1000, 500, 200, 100, 50, 20]
  for (const m of candidates) {
    const px = m * pxPerMeter
    if (px <= SCALE_BAR_MAX_PX && px >= 30) {
      return {
        px,
        label: m >= 1000 ? `${m / 1000} km` : `${m} m`,
      }
    }
  }
  return { px: 0, label: '' }
})

function applyDarkMode() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  if (isDark.value) {
    svg.style.setProperty('--bg', '#0e1116')
    svg.style.setProperty('--skog', '#1f3b1f')
    svg.style.setProperty('--eng', '#2c3a1c')
    svg.style.setProperty('--aker', '#3a2e1c')
    svg.style.setProperty('--myr', '#1c2e2a')
    svg.style.setProperty('--vann', '#1e3a5f')
    svg.style.setProperty('--vann-s', '#5aa9d8')
    svg.style.setProperty('--bygning', '#5a4a3c')
    svg.style.setProperty('--bygning-s', '#1a1410')
    svg.style.setProperty('--vei-stor', '#d97a5a')
    svg.style.setProperty('--vei-liten', '#a08568')
    svg.style.setProperty('--sti', '#d4a47a')
    svg.style.setProperty('--peak', '#d4a47a')
    svg.style.setProperty('--label', '#e8e8e8')
  } else {
    for (const v of [
      '--bg', '--skog', '--eng', '--aker', '--myr', '--vann', '--vann-s',
      '--bygning', '--bygning-s', '--vei-stor', '--vei-liten', '--sti', '--peak', '--label',
    ]) {
      svg.style.removeProperty(v)
    }
  }
}

watch(isDark, applyDarkMode)

onMounted(() => {
  measureWrapper()
  window.addEventListener('resize', measureWrapper)
  loadMap()
})
</script>

<template>
  <div class="relative w-full h-[100dvh] overflow-hidden"
       :class="isDark ? 'bg-zinc-900' : 'bg-stone-100'">

    <!-- Toppbar — låst mørk så ikoner alltid er lesbare uansett kart-tema -->
    <div class="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-3
                pointer-events-none">
      <button @click="router.push('/')"
              class="pointer-events-auto rounded-full w-10 h-10 flex items-center justify-center
                     backdrop-blur bg-zinc-900/85 border border-white/15 text-white shadow-lg
                     active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>

      <div class="pointer-events-none px-3 py-1.5 rounded-full backdrop-blur bg-zinc-900/85
                  border border-white/15 text-[12px] text-white font-medium shadow-lg">
        Vardåsen · turkart
      </div>

      <button @click="openDrawer"
              class="pointer-events-auto rounded-full w-10 h-10 flex items-center justify-center
                     backdrop-blur bg-zinc-900/85 border border-white/15 text-white shadow-lg
                     active:scale-95 transition">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="6" x2="20" y2="6"/>
          <line x1="4" y1="12" x2="20" y2="12"/>
          <line x1="4" y1="18" x2="20" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Kompass-rose -->
    <div class="absolute top-20 right-3 z-20 pointer-events-auto select-none">
      <button @click="compass.isActive ? compass.stop() : compass.start()"
              class="w-14 h-14 rounded-full backdrop-blur bg-zinc-900/85 border border-white/15
                     flex items-center justify-center text-white shadow-lg active:scale-95 transition">
        <svg viewBox="-50 -50 100 100" class="w-12 h-12"
             :style="{ transform: compass.isActive && compass.headingDeg !== null
                                  ? `rotate(${-compass.headingDeg}deg)`
                                  : 'none',
                       transition: 'transform 0.2s linear' }">
          <circle r="44" fill="none" stroke="currentColor" stroke-width="1" opacity="0.4"/>
          <polygon points="0,-38 6,0 0,8 -6,0" fill="#ef4444"/>
          <polygon points="0,38 6,0 0,-8 -6,0" fill="currentColor" opacity="0.7"/>
          <text y="-28" text-anchor="middle" font-size="14" font-weight="700"
                fill="currentColor">N</text>
        </svg>
      </button>
      <div v-if="compass.error"
           class="text-[10px] text-red-300 mt-1 max-w-[80px] text-right leading-tight
                  px-1.5 py-0.5 rounded bg-zinc-900/85 backdrop-blur">
        {{ compass.error }}
      </div>
    </div>

    <!-- Kart-flate -->
    <div ref="wrapperRef" class="absolute inset-0 touch-none select-none">
      <div class="w-full h-full" :style="transformStyle">
        <div ref="svgHostRef" class="w-full h-full"></div>
      </div>
    </div>

    <!-- Lasting / feil -->
    <div v-if="loading"
         class="absolute inset-0 flex flex-col items-center justify-center text-white/60 z-10">
      <div class="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin mb-3"/>
      <div class="text-sm">Laster Vardåsen-kart …</div>
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

    <!-- Posisjons-status — alltid mørk bakgrunn for begge moduser -->
    <div v-if="!loading && userPos.error"
         class="absolute bottom-32 left-3 right-3 z-20 px-3 py-2 rounded-lg backdrop-blur
                bg-amber-600/95 border border-amber-300/40 text-white text-[12px] shadow-lg">
      {{ userPos.error }}
    </div>
    <div v-else-if="!loading && userPos.isOutsideMap"
         class="absolute bottom-32 left-3 right-3 z-20 px-3 py-2 rounded-lg backdrop-blur
                bg-amber-600/95 border border-amber-300/40 text-white text-[12px] shadow-lg">
      Du er utenfor dette kartet.
    </div>

    <!-- Skala + ekvidistanse -->
    <div v-if="!loading"
         class="absolute bottom-3 left-3 z-20 pointer-events-none">
      <div class="px-3 py-2 rounded-lg backdrop-blur bg-zinc-900/85 border border-white/15
                  text-white text-[11px] font-medium space-y-1.5 shadow-lg">
        <div class="flex items-end gap-2" v-if="scaleBar.px > 0">
          <div class="relative">
            <div class="h-1.5 bg-white" :style="{ width: `${scaleBar.px}px` }"></div>
            <div class="absolute inset-0 flex justify-between">
              <div class="w-0.5 h-3 bg-white -translate-y-1"/>
              <div class="w-0.5 h-3 bg-white -translate-y-1"/>
            </div>
          </div>
          <div>{{ scaleBar.label }}</div>
        </div>
        <div class="text-white/70">{{ equidistanceLabel }}</div>
      </div>
    </div>

    <!-- Attribusjon -->
    <div v-if="!loading"
         class="absolute bottom-3 right-3 z-20 px-2 py-1 rounded-md backdrop-blur bg-zinc-900/85
                border border-white/15 text-white/75 text-[9px] leading-tight pointer-events-none shadow-lg">
      © OpenStreetMap-bidragsytere
    </div>

    <!-- Kontrollpanel (drawer) — swipe opp/ned for å skjule/vise -->
    <Transition name="drawer">
      <div v-if="showControls"
           class="absolute inset-x-0 bottom-0 z-30 backdrop-blur-md bg-zinc-900/92
                  border-t border-white/15 rounded-t-2xl flex flex-col shadow-2xl"
           :style="drawer.drawerHeightStyle.value">
        <!-- Sticky drag-handle og header -->
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
                            ? 'bg-violet-500/20 border-violet-400/50 text-white'
                            : 'bg-white/5 border-white/10 text-white/45'">
              <span class="text-[12px]">{{ lay.label }}</span>
            </button>
          </div>

          <div class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Visning</div>
          <div class="flex gap-2 mb-4">
            <button @click="isDark = !isDark"
                    class="flex-1 px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98]"
                    :class="isDark
                            ? 'bg-violet-500/20 border-violet-400/50 text-white'
                            : 'bg-white/5 border-white/10 text-white/75'">
              {{ isDark ? 'Mørk modus på' : 'Mørk modus av' }}
            </button>
            <button @click="reset()"
                    class="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/75
                           text-[12px] active:scale-[0.98]">
              Sentrer
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

          <div class="text-white/45 text-[10px] leading-relaxed mt-4">
            Kartdata © OpenStreetMap-bidragsytere (ODbL). 4 × 4 km utsnitt rundt Vardåsen i Asker.
            Reprojisert til UTM 32N (EPSG:25832-kompatibel) med 1 SVG-enhet = 1 m.
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.drawer-enter-active, .drawer-leave-active { transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.drawer-enter-from, .drawer-leave-to       { transform: translateY(100%); }
</style>

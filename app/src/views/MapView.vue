<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { usePinchZoom } from '../composables/usePinchZoom.js'
import { useUserPosition } from '../composables/useUserPosition.js'
import { useCompass } from '../composables/useCompass.js'
import { useDraggableDrawer } from '../composables/useDraggableDrawer.js'
import { useMapAnnotations, ANNOTATION_SYMBOLS } from '../composables/useMapAnnotations.js'
import { loadMap as loadStoredMap } from '../lib/mapStorage.js'
import { isomCatalog } from '../lib/symbolizer.js'
import { printDocument, exportSvgFile, exportPngFile } from '../lib/printExport.js'

const router = useRouter()
const route = useRoute()
const wrapperRef = ref(null)
const svgHostRef = ref(null)

const loading = ref(true)
const loadError = ref(null)
const meta = ref(null)
const mapTitle = ref('Turkart')

const BUILTIN = {
  vardasen: { navn: 'Vardåsen · turkart', file: 'vardasen.svg' },
}

// Lag-kategorier som matcher mapBuilder.js sin categoryFor()
const LAYERS = [
  { key: 'skog',       label: 'Skog' },
  { key: 'aapen',      label: 'Åpen mark' },
  { key: 'aker',       label: 'Åker' },
  { key: 'myr',        label: 'Myr' },
  { key: 'vann',       label: 'Vann' },
  { key: 'bekk',       label: 'Bekk' },
  { key: 'kontur',     label: 'Høydekurver' },
  { key: 'bygning',    label: 'Bygninger' },
  { key: 'vei-stor',   label: 'Storveg' },
  { key: 'vei-liten',  label: 'Småveg' },
  { key: 'sti',        label: 'Sti' },
  { key: 'stein',      label: 'Stein' },
  { key: 'stupkant',   label: 'Stupkant' },
  { key: 'linje',      label: 'Gjerde / kraft' },
  { key: 'navn',       label: 'Navn' },
]

const visibleLayers = ref(new Set(LAYERS.map(l => l.key)))
const isDark = ref(false)
const showControls = ref(false)

const drawer = useDraggableDrawer({ expandedHeight: 0.55, minimizedPeek: 32 })

function openDrawer() { showControls.value = true; drawer.reset() }
function closeDrawer() { showControls.value = false }

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
}

const { scale, translateX, translateY, reset } = usePinchZoom(wrapperRef)

const transformStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transformOrigin: '50% 50%',
}))

const userPos = useUserPosition(() => meta.value)
const compass = useCompass()

// Annoteringsmodus — point-symboler over auto-generert kart
const mapId = computed(() => route.params.id ?? 'vardasen')
const annot = useMapAnnotations(mapId.value)
const showSymbolPalette = ref(false)
let lastSvgString = ''      // huskes til print-eksport

watch(() => annot.annotations.value, () => renderAnnotations(), { deep: true })

// Klikk på kart i annoteringsmodus → plasser symbol
function onMapClick(e) {
  if (!annot.isAnnotateMode.value || !annot.selectedSymbol.value) return
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return
  const local = pt.matrixTransform(ctm.inverse())
  const sym = ANNOTATION_SYMBOLS.find(s => s.symbolKey === annot.selectedSymbol.value)
  if (!sym) return
  annot.addPoint(sym.code, local.x, local.y)
  annot.persist()
}

function renderAnnotations() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  let layer = svg.querySelector('#annotation-layer')
  if (!layer) {
    const ns = 'http://www.w3.org/2000/svg'
    layer = document.createElementNS(ns, 'g')
    layer.setAttribute('id', 'annotation-layer')
    layer.setAttribute('data-layer', 'annotering')
    svg.appendChild(layer)
  }
  layer.replaceChildren()
  for (const a of annot.annotations.value) {
    if (a.type !== 'point') continue
    const ns = 'http://www.w3.org/2000/svg'
    const sym = ANNOTATION_SYMBOLS.find(s => s.code === a.isomCode)
    if (!sym) continue
    const use = document.createElementNS(ns, 'use')
    use.setAttribute('href', `#iso-sym-${sym.symbolKey}`)
    use.setAttribute('x', `${a.x - 0.6}mm`)
    use.setAttribute('y', `${a.y - 0.6}mm`)
    use.setAttribute('width', '1.4mm')
    use.setAttribute('height', '1.4mm')
    use.setAttribute('data-annot-id', a.id)
    layer.appendChild(use)
  }
}

function selectSymbol(key) {
  annot.selectedSymbol.value = annot.selectedSymbol.value === key ? null : key
  annot.isAnnotateMode.value = annot.selectedSymbol.value !== null
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
    }
    setupHostSvg(root)
    loading.value = false
    await nextTick()
    applyLayerVisibility()
    applyDarkMode()
    userPos.recompute()
    await annot.load()
    renderAnnotations()
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
  if (eq) return `Høydekurver pr ${eq} m`
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

// Dark mode: bruk ISOM-katalog sin darkMode-overstyring til å sette
// CSS-variabler pr ISOM-kode på SVG-roten.
function applyDarkMode() {
  const svg = svgHostRef.value?.querySelector('svg')
  if (!svg) return
  if (isDark.value) {
    svg.style.setProperty('--bg', isomCatalog.darkMode.background)
    for (const [code, def] of Object.entries(isomCatalog.darkMode.categories ?? {})) {
      if (def.fill?.color) svg.style.setProperty(`--iso-${code}-fill`, def.fill.color)
      if (def.stroke?.color) svg.style.setProperty(`--iso-${code}-stroke`, def.stroke.color)
    }
  } else {
    svg.style.removeProperty('--bg')
    for (const code of Object.keys(isomCatalog.darkMode.categories ?? {})) {
      svg.style.removeProperty(`--iso-${code}-fill`)
      svg.style.removeProperty(`--iso-${code}-stroke`)
    }
  }
}

watch(isDark, applyDarkMode)

// Magnetisk nord-pil: konstant skjerm-størrelse i øvre høyre.
// Deklinasjon hentes fra ISOM-katalog (statisk for nå; senere fra IGRF).
const magneticDeclination = computed(() => isomCatalog.magneticNorth.defaultDeclinationDeg)

onMounted(() => {
  measureWrapper()
  window.addEventListener('resize', measureWrapper)
  loadMap()
})
</script>

<template>
  <div class="relative w-full h-[100dvh] overflow-hidden"
       :class="isDark ? 'bg-zinc-900' : 'bg-stone-100'">

    <!-- Toppbar -->
    <div class="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-3
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

    <!-- Kompass-rose -->
    <div class="absolute top-20 right-3 z-20 pointer-events-auto select-none">
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

    <!-- Magnetisk nord-pil (kart-element, fast skjerm-posisjon) -->
    <div class="absolute top-[9rem] right-3 z-20 pointer-events-none select-none">
      <div class="bg-zinc-950 rounded-md px-2 py-1.5 shadow-lg">
        <svg viewBox="-12 -22 24 30" class="w-8 h-10" :style="{ transform: `rotate(${magneticDeclination}deg)` }">
          <!-- Linje opp -->
          <line x1="0" y1="6" x2="0" y2="-18" stroke="white" stroke-width="1.4" stroke-linecap="round"/>
          <!-- Pil-spiss -->
          <polygon points="0,-20 -3,-15 3,-15" fill="white"/>
          <!-- MN-tekst -->
          <text y="6" text-anchor="middle" font-size="5" font-weight="700" fill="white">MN</text>
        </svg>
        <div class="text-[8px] text-white/60 text-center -mt-1 tabular-nums">
          {{ magneticDeclination > 0 ? '+' : '' }}{{ magneticDeclination.toFixed(1) }}°
        </div>
      </div>
    </div>

    <!-- Kart-flate -->
    <div ref="wrapperRef" class="absolute inset-0 touch-none select-none"
         :class="annot.isAnnotateMode.value ? 'cursor-crosshair' : ''">
      <div class="w-full h-full" :style="transformStyle">
        <div ref="svgHostRef" class="w-full h-full" @click="onMapClick"></div>
      </div>
    </div>

    <!-- Annoteringsmodus indikator -->
    <div v-if="annot.isAnnotateMode.value && annot.selectedSymbol.value"
         class="absolute top-[16rem] right-3 z-20 px-2.5 py-1.5 rounded-md bg-violet-600
                text-white text-[11px] font-medium shadow-lg pointer-events-none">
      Trykk på kartet for å plassere
      <div class="text-[9px] text-white/80 mt-0.5">
        {{ ANNOTATION_SYMBOLS.find(s => s.symbolKey === annot.selectedSymbol.value)?.label }}
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
                bg-amber-600/95 border border-amber-300/40 text-white text-[12px] shadow-lg">
      {{ userPos.error }}
    </div>
    <div v-else-if="!loading && userPos.isOutsideMap"
         class="absolute bottom-32 left-3 right-3 z-20 px-3 py-2 rounded-lg backdrop-blur
                bg-amber-600/95 border border-amber-300/40 text-white text-[12px] shadow-lg">
      Du er utenfor dette kartet.
    </div>

    <!-- Skala + ekvidistanse + ISOM-info -->
    <div v-if="!loading"
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

    <!-- Attribusjon -->
    <div v-if="!loading"
         class="absolute bottom-3 right-3 z-20 px-2 py-1 rounded-md bg-zinc-950
                text-white/85 text-[9px] leading-tight pointer-events-none shadow-lg max-w-[160px]">
      © OpenStreetMap-bidragsytere<br>
      <span class="text-white/50">{{ meta?.isomVersion ? `ISOM ${meta.isomVersion}` : '' }}</span>
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

          <div v-if="!mapId.startsWith('vardasen')"
               class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Annotering</div>
          <div v-if="!mapId.startsWith('vardasen')" class="space-y-2 mb-4">
            <div class="grid grid-cols-2 gap-2">
              <button v-for="s in ANNOTATION_SYMBOLS" :key="s.code"
                      @click="selectSymbol(s.symbolKey)"
                      class="px-3 py-2 rounded-lg border text-[12px] active:scale-[0.98] transition flex items-center gap-2"
                      :class="annot.selectedSymbol.value === s.symbolKey
                              ? 'bg-violet-500/30 border-violet-300/60 text-white'
                              : 'bg-white/5 border-white/10 text-white/70'">
                <svg viewBox="-1 -1 2 2" class="w-4 h-4">
                  <use :href="`#iso-sym-${s.symbolKey}`"/>
                </svg>
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

          <div class="text-white/55 text-[11px] uppercase tracking-wide mb-2">Eksport og print</div>
          <div class="grid grid-cols-3 gap-2 mb-4">
            <button @click="onExportSvg"
                    class="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/75
                           text-[11px] active:scale-[0.98]">
              .svg
            </button>
            <button @click="onExportPng"
                    class="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/75
                           text-[11px] active:scale-[0.98]">
              .png 300 dpi
            </button>
            <button @click="onPrint"
                    class="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/75
                           text-[11px] active:scale-[0.98]">
              Print / PDF
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

          <div class="text-white/40 text-[10px] leading-relaxed mt-4">
            ISOM 2017-2 inspirert symbolisering med mm-baserte streker for print-kvalitet.
            Kartdata © OpenStreetMap-bidragsytere (ODbL). Reprojisert til UTM 32N
            (EPSG:25832-kompatibel) med 1 SVG-enhet = 1 m. Magnetisk deklinasjon
            {{ magneticDeclination > 0 ? '+' : '' }}{{ magneticDeclination.toFixed(1) }}°.
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

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDeviceMotion } from '../composables/useDeviceMotion.js'
import { usePinchZoom } from '../composables/usePinchZoom.js'
import { filterPresets, svgFilterDefs, dashPatterns } from '../lib/filterPresets.js'
import {
  straightenPaths, wobblePaths, adjustStrokeWidths,
  setDashPattern, setLinecap, setGroupOpacities,
  injectFilterDefs, applyGroupFilter,
} from '../lib/pathFilters.js'
import { autoColorize, removeColorization } from '../lib/colorization.js'

const router = useRouter()

// --- Core SVG state ---
const originalSvg = ref('')
const svgHtml = ref('')
const svgWidth = ref(600)
const svgHeight = ref(400)

const containerRef = ref(null)
const { tiltX, tiltY, supported: gyroSupported, recalibrate } = useDeviceMotion()
const { scale, translateX, translateY, reset: resetZoom } = usePinchZoom(containerRef)

// --- Panel state ---
const activePanel = ref(null) // null, 'filters', 'color'

// --- Filter state ---
const strokeScale = ref('medium')
const strokeColor = ref('#c4b5fd')
const bgColor = ref('#0a0a0f')
const bgGlow = ref(true)
const perspective = ref(true)
const currentPreset = ref(null)
const dashPattern = ref('solid')
const linecapStyle = ref('round')
const isSmooth = ref(true)
const wobbleIntensity = ref(0)
const svgFilter = ref(null)

const opacities = reactive({ edges: 100, contours: 50, hatching: 35 })

const colorPresets = [
  { name: 'Fiolett', value: '#c4b5fd' },
  { name: 'Cyan', value: '#67e8f9' },
  { name: 'Gronn', value: '#86efac' },
  { name: 'Rosa', value: '#f9a8d4' },
  { name: 'Hvit', value: '#ffffff' },
  { name: 'Gull', value: '#fbbf24' },
]

const strokeScales = { thin: 0.5, medium: 1.0, bold: 2.0 }

// --- Colorization state ---
const colorized = ref(false)
const colorizing = ref(false)

// --- Parallax ---
const PARALLAX_PX = 25
const PERSPECTIVE_DEG = 8

const transformStyle = computed(() => {
  const tx = translateX.value + (perspective.value ? tiltX.value * PARALLAX_PX : 0)
  const ty = translateY.value + (perspective.value ? tiltY.value * PARALLAX_PX : 0)
  const rx = perspective.value ? -tiltY.value * PERSPECTIVE_DEG : 0
  const ry = perspective.value ? tiltX.value * PERSPECTIVE_DEG : 0
  return {
    transform: `perspective(800px) scale(${scale.value}) translate(${tx}px, ${ty}px) rotateX(${rx}deg) rotateY(${ry}deg)`,
    transition: 'transform 0.1s ease-out',
  }
})

// --- Apply all filters to SVG ---
function rebuildSvg() {
  let svg = originalSvg.value
  if (!svg) return

  // Remove old colorization if present and not wanted
  if (!colorized.value) {
    svg = removeColorization(svg)
  }

  // Stroke scale
  const scaleVal = strokeScales[strokeScale.value] || 1.0
  svg = adjustStrokeWidths(svg, scaleVal)

  // Linecap/linejoin
  const lj = linecapStyle.value === 'butt' ? 'miter' : 'round'
  svg = setLinecap(svg, linecapStyle.value, lj)

  // Dash pattern
  const dp = dashPatterns[dashPattern.value] || ''
  svg = setDashPattern(svg, dp)

  // Group opacities
  svg = setGroupOpacities(svg, opacities)

  // Straighten (remove Bezier)
  if (!isSmooth.value) {
    svg = straightenPaths(svg)
  }

  // Wobble
  if (wobbleIntensity.value > 0) {
    svg = wobblePaths(svg, wobbleIntensity.value)
  }

  // SVG filters
  if (svgFilter.value) {
    svg = injectFilterDefs(svg, svgFilterDefs)
    svg = applyGroupFilter(svg, svgFilter.value)
  } else {
    svg = applyGroupFilter(svg, null)
  }

  // Stroke color
  svg = svg.replace(/stroke="currentColor"/g, `stroke="${strokeColor.value}"`)

  svgHtml.value = svg
}

// Watch filter state and rebuild
watch(
  [strokeScale, strokeColor, dashPattern, linecapStyle, isSmooth, wobbleIntensity, svgFilter, opacities, colorized],
  rebuildSvg,
  { deep: true }
)

// --- Preset application ---
function applyPreset(name) {
  const p = filterPresets[name]
  if (!p) return
  currentPreset.value = name
  strokeScale.value = p.strokeScale <= 0.7 ? 'thin' : p.strokeScale >= 1.5 ? 'bold' : 'medium'
  strokeColor.value = p.strokeColor
  bgColor.value = p.bgColor
  opacities.edges = p.opacity.edges
  opacities.contours = p.opacity.contours
  opacities.hatching = p.opacity.hatching
  linecapStyle.value = p.linecap || 'round'
  dashPattern.value = Object.keys(dashPatterns).find(k => dashPatterns[k] === p.dashPattern) || 'solid'
  wobbleIntensity.value = p.wobble || 0
  svgFilter.value = p.svgFilter || null
  bgGlow.value = bgColor.value === '#0a0a0f'
}

// --- Auto-colorize ---
async function toggleColorize() {
  if (colorized.value) {
    colorized.value = false
    return
  }

  const rgba = window.__svgInsights_rgba
  if (!rgba) return

  colorizing.value = true
  await new Promise(r => setTimeout(r, 50)) // let UI update

  try {
    const result = autoColorize(originalSvg.value, rgba, svgWidth.value, svgHeight.value)
    originalSvg.value = result.svg
    colorized.value = true
  } finally {
    colorizing.value = false
  }
}

// --- Actions ---
function handleReset() {
  resetZoom()
  recalibrate()
}

function downloadSvg() {
  const blob = new Blob([svgHtml.value], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sketch.svg'
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  const svg = sessionStorage.getItem('svgInsights_svg')
  const w = sessionStorage.getItem('svgInsights_w')
  const h = sessionStorage.getItem('svgInsights_h')
  if (!svg) { router.replace('/capture'); return }

  originalSvg.value = svg
  svgWidth.value = parseInt(w) || 600
  svgHeight.value = parseInt(h) || 400

  requestAnimationFrame(rebuildSvg)
})
</script>

<template>
  <div class="flex flex-col min-h-[100dvh] overflow-hidden select-none" :style="{ background: bgColor }">

    <!-- Header -->
    <header class="relative z-20 flex items-center justify-between px-4 py-3 bg-black/60 backdrop-blur-xl border-b border-white/5">
      <button @click="router.push('/capture')" class="text-white/60 active:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <h1 class="text-sm font-medium text-white/80">Utforsk</h1>
      <div class="flex gap-2">
        <!-- Filter button -->
        <button
          @click="activePanel = activePanel === 'filters' ? null : 'filters'"
          class="text-white/60 active:text-white transition-colors"
          :class="{ 'text-violet-400': activePanel === 'filters' }"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <!-- Color button -->
        <button
          @click="activePanel = activePanel === 'color' ? null : 'color'"
          class="text-white/60 active:text-white transition-colors"
          :class="{ 'text-sky-400': activePanel === 'color' }"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-3.5-4-1.5 1.5-3.5 4-3 3.5-3 5.5a7 7 0 0 0 7 7z"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- SVG canvas area -->
    <div ref="containerRef" class="flex-1 flex items-center justify-center relative overflow-hidden">
      <div
        v-if="bgGlow"
        class="absolute inset-0 -z-10"
        :style="{ background: `radial-gradient(ellipse at ${50 + tiltX * 20}% ${50 + tiltY * 20}%, ${strokeColor}15 0%, transparent 70%)` }"
      />
      <div
        class="w-full h-full flex items-center justify-center p-6"
        :style="transformStyle"
        v-html="svgHtml"
      />
    </div>

    <!-- Floating action buttons -->
    <div class="absolute bottom-[max(5rem,calc(4rem+env(safe-area-inset-bottom)))] right-4 flex flex-col gap-2 z-20">
      <button @click="handleReset"
        class="w-11 h-11 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/60 active:text-white active:bg-white/10 transition-colors" title="Tilbakestill">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
      </button>
      <button @click="downloadSvg"
        class="w-11 h-11 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/60 active:text-white active:bg-white/10 transition-colors" title="Last ned SVG">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
    </div>

    <!-- ═══ Filters Panel ═══ -->
    <Transition name="panel">
      <div v-if="activePanel === 'filters'"
        class="absolute bottom-0 left-0 right-0 z-30 bg-[#111118]/95 backdrop-blur-2xl border-t border-white/5 rounded-t-2xl px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[60vh] overflow-y-auto">
        <div class="w-8 h-1 bg-white/20 rounded-full mx-auto mb-5" />

        <!-- Presets -->
        <div class="mb-5">
          <label class="text-[11px] text-white/40 uppercase tracking-wider mb-2 block">Presets</label>
          <div class="grid grid-cols-3 gap-2">
            <button v-for="(p, name) in filterPresets" :key="name" @click="applyPreset(name)"
              class="px-2 py-2 text-xs rounded-lg border transition-all active:scale-95"
              :class="currentPreset === name ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
              {{ p.label }}
            </button>
          </div>
        </div>

        <!-- Stroke color -->
        <div class="mb-4">
          <label class="text-[11px] text-white/40 uppercase tracking-wider mb-2 block">Strekfarge</label>
          <div class="flex gap-2">
            <button v-for="preset in colorPresets" :key="preset.value" @click="strokeColor = preset.value; currentPreset = null"
              class="w-8 h-8 rounded-full border-2 transition-all active:scale-90"
              :class="strokeColor === preset.value ? 'border-white scale-110' : 'border-white/10'"
              :style="{ background: preset.value }" :title="preset.name" />
          </div>
        </div>

        <!-- Stroke width -->
        <div class="mb-4">
          <label class="text-[11px] text-white/40 uppercase tracking-wider mb-2 block">Strekbredde</label>
          <div class="flex gap-2">
            <button v-for="s in ['thin', 'medium', 'bold']" :key="s" @click="strokeScale = s; currentPreset = null"
              class="flex-1 px-2 py-1.5 text-xs rounded-lg border transition-all"
              :class="strokeScale === s ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
              {{ s === 'thin' ? 'Tynn' : s === 'medium' ? 'Medium' : 'Bred' }}
            </button>
          </div>
        </div>

        <!-- Dash pattern -->
        <div class="mb-4">
          <label class="text-[11px] text-white/40 uppercase tracking-wider mb-2 block">Strek-stil</label>
          <div class="flex gap-2">
            <button v-for="(_, name) in dashPatterns" :key="name" @click="dashPattern = name; currentPreset = null"
              class="flex-1 px-2 py-1.5 text-xs rounded-lg border transition-all capitalize"
              :class="dashPattern === name ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
              {{ name === 'solid' ? 'Heltrukket' : name === 'dashed' ? 'Stiplet' : name === 'dotted' ? 'Prikket' : 'Skisse' }}
            </button>
          </div>
        </div>

        <!-- Linecap -->
        <div class="mb-4">
          <label class="text-[11px] text-white/40 uppercase tracking-wider mb-2 block">Strek-ende</label>
          <div class="flex gap-2">
            <button v-for="lc in ['round', 'butt', 'square']" :key="lc" @click="linecapStyle = lc; currentPreset = null"
              class="flex-1 px-2 py-1.5 text-xs rounded-lg border transition-all capitalize"
              :class="linecapStyle === lc ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
              {{ lc === 'round' ? 'Rund' : lc === 'butt' ? 'Flat' : 'Firkant' }}
            </button>
          </div>
        </div>

        <!-- Opacity sliders -->
        <div class="mb-4">
          <label class="text-[11px] text-white/40 uppercase tracking-wider mb-2 block">Lag-synlighet</label>
          <div class="space-y-2 text-[12px] text-white/60">
            <label class="flex items-center gap-2">
              <span class="w-16">Kanter</span>
              <input v-model.number="opacities.edges" type="range" min="0" max="100" step="5"
                class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
              <span class="w-8 text-right text-white/40">{{ opacities.edges }}%</span>
            </label>
            <label class="flex items-center gap-2">
              <span class="w-16">Konturer</span>
              <input v-model.number="opacities.contours" type="range" min="0" max="100" step="5"
                class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
              <span class="w-8 text-right text-white/40">{{ opacities.contours }}%</span>
            </label>
            <label class="flex items-center gap-2">
              <span class="w-16">Skravering</span>
              <input v-model.number="opacities.hatching" type="range" min="0" max="100" step="5"
                class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
              <span class="w-8 text-right text-white/40">{{ opacities.hatching }}%</span>
            </label>
          </div>
        </div>

        <!-- Toggles -->
        <div class="flex flex-col gap-3 mb-4">
          <label class="flex items-center justify-between">
            <span class="text-sm text-white/70">Glatte kurver</span>
            <button @click="isSmooth = !isSmooth; currentPreset = null"
              class="w-11 h-6 rounded-full transition-colors" :class="isSmooth ? 'bg-violet-600' : 'bg-white/10'">
              <div class="w-5 h-5 bg-white rounded-full transition-transform shadow-md"
                :class="isSmooth ? 'translate-x-5.5' : 'translate-x-0.5'" />
            </button>
          </label>
          <label class="flex items-center justify-between">
            <span class="text-sm text-white/70">Perspektiv</span>
            <button @click="perspective = !perspective"
              class="w-11 h-6 rounded-full transition-colors" :class="perspective ? 'bg-violet-600' : 'bg-white/10'">
              <div class="w-5 h-5 bg-white rounded-full transition-transform shadow-md"
                :class="perspective ? 'translate-x-5.5' : 'translate-x-0.5'" />
            </button>
          </label>
          <label class="flex items-center justify-between">
            <span class="text-sm text-white/70">Bakgrunnsglod</span>
            <button @click="bgGlow = !bgGlow"
              class="w-11 h-6 rounded-full transition-colors" :class="bgGlow ? 'bg-violet-600' : 'bg-white/10'">
              <div class="w-5 h-5 bg-white rounded-full transition-transform shadow-md"
                :class="bgGlow ? 'translate-x-5.5' : 'translate-x-0.5'" />
            </button>
          </label>
        </div>

        <!-- Wobble slider -->
        <div class="mb-4">
          <label class="text-[11px] text-white/40 uppercase tracking-wider mb-2 block">Haandtegnet-effekt</label>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-white/40">Ingen</span>
            <input v-model.number="wobbleIntensity" type="range" min="0" max="3" step="0.5"
              class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none"
              @input="currentPreset = null" />
            <span class="text-[11px] text-white/40">Maks</span>
          </div>
        </div>

        <!-- SVG filter effects -->
        <div class="mb-4">
          <label class="text-[11px] text-white/40 uppercase tracking-wider mb-2 block">Filter-effekt</label>
          <div class="flex gap-2 flex-wrap">
            <button @click="svgFilter = null; currentPreset = null"
              class="px-3 py-1.5 text-xs rounded-lg border transition-all"
              :class="!svgFilter ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
              Ingen
            </button>
            <button v-for="f in ['blur', 'glow', 'shadow', 'charcoal', 'emboss']" :key="f"
              @click="svgFilter = f; currentPreset = null"
              class="px-3 py-1.5 text-xs rounded-lg border transition-all capitalize"
              :class="svgFilter === f ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
              {{ f === 'blur' ? 'Uskarp' : f === 'glow' ? 'Glod' : f === 'shadow' ? 'Skygge' : f === 'charcoal' ? 'Kull' : 'Preging' }}
            </button>
          </div>
        </div>

        <p class="text-center text-[11px] text-white/25 mt-2">
          Zoom: {{ (scale * 100).toFixed(0) }}%
          <template v-if="gyroSupported"> &middot; Gyro aktiv</template>
        </p>
      </div>
    </Transition>

    <!-- ═══ Colorization Panel ═══ -->
    <Transition name="panel">
      <div v-if="activePanel === 'color'"
        class="absolute bottom-0 left-0 right-0 z-30 bg-[#111118]/95 backdrop-blur-2xl border-t border-white/5 rounded-t-2xl px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div class="w-8 h-1 bg-white/20 rounded-full mx-auto mb-5" />

        <div class="mb-4">
          <label class="text-[11px] text-white/40 uppercase tracking-wider mb-3 block">Fargelegging</label>
          <p class="text-xs text-white/50 mb-4">
            Fyll regioner automatisk med farger fra originalbildet. Bevarer dybde via luminans-modulering.
          </p>
          <button
            @click="toggleColorize"
            :disabled="colorizing"
            class="w-full py-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
            :class="colorized
              ? 'bg-white/10 border border-white/20 text-white/70'
              : 'bg-gradient-to-r from-sky-600 to-violet-600 text-white shadow-[0_0_30px_rgba(56,189,248,0.2)]'"
          >
            <span v-if="colorizing">Fargelegger...</span>
            <span v-else-if="colorized">Fjern farger</span>
            <span v-else>Auto-fargelegg</span>
          </button>
          <p v-if="!window.__svgInsights_rgba && !colorized" class="text-[11px] text-amber-400/60 mt-2 text-center">
            Ta et nytt bilde for aa aktivere fargelegging
          </p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.panel-enter-active,
.panel-leave-active {
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.panel-enter-from,
.panel-leave-to {
  transform: translateY(100%);
}
</style>

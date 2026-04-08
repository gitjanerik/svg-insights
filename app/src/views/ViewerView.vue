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

const originalSvg = ref('')
const svgHtml = ref('')
const svgWidth = ref(600)
const svgHeight = ref(400)

const containerRef = ref(null)
const { tiltX, tiltY, supported: gyroSupported, recalibrate } = useDeviceMotion()
const { scale, translateX, translateY, reset: resetZoom } = usePinchZoom(containerRef)

// Panel: which tab is open in the sidebar
const activeTab = ref('presets') // presets, stroke, layers, effects, color

// Filter state
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
const showPanel = ref(false)

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

const colorized = ref(false)
const colorizing = ref(false)

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

function rebuildSvg() {
  let svg = originalSvg.value
  if (!svg) return
  if (!colorized.value) svg = removeColorization(svg)
  const scaleVal = strokeScales[strokeScale.value] || 1.0
  svg = adjustStrokeWidths(svg, scaleVal)
  const lj = linecapStyle.value === 'butt' ? 'miter' : 'round'
  svg = setLinecap(svg, linecapStyle.value, lj)
  const dp = dashPatterns[dashPattern.value] || ''
  svg = setDashPattern(svg, dp)
  svg = setGroupOpacities(svg, opacities)
  if (!isSmooth.value) svg = straightenPaths(svg)
  if (wobbleIntensity.value > 0) svg = wobblePaths(svg, wobbleIntensity.value)
  if (svgFilter.value) {
    svg = injectFilterDefs(svg, svgFilterDefs)
    svg = applyGroupFilter(svg, svgFilter.value)
  } else {
    svg = applyGroupFilter(svg, null)
  }
  svg = svg.replace(/stroke="currentColor"/g, `stroke="${strokeColor.value}"`)
  svgHtml.value = svg
}

watch(
  [strokeScale, strokeColor, dashPattern, linecapStyle, isSmooth, wobbleIntensity, svgFilter, opacities, colorized],
  rebuildSvg,
  { deep: true }
)

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

async function toggleColorize() {
  if (colorized.value) { colorized.value = false; return }
  const rgba = window.__svgInsights_rgba
  if (!rgba) return
  colorizing.value = true
  await new Promise(r => setTimeout(r, 50))
  try {
    const result = autoColorize(originalSvg.value, rgba, svgWidth.value, svgHeight.value)
    originalSvg.value = result.svg
    colorized.value = true
  } finally { colorizing.value = false }
}

function handleReset() { resetZoom(); recalibrate() }

function downloadSvg() {
  const blob = new Blob([svgHtml.value], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sketch.svg'
  a.click()
  URL.revokeObjectURL(url)
}

const tabs = [
  { id: 'presets', icon: 'grid', label: 'Presets' },
  { id: 'stroke', icon: 'pen', label: 'Strek' },
  { id: 'layers', icon: 'layers', label: 'Lag' },
  { id: 'effects', icon: 'sparkle', label: 'Effekter' },
  { id: 'color', icon: 'palette', label: 'Farge' },
]

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
  <div class="flex flex-col h-[100dvh] overflow-hidden select-none" :style="{ background: bgColor }">

    <!-- Header -->
    <header class="shrink-0 z-20 flex items-center justify-between px-4 py-2 bg-black/60 backdrop-blur-xl border-b border-white/5">
      <button @click="router.push('/capture')" class="text-white/60 active:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <h1 class="text-sm font-medium text-white/80">Utforsk</h1>
      <div class="flex gap-2">
        <button @click="showPanel = !showPanel"
          class="text-white/60 active:text-white transition-colors"
          :class="{ 'text-violet-400': showPanel }">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
          </svg>
        </button>
        <button @click="downloadSvg" class="text-white/60 active:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- Main content: SVG + optional side/bottom panel -->
    <div class="flex-1 flex flex-col md:flex-row min-h-0">

      <!-- SVG canvas -->
      <div ref="containerRef" class="flex-1 flex items-center justify-center relative overflow-hidden min-h-0">
        <div v-if="bgGlow" class="absolute inset-0 -z-10"
          :style="{ background: `radial-gradient(ellipse at ${50 + tiltX * 20}% ${50 + tiltY * 20}%, ${strokeColor}15 0%, transparent 70%)` }" />
        <div class="w-full h-full flex items-center justify-center p-4" :style="transformStyle" v-html="svgHtml" />

        <!-- Floating buttons -->
        <div class="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
          <button @click="handleReset"
            class="w-10 h-10 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/60 active:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
        </div>
        <p class="absolute bottom-4 left-4 text-[10px] text-white/20 z-10">
          {{ (scale * 100).toFixed(0) }}%<template v-if="gyroSupported"> &middot; Gyro</template>
        </p>
      </div>

      <!-- ═══ Controls sidebar (desktop) / bottom panel (mobile) ═══ -->
      <Transition name="sidebar">
        <div v-if="showPanel"
          class="shrink-0 bg-[#111118] border-t md:border-t-0 md:border-l border-white/5
                 w-full md:w-72 h-[45vh] md:h-auto overflow-hidden flex flex-col">

          <!-- Tab bar -->
          <div class="shrink-0 flex border-b border-white/5 overflow-x-auto scrollbar-none">
            <button v-for="tab in tabs" :key="tab.id"
              @click="activeTab = tab.id"
              class="flex-1 min-w-0 px-2 py-2.5 text-[10px] uppercase tracking-wider text-center transition-colors whitespace-nowrap"
              :class="activeTab === tab.id ? 'text-violet-400 border-b-2 border-violet-400' : 'text-white/40'">
              {{ tab.label }}
            </button>
          </div>

          <!-- Tab content (scrollable) -->
          <div class="flex-1 overflow-y-auto p-4 space-y-4">

            <!-- ── Presets tab ── -->
            <template v-if="activeTab === 'presets'">
              <div class="grid grid-cols-2 gap-2">
                <button v-for="(p, name) in filterPresets" :key="name" @click="applyPreset(name)"
                  class="px-3 py-3 text-xs rounded-lg border transition-all active:scale-95 text-left"
                  :class="currentPreset === name ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                  <div class="font-medium">{{ p.label }}</div>
                  <div class="text-[10px] mt-0.5 opacity-60">{{ p.description }}</div>
                </button>
              </div>
            </template>

            <!-- ── Stroke tab ── -->
            <template v-if="activeTab === 'stroke'">
              <!-- Color -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Farge</label>
                <div class="flex gap-2 flex-wrap">
                  <button v-for="c in colorPresets" :key="c.value" @click="strokeColor = c.value; currentPreset = null"
                    class="w-8 h-8 rounded-full border-2 transition-all active:scale-90"
                    :class="strokeColor === c.value ? 'border-white scale-110' : 'border-white/10'"
                    :style="{ background: c.value }" />
                </div>
              </div>
              <!-- Width -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Bredde</label>
                <div class="flex gap-1.5">
                  <button v-for="s in ['thin', 'medium', 'bold']" :key="s" @click="strokeScale = s; currentPreset = null"
                    class="flex-1 py-1.5 text-xs rounded-lg border transition-all"
                    :class="strokeScale === s ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                    {{ s === 'thin' ? 'Tynn' : s === 'medium' ? 'Normal' : 'Bred' }}
                  </button>
                </div>
              </div>
              <!-- Dash -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Stil</label>
                <div class="flex gap-1.5">
                  <button v-for="(_, name) in dashPatterns" :key="name" @click="dashPattern = name; currentPreset = null"
                    class="flex-1 py-1.5 text-xs rounded-lg border transition-all"
                    :class="dashPattern === name ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                    {{ name === 'solid' ? 'Hel' : name === 'dashed' ? 'Strek' : name === 'dotted' ? 'Prikk' : 'Skisse' }}
                  </button>
                </div>
              </div>
              <!-- Linecap -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Ende</label>
                <div class="flex gap-1.5">
                  <button v-for="lc in ['round', 'butt', 'square']" :key="lc" @click="linecapStyle = lc; currentPreset = null"
                    class="flex-1 py-1.5 text-xs rounded-lg border transition-all"
                    :class="linecapStyle === lc ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                    {{ lc === 'round' ? 'Rund' : lc === 'butt' ? 'Flat' : 'Firkant' }}
                  </button>
                </div>
              </div>
              <!-- Smooth toggle -->
              <label class="flex items-center justify-between">
                <span class="text-xs text-white/70">Glatte kurver</span>
                <button @click="isSmooth = !isSmooth; currentPreset = null"
                  class="w-10 h-5 rounded-full transition-colors" :class="isSmooth ? 'bg-violet-600' : 'bg-white/10'">
                  <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-md"
                    :class="isSmooth ? 'translate-x-5' : 'translate-x-0.5'" />
                </button>
              </label>
            </template>

            <!-- ── Layers tab ── -->
            <template v-if="activeTab === 'layers'">
              <div class="space-y-3 text-xs text-white/60">
                <label class="flex items-center gap-2">
                  <span class="w-16 shrink-0">Kanter</span>
                  <input v-model.number="opacities.edges" type="range" min="0" max="100" step="5"
                    class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
                  <span class="w-8 text-right text-white/40">{{ opacities.edges }}</span>
                </label>
                <label class="flex items-center gap-2">
                  <span class="w-16 shrink-0">Konturer</span>
                  <input v-model.number="opacities.contours" type="range" min="0" max="100" step="5"
                    class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
                  <span class="w-8 text-right text-white/40">{{ opacities.contours }}</span>
                </label>
                <label class="flex items-center gap-2">
                  <span class="w-16 shrink-0">Skravering</span>
                  <input v-model.number="opacities.hatching" type="range" min="0" max="100" step="5"
                    class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
                  <span class="w-8 text-right text-white/40">{{ opacities.hatching }}</span>
                </label>
              </div>
              <!-- View toggles -->
              <div class="space-y-2 pt-2 border-t border-white/5">
                <label class="flex items-center justify-between">
                  <span class="text-xs text-white/70">Perspektiv</span>
                  <button @click="perspective = !perspective"
                    class="w-10 h-5 rounded-full transition-colors" :class="perspective ? 'bg-violet-600' : 'bg-white/10'">
                    <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-md"
                      :class="perspective ? 'translate-x-5' : 'translate-x-0.5'" />
                  </button>
                </label>
                <label class="flex items-center justify-between">
                  <span class="text-xs text-white/70">Bakgrunnsglod</span>
                  <button @click="bgGlow = !bgGlow"
                    class="w-10 h-5 rounded-full transition-colors" :class="bgGlow ? 'bg-violet-600' : 'bg-white/10'">
                    <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-md"
                      :class="bgGlow ? 'translate-x-5' : 'translate-x-0.5'" />
                  </button>
                </label>
              </div>
            </template>

            <!-- ── Effects tab ── -->
            <template v-if="activeTab === 'effects'">
              <!-- Wobble -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Handtegnet</label>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] text-white/30 shrink-0">0</span>
                  <input v-model.number="wobbleIntensity" type="range" min="0" max="3" step="0.5"
                    class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none"
                    @input="currentPreset = null" />
                  <span class="text-[10px] text-white/30 shrink-0">3</span>
                </div>
              </div>
              <!-- SVG filters -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">SVG-filter</label>
                <div class="grid grid-cols-2 gap-1.5">
                  <button @click="svgFilter = null; currentPreset = null"
                    class="py-2 text-xs rounded-lg border transition-all"
                    :class="!svgFilter ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                    Ingen
                  </button>
                  <button v-for="f in ['blur', 'glow', 'shadow', 'charcoal', 'emboss']" :key="f"
                    @click="svgFilter = f; currentPreset = null"
                    class="py-2 text-xs rounded-lg border transition-all"
                    :class="svgFilter === f ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                    {{ f === 'blur' ? 'Uskarp' : f === 'glow' ? 'Glod' : f === 'shadow' ? 'Skygge' : f === 'charcoal' ? 'Kull' : 'Preging' }}
                  </button>
                </div>
              </div>
            </template>

            <!-- ── Color tab ── -->
            <template v-if="activeTab === 'color'">
              <p class="text-xs text-white/50">
                Fyll regioner med farger fra originalbildet. Bevarer dybde.
              </p>
              <button @click="toggleColorize" :disabled="colorizing"
                class="w-full py-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
                :class="colorized
                  ? 'bg-white/10 border border-white/20 text-white/70'
                  : 'bg-gradient-to-r from-sky-600 to-violet-600 text-white shadow-[0_0_20px_rgba(56,189,248,0.2)]'">
                <span v-if="colorizing">Fargelegger...</span>
                <span v-else-if="colorized">Fjern farger</span>
                <span v-else>Auto-fargelegg</span>
              </button>
            </template>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.sidebar-enter-active,
.sidebar-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
/* Mobile: slide up from bottom */
.sidebar-enter-from,
.sidebar-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
/* Desktop: slide in from right */
@media (min-width: 768px) {
  .sidebar-enter-from,
  .sidebar-leave-to {
    transform: translateX(100%);
    opacity: 0;
  }
}
.scrollbar-none::-webkit-scrollbar { display: none; }
.scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
</style>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useDeviceMotion } from '../composables/useDeviceMotion.js'
import { usePinchZoom } from '../composables/usePinchZoom.js'

const router = useRouter()

const svgHtml = ref('')
const svgWidth = ref(600)
const svgHeight = ref(400)

const containerRef = ref(null)
const { tiltX, tiltY, supported: gyroSupported, recalibrate } = useDeviceMotion()
const { scale, translateX, translateY, reset: resetZoom } = usePinchZoom(containerRef)

// Visual settings
const strokeColor = ref('#c4b5fd') // violet-300
const bgGlow = ref(true)
const perspective = ref(true)

const colorPresets = [
  { name: 'Fiolett', value: '#c4b5fd' },
  { name: 'Cyan', value: '#67e8f9' },
  { name: 'Grnn', value: '#86efac' },
  { name: 'Rosa', value: '#f9a8d4' },
  { name: 'Hvit', value: '#ffffff' },
  { name: 'Gull', value: '#fbbf24' },
]

const showControls = ref(false)

// Parallax intensity
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

function updateStrokeColor(color) {
  strokeColor.value = color
  // Update all paths in the SVG
  const container = containerRef.value
  if (!container) return
  container.querySelectorAll('svg path').forEach(p => {
    p.setAttribute('stroke', color)
  })
}

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

  if (!svg) {
    router.replace('/capture')
    return
  }

  svgHtml.value = svg
  svgWidth.value = parseInt(w) || 600
  svgHeight.value = parseInt(h) || 400

  // Apply initial stroke color after render
  requestAnimationFrame(() => updateStrokeColor(strokeColor.value))
})
</script>

<template>
  <div class="flex flex-col min-h-[100dvh] bg-[#0a0a0f] overflow-hidden select-none">

    <!-- Header -->
    <header class="relative z-20 flex items-center justify-between px-4 py-3 bg-black/60 backdrop-blur-xl border-b border-white/5">
      <button @click="router.push('/capture')" class="text-white/60 active:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <h1 class="text-sm font-medium text-white/80">Utforsk</h1>
      <button
        @click="showControls = !showControls"
        class="text-white/60 active:text-white transition-colors"
        :class="{ 'text-violet-400': showControls }"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </header>

    <!-- SVG canvas area -->
    <div
      ref="containerRef"
      class="flex-1 flex items-center justify-center relative overflow-hidden"
    >
      <!-- Background glow -->
      <div
        v-if="bgGlow"
        class="absolute inset-0 -z-10"
        :style="{ background: `radial-gradient(ellipse at ${50 + tiltX * 20}% ${50 + tiltY * 20}%, ${strokeColor}15 0%, transparent 70%)` }"
      />

      <!-- The SVG illustration -->
      <div
        class="w-full h-full flex items-center justify-center p-6"
        :style="transformStyle"
        v-html="svgHtml"
      />
    </div>

    <!-- Floating action buttons -->
    <div class="absolute bottom-[max(5rem,calc(4rem+env(safe-area-inset-bottom)))] right-4 flex flex-col gap-2 z-20">
      <button
        @click="handleReset"
        class="w-11 h-11 rounded-full bg-black/60 backdrop-blur-xl border border-white/10
               flex items-center justify-center text-white/60 active:text-white active:bg-white/10 transition-colors"
        title="Tilbakestill visning"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
      </button>
      <button
        @click="downloadSvg"
        class="w-11 h-11 rounded-full bg-black/60 backdrop-blur-xl border border-white/10
               flex items-center justify-center text-white/60 active:text-white active:bg-white/10 transition-colors"
        title="Last ned SVG"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
    </div>

    <!-- Controls panel (slide up) -->
    <Transition name="panel">
      <div
        v-if="showControls"
        class="absolute bottom-0 left-0 right-0 z-30 bg-[#111118]/95 backdrop-blur-2xl border-t border-white/5
               rounded-t-2xl px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <!-- Handle -->
        <div class="w-8 h-1 bg-white/20 rounded-full mx-auto mb-5" />

        <!-- Stroke color -->
        <div class="mb-5">
          <label class="text-[11px] text-white/40 uppercase tracking-wider mb-2 block">Strekfarge</label>
          <div class="flex gap-2">
            <button
              v-for="preset in colorPresets"
              :key="preset.value"
              @click="updateStrokeColor(preset.value)"
              class="w-9 h-9 rounded-full border-2 transition-all active:scale-90"
              :class="strokeColor === preset.value ? 'border-white scale-110' : 'border-white/10'"
              :style="{ background: preset.value }"
              :title="preset.name"
            />
          </div>
        </div>

        <!-- Toggles -->
        <div class="flex flex-col gap-3">
          <label class="flex items-center justify-between">
            <span class="text-sm text-white/70">Sensor-perspektiv</span>
            <button
              @click="perspective = !perspective"
              class="w-11 h-6 rounded-full transition-colors"
              :class="perspective ? 'bg-violet-600' : 'bg-white/10'"
            >
              <div
                class="w-5 h-5 bg-white rounded-full transition-transform shadow-md"
                :class="perspective ? 'translate-x-5.5' : 'translate-x-0.5'"
              />
            </button>
          </label>
          <label class="flex items-center justify-between">
            <span class="text-sm text-white/70">Bakgrunnsglod</span>
            <button
              @click="bgGlow = !bgGlow"
              class="w-11 h-6 rounded-full transition-colors"
              :class="bgGlow ? 'bg-violet-600' : 'bg-white/10'"
            >
              <div
                class="w-5 h-5 bg-white rounded-full transition-transform shadow-md"
                :class="bgGlow ? 'translate-x-5.5' : 'translate-x-0.5'"
              />
            </button>
          </label>
        </div>

        <!-- Zoom info -->
        <p class="text-center text-[11px] text-white/25 mt-4">
          Zoom: {{ (scale * 100).toFixed(0) }}%
          <template v-if="gyroSupported"> &middot; Gyro aktiv</template>
        </p>
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

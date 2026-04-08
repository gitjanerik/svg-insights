<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { generateHumanWireframe, generateCharacterSheet } from '../lib/humanWireframe.js'

const router = useRouter()

// Controls
const rotY = ref(0)
const rotX = ref(0)
const strokeColor = ref('#c4b5fd')
const strokeWidth = ref(0.8)
const showFace = ref(true)
const viewMode = ref('single') // 'single' or 'sheet'

const colorPresets = [
  { name: 'Fiolett', value: '#c4b5fd' },
  { name: 'Cyan', value: '#67e8f9' },
  { name: 'Hvit', value: '#e2e8f0' },
  { name: 'Gull', value: '#fbbf24' },
  { name: 'Grønn', value: '#86efac' },
  { name: 'Rosa', value: '#f9a8d4' },
]

const presetViews = [
  { name: 'Front', rotY: 0, rotX: 0 },
  { name: '3/4', rotY: -Math.PI / 5, rotX: 0.05 },
  { name: 'Side', rotY: Math.PI / 2, rotX: 0 },
  { name: 'Bakfra', rotY: Math.PI, rotX: 0 },
  { name: '3/4 bak', rotY: Math.PI * 0.75, rotX: 0.05 },
]

const svgResult = computed(() => {
  if (viewMode.value === 'sheet') {
    return generateCharacterSheet({
      stroke: strokeColor.value,
      strokeWidth: strokeWidth.value,
    })
  }

  return generateHumanWireframe({
    rotationY: rotY.value,
    rotationX: rotX.value,
    stroke: strokeColor.value,
    strokeWidth: strokeWidth.value,
    showFace: showFace.value,
  })
})

function applyPresetView(preset) {
  viewMode.value = 'single'
  rotY.value = preset.rotY
  rotX.value = preset.rotX
}

function downloadSvg() {
  const blob = new Blob([svgResult.value.svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'wireframe.svg'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="flex flex-col min-h-[100dvh] bg-[#0a0a0f]">

    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 bg-black/40 backdrop-blur-xl border-b border-white/5">
      <button @click="router.push('/')" class="text-white/60 active:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <h1 class="text-sm font-medium text-white/80">Wireframe Test</h1>
      <button @click="downloadSvg" class="text-white/60 active:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
    </header>

    <!-- SVG Display -->
    <div class="flex-1 flex items-center justify-center p-4 relative overflow-hidden">
      <!-- Background glow -->
      <div
        class="absolute inset-0 -z-10"
        :style="{ background: `radial-gradient(ellipse at 50% 45%, ${strokeColor}12 0%, transparent 60%)` }"
      />

      <div
        class="w-full max-w-lg mx-auto"
        :class="viewMode === 'sheet' ? 'max-w-3xl' : 'max-w-sm'"
        :style="{ color: strokeColor }"
        v-html="svgResult.svg"
      />
    </div>

    <!-- Stats -->
    <div class="text-center text-[11px] text-white/25 py-1">
      {{ svgResult.pathCount }} paths &middot; rot {{ (rotY * 180 / Math.PI).toFixed(0) }}&deg;
    </div>

    <!-- Controls panel -->
    <div class="bg-[#111118]/95 backdrop-blur-2xl border-t border-white/5 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">

      <!-- View mode toggle -->
      <div class="flex gap-2 mb-4">
        <button
          @click="viewMode = 'single'"
          class="flex-1 py-2 rounded-lg text-xs font-medium transition-colors"
          :class="viewMode === 'single' ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/50'"
        >
          Enkelvisning
        </button>
        <button
          @click="viewMode = 'sheet'"
          class="flex-1 py-2 rounded-lg text-xs font-medium transition-colors"
          :class="viewMode === 'sheet' ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/50'"
        >
          Character Sheet
        </button>
      </div>

      <!-- Preset views -->
      <div v-if="viewMode === 'single'" class="flex gap-2 mb-4 overflow-x-auto">
        <button
          v-for="preset in presetViews"
          :key="preset.name"
          @click="applyPresetView(preset)"
          class="px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors
                 bg-white/5 text-white/50 active:bg-white/10 border border-white/5"
        >
          {{ preset.name }}
        </button>
      </div>

      <!-- Rotation sliders (single view only) -->
      <div v-if="viewMode === 'single'" class="space-y-3 mb-4">
        <div class="flex items-center gap-3">
          <span class="text-[11px] text-white/40 w-12 shrink-0">Y-rot</span>
          <input
            v-model.number="rotY"
            type="range" :min="-Math.PI" :max="Math.PI" step="0.02"
            class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none
                   [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400
                   [&::-webkit-slider-thumb]:appearance-none"
          />
          <span class="text-[11px] text-white/50 w-10 text-right">{{ (rotY * 180 / Math.PI).toFixed(0) }}&deg;</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-[11px] text-white/40 w-12 shrink-0">X-rot</span>
          <input
            v-model.number="rotX"
            type="range" :min="-0.5" :max="0.5" step="0.01"
            class="flex-1 h-1 accent-sky-500 bg-white/10 rounded-full appearance-none
                   [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sky-400
                   [&::-webkit-slider-thumb]:appearance-none"
          />
          <span class="text-[11px] text-white/50 w-10 text-right">{{ (rotX * 180 / Math.PI).toFixed(0) }}&deg;</span>
        </div>
      </div>

      <!-- Stroke width -->
      <div class="flex items-center gap-3 mb-4">
        <span class="text-[11px] text-white/40 w-12 shrink-0">Strek</span>
        <input
          v-model.number="strokeWidth"
          type="range" min="0.3" max="2" step="0.1"
          class="flex-1 h-1 accent-fuchsia-500 bg-white/10 rounded-full appearance-none
                 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-fuchsia-400
                 [&::-webkit-slider-thumb]:appearance-none"
        />
        <span class="text-[11px] text-white/50 w-10 text-right">{{ strokeWidth.toFixed(1) }}</span>
      </div>

      <!-- Colors -->
      <div class="flex gap-2 mb-3">
        <button
          v-for="preset in colorPresets"
          :key="preset.value"
          @click="strokeColor = preset.value"
          class="w-8 h-8 rounded-full border-2 transition-all active:scale-90"
          :class="strokeColor === preset.value ? 'border-white scale-110' : 'border-white/10'"
          :style="{ background: preset.value }"
          :title="preset.name"
        />
      </div>

      <!-- Face toggle -->
      <label v-if="viewMode === 'single'" class="flex items-center justify-between">
        <span class="text-xs text-white/60">Vis ansiktstrekk</span>
        <button
          @click="showFace = !showFace"
          class="w-10 h-5.5 rounded-full transition-colors"
          :class="showFace ? 'bg-violet-600' : 'bg-white/10'"
        >
          <div
            class="w-4.5 h-4.5 bg-white rounded-full transition-transform shadow-md"
            :class="showFace ? 'translate-x-5' : 'translate-x-0.5'"
          />
        </button>
      </label>
    </div>
  </div>
</template>

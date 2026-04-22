<script setup>
// SolarSystemSetupModal — prompted when the sort-hull victory triggers.
// User picks planet count, moon distribution, inner orbital period and sun
// size, then confirms to start the planetarium.

import { ref, computed, watch } from 'vue'
import { DEFAULT_SOLAR_CONFIG } from '../composables/useHalftoneGame.js'

const props = defineProps({
  open: { type: Boolean, required: true },
})
const emit = defineEmits(['start', 'cancel'])

// Local editable copy, so cancel discards
const planetCount    = ref(DEFAULT_SOLAR_CONFIG.planetCount)
const moonPlanets    = ref(DEFAULT_SOLAR_CONFIG.moonPlanets)
const innerPeriodSec = ref(DEFAULT_SOLAR_CONFIG.innerPeriodSec)
const sunSizePct     = ref(DEFAULT_SOLAR_CONFIG.sunSizePct)

// Reset to defaults whenever the modal opens fresh
watch(() => props.open, (o) => {
  if (o) {
    planetCount.value    = DEFAULT_SOLAR_CONFIG.planetCount
    moonPlanets.value    = DEFAULT_SOLAR_CONFIG.moonPlanets
    innerPeriodSec.value = DEFAULT_SOLAR_CONFIG.innerPeriodSec
    sunSizePct.value     = DEFAULT_SOLAR_CONFIG.sunSizePct
  }
})

// Kepler's third law: outer period ≈ inner × (max/min)^1.5.
// We use the orbit-spread used by the game: minA = sunR·1.5, maxA = minDim·0.48.
// Since we can't know those exact values here we ball-park a ratio of ~15×
// for typical phone screens, giving a nice "≈ 230 s" feel at inner=15s.
const outerPeriodEstimate = computed(() => {
  return Math.round(innerPeriodSec.value * Math.pow(15, 1.5))
})

function cancel() { emit('cancel') }
function start() {
  emit('start', {
    planetCount: planetCount.value,
    moonPlanets: moonPlanets.value,
    innerPeriodSec: innerPeriodSec.value,
    sunSizePct: sunSizePct.value,
  })
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open"
         class="fixed inset-0 z-50 flex items-end md:items-center justify-center
                bg-black/80 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div class="w-full max-w-md rounded-2xl border border-amber-400/20
                  bg-[#15131a] shadow-[0_0_60px_rgba(250,204,21,0.15)]
                  overflow-hidden">

        <!-- Header / narrative -->
        <div class="p-5 border-b border-white/5">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-amber-400 text-lg" aria-hidden="true">☀</span>
            <h2 class="text-base font-semibold text-amber-300">Solsystem aktivert</h2>
          </div>
          <p class="text-xs text-white/60 leading-relaxed">
            Sort hull har slukt alt — og noe nytt oppstår. Konfigurer ditt planetarium før du starter.
            Planetene følger <span class="italic text-amber-300/90">Keplers 3. lov</span>:
            <span class="font-mono text-amber-300/80">ω ∝ r<sup>−3/2</sup></span> — indre baner er
            raskere enn ytre. Jo lenger en planet er fra sola, desto lengre tid bruker den på ett
            omløp. Grip sola og dra for å se gravitasjonen i arbeid.
          </p>
        </div>

        <!-- Sliders -->
        <div class="p-5 space-y-5">

          <!-- Planet count -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm text-white/80">Antall planeter</label>
              <span class="text-sm font-semibold text-amber-300 tabular-nums">{{ planetCount }}</span>
            </div>
            <input v-model.number="planetCount" type="range" min="2" max="20" step="1"
                   class="w-full accent-amber-400" />
            <div class="flex justify-between text-[10px] text-white/35 mt-1">
              <span>2</span><span>20</span>
            </div>
          </div>

          <!-- Moon planets -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm text-white/80">Planeter med måne</label>
              <span class="text-sm font-semibold text-amber-300 tabular-nums">{{ moonPlanets }}</span>
            </div>
            <input v-model.number="moonPlanets" type="range" min="0" :max="Math.min(20, planetCount)" step="1"
                   class="w-full accent-amber-400" />
            <div class="flex justify-between text-[10px] text-white/35 mt-1">
              <span>Ingen</span><span>{{ Math.min(20, planetCount) }}</span>
            </div>
          </div>

          <!-- Inner orbital period -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm text-white/80">Indre omløpstid</label>
              <span class="text-sm font-semibold text-amber-300 tabular-nums">{{ innerPeriodSec }}s</span>
            </div>
            <input v-model.number="innerPeriodSec" type="range" min="10" max="60" step="1"
                   class="w-full accent-amber-400" />
            <div class="flex justify-between text-[10px] text-white/35 mt-1">
              <span>10s (rask)</span><span>60s (treg)</span>
            </div>
            <p class="text-[10px] text-white/40 mt-2 leading-relaxed">
              Ytre baner følger Keplers lov — beregnes automatisk
              (≈{{ outerPeriodEstimate }}s for ytterste bane)
            </p>
          </div>

          <!-- Sun size -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm text-white/80">Solstørrelse</label>
              <span class="text-sm font-semibold text-amber-300 tabular-nums">{{ sunSizePct }}%</span>
            </div>
            <input v-model.number="sunSizePct" type="range" min="0" max="100" step="5"
                   class="w-full accent-amber-400" />
            <div class="flex justify-between text-[10px] text-white/35 mt-1">
              <span>Liten og distinkt</span><span>Stor (planeter i halo)</span>
            </div>
          </div>
        </div>

        <!-- Summary -->
        <div class="px-5 pb-3 text-center">
          <p class="text-[11px] text-white/50">
            {{ planetCount }} planeter · {{ moonPlanets }} med måne · indre {{ innerPeriodSec }}s
          </p>
          <p class="text-[11px] text-amber-300/80 mt-0.5">
            Trykk på en planet for å flytte banen inn eller ut
          </p>
        </div>

        <!-- Actions -->
        <div class="p-4 pt-2 grid grid-cols-2 gap-3">
          <button @click="cancel"
                  class="py-3 rounded-xl border border-white/10 bg-white/5
                         text-sm text-white/70 active:bg-white/10 transition-colors">
            Avbryt
          </button>
          <button @click="start"
                  class="py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400
                         text-sm font-semibold text-black
                         shadow-[0_0_24px_rgba(250,204,21,0.3)]
                         active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
            <span class="text-base" aria-hidden="true">☀</span>
            Start solsystem
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
/* Slightly beefier slider thumb for touch */
input[type=range]::-webkit-slider-thumb {
  appearance: none;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: #fbbf24;
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
}
input[type=range]::-moz-range-thumb {
  width: 18px; height: 18px; border: 0;
  border-radius: 50%;
  background: #fbbf24;
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
}
</style>

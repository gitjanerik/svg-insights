<script setup>
// Interaktiv høydeprofil for Ruteplanleggeren (v12.1.14). Ren SVG: flate +
// linje fargekodet etter underlag (grus oransje / asfalt slate — samme
// semantikk som kartet og grus-baren). Scrubbing med finger/markør: en
// crosshair snapper til nærmeste sample og avlesningen (km · moh) vises i
// headeren — verdiene stigning/fall/min/maks er alltid synlige uten hover.
import { ref, computed, watch } from 'vue'
import { profileToPathData, distanceTicks } from '../lib/routeElevation.js'

const props = defineProps({
  profile: { type: Object, default: null },   // buildRouteProfile-resultat
  state: { type: String, default: 'idle' },   // idle|loading|ready|unavailable
  source: { type: String, default: null },    // 'rute' | 'dem' | null
})

const W = 360
const H = 148
const BOX = { x0: 36, y0: 10, w: W - 36 - 8, h: H - 10 - 26 }

const geom = computed(() => (props.profile ? profileToPathData(props.profile, BOX) : null))

const yTicks = computed(() => {
  const g = geom.value
  if (!g) return []
  const mid = Math.round((g.eleFloor + g.eleCeil) / 2 / 5) * 5
  const vals = [...new Set([g.eleFloor, mid, g.eleCeil])]
  return vals.map((ele) => ({ ele, y: g.yOf(ele) }))
})

const xTicks = computed(() => {
  const g = geom.value
  if (!g || !props.profile) return []
  return distanceTicks(props.profile.lengthM, 6)
    .map((km) => ({ km, x: g.xOf(km * 1000) }))
})

// ── Scrubbing ───────────────────────────────────────────────────────────────
const svgRef = ref(null)
const active = ref(null)   // { x, y, dM, eleM, gravel } | null
watch(() => props.profile, () => { active.value = null })

function scrubTo(clientX) {
  const g = geom.value
  const svg = svgRef.value
  if (!g || !svg || !props.profile) return
  const rect = svg.getBoundingClientRect()
  const x = ((clientX - rect.left) / rect.width) * W
  const dM = ((x - BOX.x0) / BOX.w) * props.profile.lengthM
  let best = null
  for (const s of props.profile.samples) {
    if (!best || Math.abs(s.dM - dM) < Math.abs(best.dM - dM)) best = s
  }
  if (best) active.value = { ...best, x: g.xOf(best.dM), y: g.yOf(best.eleM) }
}

function onPointerDown(e) {
  e.currentTarget.setPointerCapture?.(e.pointerId)
  scrubTo(e.clientX)
}
function onPointerMove(e) {
  if (e.pointerType === 'mouse' && e.buttons === 0) { scrubTo(e.clientX); return }
  if (e.pressure > 0 || e.buttons > 0) scrubTo(e.clientX)
}
function onPointerLeave() { active.value = null }

const ariaLabel = computed(() => {
  const p = props.profile
  if (!p) return 'Høydeprofil'
  return `Høydeprofil: laveste ${Math.round(p.minEle)} moh, høyeste ${Math.round(p.maxEle)} moh, ` +
    `${p.ascentM} m stigning og ${p.descentM} m fall over ${(p.lengthM / 1000).toFixed(1)} km`
})
</script>

<template>
  <div v-if="state !== 'idle'" class="rounded-lg bg-white/5 px-2.5 py-2">
    <div class="flex items-baseline justify-between gap-2">
      <div class="text-[10px] uppercase tracking-wide text-white/45">Høydeprofil</div>
      <div v-if="profile" class="text-[11px] tabular-nums"
           :class="active ? 'text-white font-semibold' : 'text-white/55'">
        <template v-if="active">{{ (active.dM / 1000).toFixed(1) }} km · {{ Math.round(active.eleM) }} moh</template>
        <template v-else>↗ {{ profile.ascentM }} m · ↘ {{ profile.descentM }} m</template>
      </div>
    </div>

    <div v-if="state === 'loading'" class="flex items-center gap-2 py-4 text-[11px] text-white/55">
      <span class="w-3 h-3 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></span>
      Henter høydedata fra Kartverket …
    </div>
    <div v-else-if="state === 'unavailable'" class="py-3 text-[11px] text-white/45 leading-snug">
      Høydeprofil utilgjengelig — fikk ikke høydedata for denne ruta.
    </div>

    <template v-else-if="profile && geom">
      <svg ref="svgRef" :viewBox="`0 0 ${W} ${H}`" class="w-full mt-1 touch-none select-none"
           role="img" :aria-label="ariaLabel"
           @pointerdown="onPointerDown" @pointermove="onPointerMove"
           @pointerup="onPointerLeave" @pointercancel="onPointerLeave" @pointerleave="onPointerLeave">
        <!-- Dempet grid + høyde-akse -->
        <g v-for="t in yTicks" :key="'y' + t.ele">
          <line :x1="BOX.x0" :y1="t.y" :x2="BOX.x0 + BOX.w" :y2="t.y"
                stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
          <text :x="BOX.x0 - 5" :y="t.y + 3" text-anchor="end" font-size="9"
                fill="rgba(255,255,255,0.4)" class="tabular-nums">{{ t.ele }}</text>
        </g>
        <!-- Flate + underlagsfargede linjestykker -->
        <path :d="geom.areaD" fill="rgba(255,255,255,0.07)"/>
        <path v-for="(run, i) in geom.runs" :key="'r' + i" :d="run.d" fill="none"
              :stroke="run.gravel ? '#e8802b' : '#94a3b8'" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"/>
        <!-- Distanse-akse -->
        <line :x1="BOX.x0" :y1="BOX.y0 + BOX.h" :x2="BOX.x0 + BOX.w" :y2="BOX.y0 + BOX.h"
              stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
        <text v-for="t in xTicks" :key="'x' + t.km" :x="t.x" :y="H - 6" text-anchor="middle"
              font-size="9" fill="rgba(255,255,255,0.4)" class="tabular-nums">{{ t.km }}</text>
        <text :x="BOX.x0 + BOX.w" :y="H - 6" text-anchor="end" font-size="8"
              fill="rgba(255,255,255,0.3)">km</text>
        <!-- Crosshair + punkt ved scrubbing -->
        <g v-if="active">
          <line :x1="active.x" :y1="BOX.y0" :x2="active.x" :y2="BOX.y0 + BOX.h"
                stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
          <circle :cx="active.x" :cy="active.y" r="3.5"
                  :fill="active.gravel !== false ? '#e8802b' : '#94a3b8'"
                  stroke="#0e1116" stroke-width="1.5"/>
        </g>
      </svg>
      <div class="text-right text-[9px] text-white/30">
        Høyder: {{ source === 'dem' ? 'Kartverket DTM' : 'BRouter' }}
      </div>
    </template>
  </div>
</template>

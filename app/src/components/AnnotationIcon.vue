<script setup>
// Inline ikon for annoteringssymboler. Brukes i drawer-knappene
// (placement, lag-toggle, liste). Bruker IKKE <use href="#iso-sym-...">
// fordi ISOM-symbolene har 0.07-0.10 mm strek (print-spec) som blir
// usynlig på 16-px-knapper. Disse er drawer-ikoner med synlig strek.
//
// 'geocache' (brand: «Stedsmerke») har SMIL-animasjon — rød dråpe-pin
// med squash & stretch én gang pr 5s + halvgjennomsiktig skygge under.
// Hver instans får tilfeldig pre-roll så de ikke spretter i takt.
import {
  STEDSMERKE_KEY_TIMES, STEDSMERKE_DUR, STEDSMERKE_SHADOW_OPACITY,
  buildPinMatrixValues, buildShadowMatrixValues, randomBegin, pinPath,
} from '../lib/stedsmerkeAnimation.js'

defineProps({
  symbolKey: { type: String, required: true },
})

// Pin head-radius s=2.5, tip ved (8, 12.5), skygge ved (8, 13.5).
// Apex-løft = 1.2s = 3 user-units i 16x16-viewBox — passer akkurat.
const PIN_S = 2.5
const PIN_PX = 8
const PIN_PY = 12.5
const SHADOW_RX = 2.5
const SHADOW_RY = 0.7
const SHADOW_PY = 13.5

const smPinValues = buildPinMatrixValues(PIN_S, PIN_PX, PIN_PY)
const smShadowValues = buildShadowMatrixValues(SHADOW_RX, SHADOW_RY, PIN_PX, SHADOW_PY)
const smPath = pinPath(PIN_S)
const smBegin = randomBegin()
</script>

<template>
  <svg viewBox="0 0 16 16" class="w-4 h-4 shrink-0" fill="none">
    <template v-if="symbolKey === 'knaus'">
      <path d="M3 10.5 A5 4 0 0 1 13 10.5"
            stroke="#b07845" stroke-width="1.8" stroke-linecap="round"/>
    </template>
    <template v-else-if="symbolKey === 'stein'">
      <polygon points="8,3 13.2,12 2.8,12" fill="currentColor"/>
    </template>
    <template v-else-if="symbolKey === 'brønn'">
      <circle cx="8" cy="8" r="5" stroke="#0099cc" stroke-width="1.6"/>
      <line x1="3" y1="8" x2="13" y2="8" stroke="#0099cc" stroke-width="1.6"/>
      <line x1="8" y1="3" x2="8" y2="13" stroke="#0099cc" stroke-width="1.6"/>
    </template>
    <template v-else-if="symbolKey === 'bro'">
      <line x1="3" y1="5.5" x2="13" y2="5.5" stroke="currentColor" stroke-width="1.8"/>
      <line x1="3" y1="10.5" x2="13" y2="10.5" stroke="currentColor" stroke-width="1.8"/>
    </template>
    <template v-else-if="symbolKey === 'geocache'">
      <!-- Skygge: halvgjennomsiktig svart ellipse, squashes horisontalt -->
      <g>
        <animateTransform attributeName="transform" type="matrix"
                          :values="smShadowValues" :keyTimes="STEDSMERKE_KEY_TIMES"
                          :dur="STEDSMERKE_DUR" repeatCount="indefinite" :begin="smBegin"/>
        <ellipse cx="0" cy="0" rx="1" ry="1" fill="#000" opacity="0.55">
          <animate attributeName="opacity" :values="STEDSMERKE_SHADOW_OPACITY"
                   :keyTimes="STEDSMERKE_KEY_TIMES"
                   :dur="STEDSMERKE_DUR" repeatCount="indefinite" :begin="smBegin"/>
        </ellipse>
      </g>
      <!-- Pin: rød dråpe med hvit prikk i midten -->
      <g>
        <animateTransform attributeName="transform" type="matrix"
                          :values="smPinValues" :keyTimes="STEDSMERKE_KEY_TIMES"
                          :dur="STEDSMERKE_DUR" repeatCount="indefinite" :begin="smBegin"/>
        <path :d="smPath" fill="#dc2626" stroke="#7f1d1d"
              stroke-width="0.4" stroke-linejoin="round"/>
        <circle cx="0" :cy="-1.85 * PIN_S" r="0.9" fill="#fff"/>
      </g>
    </template>
  </svg>
</template>

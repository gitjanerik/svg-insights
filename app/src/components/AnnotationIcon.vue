<script setup>
// Inline ikon for annoteringssymboler. Brukes i drawer-knappene
// (placement, lag-toggle, liste). Bruker IKKE <use href="#iso-sym-...">
// fordi ISOM-symbolene har 0.07-0.10 mm strek (print-spec) som blir
// usynlig på 16-px-knapper. Disse er drawer-ikoner med synlig strek.
//
// 'stedsmerke' rendres STATISK her — rød dråpe-pin med skygge i hvile.
// Squash & stretch-animasjonen skal kun kjøre på selve kartet (etter at
// brukeren har lagret/gjenåpnet) og i spillet ved treff, ikke i settings-
// drawerens forhåndsvisninger.
import { pinPath } from '../lib/stedsmerkeAnimation.js'

defineProps({
  symbolKey: { type: String, required: true },
})

// Pin head-radius s=2.5, tip ved (8, 12.5). Pin-høyde = 7.125,
// hode-topp ved y=5.375 — passer komfortabelt i 16x16 viewBox.
const PIN_S = 2.5
const SM_PATH = pinPath(PIN_S)
const SM_DOT_CY = -1.85 * PIN_S
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
    <template v-else-if="symbolKey === 'stedsmerke'">
      <ellipse cx="8" cy="13.5" rx="2.5" ry="0.7" fill="#000" opacity="0.55"/>
      <g transform="translate(8 12.5)">
        <path :d="SM_PATH" fill="#dc2626"/>
        <circle cx="0" :cy="SM_DOT_CY" r="0.9" fill="#fff"/>
      </g>
    </template>
  </svg>
</template>

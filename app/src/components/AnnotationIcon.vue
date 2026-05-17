<script setup>
// Inline ikon for annoteringssymboler. Brukes i drawer-knappene
// (placement, lag-toggle, liste). Bruker IKKE <use href="#iso-sym-...">
// fordi ISOM-symbolene har 0.07-0.10 mm strek (print-spec) som blir
// usynlig på 16-px-knapper. Disse er drawer-ikoner med synlig strek.
//
// 'geocache' har SMIL-animasjon (pulsende glow + roterende rays +
// blinkende rød X) som matcher kart-renderingen i MapView.
defineProps({
  symbolKey: { type: String, required: true },
})
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
      <circle cx="8" cy="8" r="6" fill="#fbbf24" opacity="0.55">
        <animate attributeName="r" values="5;7;5" dur="0.7s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.35;0.8;0.35" dur="0.7s" repeatCount="indefinite"/>
      </circle>
      <g stroke="#b45309" stroke-width="1" stroke-linecap="round">
        <line x1="8" y1="2.5" x2="8" y2="4.5"/>
        <line x1="8" y1="11.5" x2="8" y2="13.5"/>
        <line x1="2.5" y1="8" x2="4.5" y2="8"/>
        <line x1="11.5" y1="8" x2="13.5" y2="8"/>
        <line x1="4.1" y1="4.1" x2="5.5" y2="5.5"/>
        <line x1="10.5" y1="10.5" x2="11.9" y2="11.9"/>
        <line x1="4.1" y1="11.9" x2="5.5" y2="10.5"/>
        <line x1="10.5" y1="5.5" x2="11.9" y2="4.1"/>
        <animateTransform attributeName="transform" type="rotate"
                          from="0 8 8" to="360 8 8" dur="6s" repeatCount="indefinite"/>
      </g>
      <g stroke="#dc2626" stroke-width="1.6" stroke-linecap="round">
        <line x1="6" y1="6" x2="10" y2="10"/>
        <line x1="6" y1="10" x2="10" y2="6"/>
        <animate attributeName="opacity" values="1;0.25;1" dur="0.55s" repeatCount="indefinite"/>
      </g>
    </template>
  </svg>
</template>

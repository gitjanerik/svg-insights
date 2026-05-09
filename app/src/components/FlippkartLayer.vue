<script setup>
import { computed } from 'vue'

const props = defineProps({
  flipp: { type: Object, required: true },
  viewBox: { type: String, required: true },
})

// Hent ballradius fra composable. Ingen egen kopi — physikk og rendering
// må alltid være enige.
const ballRadius = computed(() => props.flipp.BALL_RADIUS_M ?? 12)

// Subtil grunnfarge-shift per level (v7.2.4). Level 1 = klassisk chrome,
// høyere level = progressivt varmere/kjøligere chrome via HSL-stops.
const ballGradient = computed(() => {
  const lev = props.flipp.level.value
  if (lev === 1) return { inner: '#ffffff', mid: '#cbd5e1', outer: '#0f172a' }
  const hues = [30, 350, 280, 60, 200, 120, 320]
  const h = hues[(lev - 2) % hues.length]
  return {
    inner: `hsl(${h}, 10%, 96%)`,
    mid:   `hsl(${h}, 32%, 68%)`,
    outer: `hsl(${h}, 60%, 16%)`,
  }
})

const emit = defineEmits(['drop'])

// Trail-sluttgammel: TRAIL_LEN fra useFlippkart. Holder seg syncet via
// at hver slot har age 0..TRAIL_LEN.
const trailMaxAge = 14

function trailOpacity(age) {
  return Math.max(0, 0.55 * (1 - age / trailMaxAge))
}

function trailRadius(age, base) {
  return base * Math.max(0.15, 1 - age / trailMaxAge) * 0.6
}

const splashTiles = computed(() => {
  // 8-bit pixel-eksplosjon: 8 fliser i ring rundt drown-punktet
  const t = props.flipp.splash.t       // 0..1
  if (!props.flipp.splash.active) return []
  const r = ballRadius.value
  const baseSize = r * 0.45
  const radius = r * 0.4 + t * r * 4
  const fade = 1 - t
  const tiles = []
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2
    const x = Math.cos(ang) * radius
    const y = Math.sin(ang) * radius
    tiles.push({
      x: x - baseSize / 2,
      y: y - baseSize / 2,
      size: baseSize,
      opacity: fade,
    })
  }
  return tiles
})

function onClick() {
  // v7.2.5: emit-en starter nedtelling. Drop-posisjon er randomisert i
  // composable, ikke fra tap-koord lenger.
  if (props.flipp.status.value !== 'idle') return
  emit('drop')
}
</script>

<template>
  <svg v-if="flipp.active.value"
       class="absolute inset-0 w-full h-full pointer-events-auto"
       :viewBox="viewBox"
       preserveAspectRatio="xMidYMid meet"
       @click="onClick">
    <defs>
      <radialGradient id="flipp-chrome" cx="35%" cy="30%">
        <stop offset="0%" :stop-color="ballGradient.inner"/>
        <stop offset="35%" :stop-color="ballGradient.mid"/>
        <stop offset="100%" :stop-color="ballGradient.outer"/>
      </radialGradient>
      <filter id="flipp-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5"/>
        <feOffset dx="0.5" dy="1.5" result="shadow"/>
        <feFlood flood-color="#000" flood-opacity="0.45"/>
        <feComposite in2="shadow" operator="in"/>
        <feComposite in="SourceGraphic"/>
      </filter>
    </defs>

    <!-- Trail: faded tail bak ballen -->
    <g v-if="flipp.ball.visible">
      <circle v-for="(t, i) in flipp.trail" :key="`trail-${i}`"
              :cx="t.x" :cy="t.y"
              :r="trailRadius(t.age, ballRadius)"
              :opacity="trailOpacity(t.age)"
              fill="#cbd5e1"
              pointer-events="none"/>
    </g>

    <!-- Marble -->
    <circle v-if="flipp.ball.visible"
            :cx="flipp.ball.x" :cy="flipp.ball.y" :r="ballRadius"
            fill="url(#flipp-chrome)"
            filter="url(#flipp-shadow)"
            pointer-events="none"/>

    <!-- Splash -->
    <g v-if="flipp.splash.active"
       :transform="`translate(${flipp.splash.x} ${flipp.splash.y})`"
       pointer-events="none">
      <rect v-for="(tile, i) in splashTiles" :key="`splash-${i}`"
            :x="tile.x" :y="tile.y"
            :width="tile.size" :height="tile.size"
            :opacity="tile.opacity"
            fill="#38bdf8"/>
    </g>
  </svg>
</template>


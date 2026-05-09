<script setup>
import { computed } from 'vue'

const props = defineProps({
  flipp: { type: Object, required: true },
  viewBox: { type: String, required: true },
  highestPoint: { type: Object, default: null },
})

// Hent ballradius fra composable (60m i v7.2.0). FlippkartLayer holder ikke
// egen kopi — physikk og rendering må alltid være enige.
const ballRadius = computed(() => props.flipp.BALL_RADIUS_M ?? 12)

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

function onClick(e) {
  if (props.flipp.status.value !== 'idle') return
  const svg = e.currentTarget
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return
  const local = pt.matrixTransform(ctm.inverse())
  emit('drop', { x: local.x, y: local.y })
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
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="35%" stop-color="#cbd5e1"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </radialGradient>
      <filter id="flipp-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5"/>
        <feOffset dx="0.5" dy="1.5" result="shadow"/>
        <feFlood flood-color="#000" flood-opacity="0.45"/>
        <feComposite in2="shadow" operator="in"/>
        <feComposite in="SourceGraphic"/>
      </filter>
    </defs>

    <!-- Highest-point-target: 8-bit blinking pixel-stjerne i Pac-Man-gul -->
    <g v-if="highestPoint && flipp.status.value !== 'gameover'"
       class="flipp-target"
       :transform="`translate(${highestPoint.svgX} ${highestPoint.svgY})`"
       pointer-events="none">
      <!-- Stjerne av 5 6×6 piksler i kors-mønster -->
      <rect x="-3" y="-21" width="6" height="6" fill="#fbbf24"/>
      <rect x="-3" y="15"  width="6" height="6" fill="#fbbf24"/>
      <rect x="-21" y="-3" width="6" height="6" fill="#fbbf24"/>
      <rect x="15" y="-3"  width="6" height="6" fill="#fbbf24"/>
      <rect x="-3" y="-3"  width="6" height="6" fill="#fde68a"/>
      <!-- Diagonal-aksenter, mindre piksler -->
      <rect x="-12" y="-12" width="3" height="3" fill="#fbbf24"/>
      <rect x="9" y="-12"   width="3" height="3" fill="#fbbf24"/>
      <rect x="-12" y="9"   width="3" height="3" fill="#fbbf24"/>
      <rect x="9" y="9"     width="3" height="3" fill="#fbbf24"/>
    </g>

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

<style scoped>
.flipp-target {
  animation: flipp-blink 0.8s steps(2, end) infinite;
}
@keyframes flipp-blink {
  0% { opacity: 1; }
  50% { opacity: 0.35; }
  100% { opacity: 1; }
}
</style>

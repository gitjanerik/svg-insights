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
  // 8-bit pixel-eksplosjon. Drown: 8 fliser, blå-tone. Explode: 16 fliser,
  // dobbel-radius, oransj-tone (større dramatikk når ballen detonerer).
  const t = props.flipp.splash.t       // 0..1
  if (!props.flipp.splash.active) return []
  const r = ballRadius.value
  const isExplode = props.flipp.splash.kind === 'explode'
  const tileCount = isExplode ? 16 : 8
  const sizeMult = isExplode ? 0.7 : 0.45
  const radiusMult = isExplode ? 8 : 4
  const baseSize = r * sizeMult
  const radius = r * 0.4 + t * r * radiusMult
  const fade = 1 - t
  const tiles = []
  for (let i = 0; i < tileCount; i++) {
    const ang = (i / tileCount) * Math.PI * 2
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

    <!-- Bumpers: hus-formede stationary-kollisjons-objekter. Rendres FØR
         baller så ball-circles tegnes oppå. Hver bumper viser hits-counter
         som lit/unlit firkanter på taket (4 hits = 4 firkanter, lyser grønn). -->
    <g v-for="(bp, i) in flipp.bumpers" :key="`bumper-${i}`" pointer-events="none">
      <g :transform="`translate(${bp.x} ${bp.y})`">
        <!-- Skygge -->
        <ellipse cx="3" :cy="ballRadius * 0.95"
                 :rx="ballRadius * 0.85" ry="6"
                 fill="rgba(0,0,0,0.4)"/>
        <!-- Vegg-flate -->
        <rect :x="-ballRadius * 0.85" :y="-ballRadius * 0.2"
              :width="ballRadius * 1.7" :height="ballRadius * 1.1"
              fill="#8b4513"
              stroke="#fff"
              stroke-width="3"/>
        <!-- Tak (triangel) -->
        <polygon
          :points="`${-ballRadius * 1.0},${-ballRadius * 0.2} 0,${-ballRadius * 0.95} ${ballRadius * 1.0},${-ballRadius * 0.2}`"
          fill="#dc2626"
          stroke="#fff"
          stroke-width="3"/>
        <!-- Dør -->
        <rect :x="-ballRadius * 0.18" :y="ballRadius * 0.45"
              :width="ballRadius * 0.36" :height="ballRadius * 0.45"
              fill="#451a03"/>
        <!-- Vindu -->
        <rect :x="ballRadius * 0.25" :y="ballRadius * 0.1"
              :width="ballRadius * 0.32" :height="ballRadius * 0.32"
              fill="#fbbf24"
              stroke="#7c2d12"
              stroke-width="2"/>
        <!-- Hits-counter på taket: 4 firkanter, lyser opp etter hvert som
             treff samles. Når alle 4 lyser → multiball. -->
        <g :transform="`translate(${-ballRadius * 0.6}, ${-ballRadius * 0.55})`">
          <rect v-for="n in flipp.BUMPER_HITS_TO_MULTIBALL"
                :key="`hit-${n}`"
                :x="(n - 1) * ballRadius * 0.32"
                y="0"
                :width="ballRadius * 0.22"
                :height="ballRadius * 0.18"
                :fill="n <= bp.hits ? '#22c55e' : 'rgba(0,0,0,0.4)'"
                stroke="#fff"
                stroke-width="1.5"/>
        </g>
      </g>
    </g>

    <!-- Trail: faded tail bak primary ball (balls[0]) -->
    <g v-if="flipp.balls.length > 0">
      <circle v-for="(t, i) in flipp.trail" :key="`trail-${i}`"
              :cx="t.x" :cy="t.y"
              :r="trailRadius(t.age, ballRadius)"
              :opacity="trailOpacity(t.age)"
              fill="#cbd5e1"
              pointer-events="none"/>
    </g>

    <!-- Baller (multi-ball-støtte). Charging-pulse-ring renderes UNDER ballen
         når chargeT > 0 (rød advarsel om snarlig eksplosjon). -->
    <g v-for="(b, i) in flipp.balls" :key="`ball-${i}`" pointer-events="none">
      <!-- Charging warning ring -->
      <circle v-if="b.chargeT > 0"
              :cx="b.x" :cy="b.y"
              :r="ballRadius * (1.15 + b.chargeT * 0.6)"
              :fill="`rgba(239, 68, 68, ${0.15 + b.chargeT * 0.25})`"
              :stroke="b.chargeT >= 0.95 ? '#fde047' : '#ef4444'"
              :stroke-width="3 + b.chargeT * 6"
              :stroke-dasharray="b.chargeT >= 0.5 ? '8 4' : 'none'">
        <animate v-if="b.chargeT >= 0.5"
                 attributeName="r"
                 :values="`${ballRadius * (1.15 + b.chargeT * 0.6)};${ballRadius * (1.4 + b.chargeT * 0.6)};${ballRadius * (1.15 + b.chargeT * 0.6)}`"
                 dur="0.3s"
                 repeatCount="indefinite"/>
      </circle>
      <!-- Marble -->
      <circle :cx="b.x" :cy="b.y" :r="ballRadius"
              fill="url(#flipp-chrome)"
              filter="url(#flipp-shadow)"
              :style="{ filter: b.chargeT > 0.7 ? `hue-rotate(${(b.chargeT - 0.7) * 600}deg) brightness(${1 + b.chargeT * 0.3})` : '' }"/>
    </g>

    <!-- Splash / explosion -->
    <g v-if="flipp.splash.active"
       :transform="`translate(${flipp.splash.x} ${flipp.splash.y})`"
       pointer-events="none">
      <rect v-for="(tile, i) in splashTiles" :key="`splash-${i}`"
            :x="tile.x" :y="tile.y"
            :width="tile.size" :height="tile.size"
            :opacity="tile.opacity"
            :fill="flipp.splash.kind === 'explode' ? '#fb923c' : '#38bdf8'"/>
    </g>
  </svg>
</template>


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

    <!-- Bumpers: kart-annoterings-symboler (knaus / stein / brønn / bro)
         med kremgul halo + lilla ring (matcher annotation-styling i appen).
         Hits-counter som LED-rad over symbolet (4 firkanter, lyser grønn). -->
    <g v-for="(bp, i) in flipp.bumpers" :key="`bumper-${i}`" pointer-events="none">
      <g :transform="`translate(${bp.x} ${bp.y})`">
        <!-- Halo: kremgul fyll, lilla 2px ring (matcher annoterings-stil) -->
        <circle cx="0" cy="0"
                :r="ballRadius * 0.95"
                fill="#fffef0"
                fill-opacity="0.92"
                stroke="#7a3aa3"
                :stroke-width="ballRadius * 0.04"/>

        <!-- Knaus: brun halvmåne -->
        <path v-if="bp.kind === 'knaus'"
              :d="`M${-ballRadius*0.6} ${ballRadius*0.4} A${ballRadius*0.6} ${ballRadius*0.4} 0 0 0 ${ballRadius*0.6} ${ballRadius*0.4}`"
              stroke="#7f4f24"
              :stroke-width="ballRadius * 0.10"
              stroke-linecap="round"
              fill="none"/>

        <!-- Stein: solid svart trekant -->
        <polygon v-else-if="bp.kind === 'stein'"
                 :points="`0,${-ballRadius*0.6} ${ballRadius*0.6},${ballRadius*0.5} ${-ballRadius*0.6},${ballRadius*0.5}`"
                 fill="#000"/>

        <!-- Brønn: cyan sirkel med kryss -->
        <g v-else-if="bp.kind === 'brønn'">
          <circle cx="0" cy="0" :r="ballRadius * 0.6"
                  fill="none"
                  stroke="#0099cc"
                  :stroke-width="ballRadius * 0.10"/>
          <line :x1="-ballRadius*0.6" y1="0" :x2="ballRadius*0.6" y2="0"
                stroke="#0099cc" :stroke-width="ballRadius * 0.10"/>
          <line x1="0" :y1="-ballRadius*0.6" x2="0" :y2="ballRadius*0.6"
                stroke="#0099cc" :stroke-width="ballRadius * 0.10"/>
        </g>

        <!-- Bro / klopp: to parallelle svarte streker -->
        <g v-else-if="bp.kind === 'bro'">
          <line :x1="-ballRadius*0.6" :y1="-ballRadius*0.3"
                :x2="ballRadius*0.6"  :y2="-ballRadius*0.3"
                stroke="#000" :stroke-width="ballRadius * 0.12"/>
          <line :x1="-ballRadius*0.6" :y1="ballRadius*0.3"
                :x2="ballRadius*0.6"  :y2="ballRadius*0.3"
                stroke="#000" :stroke-width="ballRadius * 0.12"/>
        </g>

        <!-- Hits-counter: 4 LED-firkanter over halo (matcher annotation-stil)  -->
        <g :transform="`translate(${-ballRadius * 0.55}, ${-ballRadius * 1.25})`">
          <rect v-for="n in flipp.BUMPER_HITS_TO_MULTIBALL"
                :key="`hit-${n}`"
                :x="(n - 1) * ballRadius * 0.30"
                y="0"
                :width="ballRadius * 0.22"
                :height="ballRadius * 0.16"
                :fill="n <= bp.hits ? '#22c55e' : 'rgba(0,0,0,0.35)'"
                stroke="#fffef0"
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


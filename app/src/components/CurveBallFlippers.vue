<script setup>
import { ref } from 'vue'

const props = defineProps({
  flipp: { type: Object, required: true },
  // Skjerm-rekt for kart-SVG-en (med pxPerM for viewBox-m → CSS-px)
  mapRect: { type: Object, default: null },
})

// Tykkelse på flipper (perpendikulært til kant), i CSS-piksler.
// v8.0.1: skaler etter mapRect.hudScale så små kart får tynne paddles og
// store kart får tykkere. Base-verdi 35px svarer til scale=1 (≈ 4×4km).
const PAD_THICKNESS_BASE = 35
function padThickness() {
  const s = props.mapRect?.hudScale
  return Number.isFinite(s) ? PAD_THICKNESS_BASE * s : PAD_THICKNESS_BASE
}

// Hvor mye drag-bevegelse før vi tolker det som drag (ikke tap).
// Under terskel = tap → energize.
const TAP_MOVE_THRESHOLD = 0.005   // fraksjon av kant-lengde

const dragState = ref(null)

function paddleStyle(edge) {
  if (!props.mapRect) return { display: 'none' }
  const r = props.mapRect
  const f = props.flipp.flippers[edge]
  const isHoriz = edge === 'top' || edge === 'bottom'
  const totalLen = isHoriz ? r.width : r.height
  const padLen = totalLen * f.length
  const padCenter = totalLen * f.position

  const insetM = props.flipp.FLIPPER_INSET_M ?? 280
  const insetPx = (r.pxPerM ?? 0.3) * insetM
  const thick = padThickness()

  if (edge === 'top') {
    return {
      top:    `${r.top + insetPx - thick}px`,
      left:   `${r.left + padCenter - padLen / 2}px`,
      width:  `${padLen}px`,
      height: `${thick}px`,
    }
  }
  if (edge === 'bottom') {
    return {
      top:    `${r.top + r.height - insetPx}px`,
      left:   `${r.left + padCenter - padLen / 2}px`,
      width:  `${padLen}px`,
      height: `${thick}px`,
    }
  }
  if (edge === 'left') {
    return {
      top:    `${r.top + padCenter - padLen / 2}px`,
      left:   `${r.left + insetPx - thick}px`,
      width:  `${thick}px`,
      height: `${padLen}px`,
    }
  }
  return {
    top:    `${r.top + padCenter - padLen / 2}px`,
    left:   `${r.left + r.width - insetPx}px`,
    width:  `${thick}px`,
    height: `${padLen}px`,
  }
}

function chargeClass(edge) {
  return `cb-charge-${props.flipp.flippers[edge].kickLevel}`
}

function onPointerDown(edge, e) {
  if (!props.mapRect) return
  e.preventDefault()
  e.stopPropagation()
  e.currentTarget.setPointerCapture?.(e.pointerId)
  const isHoriz = edge === 'top' || edge === 'bottom'
  dragState.value = {
    edge,
    pointerId: e.pointerId,
    startCoord: isHoriz ? e.clientX : e.clientY,
    startPos: props.flipp.flippers[edge].position,
    movedAsDrag: false,
  }
}

// v8.4.0: enhåndsmodus er nå alltid på (toggle-knappen fjernet).
// Ett drag på én flipper styrer ALLE fire i et diagonalt NØ/SV-mønster:
//
// Posisjons-konvensjon (kant: 0→1 retning):
//   top:    NV → NØ   |   bottom: SV → SØ
//   left:   NV → SV   |   right:  NØ → SØ
//
// Et hjørnemøte krever to flippere på samme korner-koordinat:
//   NØ-møte (topp + høyre): top.pos = 1, right.pos = 0  → top + right = 1
//   SV-møte (bunn + venstre): bottom.pos = 0, left.pos = 1 → bottom + left = 1
//
// Én T ∈ [0,1] hvor T=1 = NØ+SV-konsentrasjon:
//   top = T, right = 1-T, bottom = 1-T, left = T
// Brukeren drar topp/venstre høyre/ned for å samle ved NØ+SV; bunn/høyre i
// motsatt retning gir samme konsentrasjon.
function clampToHalf(f, pos) {
  const half = f.length / 2
  return Math.max(half, Math.min(1 - half, pos))
}

function diagonalTargets(edge, pos) {
  // Avled T fra den dratte kanten: topp/venstre direkte, bunn/høyre invertert.
  const T = (edge === 'top' || edge === 'left') ? pos : 1 - pos
  return { top: T, left: T, bottom: 1 - T, right: 1 - T }
}

function onPointerMove(e) {
  const ds = dragState.value
  if (!ds || ds.pointerId !== e.pointerId || !props.mapRect) return
  e.preventDefault()
  e.stopPropagation()
  const isHoriz = ds.edge === 'top' || ds.edge === 'bottom'
  const cur = isHoriz ? e.clientX : e.clientY
  const total = isHoriz ? props.mapRect.width : props.mapRect.height
  if (total <= 0) return
  const delta = (cur - ds.startCoord) / total
  if (Math.abs(delta) > TAP_MOVE_THRESHOLD) ds.movedAsDrag = true
  const f = props.flipp.flippers[ds.edge]
  const next = clampToHalf(f, ds.startPos + delta)
  f.position = next

  const targets = diagonalTargets(ds.edge, next)
  const flips = props.flipp.flippers
  for (const e2 of ['top', 'bottom', 'left', 'right']) {
    if (e2 === ds.edge) continue
    flips[e2].position = clampToHalf(flips[e2], targets[e2])
  }
}

function onPointerUp(e) {
  const ds = dragState.value
  if (ds && ds.pointerId === e.pointerId) {
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (!ds.movedAsDrag) {
      // Quick tap → energize (lade kick-multiplier)
      props.flipp.energize(ds.edge)
    }
    dragState.value = null
  }
}
</script>

<template>
  <div v-if="flipp.active.value && mapRect" class="cb-paddles">
    <div v-for="edge in ['top', 'bottom', 'left', 'right']"
         :key="edge"
         class="cb-paddle"
         :class="[
           `cb-paddle-${edge}`,
           chargeClass(edge),
           dragState?.edge === edge && dragState?.movedAsDrag ? 'cb-paddle-active' : '',
         ]"
         :style="paddleStyle(edge)"
         @pointerdown="onPointerDown(edge, $event)"
         @pointermove="onPointerMove"
         @pointerup="onPointerUp"
         @pointercancel="onPointerUp">
      <div class="cb-paddle-grip"/>
    </div>
  </div>
</template>

<style scoped>
.cb-paddles {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 45;
}

.cb-paddle {
  position: fixed;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
  cursor: grab;
  transition: background 120ms, box-shadow 120ms;
}

/* v7.3.0: Utvidet touch-sone via ::before pseudo-element. Paddle visuelt
   står som før, men kan grabbes 70px ekstra INN mot kart-senter. */
.cb-paddle::before {
  content: '';
  position: absolute;
  background: transparent;
}
.cb-paddle-top::before    { inset:    0  0 -70px  0; }
.cb-paddle-bottom::before { inset: -70px  0    0  0; }
.cb-paddle-left::before   { inset:    0 -70px  0  0; }
.cb-paddle-right::before  { inset:    0    0  0 -70px; }

.cb-paddle:active,
.cb-paddle.cb-paddle-active {
  cursor: grabbing;
  filter: brightness(1.15);
}

/* Charge stages — kald → varm via kickLevel.
   0 = blå (normal), 1 = gul, 2 = oransj, 3 = rød (max). */
.cb-charge-0 {
  background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.55), inset 0 0 4px rgba(0,0,0,0.3);
}
.cb-charge-1 {
  background: linear-gradient(135deg, #fde047 0%, #facc15 100%);
  box-shadow: 0 0 12px rgba(250, 204, 21, 0.75), inset 0 0 4px rgba(0,0,0,0.3);
}
.cb-charge-2 {
  background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%);
  box-shadow: 0 0 14px rgba(251, 146, 60, 0.85), inset 0 0 4px rgba(0,0,0,0.3);
}
.cb-charge-3 {
  background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
  box-shadow: 0 0 18px rgba(239, 68, 68, 0.95), inset 0 0 6px rgba(0,0,0,0.4);
  animation: cb-pulse-red 0.5s steps(2, end) infinite;
}
@keyframes cb-pulse-red {
  0%   { filter: brightness(1.0); }
  50%  { filter: brightness(1.3); }
  100% { filter: brightness(1.0); }
}

/* Diagonal grip-stripe i 8-bit-stil for visuell feedback */
.cb-paddle-grip {
  background: repeating-linear-gradient(
    45deg,
    rgba(0, 0, 0, 0.25),
    rgba(0, 0, 0, 0.25) 4px,
    transparent 4px,
    transparent 8px
  );
}
.cb-paddle-top .cb-paddle-grip,
.cb-paddle-bottom .cb-paddle-grip {
  width: 60%;
  height: 6px;
}
.cb-paddle-left .cb-paddle-grip,
.cb-paddle-right .cb-paddle-grip {
  width: 6px;
  height: 60%;
}
</style>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  flipp: { type: Object, required: true },
  // Skjerm-rekt for kart-SVG-en (med pxPerM for viewBox-m → CSS-px)
  mapRect: { type: Object, default: null },
})

// Tykkelse på flipper (perpendikulært til kant), i CSS-piksler.
const PAD_THICKNESS = 35

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

  if (edge === 'top') {
    return {
      top:    `${r.top + insetPx - PAD_THICKNESS}px`,
      left:   `${r.left + padCenter - padLen / 2}px`,
      width:  `${padLen}px`,
      height: `${PAD_THICKNESS}px`,
    }
  }
  if (edge === 'bottom') {
    return {
      top:    `${r.top + r.height - insetPx}px`,
      left:   `${r.left + padCenter - padLen / 2}px`,
      width:  `${padLen}px`,
      height: `${PAD_THICKNESS}px`,
    }
  }
  if (edge === 'left') {
    return {
      top:    `${r.top + padCenter - padLen / 2}px`,
      left:   `${r.left + insetPx - PAD_THICKNESS}px`,
      width:  `${PAD_THICKNESS}px`,
      height: `${padLen}px`,
    }
  }
  return {
    top:    `${r.top + padCenter - padLen / 2}px`,
    left:   `${r.left + r.width - insetPx}px`,
    width:  `${PAD_THICKNESS}px`,
    height: `${padLen}px`,
  }
}

function chargeClass(edge) {
  return `flipp-charge-${props.flipp.flippers[edge].kickLevel}`
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
  const half = f.length / 2
  f.position = Math.max(half, Math.min(1 - half, ds.startPos + delta))
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
  <div v-if="flipp.active.value && mapRect" class="flipp-paddles">
    <div v-for="edge in ['top', 'bottom', 'left', 'right']"
         :key="edge"
         class="flipp-paddle"
         :class="[
           `flipp-paddle-${edge}`,
           chargeClass(edge),
           dragState?.edge === edge && dragState?.movedAsDrag ? 'flipp-paddle-active' : '',
         ]"
         :style="paddleStyle(edge)"
         @pointerdown="onPointerDown(edge, $event)"
         @pointermove="onPointerMove"
         @pointerup="onPointerUp"
         @pointercancel="onPointerUp">
      <div class="flipp-paddle-grip"/>
    </div>
  </div>
</template>

<style scoped>
.flipp-paddles {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 45;
}

.flipp-paddle {
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

.flipp-paddle:active,
.flipp-paddle.flipp-paddle-active {
  cursor: grabbing;
  filter: brightness(1.15);
}

/* Charge stages — kald → varm via kickLevel.
   0 = blå (normal), 1 = gul, 2 = oransj, 3 = rød (max). */
.flipp-charge-0 {
  background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.55), inset 0 0 4px rgba(0,0,0,0.3);
}
.flipp-charge-1 {
  background: linear-gradient(135deg, #fde047 0%, #facc15 100%);
  box-shadow: 0 0 12px rgba(250, 204, 21, 0.75), inset 0 0 4px rgba(0,0,0,0.3);
}
.flipp-charge-2 {
  background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%);
  box-shadow: 0 0 14px rgba(251, 146, 60, 0.85), inset 0 0 4px rgba(0,0,0,0.3);
}
.flipp-charge-3 {
  background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
  box-shadow: 0 0 18px rgba(239, 68, 68, 0.95), inset 0 0 6px rgba(0,0,0,0.4);
  animation: flipp-pulse-red 0.5s steps(2, end) infinite;
}
@keyframes flipp-pulse-red {
  0%   { filter: brightness(1.0); }
  50%  { filter: brightness(1.3); }
  100% { filter: brightness(1.0); }
}

/* Diagonal grip-stripe i 8-bit-stil for visuell feedback */
.flipp-paddle-grip {
  background: repeating-linear-gradient(
    45deg,
    rgba(0, 0, 0, 0.25),
    rgba(0, 0, 0, 0.25) 4px,
    transparent 4px,
    transparent 8px
  );
}
.flipp-paddle-top .flipp-paddle-grip,
.flipp-paddle-bottom .flipp-paddle-grip {
  width: 60%;
  height: 6px;
}
.flipp-paddle-left .flipp-paddle-grip,
.flipp-paddle-right .flipp-paddle-grip {
  width: 6px;
  height: 60%;
}
</style>

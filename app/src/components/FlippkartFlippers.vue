<script setup>
import { ref } from 'vue'

const props = defineProps({
  flipp: { type: Object, required: true },
  // Skjerm-rekt for kart-SVG-en (ikke FlippkartLayer-overlay).
  // Brukes til å posisjonere paddles i CSS-piksler ved hver kant.
  mapRect: { type: Object, default: null },
})

// Tykkelse på flipper (perpendikulært til kant), i CSS-piksler.
// 70px > 60px-kravet: finger dekker ikke hele paddla.
const PAD_THICKNESS = 70

const dragState = ref(null)

function paddleStyle(edge) {
  if (!props.mapRect) return { display: 'none' }
  const r = props.mapRect
  const f = props.flipp.flippers[edge]
  const isHoriz = edge === 'top' || edge === 'bottom'
  const totalLen = isHoriz ? r.width : r.height
  const padLen = totalLen * f.length
  const padCenter = totalLen * f.position

  if (edge === 'top') {
    return {
      top:    `${r.top - PAD_THICKNESS}px`,
      left:   `${r.left + padCenter - padLen / 2}px`,
      width:  `${padLen}px`,
      height: `${PAD_THICKNESS}px`,
    }
  }
  if (edge === 'bottom') {
    return {
      top:    `${r.top + r.height}px`,
      left:   `${r.left + padCenter - padLen / 2}px`,
      width:  `${padLen}px`,
      height: `${PAD_THICKNESS}px`,
    }
  }
  if (edge === 'left') {
    return {
      top:    `${r.top + padCenter - padLen / 2}px`,
      left:   `${r.left - PAD_THICKNESS}px`,
      width:  `${PAD_THICKNESS}px`,
      height: `${padLen}px`,
    }
  }
  // right
  return {
    top:    `${r.top + padCenter - padLen / 2}px`,
    left:   `${r.left + r.width}px`,
    width:  `${PAD_THICKNESS}px`,
    height: `${padLen}px`,
  }
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
  const f = props.flipp.flippers[ds.edge]
  const half = f.length / 2
  f.position = Math.max(half, Math.min(1 - half, ds.startPos + delta))
}

function onPointerUp(e) {
  const ds = dragState.value
  if (ds && ds.pointerId === e.pointerId) {
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    dragState.value = null
  }
}
</script>

<template>
  <div v-if="flipp.active.value && mapRect" class="flipp-paddles">
    <div v-for="edge in ['top', 'bottom', 'left', 'right']"
         :key="edge"
         class="flipp-paddle"
         :class="[`flipp-paddle-${edge}`, dragState?.edge === edge ? 'flipp-paddle-active' : '']"
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
  background: linear-gradient(135deg, #ffe24d 0%, #fb923c 60%, #c2410c 100%);
  border: 2px solid #fff;
  box-shadow:
    0 0 12px rgba(255, 226, 77, 0.55),
    inset 0 0 6px rgba(0, 0, 0, 0.35);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
}

.flipp-paddle:active,
.flipp-paddle.flipp-paddle-active {
  cursor: grabbing;
  background: linear-gradient(135deg, #fff7d0 0%, #ffe24d 60%, #fb923c 100%);
  box-shadow:
    0 0 18px rgba(255, 226, 77, 0.85),
    inset 0 0 8px rgba(0, 0, 0, 0.35);
}

/* Grip-stripe i 8-bit-stil for visuell feedback */
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

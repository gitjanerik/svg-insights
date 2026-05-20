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
const TAP_MOVE_THRESHOLD = 0.005

const dragState = ref(null)

// v8.9.0: Effektiv lengde driver både hitbox (i useCurveBall.js
// handleEdgesForBall) og rendering. Faller tilbake til stored length
// hvis composable ikke eksponerer helperen (defensive — happens hvis
// dette komponentet brukes mot eldre useCurveBall-versjon).
function effLen(edge) {
  return props.flipp.effectiveFlipperLength?.(edge)
    ?? props.flipp.flippers[edge].length
}

function convexRad() {
  return props.flipp.flipperConvexityRad?.() ?? 0
}

function paddleStyle(edge) {
  if (!props.mapRect) return { display: 'none' }
  const r = props.mapRect
  const f = props.flipp.flippers[edge]
  const isHoriz = edge === 'top' || edge === 'bottom'
  const totalLen = isHoriz ? r.width : r.height
  const padLen = totalLen * effLen(edge)
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

// Sagitta i piksler — dybden på paddle-bulgen som ekstenderer ut mot
// banen. Matcher kollisjons-formelen i handleEdgesForBall: ved offset
// (hit−center)/half=±1 tilter normalen med ±convexityRad → arc-sagitta
// = halv-lengde × tan(θ/2).
function sagittaPx(edge) {
  if (!props.mapRect) return 0
  const r = props.mapRect
  const isHoriz = edge === 'top' || edge === 'bottom'
  const totalLen = isHoriz ? r.width : r.height
  const halfPx = totalLen * effLen(edge) * 0.5
  return halfPx * Math.tan(convexRad() / 2)
}

// SVG-path i unit-coords (0..100 x 0..100). preserveAspectRatio="none"
// gjør at vi kan bruke samme viewBox for alle paddler, x og y skaleres
// uavhengig. Sagitta uttrykkes som % av thickness (T) — kontroll-
// punktet skytes ut over 100 (= utenfor SVG-viewBox) for å trekke
// kurven mot banen. SVG-overflow=visible lar bulgen rendres utenfor.
function sagittaPctT(edge) {
  const r = props.mapRect
  if (!r) return 0
  const isHoriz = edge === 'top' || edge === 'bottom'
  const totalLen = isHoriz ? r.width : r.height
  const L = totalLen * effLen(edge)
  const T = padThickness()
  if (T <= 0) return 0
  const sPx = (L / 2) * Math.tan(convexRad() / 2)
  return (sPx / T) * 100
}

// For SVG-path: outer = siden lengst fra banen, inner = treff-flaten
// som bulker mot banen. Quadratic Bezier styrer dybden via Y/X-koord
// utenfor (0..100) som tilsvarer sagitta.
function paddlePath(edge) {
  const s = sagittaPctT(edge)
  if (edge === 'top') {
    // Outer = topp (y=0), inner = bunn (y=100) bulker NED (y=100+s)
    return `M0 0 L100 0 L100 100 Q50 ${100 + s} 0 100 Z`
  }
  if (edge === 'bottom') {
    // Outer = bunn (y=100), inner = topp (y=0) bulker OPP (y=-s)
    return `M0 100 L100 100 L100 0 Q50 ${-s} 0 0 Z`
  }
  if (edge === 'left') {
    // Outer = venstre (x=0), inner = høyre (x=100) bulker HØYRE (x=100+s)
    return `M0 0 L100 0 Q${100 + s} 50 100 100 L0 100 Z`
  }
  // right: outer = høyre (x=100), inner = venstre (x=0) bulker VENSTRE (x=-s)
  return `M100 0 L0 0 Q${-s} 50 0 100 L100 100 Z`
}

// Farge-stops pr kickLevel (matcher de tidligere CSS-gradientene).
// Brukt for SVG <linearGradient>-defs så paddle-pathen kan males med
// samme blå→gul→oransj→rød→lilla-skala.
const GRAD_STOPS = [
  ['#1e3a8a', '#3b82f6'],  // 0 — blå
  ['#fde047', '#facc15'],  // 1 — gul
  ['#fb923c', '#ea580c'],  // 2 — oransj
  ['#ef4444', '#b91c1c'],  // 3 — rød
  ['#c026d3', '#6b21a8'],  // 4 — lilla
]

function gradId(edge, kickLvl) {
  return `cb-grad-${edge}-${kickLvl}`
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
// v8.9.0: clampToHalf bruker effektiv lengde så drag-grensene følger den
// faktiske visuelle bredden — paddle kan dras nærmere kant når den er
// smal (høy energi / høyt level).
function clampToHalf(edge, pos) {
  const half = effLen(edge) / 2
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
  const next = clampToHalf(ds.edge, ds.startPos + delta)
  f.position = next

  const targets = diagonalTargets(ds.edge, next)
  const flips = props.flipp.flippers
  for (const e2 of ['top', 'bottom', 'left', 'right']) {
    if (e2 === ds.edge) continue
    flips[e2].position = clampToHalf(e2, targets[e2])
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
      <svg class="cb-paddle-svg"
           viewBox="0 0 100 100"
           preserveAspectRatio="none">
        <defs>
          <linearGradient :id="gradId(edge, flipp.flippers[edge].kickLevel)" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   :stop-color="GRAD_STOPS[flipp.flippers[edge].kickLevel]?.[0] ?? GRAD_STOPS[0][0]"/>
            <stop offset="100%" :stop-color="GRAD_STOPS[flipp.flippers[edge].kickLevel]?.[1] ?? GRAD_STOPS[0][1]"/>
          </linearGradient>
        </defs>
        <path class="cb-paddle-face"
              :d="paddlePath(edge)"
              :fill="`url(#${gradId(edge, flipp.flippers[edge].kickLevel)})`"/>
      </svg>
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
  cursor: grab;
  /* v8.9.0: SVG-pathen ekstenderer utenfor div-rekt (bulgen) — overflow
     må være visible så pathen ikke klippes. */
  overflow: visible;
  transition: filter 120ms;
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

/* SVG fyller hele paddle-div-en. Pathen bruker preserveAspectRatio="none"
   så viewBox 0..100 strekkes til faktisk W × T. Bulgen ekstenderer
   utenfor takket være overflow: visible. */
.cb-paddle-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

/* Hvit border og glow flyttes til path via stroke + drop-shadow så de
   følger bulgen. Animasjons-keyframes per charge-state lever på path-
   en via class fra forelderen. */
.cb-paddle-face {
  stroke: #fff;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  /* drop-shadow appliseres pr kickLevel under */
}

/* Glow pr charge-stage. Tilsvarer de gamle box-shadow-glowene, men
   som SVG drop-shadow så de følger paddle-formen (inkl. bulgen). */
.cb-charge-0 .cb-paddle-face {
  filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.55));
}
.cb-charge-1 .cb-paddle-face {
  filter: drop-shadow(0 0 12px rgba(250, 204, 21, 0.75));
}
.cb-charge-2 .cb-paddle-face {
  filter: drop-shadow(0 0 14px rgba(251, 146, 60, 0.85));
}
.cb-charge-3 .cb-paddle-face {
  filter: drop-shadow(0 0 18px rgba(239, 68, 68, 0.95));
  animation: cb-pulse-red 0.5s steps(2, end) infinite;
}
.cb-charge-4 .cb-paddle-face {
  filter: drop-shadow(0 0 22px rgba(192, 38, 211, 1.0));
  animation: cb-pulse-purple 0.35s steps(2, end) infinite;
}

@keyframes cb-pulse-red {
  0%   { filter: drop-shadow(0 0 18px rgba(239, 68, 68, 0.95)) brightness(1.0); }
  50%  { filter: drop-shadow(0 0 22px rgba(239, 68, 68, 1.0))  brightness(1.3); }
  100% { filter: drop-shadow(0 0 18px rgba(239, 68, 68, 0.95)) brightness(1.0); }
}
@keyframes cb-pulse-purple {
  0%   { filter: drop-shadow(0 0 22px rgba(192, 38, 211, 1.0)) brightness(1.0) saturate(1.0); }
  50%  { filter: drop-shadow(0 0 28px rgba(192, 38, 211, 1.0)) brightness(1.45) saturate(1.3); }
  100% { filter: drop-shadow(0 0 22px rgba(192, 38, 211, 1.0)) brightness(1.0) saturate(1.0); }
}
</style>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter } from 'vue-router'
import { createFrameGrabber, recordFrames } from '../lib/videoFrameCapture.js'
import { useMotionRecorder } from '../composables/useMotionRecorder.js'
import { detectFaceRegion, findLandmarks } from '../lib/faceLandmarks.js'
import { triangulateLandmarks, deriveProportions } from '../lib/landmarkTriangulation.js'
import { detectAccessories } from '../lib/accessoryDetection.js'
import { buildPortraitModel } from '../lib/portraitModel.js'
import { portraitToSvg } from '../lib/portraitToSvg.js'
import { defaultPalette, pickRandomPalette } from '../lib/portraitPalettes.js'

const router = useRouter()

const videoRef = ref(null)
const stream = ref(null)
const cameraReady = ref(false)

// Faser
const phase = ref('idle')
const progress = ref(0)
const frameCount = ref(0)
const errorMessage = ref('')
const processingStage = ref('')

const motion = useMotionRecorder()

// Capture-output
const capturedFrames = ref([])
const motionSampleCount = ref(0)

// Pipeline-output
const portraitModel = ref(null)
const palette = ref(defaultPalette())

// Diagnostikk
const diagnostics = ref({
  framesWithFace: 0,
  faceCoverageStart: 0,
  faceCoverageEnd: 0,
  landmarksStart: 0,
  landmarksEnd: 0,
  triangulated: 0,
  sweepAngle: 0,
  hasHair: false,
  hasGlasses: false,
  hasBeard: false,
})

// Live ansikts-deteksjon under preview
let liveDetectRaf = null
const liveFaceBox = ref(null)

// Drag-rotasjon
const rotY = ref(0)
const isDragging = ref(false)
let dragStartX = 0
let dragStartRot = 0
let rotRaf = null
let lastInteraction = 0
const IDLE_RESUME_MS = 4000

async function startCamera() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    })
    stream.value = s
    if (videoRef.value) {
      videoRef.value.srcObject = s
      await videoRef.value.play()
      cameraReady.value = true
      startLiveFaceDetection()
    }
  } catch (e) {
    errorMessage.value = 'Fikk ikke tilgang til kameraet. Sjekk tillatelser.'
    phase.value = 'error'
  }
}

function stopCamera() {
  stopLiveFaceDetection()
  stopAutoRotate()
  stream.value?.getTracks().forEach(t => t.stop())
  stream.value = null
  cameraReady.value = false
}

function startLiveFaceDetection() {
  const previewW = 160
  const previewH = 120
  const c = document.createElement('canvas')
  c.width = previewW
  c.height = previewH
  const ctx = c.getContext('2d', { willReadFrequently: true })
  let last = 0
  function tick(now) {
    if (!cameraReady.value || phase.value === 'recording') {
      liveDetectRaf = requestAnimationFrame(tick)
      return
    }
    if (now - last < 200) {
      liveDetectRaf = requestAnimationFrame(tick)
      return
    }
    last = now
    if (!videoRef.value || videoRef.value.readyState < 2) {
      liveDetectRaf = requestAnimationFrame(tick)
      return
    }
    ctx.drawImage(videoRef.value, 0, 0, previewW, previewH)
    const data = ctx.getImageData(0, 0, previewW, previewH)
    liveFaceBox.value = detectFaceRegion(data.data, previewW, previewH)
    liveDetectRaf = requestAnimationFrame(tick)
  }
  liveDetectRaf = requestAnimationFrame(tick)
}

function stopLiveFaceDetection() {
  if (liveDetectRaf !== null) cancelAnimationFrame(liveDetectRaf)
  liveDetectRaf = null
  liveFaceBox.value = null
}

async function handleStart() {
  if (phase.value !== 'idle') return

  await motion.requestPermission()

  phase.value = 'recording'
  progress.value = 0
  frameCount.value = 0

  motion.start()

  const grabber = createFrameGrabber(videoRef.value, { width: 320, height: 240 })

  const frames = await recordFrames({
    grabber,
    durationMs: 3000,
    fps: 15,
    onProgress: (p, count) => {
      progress.value = p
      frameCount.value = count
    },
    // RGBA for første og siste — der vi gjør hudtone-deteksjon
  })

  const motionSamples = motion.stop()

  capturedFrames.value = frames
  motionSampleCount.value = motionSamples.length

  phase.value = 'processing'
  await yieldFrame()

  await runPipeline(frames, motionSamples)

  phase.value = 'result'
  startAutoRotate()
}

async function runPipeline(frames, motionSamples) {
  const N = frames.length
  if (N < 2) {
    diagnostics.value.framesWithFace = 0
    return
  }

  // Stadium 1: ansiktsdeteksjon i første og siste frame
  processingStage.value = 'detecting'
  await yieldFrame()

  const firstFrame = frames[0]
  const lastFrame = frames[N - 1]

  if (!firstFrame.rgba || !lastFrame.rgba) {
    // Fallback: hvis RGBA ikke ble lagret, går vi ikke videre
    return
  }

  const w = firstFrame.width
  const h = firstFrame.height

  const regionStart = detectFaceRegion(firstFrame.rgba, w, h)
  const regionEnd = detectFaceRegion(lastFrame.rgba, w, h)

  diagnostics.value.framesWithFace = (regionStart ? 1 : 0) + (regionEnd ? 1 : 0)
  if (regionStart) diagnostics.value.faceCoverageStart = regionStart.area / (w * h)
  if (regionEnd) diagnostics.value.faceCoverageEnd = regionEnd.area / (w * h)

  if (!regionStart || !regionEnd) return

  // Stadium 2: landemerker i begge
  processingStage.value = 'measuring'
  await yieldFrame()

  const landmarksStart = findLandmarks(firstFrame.rgba, w, h, regionStart)
  const landmarksEnd = findLandmarks(lastFrame.rgba, w, h, regionEnd)

  diagnostics.value.landmarksStart = landmarksStart ? 6 : 0
  diagnostics.value.landmarksEnd = landmarksEnd ? 6 : 0

  if (!landmarksStart || !landmarksEnd) return

  // Stadium 3: triangulering via IMU sveip-vinkel
  const orient = motionSamples.filter(s => s.kind === 'orientation')
  let sweepAngleDeg = 30 // default 30° antakelse hvis IMU mangler
  if (orient.length >= 2) {
    let dGamma = orient[orient.length - 1].gamma - orient[0].gamma
    if (dGamma > 180) dGamma -= 360
    if (dGamma < -180) dGamma += 360
    // Bruk gamma (rotasjon rundt Y-aksen i landscape) eller alpha
    let dAlpha = orient[orient.length - 1].alpha - orient[0].alpha
    if (dAlpha > 180) dAlpha -= 360
    if (dAlpha < -180) dAlpha += 360
    // Velg den med størst magnitude (avhenger av telefonens orientering)
    sweepAngleDeg = Math.max(Math.abs(dGamma), Math.abs(dAlpha))
    if (sweepAngleDeg < 5) sweepAngleDeg = 30 // sikkerhets-fallback
  }
  diagnostics.value.sweepAngle = sweepAngleDeg

  const sweepRad = (sweepAngleDeg * Math.PI) / 180
  const landmarks3D = triangulateLandmarks(landmarksStart, landmarksEnd, sweepRad, w, h)
  diagnostics.value.triangulated = Object.keys(landmarks3D).length

  const proportions = deriveProportions(landmarks3D)
  if (!proportions) return

  // Stadium 4: aksessoir-deteksjon (på første frame)
  processingStage.value = 'composing'
  await yieldFrame()

  const accessories = detectAccessories(firstFrame.rgba, w, h, regionStart, landmarksStart)
  diagnostics.value.hasHair = accessories.hair.hasHair
  diagnostics.value.hasGlasses = accessories.glasses.hasGlasses
  diagnostics.value.hasBeard = accessories.beard.hasBeard

  // Stadium 5: bygg modell. Selve SVG-en rendres reaktivt via rotatedSvg.
  portraitModel.value = buildPortraitModel(proportions, accessories)
  processingStage.value = 'done'
  await yieldFrame()
}

function pickNewPalette() {
  palette.value = pickRandomPalette(palette.value.name)
}

function yieldFrame() {
  return new Promise(r => requestAnimationFrame(() => r()))
}

function reset() {
  stopAutoRotate()
  phase.value = 'idle'
  progress.value = 0
  frameCount.value = 0
  capturedFrames.value = []
  motionSampleCount.value = 0
  portraitModel.value = null
  palette.value = defaultPalette()
  processingStage.value = ''
  errorMessage.value = ''
  rotY.value = 0
  diagnostics.value = {
    framesWithFace: 0,
    faceCoverageStart: 0,
    faceCoverageEnd: 0,
    landmarksStart: 0,
    landmarksEnd: 0,
    triangulated: 0,
    sweepAngle: 0,
    hasHair: false,
    hasGlasses: false,
    hasBeard: false,
  }
}

const recordingLabel = computed(() => {
  const remaining = Math.max(0, 3 - progress.value * 3)
  return remaining.toFixed(1) + ' s'
})

const diagnosticHint = computed(() => {
  const d = diagnostics.value
  if (d.framesWithFace === 0) {
    return 'Fant ikke ansiktet. Hold telefonen så ansiktet er sentrert i ovalen, med god belysning.'
  }
  if (d.framesWithFace < 2) {
    return 'Mistet ansiktet halvveis. Hold det synlig gjennom hele sveipen.'
  }
  if (d.landmarksStart === 0 || d.landmarksEnd === 0) {
    return 'Klarte ikke å finne øyne/nese/munn. Sørg for god belysning og at hele ansiktet er synlig.'
  }
  if (d.triangulated < 4) {
    return 'For få landemerker triangulert. Sveip litt mer (30°) fra venstre til høyre øre.'
  }
  return 'Selvbildet ditt er klart!'
})

const hasResult = computed(() => portraitModel.value !== null)

// Live-rendering av SVG ved rotasjon eller palett-bytte
const rotatedSvg = computed(() => {
  if (!portraitModel.value) return null
  return portraitToSvg({
    model: portraitModel.value,
    rotY: rotY.value,
    viewBoxSize: 400,
    palette: palette.value,
  })
})

function startAutoRotate() {
  stopAutoRotate()
  let last = performance.now()
  lastInteraction = 0
  function loop(now) {
    const dt = (now - last) / 1000
    last = now
    if (!isDragging.value && (lastInteraction === 0 || now - lastInteraction > IDLE_RESUME_MS)) {
      rotY.value += dt * 0.25
    }
    rotRaf = requestAnimationFrame(loop)
  }
  rotRaf = requestAnimationFrame(loop)
}
function stopAutoRotate() {
  if (rotRaf !== null) cancelAnimationFrame(rotRaf)
  rotRaf = null
}

function onPointerDown(e) {
  isDragging.value = true
  dragStartX = e.clientX
  dragStartRot = rotY.value
  e.target.setPointerCapture?.(e.pointerId)
}
function onPointerMove(e) {
  if (!isDragging.value) return
  rotY.value = dragStartRot + (e.clientX - dragStartX) * 0.012
}
function onPointerUp(e) {
  if (!isDragging.value) return
  isDragging.value = false
  lastInteraction = performance.now()
  e.target.releasePointerCapture?.(e.pointerId)
}

function downloadSvg() {
  if (!rotatedSvg.value) return
  const blob = new Blob([rotatedSvg.value], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeName = palette.value.name.toLowerCase().replace(/[^a-z0-9]/g, '-')
  a.download = `digitalt-selvbilde-${safeName}.svg`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

onMounted(() => {
  startCamera()
})

onBeforeUnmount(() => {
  stopCamera()
})
</script>

<template>
  <div class="relative min-h-[100dvh] bg-black text-white overflow-hidden">

    <!-- Kamera-preview -->
    <video
      v-show="phase === 'idle' || phase === 'recording'"
      ref="videoRef"
      class="absolute inset-0 w-full h-full object-cover"
      style="transform: scaleX(-1);"
      playsinline
      muted
    />

    <!-- Topplinje -->
    <div class="absolute top-0 inset-x-0 p-4 flex items-center justify-between z-20">
      <button
        @click="router.push('/')"
        class="px-3 py-1.5 rounded-full bg-black/40 backdrop-blur text-sm border border-white/10"
      >
        ← Hjem
      </button>
      <div class="px-3 py-1.5 rounded-full bg-black/40 backdrop-blur text-xs border border-white/10">
        Digitalt selvbilde
      </div>
    </div>

    <!-- Ansikts-oval-overlay (idle/recording) -->
    <div
      v-if="phase === 'idle' || phase === 'recording'"
      class="absolute inset-0 pointer-events-none flex items-center justify-center z-10"
    >
      <svg viewBox="0 0 320 480" preserveAspectRatio="xMidYMid meet" class="w-full h-full">
        <defs>
          <mask id="face-cutout">
            <rect width="320" height="480" fill="white"/>
            <ellipse cx="160" cy="240" rx="80" ry="105" fill="black"/>
          </mask>
        </defs>
        <rect width="320" height="480" fill="rgba(0,0,0,0.4)" mask="url(#face-cutout)"/>
        <ellipse
          cx="160" cy="240" rx="80" ry="105"
          fill="none"
          :stroke="liveFaceBox ? '#10b981' : 'rgba(255,255,255,0.35)'"
          stroke-width="1.5"
          stroke-dasharray="3 3"
        />
      </svg>
    </div>

    <!-- Live-status-pille -->
    <div
      v-if="phase === 'idle' && cameraReady"
      class="absolute top-20 inset-x-0 flex justify-center z-10 pointer-events-none"
    >
      <div
        class="px-3 py-1 rounded-full text-[11px] backdrop-blur transition-colors"
        :class="liveFaceBox
          ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-200'
          : 'bg-amber-500/15 border border-amber-400/30 text-amber-200'"
      >
        {{ liveFaceBox ? 'Ansikt detektert' : 'Sentrer ansiktet i ovalen' }}
      </div>
    </div>

    <!-- Idle: instruksjon + opptaksknapp -->
    <div
      v-if="phase === 'idle'"
      class="absolute bottom-0 inset-x-0 p-6 z-10 flex flex-col items-center gap-5 bg-gradient-to-t from-black/90 via-black/60 to-transparent"
    >
      <p class="text-center text-sm text-white/75 max-w-xs leading-relaxed">
        Hold telefonen på <strong class="text-white">armlengdes avstand</strong>
        og sveip sakte fra <strong class="text-white">venstre øre til høyre øre</strong>.
        Du blir til en stilisert SVG-figur.
      </p>
      <button
        @click="handleStart"
        :disabled="!liveFaceBox"
        class="w-20 h-20 rounded-full active:scale-95 transition-all flex items-center justify-center
               border-4 disabled:opacity-50 disabled:cursor-not-allowed"
        :class="liveFaceBox
          ? 'bg-emerald-500 border-white/80 shadow-[0_0_40px_rgba(16,185,129,0.5)]'
          : 'bg-zinc-700 border-white/30'"
      >
        <span class="text-white text-xs font-semibold">3 s</span>
      </button>
      <div class="text-[11px] text-white/40">
        Sensor: {{ motion.permissionState === 'granted' ? 'klar' : 'gir tilgang ved start' }}
      </div>
    </div>

    <!-- Recording -->
    <div
      v-if="phase === 'recording'"
      class="absolute bottom-0 inset-x-0 p-6 z-10 flex flex-col items-center gap-4 bg-gradient-to-t from-black/80 to-transparent"
    >
      <div class="text-2xl font-mono text-white/90">{{ recordingLabel }}</div>
      <div class="relative w-20 h-20">
        <svg class="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="4" />
          <circle
            cx="40" cy="40" r="36" fill="none" stroke="#10b981" stroke-width="4"
            stroke-linecap="round"
            :stroke-dasharray="2 * Math.PI * 36"
            :stroke-dashoffset="2 * Math.PI * 36 * (1 - progress)"
            class="transition-[stroke-dashoffset] duration-100"
          />
        </svg>
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="w-5 h-5 rounded-full bg-emerald-500 animate-pulse" />
        </div>
      </div>
      <div class="text-[11px] text-white/50">{{ frameCount }} frames</div>
    </div>

    <!-- Processing -->
    <div
      v-if="phase === 'processing'"
      class="absolute inset-0 z-30 bg-black/85 flex flex-col items-center justify-center gap-6 px-8"
    >
      <div class="w-12 h-12 rounded-full border-2 border-emerald-400/40 border-t-emerald-400 animate-spin" />
      <div class="space-y-2 text-center">
        <div class="flex items-center gap-2 text-sm" :class="processingStage === 'detecting' ? 'text-white' : (processingStage === 'measuring' || processingStage === 'composing' || processingStage === 'done' ? 'text-emerald-300' : 'text-white/40')">
          <span class="w-2 h-2 rounded-full" :class="processingStage === 'detecting' ? 'bg-emerald-400 animate-pulse' : (processingStage === 'measuring' || processingStage === 'composing' || processingStage === 'done' ? 'bg-emerald-400' : 'bg-white/20')"></span>
          Finner ansiktet…
        </div>
        <div class="flex items-center gap-2 text-sm" :class="processingStage === 'measuring' ? 'text-white' : (processingStage === 'composing' || processingStage === 'done' ? 'text-emerald-300' : 'text-white/40')">
          <span class="w-2 h-2 rounded-full" :class="processingStage === 'measuring' ? 'bg-emerald-400 animate-pulse' : (processingStage === 'composing' || processingStage === 'done' ? 'bg-emerald-400' : 'bg-white/20')"></span>
          Måler proporsjoner i 3D…
        </div>
        <div class="flex items-center gap-2 text-sm" :class="processingStage === 'composing' ? 'text-white' : (processingStage === 'done' ? 'text-emerald-300' : 'text-white/40')">
          <span class="w-2 h-2 rounded-full" :class="processingStage === 'composing' ? 'bg-emerald-400 animate-pulse' : (processingStage === 'done' ? 'bg-emerald-400' : 'bg-white/20')"></span>
          Bygger selvbildet…
        </div>
      </div>
    </div>

    <!-- Result -->
    <div
      v-if="phase === 'result'"
      class="absolute inset-0 z-30 bg-black overflow-y-auto"
    >
      <div class="p-6 pt-20 max-w-md mx-auto space-y-5">
        <div class="text-center">
          <h2 class="text-xl font-semibold mb-1">Selvbildet ditt</h2>
          <p class="text-sm text-white/60">{{ diagnosticHint }}</p>
        </div>

        <!-- Portrett-viewer -->
        <div
          v-if="hasResult"
          class="rounded-xl overflow-hidden border border-emerald-400/20 aspect-square relative touch-none select-none"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          v-html="rotatedSvg"
        />

        <!-- Tom-tilstand -->
        <div
          v-else
          class="rounded-xl border border-amber-400/30 bg-amber-950/20 p-5 space-y-3"
        >
          <div class="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-amber-400 shrink-0 mt-0.5"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div class="flex-1">
              <div class="text-amber-200 font-semibold text-sm">Klarte ikke bygge selvbildet</div>
              <div class="text-xs text-amber-100/80 mt-1 leading-relaxed">{{ diagnosticHint }}</div>
            </div>
          </div>
        </div>

        <!-- Aksessoir-funn -->
        <div v-if="hasResult" class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-lg bg-white/5 border border-white/10 p-2">
            <div class="text-[10px] text-white/40 uppercase">Hår</div>
            <div class="text-sm font-mono" :class="diagnostics.hasHair ? 'text-emerald-300' : 'text-white/40'">{{ diagnostics.hasHair ? 'Ja' : 'Nei' }}</div>
          </div>
          <div class="rounded-lg bg-white/5 border border-white/10 p-2">
            <div class="text-[10px] text-white/40 uppercase">Briller</div>
            <div class="text-sm font-mono" :class="diagnostics.hasGlasses ? 'text-emerald-300' : 'text-white/40'">{{ diagnostics.hasGlasses ? 'Ja' : 'Nei' }}</div>
          </div>
          <div class="rounded-lg bg-white/5 border border-white/10 p-2">
            <div class="text-[10px] text-white/40 uppercase">Skjegg</div>
            <div class="text-sm font-mono" :class="diagnostics.hasBeard ? 'text-emerald-300' : 'text-white/40'">{{ diagnostics.hasBeard ? 'Ja' : 'Nei' }}</div>
          </div>
        </div>

        <!-- Palett-rad: tilfeldig-knapp + nåværende navn -->
        <div v-if="hasResult" class="flex items-center gap-3">
          <button
            @click="pickNewPalette"
            class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-fuchsia-500/15 border border-fuchsia-400/30 text-fuchsia-200 active:scale-[0.98] transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <span class="text-sm font-medium">Tilfeldig</span>
          </button>
          <div class="text-xs text-white/50">
            Palett: <span class="text-white/80 font-medium">{{ palette.name }}</span>
          </div>
        </div>

        <!-- Eksport-knapp -->
        <button
          v-if="hasResult"
          @click="downloadSvg"
          class="w-full py-3 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 active:scale-[0.98] transition"
        >
          Last ned SVG
        </button>

        <!-- Diagnose -->
        <details class="rounded-xl bg-white/5 border border-white/10 overflow-hidden" :open="!hasResult">
          <summary class="px-4 py-3 text-sm text-white/70 cursor-pointer flex items-center justify-between list-none">
            <span>Pipeline-diagnose</span>
            <svg class="w-4 h-4 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </summary>
          <div class="px-4 pb-4 pt-1 space-y-1.5 text-xs font-mono text-white/60">
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>Frames fanget</span>
              <span class="text-white">{{ capturedFrames.length }}</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>IMU-samples</span>
              <span :class="motionSampleCount > 0 ? 'text-white' : 'text-amber-400'">{{ motionSampleCount }}</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>Ansikt funnet</span>
              <span :class="diagnostics.framesWithFace === 2 ? 'text-emerald-300' : 'text-amber-400'">{{ diagnostics.framesWithFace }}/2</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>Landemerker (start/slutt)</span>
              <span :class="diagnostics.landmarksStart === 6 && diagnostics.landmarksEnd === 6 ? 'text-white' : 'text-amber-400'">{{ diagnostics.landmarksStart }}/{{ diagnostics.landmarksEnd }}</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>3D-triangulert</span>
              <span :class="diagnostics.triangulated >= 4 ? 'text-white' : 'text-amber-400'">{{ diagnostics.triangulated }}/6</span>
            </div>
            <div class="flex justify-between">
              <span>Sveip-vinkel</span>
              <span :class="diagnostics.sweepAngle > 10 ? 'text-white' : 'text-amber-400'">{{ diagnostics.sweepAngle.toFixed(1) }}°</span>
            </div>
          </div>
        </details>

        <div class="flex gap-3">
          <button
            @click="reset"
            class="flex-1 py-3 rounded-xl bg-white/10 border border-white/15 active:scale-[0.98] transition"
          >
            Ny capture
          </button>
          <button
            @click="router.push('/')"
            class="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 active:scale-[0.98] transition"
          >
            Hjem
          </button>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div
      v-if="phase === 'error'"
      class="absolute inset-0 z-30 bg-black/90 flex flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <p class="text-white/80">{{ errorMessage }}</p>
      <button
        @click="router.push('/')"
        class="px-4 py-2 rounded-xl bg-white/10 border border-white/15"
      >
        Tilbake
      </button>
    </div>
  </div>
</template>

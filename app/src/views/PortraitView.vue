<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter } from 'vue-router'
import { createFrameGrabber, recordFrames } from '../lib/videoFrameCapture.js'
import { useMotionRecorder } from '../composables/useMotionRecorder.js'
import { detectFaceRegion, findLandmarks } from '../lib/faceLandmarks.js'
import { proportionsFrom2D, medianLandmarks } from '../lib/landmarkTriangulation.js'
import { detectAccessories } from '../lib/accessoryDetection.js'
import { buildHeadMesh, buildHairMesh } from '../lib/headMesh.js'
import { meshToSvg } from '../lib/meshToSvg.js'
import { defaultPalette, pickRandomPalette } from '../lib/portraitPalettes.js'

const router = useRouter()

const videoRef = ref(null)
const stream = ref(null)
const cameraReady = ref(false)

const phase = ref('idle')
const captureProgress = ref(0)        // 0..1 under selve burst-en (~500ms)
const autoTriggerProgress = ref(0)    // 0..1 under 1.5s sentrerings-countdown
const frameCount = ref(0)
const errorMessage = ref('')
const processingStage = ref('')

const motion = useMotionRecorder()
const motionSampleCount = ref(0)

const headMesh = ref(null)
const hairMesh = ref(null)
const accessoriesData = ref(null)
const palette = ref(defaultPalette())

// Render-modus: 'wireframe' | 'shaded' | 'both'
const renderMode = ref('both')
const RENDER_MODES = ['wireframe', 'shaded', 'both']
const RENDER_MODE_LABELS = {
  wireframe: 'Trådramme',
  shaded: 'Skyggelagt',
  both: 'Begge',
}
function cycleRenderMode() {
  const idx = RENDER_MODES.indexOf(renderMode.value)
  renderMode.value = RENDER_MODES[(idx + 1) % RENDER_MODES.length]
}

const diagnostics = ref({
  framesCaptured: 0,
  framesWithFace: 0,
  framesWithLandmarks: 0,
  bestFrameIndex: -1,
})

let liveDetectRaf = null
const liveFaceBox = ref(null)

// Auto-trigger: 1.5s sammenhengende ansikts-deteksjon → fyrer av capture
const AUTO_TRIGGER_MS = 1500
let faceStableSince = 0
let autoTriggerCheckRaf = null

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
      startAutoTriggerCheck()
    }
  } catch (e) {
    errorMessage.value = 'Fikk ikke tilgang til kameraet. Sjekk tillatelser.'
    phase.value = 'error'
  }
}

function stopCamera() {
  stopLiveFaceDetection()
  stopAutoTriggerCheck()
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
    if (!cameraReady.value || phase.value !== 'idle') {
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

function startAutoTriggerCheck() {
  faceStableSince = 0
  function tick(now) {
    if (phase.value !== 'idle') {
      autoTriggerProgress.value = 0
      faceStableSince = 0
      autoTriggerCheckRaf = requestAnimationFrame(tick)
      return
    }
    if (liveFaceBox.value) {
      if (faceStableSince === 0) faceStableSince = now
      const elapsed = now - faceStableSince
      autoTriggerProgress.value = Math.min(1, elapsed / AUTO_TRIGGER_MS)
      if (elapsed >= AUTO_TRIGGER_MS) {
        autoTriggerProgress.value = 0
        faceStableSince = 0
        handleStart()
        return
      }
    } else {
      autoTriggerProgress.value = 0
      faceStableSince = 0
    }
    autoTriggerCheckRaf = requestAnimationFrame(tick)
  }
  autoTriggerCheckRaf = requestAnimationFrame(tick)
}

function stopAutoTriggerCheck() {
  if (autoTriggerCheckRaf !== null) cancelAnimationFrame(autoTriggerCheckRaf)
  autoTriggerCheckRaf = null
  autoTriggerProgress.value = 0
  faceStableSince = 0
}

async function handleStart() {
  if (phase.value !== 'idle') return

  // Sensor-permission: hyggelig å ha for diagnose, ikke nødvendig for pipelinen
  await motion.requestPermission()

  phase.value = 'recording'
  captureProgress.value = 0
  frameCount.value = 0

  motion.start()

  const grabber = createFrameGrabber(videoRef.value, { width: 320, height: 240 })

  // 5 frames over ~500ms — alle med RGBA siden vi gjør hudtone-deteksjon på alle
  const frames = await recordFrames({
    grabber,
    durationMs: 500,
    fps: 10,
    rgbaFrames: [0, 1, 2, 3, 4],
    onProgress: (p, count) => {
      captureProgress.value = p
      frameCount.value = count
    },
  })

  const motionSamples = motion.stop()
  motionSampleCount.value = motionSamples.length

  diagnostics.value.framesCaptured = frames.length

  phase.value = 'processing'
  await yieldFrame()

  await runPipeline(frames)

  phase.value = 'result'
  startAutoRotate()
}

async function runPipeline(frames) {
  // Stadium 1: ansikts-deteksjon på alle frames
  processingStage.value = 'detecting'
  await yieldFrame()

  const detections = frames.map(f => f.rgba ? detectFaceRegion(f.rgba, f.width, f.height) : null)
  diagnostics.value.framesWithFace = detections.filter(r => r !== null).length

  // Velg beste frame: største ansikts-areal
  let bestIdx = -1
  let bestArea = 0
  for (let i = 0; i < detections.length; i++) {
    if (detections[i] && detections[i].area > bestArea) {
      bestArea = detections[i].area
      bestIdx = i
    }
  }
  diagnostics.value.bestFrameIndex = bestIdx
  if (bestIdx === -1) return

  // Stadium 2: landemerker på alle frames der ansikt ble detektert
  processingStage.value = 'measuring'
  await yieldFrame()

  const landmarksPerFrame = frames.map((f, i) => {
    if (!detections[i] || !f.rgba) return null
    return findLandmarks(f.rgba, f.width, f.height, detections[i])
  })
  diagnostics.value.framesWithLandmarks = landmarksPerFrame.filter(l => l !== null).length

  // Median av landemerke-posisjoner reduserer støy fra én-frames mis-deteksjon
  const landmarks = medianLandmarks(landmarksPerFrame)
  if (!landmarks) return

  // Stadium 3: 2D-proporsjoner med mal-Z (ingen triangulering)
  const proportions = proportionsFrom2D(landmarks)
  if (!proportions) return

  // Stadium 4: aksessoir-deteksjon på beste frame
  processingStage.value = 'composing'
  await yieldFrame()

  const bestFrame = frames[bestIdx]
  const accessories = detectAccessories(
    bestFrame.rgba, bestFrame.width, bestFrame.height,
    detections[bestIdx], landmarks
  )
  accessoriesData.value = accessories

  // Stadium 5: bygg 3D-mesh deformert av proporsjonene
  headMesh.value = buildHeadMesh(proportions)
  hairMesh.value = buildHairMesh(headMesh.value, accessories.hair)
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
  captureProgress.value = 0
  autoTriggerProgress.value = 0
  frameCount.value = 0
  motionSampleCount.value = 0
  headMesh.value = null
  hairMesh.value = null
  accessoriesData.value = null
  palette.value = defaultPalette()
  renderMode.value = 'both'
  processingStage.value = ''
  errorMessage.value = ''
  rotY.value = 0
  faceStableSince = 0
  diagnostics.value = {
    framesCaptured: 0,
    framesWithFace: 0,
    framesWithLandmarks: 0,
    bestFrameIndex: -1,
  }
}

const diagnosticHint = computed(() => {
  const d = diagnostics.value
  if (d.framesWithFace === 0) {
    return 'Fant ikke ansiktet i noen frames. Pek mot mer lys, eller hold telefonen så ansiktet sentreres i ovalen.'
  }
  if (d.framesWithLandmarks === 0) {
    return 'Fant ansiktet, men ikke landemerker. Sørg for at hele ansiktet er synlig (ikke skjult av hånd e.l.).'
  }
  return 'Selvbildet ditt er klart!'
})

const hasResult = computed(() => headMesh.value !== null)

const rotatedSvg = computed(() => {
  if (!headMesh.value) return null
  return meshToSvg({
    mesh: headMesh.value,
    hair: hairMesh.value,
    glasses: accessoriesData.value?.glasses,
    beard: accessoriesData.value?.beard,
    rotY: rotY.value,
    viewBoxSize: 400,
    palette: palette.value,
    mode: renderMode.value,
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

    <!-- Ansikts-oval-overlay -->
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
        <!-- Auto-trigger progress: ring rundt ovalen som fylles 0..1 over 1.5s -->
        <ellipse
          v-if="phase === 'idle' && autoTriggerProgress > 0"
          cx="160" cy="240" rx="80" ry="105"
          fill="none"
          stroke="#10b981"
          stroke-width="3"
          :stroke-dasharray="2 * Math.PI * Math.sqrt((80*80 + 105*105) / 2)"
          :stroke-dashoffset="2 * Math.PI * Math.sqrt((80*80 + 105*105) / 2) * (1 - autoTriggerProgress)"
          stroke-linecap="round"
          style="transform-origin: 160px 240px; transform: rotate(-90deg);"
        />
      </svg>
    </div>

    <!-- Live status-pille -->
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
        <template v-if="!liveFaceBox">Sentrer ansiktet i ovalen</template>
        <template v-else-if="autoTriggerProgress > 0 && autoTriggerProgress < 1">
          Hold stille… tar bilde om {{ ((1 - autoTriggerProgress) * 1.5).toFixed(1) }} s
        </template>
        <template v-else>Ansikt detektert — tap eller hold stille</template>
      </div>
    </div>

    <!-- Idle-bunn: instruksjon + manuell knapp -->
    <div
      v-if="phase === 'idle'"
      class="absolute bottom-0 inset-x-0 p-6 z-10 flex flex-col items-center gap-5 bg-gradient-to-t from-black/90 via-black/60 to-transparent"
    >
      <p class="text-center text-sm text-white/75 max-w-xs leading-relaxed">
        Hold telefonen og <strong class="text-white">se mot kameraet</strong>.
        Bildet tas automatisk når ansiktet ditt er sentrert.
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
        <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </button>
    </div>

    <!-- Recording: lite flash + frame-teller -->
    <div
      v-if="phase === 'recording'"
      class="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
    >
      <div
        class="absolute inset-0 bg-white transition-opacity"
        :style="{ opacity: 0.35 + 0.4 * captureProgress }"
      />
      <div class="relative z-10 text-2xl font-mono text-white/90 drop-shadow">{{ frameCount }} / 5</div>
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
          Måler proporsjoner…
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

        <div
          v-if="hasResult"
          class="rounded-xl overflow-hidden border border-emerald-400/20 aspect-square relative touch-none select-none"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          v-html="rotatedSvg"
        />

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

        <!-- Modus-toggle -->
        <div v-if="hasResult" class="grid grid-cols-3 gap-2">
          <button
            v-for="m in RENDER_MODES"
            :key="m"
            @click="renderMode = m"
            class="py-2.5 rounded-xl border text-sm transition active:scale-[0.98]"
            :class="renderMode === m
              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-100'
              : 'bg-white/5 border-white/10 text-white/60'"
          >
            {{ RENDER_MODE_LABELS[m] }}
          </button>
        </div>

        <!-- Palett-rad -->
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

        <button
          v-if="hasResult"
          @click="downloadSvg"
          class="w-full py-3 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 active:scale-[0.98] transition"
        >
          Last ned SVG
        </button>

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
              <span class="text-white">{{ diagnostics.framesCaptured }}</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>Ansikt funnet</span>
              <span :class="diagnostics.framesWithFace > 0 ? 'text-white' : 'text-amber-400'">{{ diagnostics.framesWithFace }}/{{ diagnostics.framesCaptured }}</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>Landemerker</span>
              <span :class="diagnostics.framesWithLandmarks > 0 ? 'text-white' : 'text-amber-400'">{{ diagnostics.framesWithLandmarks }}/{{ diagnostics.framesCaptured }}</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>Beste frame</span>
              <span :class="diagnostics.bestFrameIndex >= 0 ? 'text-white' : 'text-amber-400'">#{{ diagnostics.bestFrameIndex >= 0 ? diagnostics.bestFrameIndex + 1 : '–' }}</span>
            </div>
            <div class="flex justify-between">
              <span>IMU-samples</span>
              <span :class="motionSampleCount > 0 ? 'text-white' : 'text-white/40'">{{ motionSampleCount }}</span>
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

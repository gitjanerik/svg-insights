<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter } from 'vue-router'
import { createFrameGrabber, recordFrames } from '../lib/videoFrameCapture.js'
import { useMotionRecorder } from '../composables/useMotionRecorder.js'
import { detectFeatures } from '../lib/featureDetection.js'
import { buildTracks } from '../lib/opticalFlow.js'
import { buildFramePoses, estimateTranslationDirection } from '../lib/motionFusion.js'
import { defaultIntrinsics, triangulateTracks } from '../lib/triangulation.js'
import { buildWireframe, distance3D } from '../lib/wireframeBuilder.js'
import { wireframeToSvg } from '../lib/wireframeToSvg.js'

const router = useRouter()

const videoRef = ref(null)
const stream = ref(null)
const cameraReady = ref(false)

// Faser: 'idle' → 'recording' → 'processing' → 'result' | 'error'
const phase = ref('idle')
const progress = ref(0)
const frameCount = ref(0)
const errorMessage = ref('')
const processingStage = ref('') // 'features' | 'tracking' | 'reconstructing' | 'done'

const motion = useMotionRecorder()

// Etter opptak:
const capturedFrames = ref([])
const motionSampleCount = ref(0)

// Fase 2-output:
const initialFeatures = ref([])
const tracks = ref([])  // [{ id, points: [{frame, x, y}], alive }]

// Fase 3-output:
const points3D = ref([])  // [{ trackId, point: {X, Y, Z}, depth }]
const sceneCenter = ref({ X: 0, Y: 0, Z: 0 })
const sceneScale = ref(1)

// Fase 4: trådramme + interaktivitet
const edges = ref([])  // [{ a, b, length }]
const calibrationMode = ref(false)
const calibrationPicks = ref([])  // indekser i points3D
const scaleFactor = ref(null)  // meter pr enhet (null = ukalibrert)
const showCalibrationDialog = ref(false)
const calibrationInput = ref('')

// Pipeline-diagnostikk: tellinger pr stadium, slik at vi kan se hvor det
// stoppet hvis 0 punkter blir igjen.
const diagnostics = ref({
  featuresDetected: 0,
  tracksAlive: 0,
  tracksWithEnoughObs: 0,
  triangulatedRaw: 0,
  finitePoints: 0,
  pointsAfterFilter: 0,
  flowMagnitude: 0,
})

// Live tilt-overlay basert på sensorenes siste sample (gjenbruker
// motion-recorder-logikken for samplemønster, men her bruker vi en lett
// orientation-listener kun for visuell feedback under opptak)
const tiltX = ref(0)
const tiltY = ref(0)
let liveOrientHandler = null

async function startCamera() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
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
    }
  } catch (e) {
    errorMessage.value = 'Fikk ikke tilgang til kameraet. Sjekk tillatelser.'
    phase.value = 'error'
  }
}

function stopCamera() {
  stream.value?.getTracks().forEach(t => t.stop())
  stream.value = null
  cameraReady.value = false
}

function attachLiveOrientation() {
  liveOrientHandler = (e) => {
    // gamma = venstre-høyre tilt (-90..90), beta = forover-bakover (-180..180)
    tiltX.value = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 30))
    tiltY.value = Math.max(-1, Math.min(1, ((e.beta ?? 0) - 60) / 30))
  }
  window.addEventListener('deviceorientation', liveOrientHandler)
}

function detachLiveOrientation() {
  if (liveOrientHandler) {
    window.removeEventListener('deviceorientation', liveOrientHandler)
    liveOrientHandler = null
  }
}

async function handleStart() {
  if (phase.value !== 'idle') return

  // Be om sensor-tilgang i samme brukergeste som starter opptaket
  await motion.requestPermission()
  attachLiveOrientation()

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
  })

  const motionSamples = motion.stop()
  detachLiveOrientation()

  capturedFrames.value = frames
  motionSampleCount.value = motionSamples.length

  phase.value = 'processing'

  // La UI få male før vi kjører tunge ops
  await nextTick()

  // 1) Feature-deteksjon i frame 0
  processingStage.value = 'features'
  await yieldFrame()
  const f0 = frames[0]
  initialFeatures.value = detectFeatures(f0.luma, f0.width, f0.height, {
    maxFeatures: 200,
    nmsRadius: 6,
    margin: 8,
  })
  diagnostics.value.featuresDetected = initialFeatures.value.length

  // 2) Track gjennom alle frames
  processingStage.value = 'tracking'
  await yieldFrame()
  tracks.value = buildTracks(frames, initialFeatures.value, {
    patchRadius: 5,
    maxIter: 4,
  })
  diagnostics.value.tracksAlive = tracks.value.filter(t => t.alive).length
  diagnostics.value.tracksWithEnoughObs = tracks.value.filter(t => t.points.length >= 5).length

  // 3) Pose-rekonstruksjon + triangulering
  processingStage.value = 'reconstructing'
  await yieldFrame()

  const poses = buildFramePoses(frames, motionSamples)
  const tDir = estimateTranslationDirection(tracks.value)
  diagnostics.value.flowMagnitude = tDir.magnitude

  // Lineært økende translasjon over frames (i unit-skala)
  const N = frames.length
  poses.forEach((p, i) => {
    const s = N > 1 ? i / (N - 1) : 0
    p.t = [tDir.x * s, tDir.y * s, tDir.z * s]
  })

  const K = defaultIntrinsics(frames[0].width, frames[0].height)
  const triangulated = triangulateTracks(tracks.value, poses, K, { minObservations: 5 })
  diagnostics.value.triangulatedRaw = triangulated.length

  // Filtrer ut ikke-finite og bak-kamera-punkter først
  const finite = triangulated.filter(r =>
    isFinite(r.point.X) && isFinite(r.point.Y) && isFinite(r.point.Z) && r.point.Z > 0
  )
  diagnostics.value.finitePoints = finite.length

  // Median-relativt dybde-filter — adapterer seg til faktisk skala uansett
  // hvilken unit-translasjon vi brukte. Beholder punkter mellom 0.2× og 5× medianen.
  let valid = finite
  if (finite.length >= 4) {
    const zs = finite.map(r => r.point.Z).sort((a, b) => a - b)
    const medZ = zs[Math.floor(zs.length / 2)]
    if (medZ > 0) {
      valid = finite.filter(r => r.point.Z >= medZ * 0.2 && r.point.Z <= medZ * 5)
    }
  }
  diagnostics.value.pointsAfterFilter = valid.length

  if (valid.length > 0) {
    const cx = valid.reduce((s, r) => s + r.point.X, 0) / valid.length
    const cy = valid.reduce((s, r) => s + r.point.Y, 0) / valid.length
    const cz = valid.reduce((s, r) => s + r.point.Z, 0) / valid.length
    sceneCenter.value = { X: cx, Y: cy, Z: cz }

    // Skalering: median avstand fra senter
    const distances = valid.map(r =>
      Math.hypot(r.point.X - cx, r.point.Y - cy, r.point.Z - cz)
    ).sort((a, b) => a - b)
    const median = distances[Math.floor(distances.length / 2)]
    sceneScale.value = median > 0.001 ? 1 / median : 1
  }

  points3D.value = valid

  // Bygg trådramme (k-NN-kanter mellom 3D-punkter)
  edges.value = buildWireframe(valid.map(v => v.point), {
    k: 5,
    maxEdgeFactor: 1.8,
  })

  processingStage.value = 'done'
  await yieldFrame()
  phase.value = 'result'
  startAutoRotate()
}

function yieldFrame() {
  return new Promise(r => requestAnimationFrame(() => r()))
}

function nextTick() {
  return new Promise(r => requestAnimationFrame(() => r()))
}

function reset() {
  stopAutoRotate()
  phase.value = 'idle'
  progress.value = 0
  frameCount.value = 0
  capturedFrames.value = []
  motionSampleCount.value = 0
  initialFeatures.value = []
  tracks.value = []
  points3D.value = []
  edges.value = []
  calibrationMode.value = false
  calibrationPicks.value = []
  scaleFactor.value = null
  showCalibrationDialog.value = false
  calibrationInput.value = ''
  processingStage.value = ''
  errorMessage.value = ''
  rotY.value = 0
  diagnostics.value = {
    featuresDetected: 0,
    tracksAlive: 0,
    tracksWithEnoughObs: 0,
    triangulatedRaw: 0,
    finitePoints: 0,
    pointsAfterFilter: 0,
    flowMagnitude: 0,
  }
}

// Heuristisk diagnose-melding når 0 punkter ble rekonstruert
const diagnosticHint = computed(() => {
  const d = diagnostics.value
  if (d.featuresDetected === 0) {
    return 'Ingen features funnet i første frame. Pek mot et område med tydelige detaljer (mønster, bokhylle, vindu) i stedet for en blank vegg.'
  }
  if (d.tracksAlive < 10) {
    return 'For få spor overlevde gjennom opptaket. Telefonen beveget seg trolig for raskt eller scenen er for ensfarget.'
  }
  if (d.tracksWithEnoughObs < 5) {
    return 'Sporene var for korte. Hold telefonen mer stabilt — sakte sidelengs-bevegelse, ikke rykk.'
  }
  if (d.flowMagnitude < 5) {
    return 'For lite parallakse — gå minst 0,5–1 m sidelengs mens du peker mot scenen. Bare å rotere håndleddet er ikke nok.'
  }
  if (d.triangulatedRaw === 0) {
    return 'Triangulering feilet. Bevegelsen var sannsynligvis dominert av rotasjon i stedet for translasjon.'
  }
  return 'Punktene havnet utenfor gyldig dybde-område. Prøv en ny sekvens med klarere parallakse.'
})

// 3D-rotasjon for visning — drag overstyrer auto-rotasjon, idle-resume etter 5 sek
const rotY = ref(0)
let rotRaf = null
let lastInteraction = 0
const IDLE_RESUME_MS = 5000

function startAutoRotate() {
  stopAutoRotate()
  let last = performance.now()
  lastInteraction = 0
  function loop(now) {
    const dt = (now - last) / 1000
    last = now
    if (!isDragging.value && (lastInteraction === 0 || now - lastInteraction > IDLE_RESUME_MS)) {
      rotY.value += dt * 0.35
    }
    rotRaf = requestAnimationFrame(loop)
  }
  rotRaf = requestAnimationFrame(loop)
}
function stopAutoRotate() {
  if (rotRaf !== null) cancelAnimationFrame(rotRaf)
  rotRaf = null
}

// Drag-rotasjon
const isDragging = ref(false)
let dragStartX = 0
let dragStartRot = 0
function onPointerDown(e) {
  if (calibrationMode.value) return // tap-håndtering tar over
  isDragging.value = true
  dragStartX = e.clientX
  dragStartRot = rotY.value
  e.target.setPointerCapture?.(e.pointerId)
}
function onPointerMove(e) {
  if (!isDragging.value) return
  const dx = e.clientX - dragStartX
  rotY.value = dragStartRot + dx * 0.012
}
function onPointerUp(e) {
  if (!isDragging.value) return
  isDragging.value = false
  lastInteraction = performance.now()
  e.target.releasePointerCapture?.(e.pointerId)
}

// Projiser 3D-punkter til 2D for SVG-rendering.
// Y-akse-rotasjon (rundt vertikalen) gir hologram-effekten.
const VIEWBOX_SIZE = 200
const projectedPoints = computed(() => {
  if (!points3D.value.length) return []
  const cx = sceneCenter.value.X
  const cy = sceneCenter.value.Y
  const cz = sceneCenter.value.Z
  const scale = sceneScale.value
  const c = Math.cos(rotY.value)
  const s = Math.sin(rotY.value)

  const HALF = VIEWBOX_SIZE / 2
  const DISPLAY = 70

  return points3D.value.map((r, i) => {
    const dx = (r.point.X - cx) * scale
    const dy = (r.point.Y - cy) * scale
    const dz = (r.point.Z - cz) * scale
    const xr = dx * c - dz * s
    const zr = dx * s + dz * c
    return {
      id: r.trackId,
      index: i,
      x: HALF + xr * DISPLAY,
      y: HALF + dy * DISPLAY,
      depth: zr,
    }
  })
})

// Kanter projiserts ved hjelp av punkt-indekser
const projectedEdges = computed(() => {
  if (!edges.value.length || !projectedPoints.value.length) return []
  const pts = projectedPoints.value
  return edges.value.map(e => ({
    a: pts[e.a],
    b: pts[e.b],
    avgDepth: (pts[e.a].depth + pts[e.b].depth) / 2,
  })).filter(e => e.a && e.b)
})

// Skala-kalibrering: bruker tapper to punkter, oppgir fysisk avstand
function pickPoint(p) {
  if (!calibrationMode.value) return
  if (calibrationPicks.value.includes(p.index)) return
  calibrationPicks.value.push(p.index)
  if (calibrationPicks.value.length === 2) {
    showCalibrationDialog.value = true
    calibrationInput.value = ''
  }
}

function applyCalibration() {
  const meters = parseFloat(calibrationInput.value.replace(',', '.'))
  if (!isFinite(meters) || meters <= 0) {
    showCalibrationDialog.value = false
    calibrationPicks.value = []
    calibrationMode.value = false
    return
  }
  const [iA, iB] = calibrationPicks.value
  const pA = points3D.value[iA].point
  const pB = points3D.value[iB].point
  const sceneDist = distance3D(pA, pB)
  if (sceneDist > 0) {
    scaleFactor.value = meters / sceneDist
  }
  showCalibrationDialog.value = false
  calibrationPicks.value = []
  calibrationMode.value = false
}

function cancelCalibration() {
  showCalibrationDialog.value = false
  calibrationPicks.value = []
  calibrationMode.value = false
}

const sceneExtent = computed(() => {
  if (!points3D.value.length) return { x: 0, y: 0, z: 0 }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const r of points3D.value) {
    const p = r.point
    if (p.X < minX) minX = p.X; if (p.X > maxX) maxX = p.X
    if (p.Y < minY) minY = p.Y; if (p.Y > maxY) maxY = p.Y
    if (p.Z < minZ) minZ = p.Z; if (p.Z > maxZ) maxZ = p.Z
  }
  const f = scaleFactor.value ?? 1
  return {
    x: (maxX - minX) * f,
    y: (maxY - minY) * f,
    z: (maxZ - minZ) * f,
  }
})

// SVG-eksport: bygg trådramme-SVG fra nåværende rotasjon og last ned
function exportSvg(animated = false) {
  const svgString = wireframeToSvg({
    points: points3D.value.map(r => r.point),
    edges: edges.value,
    rotY: rotY.value,
    background: '#0a0f0d',
    pointColor: '#10b981',
    edgeColor: '#34d399',
    animateRotation: animated,
    scaleCalibration: scaleFactor.value ? { factorMeters: scaleFactor.value } : null,
  })
  if (!svgString) return
  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = animated ? 'romskan-roterende.svg' : 'romskan.svg'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const trackingStats = computed(() => {
  const total = initialFeatures.value.length
  const alive = tracks.value.filter(t => t.alive).length
  const fullLength = tracks.value.length
    ? Math.max(...tracks.value.map(t => t.points.length))
    : 0
  const avgLength = tracks.value.length
    ? tracks.value.reduce((s, t) => s + t.points.length, 0) / tracks.value.length
    : 0
  return { total, alive, fullLength, avgLength: avgLength.toFixed(1) }
})

const recordingLabel = computed(() => {
  const remaining = Math.max(0, 3 - progress.value * 3)
  return remaining.toFixed(1) + ' s'
})

onMounted(() => {
  startCamera()
})

onBeforeUnmount(() => {
  stopCamera()
  detachLiveOrientation()
  stopAutoRotate()
})
</script>

<template>
  <div class="relative min-h-[100dvh] bg-black text-white overflow-hidden">

    <!-- Kamera-preview (vises i idle og recording-fasen) -->
    <video
      v-show="phase === 'idle' || phase === 'recording'"
      ref="videoRef"
      class="absolute inset-0 w-full h-full object-cover"
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
        Skann rommet
      </div>
    </div>

    <!-- Live vater-overlay (vises i idle/recording) -->
    <div
      v-if="phase === 'idle' || phase === 'recording'"
      class="absolute top-20 inset-x-0 flex justify-center z-10 pointer-events-none"
    >
      <div class="relative w-48 h-12 rounded-full bg-black/30 backdrop-blur border border-white/10">
        <div
          class="absolute top-1/2 left-1/2 w-32 h-0.5 bg-violet-300 origin-center transition-transform"
          :style="{
            transform: `translate(-50%, -50%) rotate(${tiltX * 25}deg) translateY(${tiltY * 8}px)`
          }"
        />
        <div class="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-white/60 -translate-x-1/2 -translate-y-1/2" />
      </div>
    </div>

    <!-- Idle: instruksjon + opptaksknapp -->
    <div
      v-if="phase === 'idle'"
      class="absolute bottom-0 inset-x-0 p-6 z-10 flex flex-col items-center gap-6 bg-gradient-to-t from-black/80 to-transparent"
    >
      <p class="text-center text-sm text-white/70 max-w-xs leading-relaxed">
        Hold telefonen oppreist og <strong class="text-white">gå sakte sidelengs</strong>
        ca. 1 meter mens du peker mot objektet du vil skanne.
      </p>
      <button
        @click="handleStart"
        class="w-20 h-20 rounded-full bg-red-500 active:bg-red-600 active:scale-95
               border-4 border-white/80 shadow-[0_0_40px_rgba(239,68,68,0.5)]
               transition-all flex items-center justify-center"
      >
        <span class="text-white text-xs font-semibold">3 s</span>
      </button>
      <div class="text-[11px] text-white/40">
        Sensor: {{ motion.permissionState === 'granted' ? 'klar' : 'gir tilgang ved start' }}
      </div>
    </div>

    <!-- Recording: progressring + countdown -->
    <div
      v-if="phase === 'recording'"
      class="absolute bottom-0 inset-x-0 p-6 z-10 flex flex-col items-center gap-4 bg-gradient-to-t from-black/80 to-transparent"
    >
      <div class="text-2xl font-mono text-white/90">{{ recordingLabel }}</div>
      <div class="relative w-20 h-20">
        <svg class="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="4" />
          <circle
            cx="40" cy="40" r="36" fill="none" stroke="#ef4444" stroke-width="4"
            stroke-linecap="round"
            :stroke-dasharray="2 * Math.PI * 36"
            :stroke-dashoffset="2 * Math.PI * 36 * (1 - progress)"
            class="transition-[stroke-dashoffset] duration-100"
          />
        </svg>
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="w-6 h-6 rounded-sm bg-red-500 animate-pulse" />
        </div>
      </div>
      <div class="text-[11px] text-white/50">{{ frameCount }} frames fanget</div>
    </div>

    <!-- Processing: stadie-statustekst -->
    <div
      v-if="phase === 'processing'"
      class="absolute inset-0 z-30 bg-black/85 flex flex-col items-center justify-center gap-6 px-8"
    >
      <div class="w-12 h-12 rounded-full border-2 border-violet-400/40 border-t-violet-400 animate-spin" />
      <div class="space-y-2 text-center">
        <div
          class="flex items-center gap-2 text-sm"
          :class="processingStage === 'features' ? 'text-white' : 'text-white/40'"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="
              processingStage === 'features' ? 'bg-violet-400 animate-pulse' :
              processingStage === 'tracking' || processingStage === 'reconstructing' || processingStage === 'done' ? 'bg-emerald-400' :
              'bg-white/20'
            "
          ></span>
          Sporer punkter…
        </div>
        <div
          class="flex items-center gap-2 text-sm"
          :class="processingStage === 'tracking' ? 'text-white' : 'text-white/40'"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="
              processingStage === 'tracking' ? 'bg-violet-400 animate-pulse' :
              processingStage === 'reconstructing' || processingStage === 'done' ? 'bg-emerald-400' :
              'bg-white/20'
            "
          ></span>
          Følger bevegelse mellom frames…
        </div>
        <div
          class="flex items-center gap-2 text-sm"
          :class="processingStage === 'reconstructing' ? 'text-white' : 'text-white/40'"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="
              processingStage === 'reconstructing' ? 'bg-violet-400 animate-pulse' :
              processingStage === 'done' ? 'bg-emerald-400' :
              'bg-white/20'
            "
          ></span>
          Trianguler 3D-punkter…
        </div>
      </div>
    </div>

    <!-- Result: 3D-trådramme med interaktiv rotasjon -->
    <div
      v-if="phase === 'result'"
      class="absolute inset-0 z-30 bg-black overflow-y-auto"
    >
      <div class="p-6 pt-20 max-w-md mx-auto space-y-5">
        <div class="text-center">
          <h2 class="text-xl font-semibold mb-1">3D-trådramme</h2>
          <p class="text-sm text-white/60">
            {{ points3D.length }} punkter · {{ edges.length }} kanter
          </p>
        </div>

        <!-- Tom-tilstand: vis diagnose-hint i stedet for tom hologram -->
        <div
          v-if="!points3D.length"
          class="rounded-xl border border-amber-400/30 bg-amber-950/20 p-5 space-y-3"
        >
          <div class="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-amber-400 shrink-0 mt-0.5"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div class="flex-1">
              <div class="text-amber-200 font-semibold text-sm">Ingen 3D-punkter rekonstruert</div>
              <div class="text-xs text-amber-100/80 mt-1 leading-relaxed">{{ diagnosticHint }}</div>
            </div>
          </div>
        </div>

        <!-- 3D-viewer (interaktiv) — kun når vi har punkter -->
        <div
          v-if="points3D.length"
          class="rounded-xl overflow-hidden border border-emerald-400/20 bg-gradient-to-b from-emerald-950/40 to-black aspect-square relative touch-none select-none"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <svg :viewBox="`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`" class="w-full h-full">
            <defs>
              <radialGradient id="hologram-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#10b981" stop-opacity="0.18" />
                <stop offset="100%" stop-color="#10b981" stop-opacity="0" />
              </radialGradient>
            </defs>
            <rect x="0" y="0" :width="VIEWBOX_SIZE" :height="VIEWBOX_SIZE" fill="url(#hologram-glow)" />

            <!-- Senterkryss -->
            <line x1="100" y1="96" x2="100" y2="104" stroke="rgba(255,255,255,0.12)" stroke-width="0.4" />
            <line x1="96" y1="100" x2="104" y2="100" stroke="rgba(255,255,255,0.12)" stroke-width="0.4" />

            <!-- Kanter -->
            <line
              v-for="(e, i) in projectedEdges"
              :key="`e${i}`"
              :x1="e.a.x" :y1="e.a.y"
              :x2="e.b.x" :y2="e.b.y"
              stroke="#34d399"
              stroke-width="0.5"
              :opacity="(0.3 + Math.max(0, 0.5 + e.avgDepth * 0.5) * 0.5).toFixed(2)"
            />

            <!-- Punkter -->
            <circle
              v-for="p in projectedPoints"
              :key="p.id"
              :cx="p.x" :cy="p.y"
              :r="calibrationPicks.includes(p.index) ? 3 : 0.9 + Math.max(0, 0.5 + p.depth * 0.5) * 1.3"
              :fill="calibrationPicks.includes(p.index) ? '#fbbf24' : '#10b981'"
              :opacity="calibrationPicks.includes(p.index) ? 1 : 0.5 + Math.max(0, 0.5 + p.depth * 0.5) * 0.5"
              @click.stop="pickPoint(p)"
              :class="calibrationMode ? 'cursor-pointer' : ''"
              :style="calibrationMode ? 'r: 4' : ''"
            />

            <!-- Kalibrerings-linje -->
            <line
              v-if="calibrationPicks.length === 1"
              :x1="projectedPoints[calibrationPicks[0]]?.x"
              :y1="projectedPoints[calibrationPicks[0]]?.y"
              :x2="projectedPoints[calibrationPicks[0]]?.x"
              :y2="projectedPoints[calibrationPicks[0]]?.y"
              stroke="#fbbf24"
              stroke-width="0.8"
              stroke-dasharray="2 1"
            />
            <line
              v-if="calibrationPicks.length === 2"
              :x1="projectedPoints[calibrationPicks[0]]?.x"
              :y1="projectedPoints[calibrationPicks[0]]?.y"
              :x2="projectedPoints[calibrationPicks[1]]?.x"
              :y2="projectedPoints[calibrationPicks[1]]?.y"
              stroke="#fbbf24"
              stroke-width="0.8"
              stroke-dasharray="2 1"
            />
          </svg>

          <div class="absolute top-2 right-2 text-[10px] text-emerald-300/60 font-mono">
            {{ Math.round(rotY * 180 / Math.PI) % 360 }}°
          </div>
          <div class="absolute bottom-2 left-2 text-[10px] text-white/40">
            <span v-if="calibrationMode">Tapp to punkter for å måle</span>
            <span v-else>Dra for å rotere</span>
          </div>
        </div>

        <!-- Stats — kun relevant når vi har punkter -->
        <div v-if="points3D.length" class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-lg bg-white/5 border border-white/10 p-2">
            <div class="text-[10px] text-white/40 uppercase">Bredde</div>
            <div class="text-sm font-mono text-white">
              {{ scaleFactor ? sceneExtent.x.toFixed(2) + ' m' : sceneExtent.x.toFixed(2) }}
            </div>
          </div>
          <div class="rounded-lg bg-white/5 border border-white/10 p-2">
            <div class="text-[10px] text-white/40 uppercase">Høyde</div>
            <div class="text-sm font-mono text-white">
              {{ scaleFactor ? sceneExtent.y.toFixed(2) + ' m' : sceneExtent.y.toFixed(2) }}
            </div>
          </div>
          <div class="rounded-lg bg-white/5 border border-white/10 p-2">
            <div class="text-[10px] text-white/40 uppercase">Dybde</div>
            <div class="text-sm font-mono text-white">
              {{ scaleFactor ? sceneExtent.z.toFixed(2) + ' m' : sceneExtent.z.toFixed(2) }}
            </div>
          </div>
        </div>

        <!-- Verktøyrad — kun når vi har punkter -->
        <div v-if="points3D.length" class="grid grid-cols-3 gap-2">
          <button
            @click="calibrationMode = !calibrationMode; calibrationPicks = []"
            class="py-2.5 rounded-xl border text-sm transition active:scale-[0.98]"
            :class="calibrationMode
              ? 'bg-amber-500/20 border-amber-400/40 text-amber-200'
              : 'bg-white/5 border-white/10 text-white/70'"
          >
            {{ calibrationMode ? 'Avbryt' : 'Mål' }}
          </button>
          <button
            @click="exportSvg(false)"
            class="py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-sm active:scale-[0.98] transition"
          >
            Last ned SVG
          </button>
          <button
            @click="exportSvg(true)"
            class="py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-400/20 text-emerald-300/80 text-sm active:scale-[0.98] transition"
          >
            Animert
          </button>
        </div>

        <!-- Pipeline-diagnose: alltid synlig som expandable så man kan se hvor flyten stoppet -->
        <details class="rounded-xl bg-white/5 border border-white/10 overflow-hidden" :open="!points3D.length">
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
              <span>Features oppdaget</span>
              <span :class="diagnostics.featuresDetected > 50 ? 'text-white' : 'text-amber-400'">{{ diagnostics.featuresDetected }}</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>Tracks som overlevde</span>
              <span :class="diagnostics.tracksAlive > 20 ? 'text-white' : 'text-amber-400'">{{ diagnostics.tracksAlive }}</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>Tracks med ≥ 5 obs.</span>
              <span :class="diagnostics.tracksWithEnoughObs > 10 ? 'text-white' : 'text-amber-400'">{{ diagnostics.tracksWithEnoughObs }}</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>Flow-magnitude</span>
              <span :class="diagnostics.flowMagnitude > 5 ? 'text-white' : 'text-amber-400'">{{ diagnostics.flowMagnitude.toFixed(1) }} px</span>
            </div>
            <div class="flex justify-between border-b border-white/5 pb-1">
              <span>Triangulert (raw)</span>
              <span :class="diagnostics.triangulatedRaw > 0 ? 'text-white' : 'text-amber-400'">{{ diagnostics.triangulatedRaw }}</span>
            </div>
            <div class="flex justify-between">
              <span>Endelige 3D-punkter</span>
              <span :class="diagnostics.pointsAfterFilter > 0 ? 'text-emerald-300 font-semibold' : 'text-red-400 font-semibold'">{{ diagnostics.pointsAfterFilter }}</span>
            </div>
          </div>
        </details>

        <div v-if="scaleFactor" class="rounded-xl bg-emerald-900/20 border border-emerald-400/20 p-3 text-xs text-emerald-200 text-center">
          Skala kalibrert: 1 enhet ≈ {{ scaleFactor.toFixed(3) }} m
        </div>

        <div class="flex gap-3">
          <button
            @click="reset"
            class="flex-1 py-3 rounded-xl bg-white/10 border border-white/15 active:scale-[0.98] transition"
          >
            Skann igjen
          </button>
          <button
            @click="router.push('/')"
            class="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 active:scale-[0.98] transition"
          >
            Hjem
          </button>
        </div>
      </div>

      <!-- Kalibrerings-dialog -->
      <Transition name="hero">
        <div
          v-if="showCalibrationDialog"
          class="fixed inset-0 z-40 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
        >
          <div class="rounded-2xl bg-zinc-900 border border-amber-400/30 p-6 max-w-sm w-full space-y-4">
            <h3 class="text-lg font-semibold text-amber-200">Skala-kalibrering</h3>
            <p class="text-sm text-white/70">
              Hvor lang er avstanden mellom de to gule punktene i meter?
            </p>
            <input
              v-model="calibrationInput"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="f.eks. 1.5"
              class="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white text-lg font-mono text-center focus:border-amber-400/50 outline-none"
              @keyup.enter="applyCalibration"
            />
            <div class="flex gap-2">
              <button
                @click="cancelCalibration"
                class="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70"
              >
                Avbryt
              </button>
              <button
                @click="applyCalibration"
                class="flex-1 py-2.5 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-200"
              >
                Bruk
              </button>
            </div>
          </div>
        </div>
      </Transition>
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

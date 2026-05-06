<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter } from 'vue-router'
import { createFrameGrabber, recordFrames } from '../lib/videoFrameCapture.js'
import { useMotionRecorder } from '../composables/useMotionRecorder.js'
import { detectFaceRegion } from '../lib/faceLandmarks.js'
import { generateStipplePoints } from '../lib/voronoiStippling.js'
import { stipplingToSvg, BLEND_MODES } from '../lib/stipplingToSvg.js'
import { defaultPalette, pickRandomPalette } from '../lib/portraitPalettes.js'

const router = useRouter()

const videoRef = ref(null)
const stream = ref(null)
const cameraReady = ref(false)

// Faser: 'idle' | 'recording' | 'cropping' | 'processing' | 'result' | 'error'
const phase = ref('idle')
const captureProgress = ref(0)        // 0..1 under selve burst-en (~500ms)
const autoTriggerProgress = ref(0)    // 0..1 under 1.5s sentrerings-countdown
const frameCount = ref(0)
const errorMessage = ref('')
const processingStage = ref('')

// Upload-relatert state
const fileInputRef = ref(null)
const uploadedImg = ref(null)         // <img>-element ferdig lastet
const cropTransform = ref({ x: 0, y: 0, scale: 1 })
const cropFaceDetected = ref(false)
let cropDetectRaf = null
const cropContainerRef = ref(null)

const motion = useMotionRecorder()
const motionSampleCount = ref(0)

// Stipple-output
const stipplePoints = ref(null)
const stipplePortraitDims = ref({ width: 160, height: 200 })
const palette = ref(defaultPalette())

// Render-modus: 'stippling' | 'halftone' | 'hybrid'
const renderMode = ref('halftone')
const RENDER_MODES = ['stippling', 'halftone', 'hybrid']
const RENDER_MODE_LABELS = {
  stippling: 'Stippling',
  halftone: 'Halftone',
  hybrid: 'Hybrid',
}

// Blend-modus på prikkene (samme som halftone i SVG-sporet)
const blendMode = ref('normal')

const diagnostics = ref({
  framesCaptured: 0,
  framesWithFace: 0,
  bestFrameIndex: -1,
  stippleCount: 0,
  stippleProgress: 0,
})

let liveDetectRaf = null
const liveFaceBox = ref(null)

// Auto-trigger: 1.5s sammenhengende ansikts-deteksjon → fyrer av capture
const AUTO_TRIGGER_MS = 1500
let faceStableSince = 0
let autoTriggerCheckRaf = null

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
}

async function runPipeline(frames) {
  // Stadium 1: ansikts-deteksjon — finner ansiktet for skala/sentrering
  processingStage.value = 'detecting'
  await yieldFrame()

  const detections = frames.map(f => f.rgba ? detectFaceRegion(f.rgba, f.width, f.height) : null)
  diagnostics.value.framesWithFace = detections.filter(r => r !== null).length

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

  const bestFrame = frames[bestIdx]
  const region = detections[bestIdx]

  // Stadium 2: crop ansiktet med litt margin og kjør Voronoi-stippling.
  // Vi bruker hele cropet (ikke bare landemerker) — algoritmen lar pixel-
  // informasjonen styre fordelingen av prikker direkte.
  processingStage.value = 'stippling'
  await yieldFrame()

  const cropped = cropFaceFromFrame(bestFrame, region)
  stipplePortraitDims.value = { width: cropped.width, height: cropped.height }

  const points = generateStipplePoints(cropped.rgba, cropped.width, cropped.height, {
    numPoints: 1500,
    iterations: 5,
    seed: Math.floor(Math.random() * 1e9),
    onProgress: p => { diagnostics.value.stippleProgress = p },
  })
  stipplePoints.value = points
  diagnostics.value.stippleCount = points.length

  processingStage.value = 'done'
  await yieldFrame()
}

// Croper ut ansiktsregionen med ~30% margin slik at hår og hake også kommer med.
// Returnerer RGBA-buffer + dimensjoner (skalert til ~200px høy for ytelse).
function cropFaceFromFrame(frame, region) {
  const { bbox } = region
  const margin = 0.35
  const cx = bbox.x + bbox.w / 2
  const cy = bbox.y + bbox.h / 2
  const w = bbox.w * (1 + margin * 2)
  const h = bbox.h * (1 + margin * 2)
  const cropX = Math.max(0, cx - w / 2)
  const cropY = Math.max(0, cy - h / 2)
  const cropW = Math.min(frame.width - cropX, w)
  const cropH = Math.min(frame.height - cropY, h)

  // Skaler til ~180-200px høyde for god balanse mellom detalj og ytelse
  const targetH = 200
  const scale = targetH / cropH
  const outW = Math.round(cropW * scale)
  const outH = targetH

  // Ekstraher fra source RGBA
  const srcRgba = frame.rgba
  const srcW = frame.width
  const out = new Uint8ClampedArray(outW * outH * 4)
  for (let y = 0; y < outH; y++) {
    const srcY = Math.min(frame.height - 1, Math.floor(cropY + y / scale))
    for (let x = 0; x < outW; x++) {
      const srcX = Math.min(frame.width - 1, Math.floor(cropX + x / scale))
      const sIdx = (srcY * srcW + srcX) * 4
      const dIdx = (y * outW + x) * 4
      out[dIdx] = srcRgba[sIdx]
      out[dIdx + 1] = srcRgba[sIdx + 1]
      out[dIdx + 2] = srcRgba[sIdx + 2]
      out[dIdx + 3] = 255
    }
  }
  return { rgba: out, width: outW, height: outH }
}

// === UPLOAD + CROP =========================================================

function triggerUpload() {
  fileInputRef.value?.click()
}

async function onFileSelected(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
  })
  uploadedImg.value = img
  await nextRender()
  // Init transform: skaler så bildet fyller containeren minst
  const container = cropContainerRef.value
  if (container) {
    const cw = container.clientWidth
    const ch = container.clientHeight
    const fitScale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight)
    const scaledW = img.naturalWidth * fitScale
    const scaledH = img.naturalHeight * fitScale
    cropTransform.value = {
      x: (cw - scaledW) / 2,
      y: (ch - scaledH) / 2,
      scale: fitScale,
    }
  }
  cropFaceDetected.value = false
  phase.value = 'cropping'
  startCropDetection()
  if (e.target) e.target.value = '' // tillat re-velg av samme fil
}

function nextRender() {
  return new Promise(r => requestAnimationFrame(() => r()))
}

function startCropDetection() {
  let last = 0
  function tick(now) {
    if (phase.value !== 'cropping' || !uploadedImg.value) {
      cropDetectRaf = null
      return
    }
    if (now - last < 250) {
      cropDetectRaf = requestAnimationFrame(tick)
      return
    }
    last = now
    const cropped = extractCropRgba(160, 120)
    if (cropped) {
      cropFaceDetected.value = !!detectFaceRegion(cropped.data, cropped.width, cropped.height)
    }
    cropDetectRaf = requestAnimationFrame(tick)
  }
  cropDetectRaf = requestAnimationFrame(tick)
}

function stopCropDetection() {
  if (cropDetectRaf !== null) cancelAnimationFrame(cropDetectRaf)
  cropDetectRaf = null
}

// Henter regionen under ovalen som RGBA i ønsket størrelse.
// Oval-overlayen er definert i SVG viewBox 320x480 med ellipse rx=80, ry=105.
// Vi mapper container-koordinater til bilde-koordinater via cropTransform.
function extractCropRgba(width, height) {
  if (!uploadedImg.value || !cropContainerRef.value) return null
  const container = cropContainerRef.value
  const cw = container.clientWidth
  const ch = container.clientHeight

  // Ovalen sitter sentrert. SVG viewBox 320x480 fitter til containeren via meet.
  // Skala: min(cw/320, ch/480)
  const svgScale = Math.min(cw / 320, ch / 480)
  const ovalHalfW = 80 * svgScale
  const ovalHalfH = 105 * svgScale
  const ovalCx = cw / 2
  const ovalCy = ch / 2

  const tx = cropTransform.value.x
  const ty = cropTransform.value.y
  const s = cropTransform.value.scale

  const imgX = (ovalCx - ovalHalfW - tx) / s
  const imgY = (ovalCy - ovalHalfH - ty) / s
  const imgW = (ovalHalfW * 2) / s
  const imgH = (ovalHalfH * 2) / s

  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')
  // Speilvendes for konsistens med selfie-capture (som speilvendes i preview)
  // ctx.translate(width, 0)
  // ctx.scale(-1, 1)
  // For upload: ikke speilvende — bruker forventer at bilde er som de ser det
  try {
    ctx.drawImage(uploadedImg.value, imgX, imgY, imgW, imgH, 0, 0, width, height)
  } catch {
    return null
  }
  const data = ctx.getImageData(0, 0, width, height)
  return { data: data.data, width, height }
}

// Touch-gestures: enfinger pan, tofinger pinch-zoom (mer smidig enn +/- knapper)
let cropGesture = null

function distBetween(t1, t2) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
}
function midpoint(t1, t2) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 }
}

function onCropTouchStart(e) {
  if (e.touches.length === 2) {
    e.preventDefault()
    cropGesture = {
      kind: 'pinch',
      startDist: distBetween(e.touches[0], e.touches[1]),
      startScale: cropTransform.value.scale,
      startTx: cropTransform.value.x,
      startTy: cropTransform.value.y,
      mid: midpoint(e.touches[0], e.touches[1]),
    }
  } else if (e.touches.length === 1) {
    cropGesture = {
      kind: 'pan',
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      tx: cropTransform.value.x,
      ty: cropTransform.value.y,
    }
  }
}

function onCropTouchMove(e) {
  if (!cropGesture) return
  if (cropGesture.kind === 'pinch' && e.touches.length === 2) {
    e.preventDefault()
    const d = distBetween(e.touches[0], e.touches[1])
    const newScale = Math.max(0.2, Math.min(8, cropGesture.startScale * d / cropGesture.startDist))
    // Zoom rundt pinch-midten — beholder fokus på hva fingrene zoomer mot
    const container = cropContainerRef.value
    if (container) {
      const rect = container.getBoundingClientRect()
      const mx = cropGesture.mid.x - rect.left
      const my = cropGesture.mid.y - rect.top
      const factor = newScale / cropGesture.startScale
      cropTransform.value = {
        x: mx - (mx - cropGesture.startTx) * factor,
        y: my - (my - cropGesture.startTy) * factor,
        scale: newScale,
      }
    } else {
      cropTransform.value = { ...cropTransform.value, scale: newScale }
    }
  } else if (cropGesture.kind === 'pan' && e.touches.length === 1) {
    cropTransform.value = {
      ...cropTransform.value,
      x: cropGesture.tx + (e.touches[0].clientX - cropGesture.startX),
      y: cropGesture.ty + (e.touches[0].clientY - cropGesture.startY),
    }
  }
}

function onCropTouchEnd() {
  cropGesture = null
}

// Mus-fallback for desktop-testing (pointer events for ikke-touch)
let cropMouseDrag = null
function onCropPointerDown(e) {
  if (e.pointerType === 'touch') return
  cropMouseDrag = {
    x: e.clientX, y: e.clientY,
    tx: cropTransform.value.x, ty: cropTransform.value.y,
  }
  e.target.setPointerCapture?.(e.pointerId)
}
function onCropPointerMove(e) {
  if (!cropMouseDrag || e.pointerType === 'touch') return
  cropTransform.value = {
    ...cropTransform.value,
    x: cropMouseDrag.tx + (e.clientX - cropMouseDrag.x),
    y: cropMouseDrag.ty + (e.clientY - cropMouseDrag.y),
  }
}
function onCropPointerUp(e) {
  cropMouseDrag = null
  e.target.releasePointerCapture?.(e.pointerId)
}
function onCropWheel(e) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  zoomCrop(delta)
}

function zoomCrop(delta) {
  setCropScale(cropTransform.value.scale * (1 + delta))
}
function setCropScale(target) {
  const newScale = Math.max(0.2, Math.min(8, target))
  const container = cropContainerRef.value
  if (container) {
    const cw = container.clientWidth
    const ch = container.clientHeight
    const cx = cw / 2
    const cy = ch / 2
    const oldScale = cropTransform.value.scale
    const factor = newScale / oldScale
    cropTransform.value = {
      x: cx - (cx - cropTransform.value.x) * factor,
      y: cy - (cy - cropTransform.value.y) * factor,
      scale: newScale,
    }
  } else {
    cropTransform.value = { ...cropTransform.value, scale: newScale }
  }
}

function cancelCrop() {
  stopCropDetection()
  if (uploadedImg.value?.src?.startsWith('blob:')) {
    URL.revokeObjectURL(uploadedImg.value.src)
  }
  uploadedImg.value = null
  phase.value = 'idle'
}

async function confirmCrop() {
  if (!cropFaceDetected.value) return
  stopCropDetection()

  const cropped = extractCropRgba(320, 240)
  if (!cropped) return

  // Konstruer single-frame array kompatibel med runPipeline
  const luma = new Float32Array(cropped.width * cropped.height)
  for (let i = 0, j = 0; i < cropped.data.length; i += 4, j++) {
    luma[j] = (0.299 * cropped.data[i] + 0.587 * cropped.data[i + 1] + 0.114 * cropped.data[i + 2]) / 255
  }
  const frame = {
    timestamp: 0,
    width: cropped.width,
    height: cropped.height,
    luma,
    rgba: cropped.data,
  }

  if (uploadedImg.value?.src?.startsWith('blob:')) {
    URL.revokeObjectURL(uploadedImg.value.src)
  }
  uploadedImg.value = null

  diagnostics.value.framesCaptured = 1
  motionSampleCount.value = 0
  phase.value = 'processing'
  await yieldFrame()
  await runPipeline([frame])
  phase.value = 'result'
}

function pickNewPalette() {
  palette.value = pickRandomPalette(palette.value.name)
}

function yieldFrame() {
  return new Promise(r => requestAnimationFrame(() => r()))
}

function reset() {
  stopCropDetection()
  if (uploadedImg.value?.src?.startsWith('blob:')) {
    URL.revokeObjectURL(uploadedImg.value.src)
  }
  uploadedImg.value = null
  phase.value = 'idle'
  captureProgress.value = 0
  autoTriggerProgress.value = 0
  frameCount.value = 0
  motionSampleCount.value = 0
  stipplePoints.value = null
  palette.value = defaultPalette()
  renderMode.value = 'halftone'
  blendMode.value = 'normal'
  processingStage.value = ''
  errorMessage.value = ''
  faceStableSince = 0
  diagnostics.value = {
    framesCaptured: 0,
    framesWithFace: 0,
    bestFrameIndex: -1,
    stippleCount: 0,
    stippleProgress: 0,
  }
}

const diagnosticHint = computed(() => {
  const d = diagnostics.value
  if (d.framesWithFace === 0) {
    return 'Fant ikke ansiktet. Pek mot mer lys, eller sentrer ansiktet i ovalen før capture.'
  }
  if (d.stippleCount === 0) {
    return 'Klarte ikke generere stipple-portrettet. Prøv en ny capture med jevnere belysning.'
  }
  return 'Stipple-portrettet ditt er klart!'
})

const hasResult = computed(() => stipplePoints.value !== null && stipplePoints.value.length > 0)

const portraitSvg = computed(() => {
  if (!stipplePoints.value) return null
  return stipplingToSvg({
    points: stipplePoints.value,
    width: stipplePortraitDims.value.width,
    height: stipplePortraitDims.value.height,
    palette: palette.value,
    mode: renderMode.value,
    blendMode: blendMode.value,
  })
})

const portraitAspectStyle = computed(() => ({
  aspectRatio: `${stipplePortraitDims.value.width} / ${stipplePortraitDims.value.height}`,
}))

function downloadSvg() {
  if (!portraitSvg.value) return
  const blob = new Blob([portraitSvg.value], { type: 'image/svg+xml' })
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
  stopCropDetection()
  if (uploadedImg.value?.src?.startsWith('blob:')) {
    URL.revokeObjectURL(uploadedImg.value.src)
  }
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
      <div class="flex items-center gap-4">
        <button
          @click="triggerUpload"
          class="w-12 h-12 rounded-full bg-white/10 border border-white/20 active:scale-95 transition flex items-center justify-center"
          aria-label="Last opp bilde"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>
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
        <div class="w-12 h-12" /> <!-- spacer for symmetri -->
      </div>
      <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileSelected" />
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

    <!-- Cropping (upload-flyt) -->
    <div
      v-if="phase === 'cropping'"
      class="absolute inset-0 z-30 bg-black"
    >
      <div
        ref="cropContainerRef"
        class="absolute inset-0 overflow-hidden"
        style="touch-action: none"
        @touchstart.passive="onCropTouchStart"
        @touchmove.prevent="onCropTouchMove"
        @touchend="onCropTouchEnd"
        @touchcancel="onCropTouchEnd"
        @pointerdown="onCropPointerDown"
        @pointermove="onCropPointerMove"
        @pointerup="onCropPointerUp"
        @pointercancel="onCropPointerUp"
        @wheel="onCropWheel"
      >
        <img
          v-if="uploadedImg"
          :src="uploadedImg.src"
          class="absolute top-0 left-0 max-w-none select-none pointer-events-none"
          :style="{
            transform: `translate(${cropTransform.x}px, ${cropTransform.y}px) scale(${cropTransform.scale})`,
            transformOrigin: '0 0',
          }"
          draggable="false"
        />
        <!-- Oval-overlay (samme som kamera-preview) -->
        <svg viewBox="0 0 320 480" preserveAspectRatio="xMidYMid meet" class="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <mask id="crop-cutout">
              <rect width="320" height="480" fill="white"/>
              <ellipse cx="160" cy="240" rx="80" ry="105" fill="black"/>
            </mask>
          </defs>
          <rect width="320" height="480" fill="rgba(0,0,0,0.55)" mask="url(#crop-cutout)"/>
          <ellipse
            cx="160" cy="240" rx="80" ry="105"
            fill="none"
            :stroke="cropFaceDetected ? '#10b981' : 'rgba(255,255,255,0.4)'"
            stroke-width="1.5"
            stroke-dasharray="3 3"
          />
        </svg>
      </div>

      <!-- Topplinje -->
      <div class="absolute top-0 inset-x-0 p-4 flex items-center justify-between z-20">
        <button
          @click="cancelCrop"
          class="px-3 py-1.5 rounded-full bg-black/40 backdrop-blur text-sm border border-white/10"
        >
          Avbryt
        </button>
        <div class="px-3 py-1.5 rounded-full bg-black/40 backdrop-blur text-xs border border-white/10">
          Beskjær bilde
        </div>
      </div>

      <!-- Live status-pille -->
      <div class="absolute top-20 inset-x-0 flex justify-center z-10 pointer-events-none">
        <div
          class="px-3 py-1 rounded-full text-[11px] backdrop-blur transition-colors"
          :class="cropFaceDetected
            ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-200'
            : 'bg-amber-500/15 border border-amber-400/30 text-amber-200'"
        >
          {{ cropFaceDetected ? 'Ansikt detektert i ovalen' : 'Sentrer ansiktet i ovalen' }}
        </div>
      </div>

      <!-- Bunn: zoom + Bruk -->
      <div class="absolute bottom-0 inset-x-0 p-6 z-10 flex flex-col items-center gap-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
        <!-- Zoom: pinch på touch, eller slider/knapper for finjustering -->
        <div class="flex items-center gap-3 w-full max-w-xs">
          <button
            @click="zoomCrop(-0.15)"
            class="w-9 h-9 rounded-full bg-white/10 border border-white/20 text-white text-lg active:scale-95 transition shrink-0"
            aria-label="Zoom ut"
          >−</button>
          <input
            type="range"
            min="0.2"
            max="6"
            step="0.05"
            :value="cropTransform.scale"
            @input="setCropScale(parseFloat($event.target.value))"
            class="flex-1 accent-emerald-400"
            aria-label="Zoom"
          />
          <button
            @click="zoomCrop(0.15)"
            class="w-9 h-9 rounded-full bg-white/10 border border-white/20 text-white text-lg active:scale-95 transition shrink-0"
            aria-label="Zoom inn"
          >+</button>
        </div>
        <div class="text-[10px] text-white/40 -mt-2">Tofinger-pinch eller scroll for å zoome</div>
        <div class="flex gap-3 w-full max-w-xs">
          <button
            @click="cancelCrop"
            class="flex-1 py-3 rounded-xl bg-white/10 border border-white/15 active:scale-[0.98] transition"
          >
            Avbryt
          </button>
          <button
            @click="confirmCrop"
            :disabled="!cropFaceDetected"
            class="flex-1 py-3 rounded-xl border transition active:scale-[0.98]"
            :class="cropFaceDetected
              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-100'
              : 'bg-zinc-800 border-white/10 text-white/40 cursor-not-allowed'"
          >
            Bruk
          </button>
        </div>
        <p v-if="!cropFaceDetected" class="text-[11px] text-amber-200/70 text-center">
          Du må sentrere et tydelig ansikt i ovalen før du kan gå videre.
        </p>
      </div>
    </div>

    <!-- Processing -->
    <div
      v-if="phase === 'processing'"
      class="absolute inset-0 z-30 bg-black/85 flex flex-col items-center justify-center gap-6 px-8"
    >
      <div class="w-12 h-12 rounded-full border-2 border-emerald-400/40 border-t-emerald-400 animate-spin" />
      <div class="space-y-2 text-center">
        <div class="flex items-center gap-2 text-sm" :class="processingStage === 'detecting' ? 'text-white' : (processingStage === 'stippling' || processingStage === 'done' ? 'text-emerald-300' : 'text-white/40')">
          <span class="w-2 h-2 rounded-full" :class="processingStage === 'detecting' ? 'bg-emerald-400 animate-pulse' : (processingStage === 'stippling' || processingStage === 'done' ? 'bg-emerald-400' : 'bg-white/20')"></span>
          Finner ansiktet…
        </div>
        <div class="flex items-center gap-2 text-sm" :class="processingStage === 'stippling' ? 'text-white' : (processingStage === 'done' ? 'text-emerald-300' : 'text-white/40')">
          <span class="w-2 h-2 rounded-full" :class="processingStage === 'stippling' ? 'bg-emerald-400 animate-pulse' : (processingStage === 'done' ? 'bg-emerald-400' : 'bg-white/20')"></span>
          Stippler punktene… <span v-if="diagnostics.stippleProgress > 0" class="text-[10px] text-white/40 ml-1">{{ Math.round(diagnostics.stippleProgress * 100) }}%</span>
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
          class="rounded-xl overflow-hidden border border-emerald-400/20 select-none w-full"
          :style="portraitAspectStyle"
          v-html="portraitSvg"
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

        <!-- Blend-modus (samme som halftone i SVG-sporet) -->
        <div v-if="hasResult">
          <div class="text-[10px] text-white/40 uppercase tracking-wider mb-2">Blend-modus</div>
          <div class="grid grid-cols-4 gap-1.5">
            <button
              v-for="b in BLEND_MODES"
              :key="b.value"
              @click="blendMode = b.value"
              class="py-2 text-[11px] rounded-lg border transition active:scale-[0.98]"
              :class="blendMode === b.value
                ? 'bg-sky-600/40 border-sky-400/60 text-white'
                : 'bg-white/5 border-white/10 text-white/60'"
            >
              {{ b.label }}
            </button>
          </div>
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
              <span>Beste frame</span>
              <span :class="diagnostics.bestFrameIndex >= 0 ? 'text-white' : 'text-amber-400'">#{{ diagnostics.bestFrameIndex >= 0 ? diagnostics.bestFrameIndex + 1 : '–' }}</span>
            </div>
            <div class="flex justify-between">
              <span>Stipple-prikker</span>
              <span :class="diagnostics.stippleCount > 0 ? 'text-emerald-300' : 'text-amber-400'">{{ diagnostics.stippleCount }}</span>
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

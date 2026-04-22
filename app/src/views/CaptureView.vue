<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { imageToSvg } from '../lib/imageToSvg.js'

const router = useRouter()

const videoRef = ref(null)
const canvasRef = ref(null)
const fileInputRef = ref(null)

const stream = ref(null)
const cameraReady = ref(false)
const processing = ref(false)
const sensitivity = ref(55)
const previewSvg = ref(null)

// Camera orientation ('environment' = back, 'user' = selfie)
const facingMode = ref('environment')
// Optical / digital zoom (1.0 = native). Falls back to CSS scale when the
// device doesn't support MediaTrack zoom constraints.
const zoom = ref(1.0)
const zoomSupported = ref(false)
const zoomRange = ref({ min: 1, max: 3, step: 0.1 })

async function startCamera() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facingMode.value,
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
    })
    stream.value = s
    if (videoRef.value) {
      videoRef.value.srcObject = s
      videoRef.value.play()
      cameraReady.value = true
    }
    // Probe for native zoom support
    const track = s.getVideoTracks()[0]
    const caps = track.getCapabilities?.() || {}
    if (caps.zoom) {
      zoomSupported.value = true
      zoomRange.value = {
        min: caps.zoom.min ?? 1,
        max: caps.zoom.max ?? 3,
        step: caps.zoom.step ?? 0.1,
      }
      zoom.value = caps.zoom.min ?? 1
    } else {
      zoomSupported.value = false
      zoomRange.value = { min: 1, max: 3, step: 0.1 }
      zoom.value = 1
    }
  } catch {
    // Camera not available — user can still upload
    cameraReady.value = false
  }
}

function stopCamera() {
  stream.value?.getTracks().forEach(t => t.stop())
  stream.value = null
  cameraReady.value = false
}

async function flipCamera() {
  facingMode.value = facingMode.value === 'environment' ? 'user' : 'environment'
  stopCamera()
  await startCamera()
}

// Apply zoom: native MediaTrack if supported, otherwise CSS scale on the video
watch(zoom, (z) => {
  if (!stream.value) return
  const track = stream.value.getVideoTracks()[0]
  if (zoomSupported.value && track.applyConstraints) {
    track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {})
  }
})

async function capturePhoto() {
  if (!videoRef.value) return
  const canvas = canvasRef.value
  const video = videoRef.value
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  // If selfie mode (user-facing), mirror the captured image so the SVG
  // matches what the user saw in the preview
  if (facingMode.value === 'user') {
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
  }
  // Apply CSS-zoom fallback by cropping from the centre
  if (!zoomSupported.value && zoom.value > 1) {
    const z = zoom.value
    const cropW = video.videoWidth / z
    const cropH = video.videoHeight / z
    const cropX = (video.videoWidth - cropW) / 2
    const cropY = (video.videoHeight - cropH) / 2
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)
  } else {
    ctx.drawImage(video, 0, 0)
  }
  stopCamera()
  await processImage(canvas.toDataURL('image/jpeg', 0.85))
}

function onFileSelect(e) {
  const file = e.target.files?.[0]
  if (!file) return
  stopCamera()
  processImage(file)
}

async function processImage(src) {
  processing.value = true
  try {
    const result = await imageToSvg(src, {
      sensitivity: sensitivity.value / 100,
    })
    previewSvg.value = result

    // Store in sessionStorage for the viewer
    sessionStorage.setItem('svgInsights_svg', result.svg)
    sessionStorage.setItem('svgInsights_w', result.width)
    sessionStorage.setItem('svgInsights_h', result.height)
    // Store original RGBA data in memory for colorization
    window.__svgInsights_rgba = result.imageData
  } finally {
    processing.value = false
  }
}

function retake() {
  previewSvg.value = null
  startCamera()
}

function goToViewer() {
  router.push('/viewer')
}

onMounted(startCamera)
onUnmounted(stopCamera)
</script>

<template>
  <div class="flex flex-col min-h-[100dvh] bg-[#0a0a0f]">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 bg-black/40 backdrop-blur-xl border-b border-white/5">
      <button @click="router.push('/')" class="text-white/60 active:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <h1 class="text-sm font-medium text-white/80">Ta bilde eller last opp</h1>
      <div class="w-6" />
    </header>

    <!-- Main area -->
    <div class="flex-1 flex flex-col min-h-0">

      <!-- Camera / Preview -->
      <div class="flex-1 flex items-center justify-center bg-black min-h-0">

        <!-- Live camera — mirrored when in selfie/front mode for a natural feel -->
        <video
          v-if="!previewSvg && !processing"
          ref="videoRef"
          autoplay
          playsinline
          muted
          class="max-w-full max-h-full object-contain"
          :class="{ '-scale-x-100': facingMode === 'user' }"
        />

        <!-- Processing spinner -->
        <div v-if="processing" class="flex flex-col items-center gap-4">
          <div class="w-12 h-12 border-2 border-violet-500/30 border-t-violet-400 rounded-full animate-spin" />
          <p class="text-sm text-white/50">Konverterer til strektegning...</p>
        </div>

        <!-- SVG Preview — same size as the viewer so the user sees what they'll get -->
        <div
          v-if="previewSvg && !processing"
          class="w-full h-full flex items-center justify-center p-4 text-violet-300"
          v-html="previewSvg.svg"
        />

        <!-- No camera fallback hint -->
        <div
          v-if="!cameraReady && !previewSvg && !processing"
          class="flex flex-col items-center justify-center gap-3 text-white/40 py-20"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <p class="text-xs">Kamera ikke tilgjengelig</p>
        </div>
      </div>

      <!-- Hidden elements -->
      <canvas ref="canvasRef" class="hidden" />
      <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileSelect" />

      <!-- Controls -->
      <div class="bg-black/60 backdrop-blur-xl border-t border-white/5 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">

        <!-- Sliders: Detaljer + Zoom (only shown when we haven't captured yet) -->
        <div v-if="!previewSvg" class="space-y-3 mb-4">
          <div class="flex items-center gap-3">
            <span class="text-[11px] text-white/40 w-16 shrink-0">Detaljer</span>
            <input
              v-model.number="sensitivity"
              type="range" min="20" max="90" step="1"
              class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none
                     [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(167,139,250,0.5)]"
            />
            <span class="text-[11px] text-white/50 w-10 text-right tabular-nums">{{ sensitivity }}%</span>
          </div>

          <div v-if="cameraReady" class="flex items-center gap-3">
            <span class="text-[11px] text-white/40 w-16 shrink-0">Zoom</span>
            <input
              v-model.number="zoom"
              type="range"
              :min="zoomRange.min" :max="zoomRange.max" :step="zoomRange.step"
              class="flex-1 h-1 accent-sky-500 bg-white/10 rounded-full appearance-none
                     [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sky-400
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(56,189,248,0.5)]"
            />
            <span class="text-[11px] text-white/50 w-10 text-right tabular-nums">{{ zoom.toFixed(1) }}&times;</span>
          </div>
        </div>

        <!-- Capture row: Upload (left) · Shutter (center) · Flip (right) -->
        <div v-if="!previewSvg" class="grid grid-cols-3 items-center">
          <!-- Upload (left-aligned) -->
          <div class="flex justify-start">
            <button
              @click="fileInputRef?.click()"
              aria-label="Last opp bilde"
              class="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center
                     active:bg-white/10 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>
          </div>

          <!-- Shutter (centered) -->
          <div class="flex justify-center">
            <button
              v-if="cameraReady"
              @click="capturePhoto"
              aria-label="Ta bilde"
              class="w-18 h-18 rounded-full border-4 border-white/80 flex items-center justify-center
                     active:scale-90 transition-transform"
            >
              <div class="w-14 h-14 rounded-full bg-white active:bg-white/80 transition-colors" />
            </button>
          </div>

          <!-- Flip camera (right-aligned) -->
          <div class="flex justify-end">
            <button
              v-if="cameraReady"
              @click="flipCamera"
              aria-label="Bytt kamera"
              class="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center
                     active:bg-white/10 transition-colors"
            >
              <!-- Switch-camera icon: two arrows around a camera -->
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 4h-3.17L15 2H9L7.17 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6"/>
                <path d="M16 19l3 3 3-3"/>
                <path d="M19 22v-8a3 3 0 0 0-3-3h-2"/>
                <circle cx="9" cy="11" r="3"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Post-capture actions: always visible after preview exists -->
        <div v-if="previewSvg" class="flex items-center gap-3">
          <button
            @click="retake"
            class="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white/70 text-sm font-medium
                   active:bg-white/10 transition-colors"
          >
            Ta nytt bilde
          </button>
          <button
            @click="goToViewer"
            class="flex-1 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-sky-600 text-white text-sm font-semibold
                   active:scale-[0.98] transition-transform shadow-[0_0_30px_rgba(139,92,246,0.3)]"
          >
            Utforsk SVG
          </button>
        </div>

        <!-- Path count under action buttons -->
        <p v-if="previewSvg" class="text-center text-[11px] text-white/30 mt-2">
          {{ previewSvg.pathCount }} streker generert &middot; {{ previewSvg.width }}&times;{{ previewSvg.height }}px
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
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

async function startCamera() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
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
  } catch {
    // Camera not available — user can still upload
    cameraReady.value = false
  }
}

function stopCamera() {
  stream.value?.getTracks().forEach(t => t.stop())
}

async function capturePhoto() {
  if (!videoRef.value) return
  const canvas = canvasRef.value
  const video = videoRef.value
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d').drawImage(video, 0, 0)
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
      <h1 class="text-sm font-medium text-white/80">Fang bilde</h1>
      <div class="w-6" />
    </header>

    <!-- Main area -->
    <div class="flex-1 flex flex-col min-h-0">

      <!-- Camera / Preview -->
      <div class="flex-1 flex items-center justify-center bg-black min-h-0">

        <!-- Live camera -->
        <video
          v-if="!previewSvg && !processing"
          ref="videoRef"
          autoplay
          playsinline
          muted
          class="max-w-full max-h-full object-contain"
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

        <!-- Sensitivity slider -->
        <div v-if="!previewSvg" class="flex items-center gap-3 mb-4">
          <span class="text-[11px] text-white/40 w-16 shrink-0">Detaljer</span>
          <input
            v-model="sensitivity"
            type="range" min="20" max="90" step="1"
            class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none
                   [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(167,139,250,0.5)]"
          />
          <span class="text-[11px] text-white/50 w-8 text-right">{{ sensitivity }}%</span>
        </div>

        <!-- Action buttons -->
        <div v-if="!previewSvg" class="flex items-center justify-center gap-6">
          <!-- Upload button -->
          <button
            @click="fileInputRef?.click()"
            class="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center
                   active:bg-white/10 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>

          <!-- Shutter button -->
          <button
            v-if="cameraReady"
            @click="capturePhoto"
            class="w-18 h-18 rounded-full border-4 border-white/80 flex items-center justify-center
                   active:scale-90 transition-transform"
          >
            <div class="w-14 h-14 rounded-full bg-white active:bg-white/80 transition-colors" />
          </button>
        </div>

        <!-- After capture controls -->
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
            Utforsk i 3D
          </button>
        </div>

        <!-- Path count -->
        <p v-if="previewSvg" class="text-center text-[11px] text-white/30 mt-2">
          {{ previewSvg.pathCount }} streker generert &middot; {{ previewSvg.width }}&times;{{ previewSvg.height }}px
        </p>
      </div>
    </div>
  </div>
</template>

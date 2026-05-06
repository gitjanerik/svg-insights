<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter } from 'vue-router'
import { createFrameGrabber, recordFrames } from '../lib/videoFrameCapture.js'
import { useMotionRecorder } from '../composables/useMotionRecorder.js'

const router = useRouter()

const videoRef = ref(null)
const stream = ref(null)
const cameraReady = ref(false)

// Faser: 'idle' → 'recording' → 'processing' → 'result' | 'error'
const phase = ref('idle')
const progress = ref(0)
const frameCount = ref(0)
const errorMessage = ref('')

const motion = useMotionRecorder()

// Etter opptak (Fase 1 viser bare miniatyrer som bevis på at pipelinen funker):
const capturedFrames = ref([])
const motionSampleCount = ref(0)

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

  // Fase 1: ingen prosessering ennå. Vis et kort "fullført"-statusbilde og gå
  // direkte til result. Senere faser plugger inn feature-tracking + 3D her.
  await new Promise(r => setTimeout(r, 400))
  phase.value = 'result'
}

function reset() {
  phase.value = 'idle'
  progress.value = 0
  frameCount.value = 0
  capturedFrames.value = []
  motionSampleCount.value = 0
  errorMessage.value = ''
}

const recordingLabel = computed(() => {
  const remaining = Math.max(0, 3 - progress.value * 3)
  return remaining.toFixed(1) + ' s'
})

// Tegn en miniatyr som datakilde for bevis i UI: lagres som dataURL via canvas.
function frameToDataUrl(frame) {
  const c = document.createElement('canvas')
  c.width = frame.width
  c.height = frame.height
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(frame.width, frame.height)
  for (let i = 0, j = 0; i < frame.luma.length; i++, j += 4) {
    const v = Math.round(frame.luma[i] * 255)
    img.data[j] = v
    img.data[j + 1] = v
    img.data[j + 2] = v
    img.data[j + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/jpeg', 0.6)
}

const thumbnails = computed(() => {
  // Vis hvert 3. frame for å begrense rendering
  const step = 3
  const out = []
  for (let i = 0; i < capturedFrames.value.length; i += step) {
    out.push(frameToDataUrl(capturedFrames.value[i]))
  }
  return out
})

onMounted(() => {
  startCamera()
})

onBeforeUnmount(() => {
  stopCamera()
  detachLiveOrientation()
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

    <!-- Processing: enkel statustekst (vil utvides i Fase 2/3) -->
    <div
      v-if="phase === 'processing'"
      class="absolute inset-0 z-30 bg-black/80 flex flex-col items-center justify-center gap-4"
    >
      <div class="w-12 h-12 rounded-full border-2 border-violet-400/40 border-t-violet-400 animate-spin" />
      <p class="text-white/70 text-sm">Klargjør data...</p>
    </div>

    <!-- Result (Fase 1: bevis at pipelinen virker — viser thumbnails + sample-count) -->
    <div
      v-if="phase === 'result'"
      class="absolute inset-0 z-30 bg-black overflow-y-auto"
    >
      <div class="p-6 pt-20 max-w-md mx-auto space-y-6">
        <div class="text-center">
          <h2 class="text-xl font-semibold mb-2">Opptak fullført</h2>
          <p class="text-sm text-white/60">
            {{ capturedFrames.length }} frames · {{ motionSampleCount }} sensor-samples
          </p>
        </div>

        <!-- Frame-strip -->
        <div>
          <div class="text-[11px] text-white/40 mb-2 uppercase tracking-wide">Frame-strip (luma)</div>
          <div class="flex gap-1 overflow-x-auto pb-2 -mx-2 px-2">
            <img
              v-for="(src, i) in thumbnails"
              :key="i"
              :src="src"
              class="h-20 rounded border border-white/10 shrink-0"
            />
          </div>
        </div>

        <!-- Status / neste fase -->
        <div class="rounded-xl bg-violet-900/30 border border-violet-400/20 p-4 text-sm text-white/70 leading-relaxed">
          <strong class="text-white">Fase 1 OK.</strong>
          Datapipelinen leverer luma-frames og synkroniserte IMU-samples.
          Neste fase legger til feature-tracking og 3D-rekonstruksjon.
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

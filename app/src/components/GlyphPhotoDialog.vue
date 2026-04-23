<script setup>
// ─────────────────────────────────────────────────────────────────────────
// GlyphPhotoDialog
// Fullscreen dialog for capturing a single glyph via camera or upload.
//
// Flow:
//   1. Camera preview (default) OR user taps "Last opp" to pick a file
//   2. After capture/upload → still-preview with 4×5 crop overlay
//      - Pinch to zoom (digital, via CSS transform on the image)
//      - Drag the four corners to resize the crop rectangle
//      - Guide lines: baseline (1/5 from bottom), x-height (2/5 from bottom)
//   3. "Bruk utsnitt" → crops to 512×512 and emits @capture(dataUrl)
//
// Grid interpretation (5 rows, bottom → top):
//   Row 1     : descender zone          (y ∈ [4/5, 5/5] in DOM coords)
//   Row 1|2   : baseline                (y = 4/5)
//   Row 2     : x-height zone           (y ∈ [3/5, 4/5])
//   Row 2|3   : x-height line           (y = 3/5)
//   Row 3+    : ascender / cap zone
// ─────────────────────────────────────────────────────────────────────────

import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  char: { type: String, default: '' },
})
const emit = defineEmits(['capture', 'cancel'])

// ── Refs ─────────────────────────────────────────────────────────────────
const videoRef      = ref(null)
const previewImgRef = ref(null)
const fileInputRef  = ref(null)
const stageRef      = ref(null)

// Camera state
const stream        = ref(null)
const cameraReady   = ref(false)
const facingMode    = ref('environment')
const zoom          = ref(1.0)
const zoomSupported = ref(false)
const zoomRange     = ref({ min: 1, max: 3, step: 0.1 })

// Post-capture state
const capturedImg   = ref(null)     // HTMLImageElement once loaded
const capturedSrc   = ref(null)     // data-URL source for <img>
const imgZoom       = ref(1.0)      // digital zoom applied to the still image
const imgPanX       = ref(0)        // user-drag offset, px
const imgPanY       = ref(0)

// Pan / pinch gesture tracking (for the still image under the fixed crop frame)
const gesture = ref({
  panning:   false,
  panStartX: 0, panStartY: 0,
  panOrigX:  0, panOrigY:  0,
  pinching:  false,
  pinchStartDist: 0,
  pinchStartZoom: 1,
})

// ── Lifecycle ────────────────────────────────────────────────────────────
watch(() => props.open, async (o) => {
  if (o) {
    resetAll()
    await startCamera()
  } else {
    stopCamera()
  }
})

onMounted(() => { if (props.open) startCamera() })
onUnmounted(() => stopCamera())

function resetAll() {
  capturedImg.value = null
  capturedSrc.value = null
  imgZoom.value = 1.0
  imgPanX.value = 0
  imgPanY.value = 0
}

// ── Camera ───────────────────────────────────────────────────────────────
async function startCamera() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facingMode.value,
        width:  { ideal: 1280 },
        height: { ideal: 1280 },
      },
    })
    stream.value = s
    if (videoRef.value) {
      videoRef.value.srcObject = s
      await videoRef.value.play()
      cameraReady.value = true
    }
    const track = s.getVideoTracks()[0]
    const caps  = track.getCapabilities?.() || {}
    if (caps.zoom) {
      zoomSupported.value = true
      zoomRange.value = {
        min:  caps.zoom.min  ?? 1,
        max:  caps.zoom.max  ?? 3,
        step: caps.zoom.step ?? 0.1,
      }
      zoom.value = caps.zoom.min ?? 1
    } else {
      zoomSupported.value = false
      zoomRange.value = { min: 1, max: 3, step: 0.1 }
      zoom.value = 1
    }
  } catch {
    cameraReady.value = false  // user can still upload
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

// Native zoom via MediaTrack when available
watch(zoom, (z) => {
  if (!stream.value) return
  const track = stream.value.getVideoTracks()[0]
  if (zoomSupported.value && track.applyConstraints) {
    track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {})
  }
})

// ── Capture from camera ─────────────────────────────────────────────────
async function capturePhoto() {
  const v = videoRef.value
  if (!v) return
  const w = v.videoWidth, h = v.videoHeight
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d')
  if (facingMode.value === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1) }
  if (!zoomSupported.value && zoom.value > 1) {
    const z = zoom.value
    const cw = w / z, ch = h / z
    const cx = (w - cw) / 2, cy = (h - ch) / 2
    ctx.drawImage(v, cx, cy, cw, ch, 0, 0, w, h)
  } else {
    ctx.drawImage(v, 0, 0)
  }
  stopCamera()
  await loadCapturedImage(cv.toDataURL('image/jpeg', 0.92))
}

// ── Upload ───────────────────────────────────────────────────────────────
function triggerFilePick() { fileInputRef.value?.click() }

function onFileSelect(e) {
  const f = e.target.files?.[0]
  if (!f) return
  stopCamera()
  const r = new FileReader()
  r.onload = ev => loadCapturedImage(ev.target.result)
  r.readAsDataURL(f)
}

async function loadCapturedImage(dataUrl) {
  capturedSrc.value = dataUrl
  const img = new Image()
  await new Promise(res => { img.onload = res; img.src = dataUrl })
  capturedImg.value = img
}

// ── Retake ───────────────────────────────────────────────────────────────
async function retake() {
  resetAll()
  await startCamera()
}

// ── Pan + pinch on the still image ───────────────────────────────────────
// The crop frame is fixed and centred. The user positions the letter inside
// it by dragging (single finger) and pinching (two fingers). A slider in the
// footer also drives imgZoom.
function dist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) }

function onStageTouchStart(e) {
  if (e.touches.length === 2) {
    gesture.value.pinching       = true
    gesture.value.pinchStartDist = dist(e.touches[0], e.touches[1])
    gesture.value.pinchStartZoom = imgZoom.value
    gesture.value.panning = false
  } else if (e.touches.length === 1) {
    gesture.value.panning    = true
    gesture.value.panStartX  = e.touches[0].clientX
    gesture.value.panStartY  = e.touches[0].clientY
    gesture.value.panOrigX   = imgPanX.value
    gesture.value.panOrigY   = imgPanY.value
  }
}

function onStageTouchMove(e) {
  if (gesture.value.pinching && e.touches.length === 2) {
    const d = dist(e.touches[0], e.touches[1])
    const ratio = d / gesture.value.pinchStartDist
    imgZoom.value = Math.max(1, Math.min(6, gesture.value.pinchStartZoom * ratio))
  } else if (gesture.value.panning && e.touches.length === 1) {
    imgPanX.value = gesture.value.panOrigX + (e.touches[0].clientX - gesture.value.panStartX)
    imgPanY.value = gesture.value.panOrigY + (e.touches[0].clientY - gesture.value.panStartY)
  }
}

function onStageTouchEnd() {
  gesture.value.pinching = false
  gesture.value.panning  = false
}

// Pointer/mouse pan — for desktop testing
function onStagePointerDown(e) {
  if (e.pointerType === 'touch') return
  gesture.value.panning   = true
  gesture.value.panStartX = e.clientX
  gesture.value.panStartY = e.clientY
  gesture.value.panOrigX  = imgPanX.value
  gesture.value.panOrigY  = imgPanY.value
  window.addEventListener('pointermove', onStagePointerMove)
  window.addEventListener('pointerup',   onStagePointerUp, { once: true })
}
function onStagePointerMove(e) {
  if (!gesture.value.panning) return
  imgPanX.value = gesture.value.panOrigX + (e.clientX - gesture.value.panStartX)
  imgPanY.value = gesture.value.panOrigY + (e.clientY - gesture.value.panStartY)
}
function onStagePointerUp() {
  gesture.value.panning = false
  window.removeEventListener('pointermove', onStagePointerMove)
}

// ── Confirm: render fixed 4:5 crop to 512×512 ────────────────────────────
// The crop frame is locked to aspect 4:5 and sits centred in the stage. Its
// actual size depends on stage dimensions (width: min(78vw, 56vh)). We read
// its bounding rect at confirm-time and project it back into source-image
// coordinates through the image's displayed rect (which already reflects
// pan + zoom via CSS transform).
function confirmCrop() {
  const img   = capturedImg.value
  const imgEl = previewImgRef.value
  const frame = document.getElementById('glyph-crop-frame')
  if (!img || !imgEl || !frame) return

  const iRect = imgEl.getBoundingClientRect()
  const fRect = frame.getBoundingClientRect()

  // Map crop-frame viewport pixels → source image pixels
  const scaleX = img.naturalWidth  / iRect.width
  const scaleY = img.naturalHeight / iRect.height
  const sx = (fRect.left - iRect.left) * scaleX
  const sy = (fRect.top  - iRect.top)  * scaleY
  const sw = fRect.width  * scaleX
  const sh = fRect.height * scaleY

  // Output: 512×512 (square), with the 4:5 crop fit inside vertically so
  // the crop-bottom (baseline) lands on the canvas bottom — this is what
  // traceGlyphFromPhoto expects (y=size → baseline, y=0 → ascender).
  const size = 512
  const cv = document.createElement('canvas')
  cv.width = size; cv.height = size
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  // Crop is 4:5 (portrait). Place it full-height in the 512×512 canvas and
  // pad horizontally with white. Target dims: height=512, width=512*(4/5)=409.6
  const targetH = size
  const targetW = Math.round(size * (4 / 5))
  const tx = Math.round((size - targetW) / 2)

  ctx.drawImage(img, sx, sy, sw, sh, tx, 0, targetW, targetH)
  emit('capture', cv.toDataURL('image/jpeg', 0.95))
}

function cancel() { emit('cancel') }

// ── Image style (pan + zoom transform on still) ─────────────────────────
const imgStyle = computed(() => ({
  transform: `translate(${imgPanX.value}px, ${imgPanY.value}px) scale(${imgZoom.value})`,
  transformOrigin: 'center center',
}))
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 bg-black flex flex-col">

    <!-- Header -->
    <header class="shrink-0 px-4 py-3 flex items-center justify-between
                   bg-black/80 backdrop-blur-xl border-b border-white/5">
      <button @click="cancel" class="text-white/70 text-sm active:text-white">Avbryt</button>
      <div class="text-sm text-white/80">
        Ta bilde av «<span class="font-semibold text-amber-300">{{ char }}</span>»
      </div>
      <div class="w-12" />
    </header>

    <!-- Stage -->
    <div ref="stageRef" class="flex-1 relative overflow-hidden bg-black">

      <!-- Live camera preview -->
      <video v-if="!capturedSrc" ref="videoRef" playsinline muted
             class="absolute inset-0 w-full h-full object-cover"
             :class="{ '-scale-x-100': facingMode === 'user' }" />

      <!-- Still image preview (post-capture) -->
      <img v-if="capturedSrc" ref="previewImgRef" :src="capturedSrc"
           :style="imgStyle"
           class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
           draggable="false" />

      <!-- Gesture capture for pan/pinch on the still image. Only active in
           crop mode — the touch layer sits above the image but below the
           fixed crop frame so it catches drags anywhere in the stage. -->
      <div v-if="capturedSrc"
           class="absolute inset-0"
           style="touch-action: none;"
           @touchstart="onStageTouchStart"
           @touchmove.prevent="onStageTouchMove"
           @touchend="onStageTouchEnd"
           @touchcancel="onStageTouchEnd"
           @pointerdown="onStagePointerDown" />

      <!-- Fixed 4:5 crop frame overlay (still mode only).
           Dark veil outside; 4×5 grid, baseline + x-height guides inside. -->
      <div v-if="capturedSrc" class="absolute inset-0 pointer-events-none
                                     flex items-center justify-center">
        <!-- Wrapper keeps aspect 4:5; size adapts to stage dims -->
        <div id="glyph-crop-frame"
             class="relative"
             style="width: min(78vw, 56vh); aspect-ratio: 4 / 5;
                    box-shadow: 0 0 0 9999px rgba(0,0,0,0.55);
                    border: 2px solid rgba(251,191,36,0.9);">

          <!-- 4×5 grid (4 cols × 5 rows) -->
          <div class="absolute inset-0 grid grid-cols-4 grid-rows-5">
            <div v-for="i in 20" :key="i" class="border border-amber-400/15" />
          </div>

          <!-- Baseline: y = 4/5 (1 row up from bottom) — pink solid -->
          <div class="absolute left-0 right-0 h-px bg-pink-400"
               style="top: 80%" />
          <div class="absolute -right-1 translate-x-full whitespace-nowrap
                      text-[10px] font-semibold tracking-wider text-pink-300"
               style="top: calc(80% - 6px)">grunnlinje</div>

          <!-- X-height: y = 3/5 (2 rows up) — cyan dashed -->
          <div class="absolute left-0 right-0 h-px border-t border-dashed border-cyan-300"
               style="top: 60%" />
          <div class="absolute -right-1 translate-x-full whitespace-nowrap
                      text-[10px] font-semibold tracking-wider text-cyan-200"
               style="top: calc(60% - 6px)">x-høyde</div>
        </div>
      </div>

      <!-- Hint -->
      <div v-if="capturedSrc"
           class="absolute bottom-3 left-1/2 -translate-x-1/2
                  text-[11px] text-white/60 text-center px-4 pointer-events-none">
        Dra for å flytte · klyp for å zoome
      </div>
    </div>

    <!-- Bottom controls -->
    <footer class="shrink-0 bg-black/90 backdrop-blur-xl border-t border-white/5
                   pb-[max(0.75rem,env(safe-area-inset-bottom))]">

      <!-- LIVE CAMERA MODE -->
      <template v-if="!capturedSrc">
        <!-- Zoom slider -->
        <div class="px-5 pt-3 pb-1 flex items-center gap-3" v-if="cameraReady">
          <span class="text-[11px] text-white/40 w-6">1×</span>
          <input v-model.number="zoom" type="range"
                 :min="zoomRange.min" :max="zoomRange.max" :step="zoomRange.step"
                 class="flex-1 h-1 accent-amber-400 bg-white/10 rounded-full appearance-none" />
          <span class="text-[11px] text-amber-300 w-10 text-right">{{ zoom.toFixed(1) }}×</span>
        </div>

        <div class="px-5 py-3 grid grid-cols-3 items-center">
          <!-- Upload (left) -->
          <button @click="triggerFilePick"
                  class="justify-self-start flex flex-col items-center gap-1 text-white/70 active:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span class="text-[10px]">Last opp</span>
          </button>

          <!-- Shutter (center) -->
          <button @click="capturePhoto" :disabled="!cameraReady"
                  class="justify-self-center w-16 h-16 rounded-full border-4 border-white
                         bg-white/10 active:scale-95 transition-transform disabled:opacity-30
                         flex items-center justify-center">
            <div class="w-11 h-11 rounded-full bg-white" />
          </button>

          <!-- Flip (right) -->
          <button @click="flipCamera"
                  class="justify-self-end flex flex-col items-center gap-1 text-white/70 active:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <span class="text-[10px]">Bytt</span>
          </button>
        </div>

        <input ref="fileInputRef" type="file" accept="image/*" class="hidden"
               @change="onFileSelect" />
      </template>

      <!-- STILL / CROP MODE -->
      <template v-else>
        <div class="px-5 pt-3 pb-1 flex items-center gap-3">
          <span class="text-[11px] text-white/40 w-6">1×</span>
          <input v-model.number="imgZoom" type="range" min="1" max="4" step="0.1"
                 class="flex-1 h-1 accent-amber-400 bg-white/10 rounded-full appearance-none" />
          <span class="text-[11px] text-amber-300 w-10 text-right">{{ imgZoom.toFixed(1) }}×</span>
        </div>

        <div class="px-4 py-3 flex gap-2">
          <button @click="retake"
                  class="flex-1 px-4 py-3 rounded-xl border border-white/15
                         text-white/80 text-sm active:bg-white/5">
            Ta nytt
          </button>
          <button @click="confirmCrop"
                  class="flex-[2] px-4 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400
                         text-black text-sm font-semibold active:scale-[0.98] transition-transform">
            Bruk utsnitt
          </button>
        </div>
      </template>
    </footer>
  </div>
</template>

<style scoped>
/* Hide default range thumb outline on iOS */
input[type="range"] { -webkit-appearance: none; }
</style>

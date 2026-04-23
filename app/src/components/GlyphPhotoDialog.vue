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
const imgPanX       = ref(0)        // not currently draggable; reserved for future
const imgPanY       = ref(0)

// Crop rectangle in % of stage (0..1). Default = centred square covering
// most of the stage height, 4:5 aspect (portrait).
const cropL = ref(0.18)  // left
const cropT = ref(0.05)  // top
const cropR = ref(0.82)  // right
const cropB = ref(0.95)  // bottom

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
  cropL.value = 0.18
  cropT.value = 0.05
  cropR.value = 0.82
  cropB.value = 0.95
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

// ── Crop corners (drag) ──────────────────────────────────────────────────
// Each corner updates two of {cropL, cropT, cropR, cropB}.
// Min crop size = 20% of stage to prevent accidental collapse.
const MIN_CROP = 0.20

function onCornerDrag(which, ev) {
  ev.preventDefault()
  const stage = stageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()

  function move(e) {
    const t = e.touches?.[0] || e
    const x = Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (t.clientY - rect.top)  / rect.height))
    if (which === 'tl') { cropL.value = Math.min(x, cropR.value - MIN_CROP); cropT.value = Math.min(y, cropB.value - MIN_CROP) }
    if (which === 'tr') { cropR.value = Math.max(x, cropL.value + MIN_CROP); cropT.value = Math.min(y, cropB.value - MIN_CROP) }
    if (which === 'bl') { cropL.value = Math.min(x, cropR.value - MIN_CROP); cropB.value = Math.max(y, cropT.value + MIN_CROP) }
    if (which === 'br') { cropR.value = Math.max(x, cropL.value + MIN_CROP); cropB.value = Math.max(y, cropT.value + MIN_CROP) }
  }
  function end() {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
  }
  window.addEventListener('pointermove', move, { passive: false })
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

// ── Derived crop geometry (CSS %) ────────────────────────────────────────
const cropStyle = computed(() => ({
  left:   `${cropL.value * 100}%`,
  top:    `${cropT.value * 100}%`,
  width:  `${(cropR.value - cropL.value) * 100}%`,
  height: `${(cropB.value - cropT.value) * 100}%`,
}))

// ── Confirm: render to 512×512 and emit ──────────────────────────────────
function confirmCrop() {
  const img = capturedImg.value
  const stage = stageRef.value
  if (!img || !stage) return

  // Map stage-space crop → image-space pixels, accounting for object-contain
  // sizing of the img inside the stage, and our digital zoom/pan.
  const sRect = stage.getBoundingClientRect()
  const imgEl = previewImgRef.value
  const iRect = imgEl.getBoundingClientRect()

  // Crop in viewport-px
  const vx = sRect.left + cropL.value * sRect.width
  const vy = sRect.top  + cropT.value * sRect.height
  const vw = (cropR.value - cropL.value) * sRect.width
  const vh = (cropB.value - cropT.value) * sRect.height

  // Map to image-source px: image has natural size img.naturalWidth×naturalHeight
  // and is rendered into iRect (which already reflects zoom transform).
  const sx = (vx - iRect.left) * (img.naturalWidth  / iRect.width)
  const sy = (vy - iRect.top)  * (img.naturalHeight / iRect.height)
  const sw = vw * (img.naturalWidth  / iRect.width)
  const sh = vh * (img.naturalHeight / iRect.height)

  const size = 512
  const cv = document.createElement('canvas')
  cv.width = size; cv.height = size
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  // Draw the cropped region into the full 512×512 output. Because the user's
  // crop is always 4:5 by default but can be resized freely, we stretch to
  // fit. The tracer normalises against baseline/x-height anyway.
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size)

  emit('capture', cv.toDataURL('image/jpeg', 0.95))
}

function cancel() { emit('cancel') }

// ── Image style (zoom transform on still) ────────────────────────────────
const imgStyle = computed(() => ({
  transform: `scale(${imgZoom.value})`,
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

      <!-- 4×5 crop overlay — only in still-preview mode -->
      <div v-if="capturedSrc" class="absolute inset-0 pointer-events-none">
        <!-- Dark veil OUTSIDE the crop rectangle (uses 4 divs instead of
             mask-image for broad browser support) -->
        <div class="absolute bg-black/60"
             :style="{ left: 0, top: 0, right: 0, height: cropStyle.top }" />
        <div class="absolute bg-black/60"
             :style="{ left: 0, bottom: 0, right: 0,
                       top: `calc(${cropStyle.top} + ${cropStyle.height})` }" />
        <div class="absolute bg-black/60"
             :style="{ left: 0, top: cropStyle.top, width: cropStyle.left,
                       height: cropStyle.height }" />
        <div class="absolute bg-black/60"
             :style="{ top: cropStyle.top, height: cropStyle.height,
                       left: `calc(${cropStyle.left} + ${cropStyle.width})`,
                       right: 0 }" />

        <!-- Crop rectangle -->
        <div class="absolute border-2 border-amber-400/90"
             :style="cropStyle">
          <!-- 4×5 grid (4 cols × 5 rows) -->
          <div class="absolute inset-0 grid grid-cols-4 grid-rows-5">
            <div v-for="i in 20" :key="i" class="border border-amber-400/20" />
          </div>

          <!-- Baseline guide: y = 4/5 (1 row up from bottom) — pink solid -->
          <div class="absolute left-0 right-0 h-px bg-pink-400"
               style="top: 80%" />
          <div class="absolute right-1 text-[9px] text-pink-300 font-semibold tracking-wider"
               style="top: calc(80% - 12px)">grunnlinje</div>

          <!-- X-height guide: y = 3/5 (2 rows up) — cyan dashed -->
          <div class="absolute left-0 right-0 h-px border-t border-dashed border-cyan-300"
               style="top: 60%" />
          <div class="absolute right-1 text-[9px] text-cyan-200 font-semibold tracking-wider"
               style="top: calc(60% - 12px)">x-høyde</div>
        </div>

        <!-- Corner handles (pointer-events enabled only on these) -->
        <template v-for="c in ['tl','tr','bl','br']" :key="c">
          <div class="absolute w-11 h-11 flex items-center justify-center pointer-events-auto"
               :style="{
                 left:   (c === 'tl' || c === 'bl') ? `calc(${cropStyle.left} - 22px)`  : `calc(${cropStyle.left} + ${cropStyle.width} - 22px)`,
                 top:    (c === 'tl' || c === 'tr') ? `calc(${cropStyle.top} - 22px)`   : `calc(${cropStyle.top} + ${cropStyle.height} - 22px)`,
                 touchAction: 'none',
                 cursor:       c === 'tl' || c === 'br' ? 'nwse-resize' : 'nesw-resize',
               }"
               @pointerdown="onCornerDrag(c, $event)">
            <svg width="22" height="22" viewBox="0 0 22 22" class="text-amber-400 drop-shadow">
              <path :d="c === 'tl' ? 'M2 10 V2 H10' : c === 'tr' ? 'M12 2 H20 V10' : c === 'bl' ? 'M2 12 V20 H10' : 'M12 20 H20 V12'"
                    stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>
            </svg>
          </div>
        </template>
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

<script setup>
// GlyphPhotoDialog — kamera/opplasting + justerbar crop-boks med drabare hjørner
// Flow: kamera → ta bilde → stil bildet (pan/zoom) + juster crop-boks → "Bruk utsnitt"

import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

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

// Kamera-state
const stream        = ref(null)
const cameraReady   = ref(false)
const facingMode    = ref('environment')
const zoom          = ref(1.0)
const zoomSupported = ref(false)
const zoomRange     = ref({ min: 1, max: 3, step: 0.1 })

// Post-capture state
const capturedImg   = ref(null)   // HTMLImageElement
const capturedSrc   = ref(null)   // data-URL

// Bildet pannes/zoomes med CSS transform
const imgZoom = ref(1.0)
const imgPanX = ref(0)
const imgPanY = ref(0)

// ── Crop-boks (stage-relative px) ────────────────────────────────────────
const cropL = ref(0)
const cropT = ref(0)
const cropR = ref(0)
const cropB = ref(0)

function initCropBox() {
  const sr = stageRef.value?.getBoundingClientRect()
  if (!sr) return
  const bH = sr.height * 0.48  // ~2/3 av forrige størrelse
  const bW = bH * (4 / 5)
  cropL.value = (sr.width  - bW) / 2
  cropT.value = (sr.height - bH) / 2
  cropR.value = cropL.value + bW
  cropB.value = cropT.value + bH
}

// ── Gestur-tracking ───────────────────────────────────────────────────────
const dragCorner = ref(null)  // 'tl'|'tr'|'bl'|'br'|null
const gesture    = ref({
  panning:        false,
  panStartX:      0, panStartY:      0,
  panOrigX:       0, panOrigY:       0,
  pinching:       false,
  pinchStartDist: 0, pinchStartZoom: 1,
})

function distBetween(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

// Sjekker om (sx,sy) i stage-koordinater er nær et hjørne (innen 40px)
function nearCorner(sx, sy) {
  const hits = [
    ['tl', cropL.value, cropT.value],
    ['tr', cropR.value, cropT.value],
    ['bl', cropL.value, cropB.value],
    ['br', cropR.value, cropB.value],
  ]
  for (const [id, cx, cy] of hits) {
    if (Math.hypot(sx - cx, sy - cy) < 40) return id
  }
  return null
}

function applyCornerDrag(id, sx, sy, stageW, stageH) {
  const MIN = 80
  if (id.includes('l')) cropL.value = Math.max(0, Math.min(sx, cropR.value - MIN))
  if (id.includes('r')) cropR.value = Math.min(stageW, Math.max(sx, cropL.value + MIN))
  if (id.includes('t')) cropT.value = Math.max(0, Math.min(sy, cropB.value - MIN))
  if (id.includes('b')) cropB.value = Math.min(stageH, Math.max(sy, cropT.value + MIN))
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
watch(() => props.open, async (o) => {
  if (o) { resetAll(); await startCamera() }
  else   { stopCamera() }
})
onMounted  (() => { if (props.open) startCamera() })
onUnmounted(() => stopCamera())

function resetAll() {
  capturedImg.value = null
  capturedSrc.value = null
  imgZoom.value = 1.0
  imgPanX.value = 0
  imgPanY.value = 0
  dragCorner.value = null
}

// ── Kamera ────────────────────────────────────────────────────────────────
async function startCamera() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facingMode.value, width: { ideal: 1280 }, height: { ideal: 1280 } },
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
      zoomRange.value = { min: caps.zoom.min ?? 1, max: caps.zoom.max ?? 3, step: caps.zoom.step ?? 0.1 }
      zoom.value = caps.zoom.min ?? 1
    } else {
      zoomSupported.value = false
      zoomRange.value = { min: 1, max: 3, step: 0.1 }
      zoom.value = 1
    }
  } catch { cameraReady.value = false }
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

watch(zoom, (z) => {
  if (!stream.value) return
  const track = stream.value.getVideoTracks()[0]
  if (zoomSupported.value && track.applyConstraints) {
    track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {})
  }
})

// ── Ta bilde ──────────────────────────────────────────────────────────────
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
    ctx.drawImage(v, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, w, h)
  } else {
    ctx.drawImage(v, 0, 0)
  }
  stopCamera()
  await loadCapturedImage(cv.toDataURL('image/jpeg', 0.92))
}

// ── Opplasting ────────────────────────────────────────────────────────────
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
  await nextTick()
  initCropBox()
}

async function retake() { resetAll(); await startCamera() }

// ── Touch-gestur (pan/zoom på bilde + hjørne-drag) ────────────────────────
function onStageTouchStart(e) {
  const sr = stageRef.value?.getBoundingClientRect()
  if (!sr) return

  if (e.touches.length === 2) {
    dragCorner.value         = null
    gesture.value.panning    = false
    gesture.value.pinching   = true
    gesture.value.pinchStartDist = distBetween(e.touches[0], e.touches[1])
    gesture.value.pinchStartZoom = imgZoom.value
  } else if (e.touches.length === 1) {
    const sx = e.touches[0].clientX - sr.left
    const sy = e.touches[0].clientY - sr.top
    const corner = nearCorner(sx, sy)
    if (corner) {
      dragCorner.value      = corner
      gesture.value.panning = false
    } else {
      dragCorner.value         = null
      gesture.value.panning    = true
      gesture.value.panStartX  = e.touches[0].clientX
      gesture.value.panStartY  = e.touches[0].clientY
      gesture.value.panOrigX   = imgPanX.value
      gesture.value.panOrigY   = imgPanY.value
    }
  }
}

function onStageTouchMove(e) {
  const sr = stageRef.value?.getBoundingClientRect()
  if (!sr) return

  if (gesture.value.pinching && e.touches.length === 2) {
    const d = distBetween(e.touches[0], e.touches[1])
    imgZoom.value = Math.max(1, Math.min(8, gesture.value.pinchStartZoom * d / gesture.value.pinchStartDist))
  } else if (dragCorner.value && e.touches.length === 1) {
    applyCornerDrag(
      dragCorner.value,
      e.touches[0].clientX - sr.left,
      e.touches[0].clientY - sr.top,
      sr.width, sr.height,
    )
  } else if (gesture.value.panning && e.touches.length === 1) {
    imgPanX.value = gesture.value.panOrigX + (e.touches[0].clientX - gesture.value.panStartX)
    imgPanY.value = gesture.value.panOrigY + (e.touches[0].clientY - gesture.value.panStartY)
  }
}

function onStageTouchEnd() {
  gesture.value.pinching = false
  gesture.value.panning  = false
  dragCorner.value        = null
}

// Mus/pointer (desktop-testing)
function onStagePointerDown(e) {
  if (e.pointerType === 'touch') return
  const sr = stageRef.value?.getBoundingClientRect()
  if (!sr) return
  const sx = e.clientX - sr.left
  const sy = e.clientY - sr.top
  const corner = nearCorner(sx, sy)
  if (corner) {
    dragCorner.value = corner
  } else {
    gesture.value.panning    = true
    gesture.value.panStartX  = e.clientX
    gesture.value.panStartY  = e.clientY
    gesture.value.panOrigX   = imgPanX.value
    gesture.value.panOrigY   = imgPanY.value
  }
  window.addEventListener('pointermove', onStagePointerMove)
  window.addEventListener('pointerup', onStagePointerUp, { once: true })
}

function onStagePointerMove(e) {
  const sr = stageRef.value?.getBoundingClientRect()
  if (!sr) return
  if (dragCorner.value) {
    applyCornerDrag(dragCorner.value, e.clientX - sr.left, e.clientY - sr.top, sr.width, sr.height)
  } else if (gesture.value.panning) {
    imgPanX.value = gesture.value.panOrigX + (e.clientX - gesture.value.panStartX)
    imgPanY.value = gesture.value.panOrigY + (e.clientY - gesture.value.panStartY)
  }
}

function onStagePointerUp() {
  dragCorner.value = null
  gesture.value.panning = false
  window.removeEventListener('pointermove', onStagePointerMove)
}

// ── Bekreft crop → emit dataUrl ────────────────────────────────────────────
// Korrekt koordinat-mapping:
//   1. Finn bildet sin "base" display-rect i stage (object-contain letterboxing)
//   2. Appliser CSS-transform translate(panX,panY) scale(Z) fra center
//   3. Map crop-boks-koordinater til kilde-piksel-koordinater
function confirmCrop() {
  const img = capturedImg.value
  if (!img) return
  const sr = stageRef.value?.getBoundingClientRect()
  if (!sr) return

  // 1. Base display-rect uten transform (object-contain)
  const imgAspect = img.naturalWidth / img.naturalHeight
  const srAspect  = sr.width / sr.height
  let baseW, baseH, baseX, baseY
  if (imgAspect > srAspect) {
    baseW = sr.width;  baseH = sr.width / imgAspect
    baseX = 0;         baseY = (sr.height - baseH) / 2
  } else {
    baseH = sr.height; baseW = sr.height * imgAspect
    baseX = (sr.width - baseW) / 2; baseY = 0
  }

  // 2. CSS transform: translate(panX,panY) scale(Z) fra center
  const Z  = imgZoom.value
  const cx = sr.width / 2, cy = sr.height / 2
  const imgLeft  = (baseX - cx) * Z + cx + imgPanX.value
  const imgTop   = (baseY - cy) * Z + cy + imgPanY.value
  const imgDispW = baseW * Z
  const imgDispH = baseH * Z

  // 3. Crop-boks → kilde-piksel
  const sx = Math.round((cropL.value - imgLeft) / imgDispW * img.naturalWidth)
  const sy = Math.round((cropT.value - imgTop)  / imgDispH * img.naturalHeight)
  const sw = Math.round((cropR.value - cropL.value) / imgDispW * img.naturalWidth)
  const sh = Math.round((cropB.value - cropT.value) / imgDispH * img.naturalHeight)

  const size = 512
  const cv   = document.createElement('canvas')
  cv.width   = size; cv.height = size
  const ctx  = cv.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  // Clamp til gyldig kilde-rect
  const clSx = Math.max(0, sx)
  const clSy = Math.max(0, sy)
  const clSw = Math.min(sw, img.naturalWidth  - clSx)
  const clSh = Math.min(sh, img.naturalHeight - clSy)
  if (clSw > 0 && clSh > 0) {
    ctx.drawImage(img, clSx, clSy, clSw, clSh, 0, 0, size, size)
  }
  emit('capture', cv.toDataURL('image/jpeg', 0.95))
}

function cancel() { emit('cancel') }

// CSS-transform for bildet
const imgStyle = computed(() => ({
  transform:       `translate(${imgPanX.value}px, ${imgPanY.value}px) scale(${imgZoom.value})`,
  transformOrigin: 'center center',
}))

// ── Hjørne-handle visuelt ─────────────────────────────────────────────────
// L-formede SVG-markører; path-data i 44×44 viewBox, sentrum på hjørnet
const CORNER_PATH = {
  tl: 'M34,22 L22,22 L22,34',
  tr: 'M10,22 L22,22 L22,34',
  bl: 'M34,22 L22,22 L22,10',
  br: 'M10,22 L22,22 L22,10',
}

function cornerStyle(id) {
  const x = id.includes('l') ? cropL.value : cropR.value
  const y = id.includes('t') ? cropT.value : cropB.value
  return { position: 'absolute', left: (x - 22) + 'px', top: (y - 22) + 'px',
           width: '44px', height: '44px', zIndex: 15, touchAction: 'none' }
}

const cropBoxStyle = computed(() => ({
  position: 'absolute',
  left:   cropL.value + 'px',
  top:    cropT.value + 'px',
  width:  (cropR.value - cropL.value) + 'px',
  height: (cropB.value - cropT.value) + 'px',
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

      <!-- Live kamera -->
      <video v-if="!capturedSrc" ref="videoRef" playsinline muted
             class="absolute inset-0 w-full h-full object-cover"
             :class="{ '-scale-x-100': facingMode === 'user' }" />

      <!-- Stille bilde (post-capture) -->
      <img v-if="capturedSrc" ref="previewImgRef" :src="capturedSrc"
           :style="imgStyle"
           class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
           draggable="false" />

      <!-- Gestur-layer: fanger pan/zoom og hjørne-drag -->
      <div v-if="capturedSrc"
           class="absolute inset-0"
           style="z-index: 10; touch-action: none;"
           @touchstart.prevent="onStageTouchStart"
           @touchmove.prevent="onStageTouchMove"
           @touchend="onStageTouchEnd"
           @touchcancel="onStageTouchEnd"
           @pointerdown="onStagePointerDown" />

      <!-- Crop-overlay: mørk veil + ramme + guider -->
      <template v-if="capturedSrc">
        <!-- Veil: fire felter rundt crop-boksen -->
        <div class="absolute inset-x-0 bg-black/60 pointer-events-none"
             :style="{ top: 0, height: cropT + 'px', zIndex: 11 }" />
        <div class="absolute inset-x-0 bg-black/60 pointer-events-none"
             :style="{ top: cropB + 'px', bottom: 0, zIndex: 11 }" />
        <div class="absolute bg-black/60 pointer-events-none"
             :style="{ left: 0, width: cropL + 'px', top: cropT + 'px',
                       height: (cropB - cropT) + 'px', zIndex: 11 }" />
        <div class="absolute bg-black/60 pointer-events-none"
             :style="{ left: cropR + 'px', right: 0, top: cropT + 'px',
                       height: (cropB - cropT) + 'px', zIndex: 11 }" />

        <!-- Crop-ramme med guider -->
        <div class="absolute border border-amber-400/70 pointer-events-none"
             :style="{ ...cropBoxStyle, zIndex: 12 }">
          <!-- Grid 4×5 -->
          <div class="absolute inset-0 grid grid-cols-4 grid-rows-5">
            <div v-for="i in 20" :key="i" class="border border-amber-400/10" />
          </div>
          <!-- Grunnlinje (80% fra topp) -->
          <div class="absolute left-0 right-0 h-px bg-pink-400" style="top: 80%" />
          <!-- x-høyde (60% fra topp) -->
          <div class="absolute left-0 right-0 h-px border-t border-dashed border-cyan-300"
               style="top: 60%" />
        </div>

        <!-- Hjørne-handles: L-formede SVG, rent visuelt — gestur-laget under håndterer touch -->
        <div v-for="id in ['tl','tr','bl','br']" :key="id"
             :style="cornerStyle(id)"
             class="pointer-events-none">
          <svg viewBox="0 0 44 44" fill="none" class="w-full h-full">
            <!-- Ytre halosirkel for touch-target visualisering -->
            <circle cx="22" cy="22" r="10" fill="rgba(251,191,36,0.12)" />
            <polyline :points="CORNER_PATH[id]"
                      stroke="rgb(251,191,36)" stroke-width="3"
                      stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>

        <!-- Hint -->
        <div class="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none"
             style="z-index: 13">
          <p class="text-[11px] text-white/55 text-center bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm">
            Dra hjørnene for å justere · klyp for å zoome
          </p>
        </div>
      </template>

    </div><!-- /stage -->

    <!-- Kontroller -->
    <footer class="shrink-0 bg-black/90 backdrop-blur-xl border-t border-white/5
                   pb-[max(0.75rem,env(safe-area-inset-bottom))]">

      <!-- LIVE KAMERA -->
      <template v-if="!capturedSrc">
        <div class="px-5 pt-3 pb-1 flex items-center gap-3" v-if="cameraReady">
          <span class="text-[11px] text-white/40 w-6">1×</span>
          <input v-model.number="zoom" type="range"
                 :min="zoomRange.min" :max="zoomRange.max" :step="zoomRange.step"
                 class="flex-1 h-1 accent-amber-400 bg-white/10 rounded-full appearance-none" />
          <span class="text-[11px] text-amber-300 w-10 text-right">{{ zoom.toFixed(1) }}×</span>
        </div>

        <div class="px-5 py-3 grid grid-cols-3 items-center">
          <button @click="triggerFilePick"
                  class="justify-self-start flex flex-col items-center gap-1 text-white/70 active:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span class="text-[10px]">Last opp</span>
          </button>

          <button @click="capturePhoto" :disabled="!cameraReady"
                  class="justify-self-center w-16 h-16 rounded-full border-4 border-white
                         bg-white/10 active:scale-95 transition-transform disabled:opacity-30
                         flex items-center justify-center">
            <div class="w-11 h-11 rounded-full bg-white" />
          </button>

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

        <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileSelect" />
      </template>

      <!-- CROP-MODUS -->
      <template v-else>
        <div class="px-5 pt-3 pb-1 flex items-center gap-3">
          <span class="text-[11px] text-white/40 w-6">1×</span>
          <input v-model.number="imgZoom" type="range" min="1" max="8" step="0.1"
                 class="flex-1 h-1 accent-amber-400 bg-white/10 rounded-full appearance-none" />
          <span class="text-[11px] text-amber-300 w-10 text-right">{{ imgZoom.toFixed(1) }}×</span>
        </div>

        <div class="px-4 py-3 flex gap-2">
          <button @click="cancel"
                  class="px-4 py-3 rounded-xl border border-white/15
                         text-white/60 text-sm active:bg-white/5">
            Avbryt
          </button>
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
input[type="range"] { -webkit-appearance: none; }
</style>

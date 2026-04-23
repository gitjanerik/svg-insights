<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ALL_GLYPHS, GLYPH_GROUPS, glyphs, fontMetrics, fontSettings,
  fontName, detectedFontInfo, setGlyphPath, glyphStats, canExportFont,
} from '../composables/useFontProject.js'
import { useGlyphEditor } from '../composables/useGlyphEditor.js'
import { generateGlyphFromSystemFont, traceGlyphFromPhoto } from '../lib/canvasGlyphRenderer.js'
import { polygonToBezier } from '../lib/bezierSmoothing.js'
import GlyphPhotoDialog from '../components/GlyphPhotoDialog.vue'

const router = useRouter()
const editor = useGlyphEditor()

const selectedChar = ref(null)
const photoDialogOpen = ref(false)

// ── Glyph selection & loading ────────────────────────────────────────────

function openGlyph(char) {
  selectedChar.value = char
  // Ensure a starting path exists. If none, render with the browser font
  // using the chosen Google font as fontFamily.
  if (!glyphs[char] || !glyphs[char].pathD) {
    const fontFamily = detectedFontInfo.value?.suggestions?.[0]?.name || 'sans-serif'
    const rendered = generateGlyphFromSystemFont(char, fontMetrics, fontFamily, fontSettings)
    if (rendered?.pathD) {
      setGlyphPath(char, rendered.pathD, rendered.advanceWidth, 'auto')
    }
  }
  editor.loadPath(char, glyphs[char]?.pathD || '')
}

function closeGlyph() {
  // Persist edits before closing
  if (selectedChar.value && editor.points.value.length) {
    const newD = editor.toPathD()
    const prev = glyphs[selectedChar.value]
    if (prev && prev.pathD !== newD) {
      setGlyphPath(selectedChar.value, newD, prev.advanceWidth, 'edited')
    }
  }
  selectedChar.value = null
}

// Auto-save on any point change
watch(() => editor.points.value, () => {
  if (!selectedChar.value) return
  if (!editor.points.value.length) return
  const newD = editor.toPathD()
  const prev = glyphs[selectedChar.value]
  if (!prev || prev.pathD === newD) return
  setGlyphPath(selectedChar.value, newD, prev.advanceWidth,
    prev.status === 'auto' ? 'auto' : 'edited')
}, { deep: true })

// ── Status + colors for the grid ─────────────────────────────────────────

const stats = computed(() => glyphStats())

function statusColor(char) {
  const g = glyphs[char]
  if (!g || g.status === 'empty') return 'bg-white/5 border-white/5'
  if (g.status === 'edited') return 'bg-emerald-500/15 border-emerald-400/40'
  if (g.status === 'traced') return 'bg-amber-500/15 border-amber-400/40'
  return 'bg-sky-500/10 border-sky-400/30' // auto
}

// ── Index navigation ─────────────────────────────────────────────────────

const currentIndex = computed(() => ALL_GLYPHS.indexOf(selectedChar.value))
function prevGlyph() {
  if (currentIndex.value > 0) openGlyph(ALL_GLYPHS[currentIndex.value - 1])
}
function nextGlyph() {
  if (currentIndex.value < ALL_GLYPHS.length - 1) openGlyph(ALL_GLYPHS[currentIndex.value + 1])
}

// ── Canvas zoom/pan ──────────────────────────────────────────────────────

const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const pinchStart = ref(null)
const panStart   = ref(null)

// SVG viewBox spans ascender→descender; add lateral padding
const VIEW = {
  xMin: -100,
  yMin: -(fontMetrics.ascender + 50),
  w: fontMetrics.defaultAdvanceWidth + 200,
  h: fontMetrics.ascender - fontMetrics.descender + 100,
}
const viewBox = computed(() => {
  const z = zoom.value
  const w = VIEW.w / z
  const h = VIEW.h / z
  const cx = VIEW.xMin + VIEW.w / 2 + panX.value
  const cy = VIEW.yMin + VIEW.h / 2 + panY.value
  return `${cx - w/2} ${cy - h/2} ${w} ${h}`
})

function zoomIn()    { zoom.value = Math.min(8,   zoom.value * 1.3) }
function zoomOut()   { zoom.value = Math.max(0.3, zoom.value / 1.3) }
function zoomReset() { zoom.value = 1; panX.value = 0; panY.value = 0 }

function onSvgTouchStart(e) {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    pinchStart.value = { dist: Math.hypot(dx, dy), zoom: zoom.value }
  } else if (e.touches.length === 1) {
    panStart.value = { x: e.touches[0].clientX, y: e.touches[0].clientY, panX: panX.value, panY: panY.value }
  }
}
function onSvgTouchMove(e) {
  if (e.touches.length === 2 && pinchStart.value) {
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    const dist = Math.hypot(dx, dy)
    zoom.value = Math.max(0.3, Math.min(8, pinchStart.value.zoom * (dist / pinchStart.value.dist)))
  } else if (e.touches.length === 1 && panStart.value) {
    const invZ = 1 / zoom.value
    panX.value = panStart.value.panX - (e.touches[0].clientX - panStart.value.x) * invZ * 1.5
    panY.value = panStart.value.panY - (e.touches[0].clientY - panStart.value.y) * invZ * 1.5
  }
}
function onSvgTouchEnd() { pinchStart.value = null; panStart.value = null }

// ── Anchor/handle dragging ───────────────────────────────────────────────

const dragging = ref(null)   // { kind: 'anchor'|'cp1'|'cp2', index }
const svgRoot  = ref(null)

function screenToSvg(clientX, clientY) {
  const svg = svgRoot.value
  if (!svg) return { x: 0, y: 0 }
  const pt = svg.createSVGPoint()
  pt.x = clientX; pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const inv = ctm.inverse()
  const out = pt.matrixTransform(inv)
  return { x: Math.round(out.x), y: Math.round(out.y) }
}

function ptDown(e, index, which = 'anchor') {
  e.stopPropagation()
  e.preventDefault()
  editor.startDrag()
  if (which === 'anchor') editor.selectAnchor(index)
  dragging.value = { kind: which, index }
}

function onMove(e) {
  if (!dragging.value) return
  e.preventDefault()
  const { clientX, clientY } = e.touches ? e.touches[0] : e
  const svgPt = screenToSvg(clientX, clientY)
  const { kind, index } = dragging.value
  if (kind === 'anchor') editor.dragAnchor(index, svgPt.x, svgPt.y)
  else if (kind === 'cp1') editor.dragCp1(index, svgPt.x, svgPt.y)
  else if (kind === 'cp2') editor.dragCp2(index, svgPt.x, svgPt.y)
}
function onUp() { dragging.value = null }

/** Deselect when user taps empty canvas (not on an anchor/handle). */
function canvasTap(e) {
  if (e.target.tagName === 'svg' || e.target.tagName === 'path') {
    editor.clearSelection()
  }
}

// ── Smooth-path helper for auto-traced polygons ──────────────────────────

function smoothPathD(pathD) {
  if (!pathD) return pathD
  if (/[CcQq]/.test(pathD)) return pathD
  const subpaths = pathD.split(/(?=M)/).filter(Boolean)
  return subpaths.map(sub => {
    const anchors = []
    const pts = sub.matchAll(/([ML])\s*([-\d.]+)\s+([-\d.]+)/g)
    for (const m of pts) anchors.push({ x: +m[2], y: +m[3] })
    if (anchors.length < 3) return sub
    const smoothed = polygonToBezier(anchors, 1)
    if (!smoothed?.length) return sub
    const parts = smoothed.map(p => {
      if (p.type === 'M') return `M${p.x} ${p.y}`
      if (p.type === 'C') return `C${p.cp1x} ${p.cp1y} ${p.cp2x} ${p.cp2y} ${p.x} ${p.y}`
      return `L${p.x} ${p.y}`
    })
    return parts.join(' ') + ' Z'
  }).join(' ')
}

// ── Debug logging ────────────────────────────────────────────────────────

const debugStatus = ref([])
const isDev = import.meta.env.DEV
function logStatus(msg) {
  if (isDev) debugStatus.value.push(msg)
  console.log('[FontEditor]', msg)
}

// ── Initial pre-generation of all 97 glyphs ──────────────────────────────

const loading = ref(true)
const loadProgress = ref(0)
const loadTotal    = ref(0)
const loadingFontFamily = ref('sans-serif')

onMounted(async () => {
  logStatus(`Start. Valgt font: ${detectedFontInfo.value?.suggestions?.[0]?.name || 'ingen'}`)

  const sugg = detectedFontInfo.value?.suggestions?.[0]
  const fontFamily = sugg?.name || 'sans-serif'
  loadingFontFamily.value = fontFamily

  if (sugg?.googleId) {
    const existing = document.getElementById(`gfont-${sugg.googleId}`)
    if (!existing) {
      const link = document.createElement('link')
      link.id   = `gfont-${sugg.googleId}`
      link.rel  = 'stylesheet'
      link.href = `https://fonts.googleapis.com/css2?family=${sugg.googleId}:wght@400&display=swap`
      document.head.appendChild(link)
    }
    logStatus(`Laster ${fontFamily}…`)
    try {
      await Promise.race([
        document.fonts.load(`400 24px "${fontFamily}"`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('font load timeout')), 6000)),
      ])
      logStatus('Font klar')
    } catch (e) {
      logStatus(`Font-lasting feilet: ${e.message} — bruker fallback`)
    }
  }

  const pending = ALL_GLYPHS.filter(c => !(glyphs[c] && glyphs[c].pathD))
  loadTotal.value = pending.length
  loadProgress.value = 0

  const BATCH = 8
  let captured = 0
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH)
    for (const c of slice) {
      try {
        const r = generateGlyphFromSystemFont(c, fontMetrics, fontFamily, fontSettings)
        if (r?.pathD) {
          setGlyphPath(c, r.pathD, r.advanceWidth, 'auto')
          captured++
        }
      } catch (e) {
        console.warn('[FontEditor] glyph-gen failed for', c, e)
      }
      loadProgress.value++
    }
    // Yield to browser so it can repaint
    await new Promise(r => setTimeout(r, 0))
  }

  logStatus(`Fanget ${captured} glyfer med "${fontFamily}"`)
  loading.value = false
})

// ── Photo capture flow ───────────────────────────────────────────────────

async function handlePhotoCapture(imageDataUrl) {
  if (!selectedChar.value) return
  photoDialogOpen.value = false
  const r = await traceGlyphFromPhoto(imageDataUrl, fontMetrics, fontSettings)
  if (r?.pathD) {
    setGlyphPath(selectedChar.value, r.pathD, r.advanceWidth, 'traced')
    editor.loadPath(selectedChar.value, r.pathD)
  }
}

function goToPreview() {
  router.push('/font-preview')
}
function backToOverview() {
  router.push('/')
}
</script>

<template>
  <div class="flex flex-col h-[100dvh] overflow-hidden bg-[#0a0a0f] text-white">

    <!-- Loading overlay -->
    <div v-if="loading"
         class="fixed inset-0 z-50 flex flex-col items-center justify-center
                bg-gradient-to-br from-[#0a0a0f] via-[#12091c] to-[#0a0a0f]">
      <div class="relative mb-8">
        <div class="text-[160px] leading-none font-bold relative"
             :style="{ fontFamily: `'${loadingFontFamily}', sans-serif` }">
          <span class="text-white/30">A</span><span class="text-amber-400/80">g</span>
        </div>
      </div>
      <div class="text-sm text-white/60 mb-3">Lager glyfer …</div>
      <div class="w-48 h-1 rounded-full bg-white/10 overflow-hidden">
        <div class="h-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all"
             :style="{ width: loadTotal ? (loadProgress / loadTotal * 100) + '%' : '0%' }" />
      </div>
      <div class="text-[11px] text-white/40 mt-2">{{ loadProgress }} / {{ loadTotal }}</div>
      <div v-if="isDev" class="absolute bottom-4 left-4 right-4 text-[10px] text-white/30 font-mono">
        <div v-for="(msg, i) in debugStatus" :key="i">{{ msg }}</div>
      </div>
    </div>

    <!-- Overview grid -->
    <template v-if="!selectedChar">
      <header class="shrink-0 z-10 flex items-center justify-between px-4 py-2
                     bg-black/60 backdrop-blur-xl border-b border-white/5">
        <button @click="backToOverview" class="text-white/60 active:text-white text-sm">
          ← Hjem
        </button>
        <h1 class="text-sm font-medium text-white/80">{{ fontName }}</h1>
        <button @click="goToPreview" :disabled="!canExportFont()"
                class="text-xs px-3 py-1 rounded-full border border-amber-400/40
                       text-amber-300 disabled:opacity-30 active:bg-amber-400/10">
          <svg xmlns="http://www.w3.org/2000/svg" class="inline w-3 h-3 mr-1" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          .otf
        </button>
      </header>

      <div class="flex-1 overflow-y-auto px-4 py-3 scrollbar-none">
        <div class="text-xs text-white/50 mb-3 flex flex-wrap gap-x-3 gap-y-1">
          <span><span class="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1"/>{{ stats.edited }} redigert</span>
          <span><span class="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1"/>{{ stats.traced }} fra foto</span>
          <span><span class="inline-block w-2 h-2 rounded-full bg-sky-400 mr-1"/>{{ stats.auto }} auto</span>
          <span><span class="inline-block w-2 h-2 rounded-full bg-white/20 mr-1"/>{{ stats.empty }} tom</span>
        </div>

        <div v-for="(chars, groupName) in GLYPH_GROUPS" :key="groupName" class="mb-5">
          <div class="text-[11px] uppercase tracking-wider text-white/40 mb-2">
            {{ { upper: 'Store bokstaver', lower: 'Små bokstaver', digits: 'Tall', punct: 'Tegnsetting' }[groupName] }}
          </div>
          <div class="grid grid-cols-7 gap-2">
            <button v-for="c in chars" :key="c"
                    @click="openGlyph(c)"
                    :class="['aspect-square rounded-lg border text-xl font-medium',
                             'flex items-center justify-center transition-colors active:scale-95',
                             statusColor(c)]">
              {{ c }}
            </button>
          </div>
        </div>

        <!-- NB: typography settings (x-height, cap-height, tracking, skew)
             are now configured in the naming step before the editor opens.
             The old accordion here was removed in v4.12.7. -->
      </div>
    </template>

    <!-- Per-glyph editor -->
    <template v-else>
      <header class="shrink-0 z-10 flex items-center justify-between px-4 py-2
                     bg-black/60 backdrop-blur-xl border-b border-white/5">
        <button @click="closeGlyph" class="text-white/60 active:text-white text-sm">← Oversikt</button>
        <h1 class="text-sm font-medium text-white/80">{{ fontName }}</h1>
        <button @click="goToPreview" :disabled="!canExportFont()"
                class="text-xs px-3 py-1 rounded-full border border-amber-400/40
                       text-amber-300 disabled:opacity-30">
          .otf
        </button>
      </header>

      <div class="shrink-0 px-4 py-2 flex items-center justify-between border-b border-white/5">
        <button @click="prevGlyph" :disabled="currentIndex <= 0"
                class="w-10 h-10 rounded-lg bg-white/5 border border-white/10
                       disabled:opacity-30 active:bg-white/10">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mx-auto text-white/70"
               viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="text-center">
          <div class="text-3xl font-bold">{{ selectedChar }}</div>
          <div class="text-[11px] text-white/40 mt-0.5">
            {{ currentIndex + 1 }} / {{ ALL_GLYPHS.length }} ·
            {{ glyphs[selectedChar]?.status || 'empty' }}
          </div>
        </div>
        <button @click="nextGlyph" :disabled="currentIndex >= ALL_GLYPHS.length - 1"
                class="w-10 h-10 rounded-lg bg-white/5 border border-white/10
                       disabled:opacity-30 active:bg-white/10">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mx-auto text-white/70"
               viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <div class="px-4 pt-2 text-[11px] text-white/50">
        Dra de <strong class="text-white/80">{{ editor.points.value.length }} punktene</strong>
        for å justere formen. Endringer lagres automatisk.
      </div>

      <!-- Canvas -->
      <div class="flex-1 relative overflow-hidden"
           @mousemove="onMove" @mouseup="onUp" @mouseleave="onUp"
           @touchmove="onMove" @touchend="onUp" @touchcancel="onUp">
        <svg ref="svgRoot" :viewBox="viewBox"
             @touchstart.passive="onSvgTouchStart"
             @touchmove.passive="onSvgTouchMove"
             @touchend="onSvgTouchEnd"
             @click="canvasTap"
             class="w-full h-full touch-none">
          <g :transform="`scale(1, -1)`">
            <!-- Metric guides -->
            <line :x1="VIEW.xMin" :x2="VIEW.xMin + VIEW.w" :y1="fontMetrics.capHeight" :y2="fontMetrics.capHeight"
                  stroke="#ffffff15" stroke-dasharray="4 4" />
            <text :x="VIEW.xMin + 10" :y="fontMetrics.capHeight" transform="scale(1,-1)"
                  class="text-[10px] fill-sky-400/50" font-size="18">cap</text>
            <line :x1="VIEW.xMin" :x2="VIEW.xMin + VIEW.w" :y1="fontMetrics.xHeight" :y2="fontMetrics.xHeight"
                  stroke="#ffffff15" stroke-dasharray="4 4" />
            <text :x="VIEW.xMin + 10" :y="fontMetrics.xHeight" transform="scale(1,-1)"
                  class="text-[10px] fill-sky-400/50" font-size="18">x</text>
            <line :x1="VIEW.xMin" :x2="VIEW.xMin + VIEW.w" y1="0" y2="0" stroke="#ffffff25" />
            <text :x="VIEW.xMin + 10" y="0" transform="scale(1,-1)"
                  class="text-[10px] fill-sky-400/50" font-size="18">base</text>

            <!-- Filled path preview -->
            <path v-if="editor.points.value.length"
                  :d="editor.toPathD()" fill="#a78bfa30" stroke="none" fill-rule="evenodd" />

            <!-- Outline -->
            <path v-if="editor.points.value.length"
                  :d="editor.toPathD()" fill="none" stroke="#c4b5fd" stroke-width="3"
                  vector-effect="non-scaling-stroke" />

            <!-- Handle lines (for C curves) -->
            <g v-for="(p, i) in editor.points.value" :key="'h'+i">
              <template v-if="p.type === 'C'">
                <line :x1="editor.points.value[(i-1+editor.points.value.length) % editor.points.value.length].x"
                      :y1="editor.points.value[(i-1+editor.points.value.length) % editor.points.value.length].y"
                      :x2="p.cp1x" :y2="p.cp1y" stroke="#ffffff20" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="3 3" />
                <line :x1="p.x" :y1="p.y" :x2="p.cp2x" :y2="p.cp2y"
                      stroke="#ffffff20" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="3 3" />
              </template>
            </g>

            <!-- Handle points -->
            <g v-for="(p, i) in editor.points.value" :key="'cp'+i">
              <circle v-if="p.type === 'C'"
                      :cx="p.cp1x" :cy="p.cp1y" r="6" fill="transparent"
                      stroke="#c4b5fd80" stroke-width="1" vector-effect="non-scaling-stroke"
                      @mousedown="e => ptDown(e, i, 'cp1')"
                      @touchstart="e => ptDown(e, i, 'cp1')" />
              <circle v-if="p.type === 'C'"
                      :cx="p.cp2x" :cy="p.cp2y" r="6" fill="transparent"
                      stroke="#c4b5fd80" stroke-width="1" vector-effect="non-scaling-stroke"
                      @mousedown="e => ptDown(e, i, 'cp2')"
                      @touchstart="e => ptDown(e, i, 'cp2')" />
            </g>

            <!-- Anchor points -->
            <g v-for="(p, i) in editor.points.value" :key="'a'+i">
              <circle :cx="p.x" :cy="p.y" r="10"
                      :fill="editor.selectedIdx.value === i ? '#fbbf24' : '#e5e7eb'"
                      :stroke="editor.selectedIdx.value === i ? '#f59e0b' : '#ffffff'"
                      stroke-width="2" vector-effect="non-scaling-stroke"
                      @mousedown="e => ptDown(e, i, 'anchor')"
                      @touchstart="e => ptDown(e, i, 'anchor')" />
            </g>
          </g>
        </svg>

        <!-- Floating zoom controls -->
        <div class="absolute right-3 bottom-4 flex flex-col gap-2">
          <button @click="zoomIn" class="w-11 h-11 rounded-lg bg-white/10 backdrop-blur border border-white/10 text-white active:bg-white/20">+</button>
          <button @click="zoomOut" class="w-11 h-11 rounded-lg bg-white/10 backdrop-blur border border-white/10 text-white active:bg-white/20">−</button>
          <button @click="zoomReset" class="w-11 h-11 rounded-lg bg-white/10 backdrop-blur border border-white/10 text-[10px] text-white active:bg-white/20">
            {{ Math.round(zoom * 100) }}%
          </button>
        </div>
      </div>

      <!-- Quick actions row -->
      <div class="shrink-0 overflow-x-auto scrollbar-none border-t border-white/10 bg-black/40">
        <div class="flex gap-2 px-3 py-2 w-max">
          <button @click="photoDialogOpen = true"
                  class="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg
                         border border-amber-400/40 text-amber-300 text-xs active:bg-amber-400/10">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
            </svg>
            Fra bilde
          </button>
          <button @click="editor.makeSmooth"
                  class="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg
                         border border-violet-400/40 bg-violet-500/10 text-violet-200 text-xs active:bg-violet-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 17 Q 12 4, 21 17"/>
            </svg>
            Gjør myk
          </button>
          <button @click="editor.makeStraight"
                  class="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg
                         border border-white/10 text-white/70 text-xs active:bg-white/10">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"/>
            </svg>
            Rett
          </button>
          <button @click="editor.simplify"
                  class="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg
                         border border-violet-400/40 bg-violet-500/5 text-violet-200 text-xs active:bg-violet-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
            </svg>
            Forenkle
          </button>
          <button @click="editor.thicken(8)"
                  class="shrink-0 px-3 py-2 rounded-lg border border-white/10 text-white/70 text-xs active:bg-white/10">
            Tykkere
          </button>
          <button @click="editor.thicken(-8)"
                  class="shrink-0 px-3 py-2 rounded-lg border border-white/10 text-white/70 text-xs active:bg-white/10">
            Tynnere
          </button>
        </div>
      </div>

      <!-- Sticky bottom actions -->
      <footer class="shrink-0 border-t border-white/10 bg-black/70 backdrop-blur-xl
                     px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]
                     grid grid-cols-4 gap-2">
        <button @click="editor.addPointAfterSelected" :disabled="!editor.canAddPoint.value"
                class="px-3 py-2.5 rounded-lg border border-white/10 text-xs text-white/70
                       disabled:opacity-30 active:bg-white/10">
          + Punkt
        </button>
        <button @click="editor.removeSelected" :disabled="!editor.canRemovePoint.value"
                class="px-3 py-2.5 rounded-lg border border-white/10 text-xs text-white/70
                       disabled:opacity-30 active:bg-white/10">
          − Punkt
        </button>
        <button @click="closeGlyph"
                class="px-3 py-2.5 rounded-lg border border-amber-400/40 bg-amber-500/10
                       text-xs text-amber-200 active:bg-amber-500/20 font-medium">
          Lagre og tilbake
        </button>
        <button @click="nextGlyph" :disabled="currentIndex >= ALL_GLYPHS.length - 1"
                class="px-3 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400
                       text-black text-xs font-semibold disabled:opacity-30 active:scale-95 transition-transform">
          Neste →
        </button>
      </footer>
    </template>

    <!-- Glyph photo capture: camera preview, 4×5 crop overlay with
         baseline + x-height guides, and a digital-zoom still-preview. -->
    <GlyphPhotoDialog
      :open="photoDialogOpen"
      :char="selectedChar || ''"
      @capture="dataUrl => { photoDialogOpen = false; handlePhotoCapture(dataUrl) }"
      @cancel="photoDialogOpen = false" />
  </div>
</template>

<style scoped>
.scrollbar-none::-webkit-scrollbar { display: none; }
.scrollbar-none { scrollbar-width: none; }
</style>

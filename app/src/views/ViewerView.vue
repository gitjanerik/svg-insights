<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { usePinchZoom } from '../composables/usePinchZoom.js'
import { filterPresets, svgFilterDefs, dashPatterns } from '../lib/filterPresets.js'
import {
  straightenPaths, wobblePaths, adjustStrokeWidths,
  setDashPattern, setLinecap, setGroupOpacities,
  injectFilterDefs, applyGroupFilter,
  convertToHalftone,
  trimPaths, simplifyPaths, spaghettify, calligraphy, kurvatur,
  setStrokeOpacity, setHatchOpacity,
} from '../lib/pathFilters.js'
import { computeFills, insertFills, removeColorization, rgbToHex, hslToRgb } from '../lib/colorization.js'
import { useHalftoneGame } from '../composables/useHalftoneGame.js'
import { useDraggableDrawer } from '../composables/useDraggableDrawer.js'
import SolarSystemSetupModal from '../components/SolarSystemSetupModal.vue'

const router = useRouter()

const originalSvg = ref('')
const svgHtml = ref('')
const svgWidth = ref(600)
const svgHeight = ref(400)

const containerRef = ref(null)
const { scale, translateX, translateY, reset: resetZoom } = usePinchZoom(containerRef)

// Panel: which tab is open in the sidebar
const activeTab = ref('presets') // presets, stroke, layers, effects, color

// Filter state
const strokeScale = ref(2.5)
const strokeColor = ref('#c4b5fd')
const bgColor = ref('#0a0a0f')
const currentPreset = ref(null)
const dashPattern = ref('solid')
const linecapStyle = ref('round')
const isSmooth = ref(true)
const wobbleIntensity = ref(0)
const svgFilter = ref(null)
const showPanel = ref(true)
const halftone = ref(false)
const halftoneScale = ref(1.0)
const halftoneMerge = ref(0.3)
const halftoneBlend = ref('normal')
const halftoneOpacity = ref(50)
const halftoneColor = ref('#000000')

// ── Strek-tab effects (v4.11) ──────────────────────────────────────────
// Each effect has an `enabled` toggle and an `amount` slider. Turning a
// toggle off instantly reverses the effect — we simply skip that filter
// in the rebuild pipeline. The original svg is never mutated.

// Trimming: remove N% of paths (10%-90% is the sensible working range)
const trimEnabled = ref(false)
const trimAmount  = ref(0.3)   // default 30%

// Forenkling: Ramer-Douglas-Peucker simplification
const simplifyEnabled = ref(false)
const simplifyAmount  = ref(0.3)

// Spagettifisering: moving-average smoothing over coordinates
const spaghettiEnabled = ref(false)
const spaghettiAmount  = ref(0.4)

// Kalligrafi: -1 (konkav) → 0 (flat) → +1 (konveks)
const calligraphyEnabled = ref(false)
const calligraphyAmount  = ref(-0.5)

// Kurvatur (à la Frode Øverli): replace N% of curves with straight lines
const kurvaturEnabled = ref(false)
const kurvaturAmount  = ref(0.5)

// Opacity slider for strokes
const strokeOpacity = ref(1.0)

// Opacity slider for hatching
const hatchOpacity = ref(1.0)

const exportWithBg = ref(true)

// Info popover for the interactive modes
const showInteractivityInfo = ref(false)

// Halftone gamification
const game = useHalftoneGame({
  halftone,
  originalSvg,
  halftoneScale,
  halftoneMerge,
  strokeColor: halftoneColor,
  onEmpty: () => {},
})
const gameMode = game.mode
const gameDots = game.dots
const gamePointer = game.pointer
const gameSvgRef = game.gameSvgRef
const gameActive = game.isActive
const solarSystem = game.solarSystem
const solarSystemPending = game.solarSystemPending
const onGamePointerDown = game.onPointerDown
const onGamePointerMove = game.onPointerMove
const onGamePointerUp = game.onPointerUp
const resetGame = () => game.reset()

// Solar-system setup modal handlers
function onSolarStart(config) {
  if (solarSystemPending.value) {
    game.startSolarSystem(solarSystemPending.value, config)
  }
}
function onSolarCancel() {
  game.cancelSolarSystem()
}

// Click on a planet → shift its orbit inward; shift-click (or long-press)
// shifts outward. On touch we simply toggle direction based on the planet's
// position: inner half shifts outward, outer half shifts inward, so every
// tap is a meaningful move.
function onPlanetTap(planet, event) {
  if (!solarSystem.value) return
  event?.stopPropagation()
  // Use shift/alt modifier on desktop, otherwise decide by current orbit
  const planets = gameDots.value.filter(d => d.isPlanet)
  const sorted = [...planets].sort((a, b) => a.a - b.a)
  const idx = sorted.indexOf(planet)
  const mid = (sorted.length - 1) / 2
  const direction = event?.shiftKey
    ? -1
    : event?.altKey
      ? 1
      : idx > mid ? -1 : 1 // outer planets move in, inner planets move out
  game.shiftPlanetOrbit(planet.id, direction)
}

// Live info about the sun (if solar system is active) for halo rendering
const sunDot = computed(() => gameDots.value.find(d => d.isSun) || null)

// Precomputed orbit-path ellipses (so the template stays readable)
// Everything except the sun — the sun renders separately outside the halftone
// opacity group so it stays fully opaque and knall gul.
const nonSunDots = computed(() => gameDots.value.filter(d => !d.isSun))

const orbitPaths = computed(() => {
  if (!solarSystem.value || !sunDot.value) return []
  const sx = sunDot.value.x
  const sy = sunDot.value.y
  const paths = []
  for (const d of gameDots.value) {
    if (!d.isPlanet) continue
    // Sun sits at the right focus; ellipse centre is offset left by c, rotated.
    const cosR = Math.cos(d.orbitRotation)
    const sinR = Math.sin(d.orbitRotation)
    const cx = sx - d.c * cosR
    const cy = sy - d.c * sinR
    paths.push({
      id: d.id,
      cx, cy,
      rx: d.a,
      ry: d.b,
      rotDeg: d.orbitRotation * 180 / Math.PI,
    })
  }
  return paths
})

const rotation = ref(0)

const opacities = reactive({ edges: 100, contours: 50, hatching: 35 })

const colorPresets = [
  { name: 'Sort', value: '#000000' },
  { name: 'Fiolett', value: '#c4b5fd' },
  { name: 'Cyan', value: '#67e8f9' },
  { name: 'Gronn', value: '#86efac' },
  { name: 'Rosa', value: '#f9a8d4' },
  { name: 'Hvit', value: '#ffffff' },
  { name: 'Gull', value: '#fbbf24' },
]

const bgPresets = [
  { name: 'Sort', value: '#000000' },
  { name: 'Hvit', value: '#ffffff' },
  { name: 'Morkt', value: '#0a0a0f' },
  { name: 'Rod', value: '#991b1b' },
  { name: 'Oransj', value: '#9a3412' },
  { name: 'Gul', value: '#854d0e' },
  { name: 'Gronn', value: '#166534' },
  { name: 'Bla', value: '#1e3a5f' },
  { name: 'Lilla', value: '#581c87' },
  { name: 'Rosa', value: '#831843' },
]


const colorized = ref(false)
const colorizing = ref(false)
const fillDelay = ref(0.1)
const fillBatch = ref(5)
const fillsData = ref([])
const revealedCount = ref(0)
let revealTimer = null

// Mobile drawer — only active on narrow viewports. Desktop keeps the sidebar.
const isMobileView = ref(false)
function updateMobile() {
  isMobileView.value = window.matchMedia('(max-width: 767px)').matches
}
if (typeof window !== 'undefined') {
  updateMobile()
  window.addEventListener('resize', updateMobile, { passive: true })
  onBeforeUnmount?.(() => window.removeEventListener('resize', updateMobile))
}
const drawer = useDraggableDrawer({
  expandedHeight: 0.45,   // drawer takes 45% of viewport when expanded
  minimizedPeek: 28,      // just the handle strip remains visible
  snapThreshold: 1 / 3,   // magnet kicks in past 1/3 travel
})

// On mobile the floating buttons + stats should hover just above the drawer.
// We read `visibleHeightPx` and add a small gap. On desktop the drawer doesn't
// exist in this layout so buttons stay at `bottom-4`.
const bottomOffsetStyle = computed(() => {
  if (!isMobileView.value) return {} // desktop: rely on bottom-4 class
  const gap = 12
  return { bottom: (drawer.visibleHeightPx.value + gap) + 'px' }
})

// Height reserved for drawer — SVG canvas uses this to know how much
// vertical space to give up. When drawer minimises, the canvas expands.
const canvasReservedSpaceStyle = computed(() => {
  if (!isMobileView.value) return {}
  return { paddingBottom: drawer.visibleHeightPx.value + 'px' }
})

// Reset drawer to expanded whenever the panel re-opens so the user doesn't
// return to a minimised state they forgot about.
watch(showPanel, (open) => {
  if (open) drawer.reset()
})

const transformStyle = computed(() => ({
  transform: `scale(${scale.value}) translate(${translateX.value}px, ${translateY.value}px) rotate(${rotation.value}deg)`,
  transition: 'transform 0.1s ease-out',
}))

// Visible stroke count — counts <path> tags in the rendered SVG
const strokeCount = computed(() => {
  const html = svgHtml.value
  if (!html) return 0
  // Count self-closing and open <path ...> occurrences. A simple regex is
  // enough since we control the output ourselves.
  const matches = html.match(/<path\b/gi)
  return matches ? matches.length : 0
})

// Count of "coloured regions" — only visible when colorization is active
const colouredRegionCount = computed(() => {
  if (!colorized.value) return null
  // Use revealedCount so the number grows as the reveal animation runs
  return revealedCount.value
})

// Choose text colour based on background luminance: light bg → dark text,
// dark bg → light text. Returns 'white/70' or 'slate-900/70' style values.
const statsTextColor = computed(() => {
  const hex = (bgColor.value || '#0a0a0f').trim()
  // Accept '#rrggbb' (ignore rgba() or named — rare in our palette)
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.replace(/^#/, '#'))
  if (!m) return 'rgba(255,255,255,0.6)' // sensible default (dark bg)
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  // Relative luminance (Rec. 709). Threshold 0.5 is the standard cutover.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return lum > 0.5
    ? 'rgba(15,23,42,0.7)'   // slate-900 at 70% — for light backgrounds
    : 'rgba(255,255,255,0.6)' // white at 60% — for dark backgrounds
})

function rebuildSvg() {
  let svg = originalSvg.value
  if (!svg) return
  if (!colorized.value) svg = removeColorization(svg)
  svg = adjustStrokeWidths(svg, strokeScale.value)
  const lj = linecapStyle.value === 'butt' ? 'miter' : 'round'
  svg = setLinecap(svg, linecapStyle.value, lj)
  const dp = dashPatterns[dashPattern.value] || ''
  svg = setDashPattern(svg, dp)
  svg = setGroupOpacities(svg, opacities)
  if (!isSmooth.value) svg = straightenPaths(svg)
  if (wobbleIntensity.value > 0) svg = wobblePaths(svg, wobbleIntensity.value)

  // ── Strek-tab effect filters (v4.11) ──────────────────────────────
  // Order matters: trim first (removes paths), simplify (reduces anchors
  // on what's left), spaghettify (smooths), kurvatur (replaces curves),
  // calligraphy last (duplicates paths — doing it earlier would make the
  // others work twice).
  if (trimEnabled.value && trimAmount.value > 0) {
    svg = trimPaths(svg, trimAmount.value, 1)
  }
  if (simplifyEnabled.value && simplifyAmount.value > 0) {
    svg = simplifyPaths(svg, simplifyAmount.value)
  }
  if (spaghettiEnabled.value && spaghettiAmount.value > 0) {
    svg = spaghettify(svg, spaghettiAmount.value)
  }
  if (kurvaturEnabled.value && kurvaturAmount.value > 0) {
    svg = kurvatur(svg, kurvaturAmount.value, 7)
  }
  if (calligraphyEnabled.value && Math.abs(calligraphyAmount.value) > 0.01) {
    svg = calligraphy(svg, calligraphyAmount.value)
  }
  // Opacity sliders are always live (no toggle needed — 1.0 is neutral)
  if (strokeOpacity.value < 1) svg = setStrokeOpacity(svg, strokeOpacity.value)
  if (hatchOpacity.value < 1)  svg = setHatchOpacity(svg, hatchOpacity.value)

  if (svgFilter.value) {
    svg = injectFilterDefs(svg, svgFilterDefs)
    svg = applyGroupFilter(svg, svgFilter.value)
  } else {
    svg = applyGroupFilter(svg, null)
  }
  svg = svg.replace(/stroke="currentColor"/g, `stroke="${strokeColor.value}"`)

  // Halftone effect — dots use the current stroke colour and are placed by
  // photo-luminance on a grid so they cover contiguous image regions.
  // Skipped when gamification takes over: the game overlay renders dots reactively instead.
  if (halftone.value && !gameActive.value) {
    svg = convertToHalftone(svg, {
      scale: halftoneScale.value,
      usePhotoColors: false,
      dotColor: halftoneColor.value,
      merge: halftoneMerge.value,
      blend: halftoneBlend.value,
      opacity: halftoneOpacity.value,
    })
  }
  // In game mode the halftone dots render as a reactive overlay. Guide strokes
  // keep the user's Lag-tab opacity (we no longer force-dim them).

  svgHtml.value = svg
}

watch(
  [
    strokeScale, strokeColor, dashPattern, linecapStyle, isSmooth, wobbleIntensity,
    svgFilter, opacities, colorized, halftone, halftoneScale, halftoneMerge,
    halftoneBlend, halftoneOpacity, halftoneColor, gameActive,
    // New Strek-tab effect refs
    trimEnabled, trimAmount, simplifyEnabled, simplifyAmount,
    spaghettiEnabled, spaghettiAmount, calligraphyEnabled, calligraphyAmount,
    kurvaturEnabled, kurvaturAmount, strokeOpacity, hatchOpacity,
  ],
  rebuildSvg,
  { deep: true }
)

function applyPreset(name) {
  const p = filterPresets[name]
  if (!p) return
  currentPreset.value = name
  strokeScale.value = p.strokeScale
  strokeColor.value = p.strokeColor
  bgColor.value = p.bgColor
  opacities.edges = p.opacity.edges
  opacities.contours = p.opacity.contours
  opacities.hatching = p.opacity.hatching
  linecapStyle.value = p.linecap || 'round'
  dashPattern.value = Object.keys(dashPatterns).find(k => dashPatterns[k] === p.dashPattern) || 'solid'
  wobbleIntensity.value = p.wobble || 0
  svgFilter.value = p.svgFilter || null

  // Trigger / clear auto-colorization per preset flag
  if (p.autoColorize) {
    if (!colorized.value && !colorizing.value) startColorize()
  } else if (colorized.value) {
    stopColorize()
  }
}

async function startColorize(fills = null) {
  clearInterval(revealTimer)
  const rgba = window.__svgInsights_rgba
  if (!rgba && !fills) return

  colorizing.value = true
  await new Promise(r => setTimeout(r, 50))

  try {
    // Compute fills if not provided (photo-based)
    if (!fills) {
      fills = computeFills(originalSvg.value, rgba, svgWidth.value, svgHeight.value)
    }
    fillsData.value = fills

    // Insert all fills with opacity 0 initially
    const baseSvg = removeColorization(originalSvg.value)
    const hiddenFills = fills.map(f => ({ ...f, color: f.color }))
    originalSvg.value = insertFills(baseSvg, hiddenFills)
    colorized.value = true
    revealedCount.value = 0

    // Rebuild so the SVG is in the DOM, then animate
    rebuildSvg()
    await new Promise(r => setTimeout(r, 50))

    // Set all fill regions to hidden, then reveal one by one
    const container = containerRef.value
    if (container) {
      const paths = container.querySelectorAll('.fill-region')
      const delayMs = fillDelay.value * 1000
      const batch = fillBatch.value
      paths.forEach(p => {
        p.style.opacity = '0'
        p.style.transition = `opacity ${Math.max(200, delayMs)}ms ease-in-out`
      })

      if (delayMs === 0) {
        paths.forEach(p => { p.style.opacity = '1' })
        revealedCount.value = paths.length
      } else {
        let i = 0
        revealTimer = setInterval(() => {
          const end = Math.min(i + batch, paths.length)
          for (let j = i; j < end; j++) {
            paths[j].style.opacity = '1'
          }
          i = end
          revealedCount.value = i
          if (i >= paths.length) clearInterval(revealTimer)
        }, delayMs)
      }
    }
  } finally { colorizing.value = false }
}

function stopColorize() {
  clearInterval(revealTimer)
  colorized.value = false
  fillsData.value = []
  revealedCount.value = 0
}

function randomizeColors() {
  clearInterval(revealTimer)
  const rgba = window.__svgInsights_rgba
  if (!rgba) return

  // Compute fills from photo first if we don't have them
  let baseFills = fillsData.value
  if (!baseFills.length) {
    baseFills = computeFills(originalSvg.value, rgba, svgWidth.value, svgHeight.value)
  }

  // Pick a random base hue, then assign complementary/analogous colors
  const baseHue = Math.random() * 360
  const randomFills = baseFills.map((f, i) => {
    // Spread hues evenly + some randomness, vary saturation and lightness
    const hue = (baseHue + (i / baseFills.length) * 360 + Math.random() * 40 - 20) % 360
    const sat = 40 + Math.random() * 45
    const lit = 25 + Math.random() * 50
    const rgb = hslToRgb(hue, sat, lit)
    return { ...f, color: rgbToHex(rgb.r, rgb.g, rgb.b) }
  })

  startColorize(randomFills)
}

function handleReset() { resetZoom(); rotation.value = 0 }

function downloadSvg() {
  let out = svgHtml.value

  // In game mode, svgHtml only contains the line drawing (halftone is rendered
  // reactively as an overlay). Bake the live dot positions into the exported
  // SVG so the raster effect actually appears in the saved file.
  if (gameActive.value && gameDots.value.length > 0) {
    const opacityVal = (halftoneOpacity.value / 100).toFixed(2)
    const styleAttr = halftoneBlend.value !== 'normal'
      ? ` style="mix-blend-mode:${halftoneBlend.value}"`
      : ''
    // Exclude the sun from the opacity-controlled group — it gets rendered
    // separately below, fully opaque.
    const dotsForGroup = solarSystem.value
      ? gameDots.value.filter(d => !d.isSun)
      : gameDots.value
    const circles = dotsForGroup.map(d =>
      `    <circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${d.radius.toFixed(2)}" fill="${d.color}"/>`
    ).join('\n')
    const group = `  <g class="halftone-dots" opacity="${opacityVal}"${styleAttr}>\n${circles}\n  </g>`
    out = out.replace(/<\/svg>\s*$/i, `${group}\n</svg>`)
  }

  // Solar-system layering: orbits behind, sun + formula fully opaque on top
  if (solarSystem.value && sunDot.value) {
    const s = sunDot.value
    const orbitMarkup = orbitPaths.value.map(o =>
      `    <ellipse cx="${o.cx.toFixed(1)}" cy="${o.cy.toFixed(1)}" rx="${o.rx.toFixed(2)}" ry="${o.ry.toFixed(2)}" transform="rotate(${o.rotDeg.toFixed(2)}, ${o.cx.toFixed(1)}, ${o.cy.toFixed(1)})" fill="none" stroke="white" stroke-width="0.5" stroke-dasharray="1.5 3"/>`
    ).join('\n')
    const orbitsBefore = `  <g pointer-events="none" opacity="0.18">
${orbitMarkup}
  </g>`
    // Inject orbits before the halftone group so they sit behind the planets
    out = out.replace('<g class="halftone-dots"', `${orbitsBefore}\n  <g class="halftone-dots"`)

    // Sun corona + disc + formula go AFTER the halftone group so they're fully
    // opaque on top of everything.
    const fontSize = Math.max(11, s.radius * 0.42).toFixed(1)
    const sunBlock = `  <g pointer-events="none">
    <circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${(s.radius * 2.4).toFixed(2)}" fill="${s.color}" opacity="0.12"/>
    <circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${(s.radius * 1.7).toFixed(2)}" fill="${s.color}" opacity="0.25"/>
    <circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${(s.radius * 1.25).toFixed(2)}" fill="${s.color}" opacity="0.4"/>
  </g>
  <circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.radius.toFixed(2)}" fill="${s.color}" opacity="0.82"/>
  <text x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-family="serif" font-style="italic" fill="#1a1a1a" font-weight="600">ω ∝ r⁻³ᐟ²</text>`
    out = out.replace(/<\/svg>\s*$/i, `${sunBlock}\n</svg>`)
  }

  if (exportWithBg.value && bgColor.value) {
    // Insert a full-size background rect right after the opening <svg ...> tag
    const bgRect = `<rect width="100%" height="100%" fill="${bgColor.value}"/>`
    out = out.replace(/(<svg\b[^>]*>)/i, `$1\n${bgRect}`)
  }
  const blob = new Blob([out], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sketch.svg'
  a.click()
  URL.revokeObjectURL(url)
}

const tabs = [
  { id: 'presets', icon: 'grid', label: 'Presets' },
  { id: 'stroke', icon: 'pen', label: 'Strek' },
  { id: 'layers', icon: 'layers', label: 'Lag' },
  { id: 'effects', icon: 'sparkle', label: 'Effekter' },
  { id: 'color', icon: 'palette', label: 'Farge' },
]

onMounted(() => {
  const svg = sessionStorage.getItem('svgInsights_svg')
  const w = sessionStorage.getItem('svgInsights_w')
  const h = sessionStorage.getItem('svgInsights_h')
  if (!svg) { router.replace('/capture'); return }
  originalSvg.value = svg
  svgWidth.value = parseInt(w) || 600
  svgHeight.value = parseInt(h) || 400
  requestAnimationFrame(rebuildSvg)
})
</script>

<template>
  <div class="flex flex-col h-[100dvh] overflow-hidden select-none" :style="{ background: bgColor }">

    <!-- Header -->
    <header class="shrink-0 z-20 flex items-center justify-between px-4 py-2 bg-black/60 backdrop-blur-xl border-b border-white/5">
      <button @click="router.push('/capture')" class="text-white/60 active:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <h1 class="text-sm font-medium text-white/80">Utforsk</h1>
      <div class="flex gap-2">
        <button @click="showPanel = !showPanel"
          class="text-white/60 active:text-white transition-colors"
          :class="{ 'text-violet-400': showPanel }">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
          </svg>
        </button>
        <button @click="downloadSvg" class="text-white/60 active:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- Main content: SVG + optional side/bottom panel -->
    <div class="flex-1 flex flex-col md:flex-row min-h-0">

      <!-- SVG canvas -->
      <div ref="containerRef"
           class="flex-1 flex items-center justify-center relative overflow-hidden min-h-0 transition-[padding] duration-200"
           :style="canvasReservedSpaceStyle">
        <div class="w-full h-full flex items-center justify-center p-4" :style="transformStyle">
          <div class="relative w-full h-full">
            <div class="absolute inset-0" v-show="!solarSystem && !solarSystemPending" v-html="svgHtml" />
            <!-- Interactive halftone game overlay -->
            <svg v-if="gameActive" ref="gameSvgRef"
                 class="absolute inset-0 w-full h-full"
                 :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
                 preserveAspectRatio="xMidYMid meet"
                 xmlns="http://www.w3.org/2000/svg"
                 style="touch-action: none;"
                 @pointerdown="onGamePointerDown"
                 @pointermove="onGamePointerMove"
                 @pointerup="onGamePointerUp"
                 @pointerleave="onGamePointerUp"
                 @pointercancel="onGamePointerUp">
              <!-- Pointer aura (force visualisation) -->
              <circle v-if="gamePointer.active && gameMode !== 'off' && gamePointer.forceStrength > 0"
                      :cx="gamePointer.x" :cy="gamePointer.y"
                      :r="20 + gamePointer.forceStrength * 20"
                      fill="none"
                      :stroke="gameMode === 'magnet' ? '#38bdf8'
                               : gameMode === 'repel' ? '#f472b6'
                               : '#a78bfa'"
                      stroke-opacity="0.5" stroke-width="1.5"
                      pointer-events="none" />
              <!-- Subtle orbital paths (behind everything) -->
              <g v-if="solarSystem" opacity="0.18" pointer-events="none">
                <ellipse v-for="orbit in orbitPaths" :key="`orbit-${orbit.id}`"
                         :cx="orbit.cx" :cy="orbit.cy"
                         :rx="orbit.rx" :ry="orbit.ry"
                         :transform="`rotate(${orbit.rotDeg}, ${orbit.cx}, ${orbit.cy})`"
                         fill="none" stroke="white"
                         stroke-width="0.5" stroke-dasharray="1.5 3" />
              </g>
              <!-- Planets, moons and regular halftone dots — subject to halftone opacity -->
              <g :opacity="halftoneOpacity / 100"
                 :style="halftoneBlend !== 'normal' ? { mixBlendMode: halftoneBlend } : {}">
                <circle v-for="dot in nonSunDots" :key="dot.id"
                        :cx="dot.x" :cy="dot.y" :r="dot.radius" :fill="dot.color"
                        :opacity="dot.opacity"
                        :class="{ 'game-dot-marked': dot.id === gamePointer.markedId, 'planet-clickable': dot.isPlanet }"
                        @click="dot.isPlanet ? onPlanetTap(dot, $event) : null"
                        :style="dot.isPlanet ? { cursor: 'pointer' } : {}" />
              </g>
              <!-- Sun: always fully opaque and knall gul, rendered OUTSIDE the
                   halftone opacity group. Corona → disc. -->
              <template v-if="sunDot">
                <circle :cx="sunDot.x" :cy="sunDot.y" :r="sunDot.radius * 2.4"
                        :fill="sunDot.color" opacity="0.12" pointer-events="none" />
                <circle :cx="sunDot.x" :cy="sunDot.y" :r="sunDot.radius * 1.7"
                        :fill="sunDot.color" opacity="0.25" pointer-events="none" />
                <circle :cx="sunDot.x" :cy="sunDot.y" :r="sunDot.radius * 1.25"
                        :fill="sunDot.color" opacity="0.4" pointer-events="none" />
                <circle :cx="sunDot.x" :cy="sunDot.y" :r="sunDot.radius"
                        :fill="sunDot.color" opacity="0.82" />
              </template>
            </svg>
          </div>
        </div>

        <!-- Floating buttons — on mobile they follow the drawer's top so they
             stay just above it whether it's expanded, dragging or minimized. -->
        <div class="absolute right-4 flex gap-2 z-10 transition-[bottom] duration-200"
             :style="bottomOffsetStyle"
             :class="!isMobileView ? 'bottom-4' : ''">
          <button @click="rotation = (rotation - 90) % 360"
            class="w-10 h-10 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/60 active:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
          </button>
          <button @click="rotation = (rotation + 90) % 360"
            class="w-10 h-10 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/60 active:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>
            </svg>
          </button>
          <button @click="handleReset"
            class="w-10 h-10 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/60 active:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>
            </svg>
          </button>
        </div>
        <!-- Stats readout: zoom · strokes · coloured regions. Text colour
             auto-adjusts to the current background. Follows drawer on mobile. -->
        <p class="absolute left-4 z-10 text-[10px] flex items-center gap-2 transition-[bottom] duration-200"
           :style="{ color: statsTextColor, ...bottomOffsetStyle }"
           :class="!isMobileView ? 'bottom-4' : ''">
          <span>{{ (scale * 100).toFixed(0) }}%</span>
          <span :style="{ opacity: 0.5 }">·</span>
          <span>{{ strokeCount.toLocaleString('no-NO') }} streker</span>
          <template v-if="colouredRegionCount !== null">
            <span :style="{ opacity: 0.5 }">·</span>
            <span>{{ colouredRegionCount.toLocaleString('no-NO') }} fargede omr&aring;der</span>
          </template>
        </p>
      </div>

      <!-- ═══ Controls sidebar (desktop) / bottom panel (mobile) ═══ -->
      <Transition name="sidebar">
        <div v-if="showPanel"
          :class="[
            'bg-[#111118] border-white/5 overflow-hidden flex flex-col',
            isMobileView
              ? 'fixed bottom-0 left-0 right-0 z-20 border-t h-[45vh]'
              : 'shrink-0 border-l w-72 h-auto',
          ]"
          :style="isMobileView ? drawer.drawerStyle.value : {}">

          <!-- Drawer handle — only on mobile. Tap or drag to toggle/minimize.
               Area is tall enough for a comfortable grip; visual handle is
               the short pill in the middle. -->
          <div v-if="isMobileView"
               class="shrink-0 h-7 flex items-center justify-center touch-none cursor-grab active:cursor-grabbing select-none"
               @pointerdown="drawer.onPointerDown"
               @pointermove="drawer.onPointerMove"
               @pointerup="drawer.onPointerUp"
               @pointercancel="drawer.onPointerUp">
            <span class="block h-1 w-10 rounded-full bg-white/30 transition-opacity"
                  :style="{ opacity: drawer.handleOpacity.value }" />
          </div>

          <!-- Tab bar -->
          <div class="shrink-0 flex border-b border-white/5 overflow-x-auto scrollbar-none">
            <button v-for="tab in tabs" :key="tab.id"
              @click="activeTab = tab.id"
              class="flex-1 min-w-0 px-2 py-2.5 text-[10px] uppercase tracking-wider text-center transition-colors whitespace-nowrap"
              :class="activeTab === tab.id ? 'text-violet-400 border-b-2 border-violet-400' : 'text-white/40'">
              {{ tab.label }}
            </button>
          </div>

          <!-- Tab content (scrollable) -->
          <div class="flex-1 overflow-y-auto p-4 space-y-4">

            <!-- ── Presets tab ── -->
            <template v-if="activeTab === 'presets'">
              <div class="grid grid-cols-2 gap-2">
                <button v-for="(p, name) in filterPresets" :key="name" @click="applyPreset(name)"
                  class="px-3 py-3 text-xs rounded-lg border transition-all active:scale-95 text-left"
                  :class="currentPreset === name ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                  <div class="font-medium">{{ p.label }}</div>
                  <div class="text-[10px] mt-0.5 opacity-60">{{ p.description }}</div>
                </button>
              </div>
            </template>

            <!-- ── Stroke tab ── -->
            <template v-if="activeTab === 'stroke'">
              <!-- Stroke color -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Strekfarge</label>
                <div class="flex gap-2 flex-wrap items-center">
                  <button v-for="c in colorPresets" :key="c.value" @click="strokeColor = c.value; currentPreset = null"
                    class="w-8 h-8 rounded-full border-2 transition-all active:scale-90"
                    :class="strokeColor === c.value ? 'border-white scale-110' : 'border-white/10'"
                    :style="{ background: c.value }" />
                  <label class="w-8 h-8 rounded-full border-2 border-white/10 overflow-hidden cursor-pointer relative">
                    <input type="color" :value="strokeColor" @input="strokeColor = $event.target.value; currentPreset = null"
                      class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <div class="w-full h-full" :style="{ background: `conic-gradient(red, yellow, lime, aqua, blue, magenta, red)` }" />
                  </label>
                </div>
              </div>
              <!-- Width -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Bredde</label>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] text-white/30 shrink-0">0.25</span>
                  <input v-model.number="strokeScale" type="range" min="0.25" max="5" step="0.25"
                    @input="currentPreset = null"
                    class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
                  <span class="text-[10px] text-white/30 shrink-0">5.0</span>
                </div>
                <p class="text-[10px] text-white/30 mt-1 text-center">{{ strokeScale.toFixed(2) }}×</p>
              </div>
              <!-- Dash -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Stil</label>
                <div class="flex gap-1.5">
                  <button v-for="(_, name) in dashPatterns" :key="name" @click="dashPattern = name; currentPreset = null"
                    class="flex-1 py-1.5 text-xs rounded-lg border transition-all"
                    :class="dashPattern === name ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                    {{ name === 'solid' ? 'Hel' : name === 'dashed' ? 'Strek' : name === 'dotted' ? 'Prikk' : 'Skisse' }}
                  </button>
                </div>
              </div>
              <!-- Linecap -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Ende</label>
                <div class="flex gap-1.5">
                  <button v-for="lc in ['round', 'butt', 'square']" :key="lc" @click="linecapStyle = lc; currentPreset = null"
                    class="flex-1 py-1.5 text-xs rounded-lg border transition-all"
                    :class="linecapStyle === lc ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                    {{ lc === 'round' ? 'Rund' : lc === 'butt' ? 'Flat' : 'Firkant' }}
                  </button>
                </div>
              </div>
              <!-- Smooth toggle -->
              <label class="flex items-center justify-between">
                <span class="text-xs text-white/70">Glatte kurver</span>
                <button @click="isSmooth = !isSmooth; currentPreset = null"
                  class="w-10 h-5 rounded-full transition-colors" :class="isSmooth ? 'bg-violet-600' : 'bg-white/10'">
                  <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-md"
                    :class="isSmooth ? 'translate-x-5' : 'translate-x-0.5'" />
                </button>
              </label>

              <!-- Effekter section divider -->
              <div class="pt-2 border-t border-white/5">
                <label class="text-[10px] text-white/40 uppercase tracking-wider block mb-3">Effekter</label>

                <!-- Trimming -->
                <div class="mb-4">
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <button @click="trimEnabled = !trimEnabled; currentPreset = null"
                              class="w-9 h-5 rounded-full transition-colors shrink-0"
                              :class="trimEnabled ? 'bg-violet-600' : 'bg-white/10'">
                        <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-sm"
                             :class="trimEnabled ? 'translate-x-4' : 'translate-x-0.5'" />
                      </button>
                      <span class="text-xs text-white/80">Trimming</span>
                    </div>
                    <span class="text-[10px] text-white/40 tabular-nums">
                      {{ Math.round(trimAmount * 100) }}%
                    </span>
                  </div>
                  <input v-model.number="trimAmount" type="range" min="0.1" max="0.9" step="0.05"
                         :disabled="!trimEnabled"
                         class="w-full h-1 accent-violet-500 bg-white/10 rounded-full appearance-none"
                         :class="{ 'opacity-30': !trimEnabled }" />
                  <p class="text-[10px] text-white/30 mt-0.5">Fjerner streker &mdash; skru av for å få alt tilbake</p>
                </div>

                <!-- Forenkling -->
                <div class="mb-4">
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <button @click="simplifyEnabled = !simplifyEnabled; currentPreset = null"
                              class="w-9 h-5 rounded-full transition-colors shrink-0"
                              :class="simplifyEnabled ? 'bg-violet-600' : 'bg-white/10'">
                        <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-sm"
                             :class="simplifyEnabled ? 'translate-x-4' : 'translate-x-0.5'" />
                      </button>
                      <span class="text-xs text-white/80">Forenkling</span>
                    </div>
                    <span class="text-[10px] text-white/40 tabular-nums">
                      {{ Math.round(simplifyAmount * 100) }}%
                    </span>
                  </div>
                  <input v-model.number="simplifyAmount" type="range" min="0.05" max="0.95" step="0.05"
                         :disabled="!simplifyEnabled"
                         class="w-full h-1 accent-violet-500 bg-white/10 rounded-full appearance-none"
                         :class="{ 'opacity-30': !simplifyEnabled }" />
                  <p class="text-[10px] text-white/30 mt-0.5">F&aelig;rre ankerpunkter per strek</p>
                </div>

                <!-- Spagettifisering -->
                <div class="mb-4">
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <button @click="spaghettiEnabled = !spaghettiEnabled; currentPreset = null"
                              class="w-9 h-5 rounded-full transition-colors shrink-0"
                              :class="spaghettiEnabled ? 'bg-violet-600' : 'bg-white/10'">
                        <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-sm"
                             :class="spaghettiEnabled ? 'translate-x-4' : 'translate-x-0.5'" />
                      </button>
                      <span class="text-xs text-white/80">Spagettifisering</span>
                    </div>
                    <span class="text-[10px] text-white/40 tabular-nums">
                      {{ Math.round(spaghettiAmount * 100) }}%
                    </span>
                  </div>
                  <input v-model.number="spaghettiAmount" type="range" min="0.1" max="1.0" step="0.05"
                         :disabled="!spaghettiEnabled"
                         class="w-full h-1 accent-violet-500 bg-white/10 rounded-full appearance-none"
                         :class="{ 'opacity-30': !spaghettiEnabled }" />
                  <p class="text-[10px] text-white/30 mt-0.5">Glatter ut snirkler og skjelvinger</p>
                </div>

                <!-- Kalligrafi (bipolar slider: konkav ↔ konveks) -->
                <div class="mb-4">
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <button @click="calligraphyEnabled = !calligraphyEnabled; currentPreset = null"
                              class="w-9 h-5 rounded-full transition-colors shrink-0"
                              :class="calligraphyEnabled ? 'bg-violet-600' : 'bg-white/10'">
                        <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-sm"
                             :class="calligraphyEnabled ? 'translate-x-4' : 'translate-x-0.5'" />
                      </button>
                      <span class="text-xs text-white/80">Kalligrafi</span>
                    </div>
                    <span class="text-[10px] text-white/40 tabular-nums">
                      {{ calligraphyAmount > 0.01 ? 'konveks' : calligraphyAmount < -0.01 ? 'konkav' : 'flat' }}
                    </span>
                  </div>
                  <input v-model.number="calligraphyAmount" type="range" min="-1" max="1" step="0.1"
                         :disabled="!calligraphyEnabled"
                         class="w-full h-1 accent-violet-500 bg-white/10 rounded-full appearance-none"
                         :class="{ 'opacity-30': !calligraphyEnabled }" />
                  <div class="flex justify-between text-[10px] text-white/30 mt-0.5">
                    <span>konkav</span><span>flat</span><span>konveks</span>
                  </div>
                </div>

                <!-- Kurvatur (named after Frode Øverli — Norwegian comic artist) -->
                <div class="mb-4">
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <button @click="kurvaturEnabled = !kurvaturEnabled; currentPreset = null"
                              class="w-9 h-5 rounded-full transition-colors shrink-0"
                              :class="kurvaturEnabled ? 'bg-violet-600' : 'bg-white/10'">
                        <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-sm"
                             :class="kurvaturEnabled ? 'translate-x-4' : 'translate-x-0.5'" />
                      </button>
                      <span class="text-xs text-white/80">Kurvatur</span>
                    </div>
                    <span class="text-[10px] text-white/40 tabular-nums">
                      {{ Math.round(kurvaturAmount * 100) }}%
                    </span>
                  </div>
                  <input v-model.number="kurvaturAmount" type="range" min="0" max="1" step="0.05"
                         :disabled="!kurvaturEnabled"
                         class="w-full h-1 accent-violet-500 bg-white/10 rounded-full appearance-none"
                         :class="{ 'opacity-30': !kurvaturEnabled }" />
                  <p class="text-[10px] text-white/30 mt-0.5">Gjør kurver rette &mdash; som en norsk tegneserieskaper</p>
                </div>

                <!-- Stroke opacity (always live, no toggle) -->
                <div class="mb-3">
                  <div class="flex items-center justify-between mb-1.5">
                    <span class="text-xs text-white/80">Transparens p&aring; strek</span>
                    <span class="text-[10px] text-white/40 tabular-nums">{{ Math.round(strokeOpacity * 100) }}%</span>
                  </div>
                  <input v-model.number="strokeOpacity" type="range" min="0" max="1" step="0.05"
                         class="w-full h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
                </div>

                <!-- Hatch opacity -->
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <span class="text-xs text-white/80">Transparens p&aring; skravering</span>
                    <span class="text-[10px] text-white/40 tabular-nums">{{ Math.round(hatchOpacity * 100) }}%</span>
                  </div>
                  <input v-model.number="hatchOpacity" type="range" min="0" max="1" step="0.05"
                         class="w-full h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
                </div>
              </div>
            </template>

            <!-- ── Layers tab ── -->
            <template v-if="activeTab === 'layers'">
              <!-- Background color -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Bakgrunnsfarge</label>
                <div class="flex gap-2 flex-wrap items-center">
                  <button v-for="c in bgPresets" :key="c.value" @click="bgColor = c.value"
                    class="w-7 h-7 rounded-full border-2 transition-all active:scale-90"
                    :class="bgColor === c.value ? 'border-white scale-110' : 'border-white/10'"
                    :style="{ background: c.value }" />
                  <label class="w-7 h-7 rounded-full border-2 border-white/10 overflow-hidden cursor-pointer relative">
                    <input type="color" :value="bgColor" @input="bgColor = $event.target.value"
                      class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <div class="w-full h-full" :style="{ background: `conic-gradient(red, yellow, lime, aqua, blue, magenta, red)` }" />
                  </label>
                </div>
                <label class="flex items-center justify-between mt-3">
                  <span class="text-xs text-white/70">Inkluder bakgrunn ved lagring</span>
                  <button @click="exportWithBg = !exportWithBg"
                    class="w-10 h-5 rounded-full transition-colors" :class="exportWithBg ? 'bg-violet-600' : 'bg-white/10'">
                    <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-md"
                      :class="exportWithBg ? 'translate-x-5' : 'translate-x-0.5'" />
                  </button>
                </label>
              </div>
              <div class="space-y-3 text-xs text-white/60">
                <label class="flex items-center gap-2">
                  <span class="w-16 shrink-0">Kanter</span>
                  <input v-model.number="opacities.edges" type="range" min="0" max="100" step="5"
                    class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
                  <span class="w-8 text-right text-white/40">{{ opacities.edges }}</span>
                </label>
                <label class="flex items-center gap-2">
                  <span class="w-16 shrink-0">Konturer</span>
                  <input v-model.number="opacities.contours" type="range" min="0" max="100" step="5"
                    class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
                  <span class="w-8 text-right text-white/40">{{ opacities.contours }}</span>
                </label>
                <label class="flex items-center gap-2">
                  <span class="w-16 shrink-0">Skravering</span>
                  <input v-model.number="opacities.hatching" type="range" min="0" max="100" step="5"
                    class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none" />
                  <span class="w-8 text-right text-white/40">{{ opacities.hatching }}</span>
                </label>
              </div>
            </template>

            <!-- ── Effects tab ── -->
            <template v-if="activeTab === 'effects'">
              <!-- Wobble -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Handtegnet</label>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] text-white/30 shrink-0">0</span>
                  <input v-model.number="wobbleIntensity" type="range" min="0" max="3" step="0.5"
                    class="flex-1 h-1 accent-violet-500 bg-white/10 rounded-full appearance-none"
                    @input="currentPreset = null" />
                  <span class="text-[10px] text-white/30 shrink-0">3</span>
                </div>
              </div>
              <!-- SVG filters -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">SVG-filter</label>
                <div class="grid grid-cols-2 gap-1.5">
                  <button @click="svgFilter = null; currentPreset = null"
                    class="py-2 text-xs rounded-lg border transition-all"
                    :class="!svgFilter ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                    Ingen
                  </button>
                  <button v-for="f in ['blur', 'glow', 'shadow', 'charcoal', 'emboss']" :key="f"
                    @click="svgFilter = f; currentPreset = null"
                    class="py-2 text-xs rounded-lg border transition-all"
                    :class="svgFilter === f ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                    {{ f === 'blur' ? 'Uskarp' : f === 'glow' ? 'Glod' : f === 'shadow' ? 'Skygge' : f === 'charcoal' ? 'Kull' : 'Preging' }}
                  </button>
                </div>
              </div>
              <!-- Halftone -->
              <div class="pt-3 border-t border-white/5">
                <label class="flex items-center justify-between mb-3">
                  <span class="text-xs text-white/70">Rasterpunkter</span>
                  <button @click="halftone = !halftone"
                    class="w-10 h-5 rounded-full transition-colors" :class="halftone ? 'bg-sky-600' : 'bg-white/10'">
                    <div class="w-4 h-4 bg-white rounded-full transition-transform shadow-md"
                      :class="halftone ? 'translate-x-5' : 'translate-x-0.5'" />
                  </button>
                </label>
                <div v-if="halftone">
                  <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Punktstorrelse</label>
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-white/30 shrink-0">Sma</span>
                    <input v-model.number="halftoneScale" type="range" min="0.3" max="1.5" step="0.1"
                      class="flex-1 h-1 accent-sky-500 bg-white/10 rounded-full appearance-none" />
                    <span class="text-[10px] text-white/30 shrink-0">Store</span>
                  </div>
                  <p class="text-[10px] text-white/30 mt-1 text-center">{{ halftoneScale.toFixed(1) }}x</p>

                  <!-- Merge slider -->
                  <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 mt-3 block">Sammenslåing</label>
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-white/30 shrink-0">Ingen</span>
                    <input v-model.number="halftoneMerge" type="range" min="0" max="0.5" step="0.05"
                      class="flex-1 h-1 accent-sky-500 bg-white/10 rounded-full appearance-none" />
                    <span class="text-[10px] text-white/30 shrink-0">Mye</span>
                  </div>
                  <p class="text-[10px] text-white/30 mt-1 text-center">{{ halftoneMerge === 0 ? 'Av' : halftoneMerge.toFixed(1) }}</p>

                  <!-- Blend mode -->
                  <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 mt-3 block">Blend-modus</label>
                  <div class="grid grid-cols-2 gap-1.5">
                    <button v-for="b in [
                      { v: 'normal', label: 'Normal' },
                      { v: 'luminosity', label: 'Luminositet' },
                      { v: 'multiply', label: 'Multiply' },
                      { v: 'difference', label: 'Difference' },
                    ]" :key="b.v"
                      @click="halftoneBlend = b.v"
                      class="py-1.5 text-[11px] rounded-lg border transition-all"
                      :class="halftoneBlend === b.v ? 'bg-sky-600 border-sky-500 text-white' : 'bg-white/5 border-white/10 text-white/60'">
                      {{ b.label }}
                    </button>
                  </div>

                  <!-- Gamification modes -->
                  <div class="flex items-center gap-1.5 mb-2 mt-3">
                    <span class="text-[10px] text-white/40 uppercase tracking-wider">Interaktivt</span>
                    <button @click="showInteractivityInfo = !showInteractivityInfo"
                      type="button"
                      :aria-expanded="showInteractivityInfo"
                      aria-label="Vis info om interaktive modi"
                      class="w-4 h-4 inline-flex items-center justify-center rounded-full transition-colors"
                      :class="showInteractivityInfo ? 'bg-violet-500 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'">
                      <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="11" x2="12" y2="17"/>
                        <circle cx="12" cy="7.5" r="0.5" fill="currentColor"/>
                      </svg>
                    </button>
                  </div>
                  <div v-if="showInteractivityInfo"
                       class="relative mb-2 p-3 rounded-lg bg-black/60 border border-white/15 text-[11px] text-white/75 leading-relaxed">
                    <button @click="showInteractivityInfo = false" type="button"
                      aria-label="Lukk info"
                      class="absolute top-1.5 right-2 text-white/40 hover:text-white text-sm leading-none">×</button>
                    <p class="mb-2 pr-4">
                      <strong class="text-white/90">Klikk og hold</strong> på en stor sirkel for å gripe den.
                      Kombiner med å flytte sirkelen for å forsterke effekten.
                    </p>
                    <ul class="space-y-1 list-disc list-inside marker:text-white/40">
                      <li><strong class="text-sky-300">Gravitasjon</strong> &mdash; trekker mindre sirkler mot den du holder</li>
                      <li><strong class="text-pink-300">Antistoff</strong> &mdash; støter mindre sirkler unna</li>
                      <li><strong class="text-violet-300">Sort hull</strong> &mdash; sluker mindre sirkler, vokser for hver som spises</li>
                    </ul>
                    <p class="mt-2 text-[10px] text-white/40">
                      Tips: Jo lenger du holder, jo sterkere blir kraften.
                    </p>
                  </div>
                  <div class="grid grid-cols-2 gap-1.5">
                    <button v-for="m in [
                      { v: 'off',    label: 'Av' },
                      { v: 'magnet', label: 'Gravitasjon' },
                      { v: 'repel',  label: 'Antistoff' },
                      { v: 'eraser', label: 'Sort hull' },
                    ]" :key="m.v"
                      @click="gameMode = m.v"
                      class="py-1.5 text-[11px] rounded-lg border transition-all"
                      :class="gameMode === m.v
                        ? (m.v === 'off' ? 'bg-white/10 border-white/20 text-white/80' : 'bg-pink-600 border-pink-500 text-white')
                        : 'bg-white/5 border-white/10 text-white/60'">
                      {{ m.label }}
                    </button>
                  </div>
                  <button v-if="gameMode !== 'off'" @click="resetGame"
                    class="w-full mt-2 py-1.5 text-[11px] rounded-lg bg-white/5 border border-white/10 text-white/70 active:scale-95 transition-all">
                    Tilbakestill punkter
                  </button>
                  <p class="text-[10px] text-white/40 mt-2 leading-tight">
                    <template v-if="solarSystem">
                      Grip <span class="text-amber-300">sola</span> og dra planetsystemet rundt — planetene følger gravitasjonen, men <em>sliter litt med å finne banene</em> igjen.
                      Formelen <span class="text-amber-300 font-serif italic">ω ∝ r⁻³ᐟ²</span> er Keplers 3. lov: jo lenger ute en planet er, desto langsommere vinkelhastighet — ytre baner tar mye lengre tid per runde enn indre.
                    </template>
                    <template v-else-if="gameMode === 'magnet'">Grip en stor sirkel — mindre sirkler tiltrekkes av gravitasjonen. Lengre holdetid = sterkere tyngdekraft.</template>
                    <template v-else-if="gameMode === 'repel'">Grip en stor sirkel — mindre sirkler støtes unna som av antistoff. Lengre holdetid = kraftigere effekt.</template>
                    <template v-else-if="gameMode === 'eraser'">Grip en stor sirkel og hold inne — mindre sirkler tiltrekkes og slukes. Hullet vokser for hver sirkel det spiser. Tøm hele lerretet for en liten overraskelse!</template>
                  </p>

                  <!-- Raster opacity (moved from Lag tab — nest nederst) -->
                  <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 mt-4 block">Raster (gjennomsiktighet)</label>
                  <div class="flex items-center gap-2">
                    <input v-model.number="halftoneOpacity" type="range" min="0" max="100" step="5"
                      class="flex-1 h-1 accent-sky-500 bg-white/10 rounded-full appearance-none" />
                    <span class="w-8 text-right text-white/40 text-[10px]">{{ halftoneOpacity }}</span>
                  </div>

                  <!-- Raster colour picker (nederst) -->
                  <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 mt-4 block">Rasterfarge</label>
                  <div class="flex gap-2 flex-wrap items-center">
                    <button v-for="c in colorPresets" :key="c.value" @click="halftoneColor = c.value"
                      class="w-7 h-7 rounded-full border-2 transition-all active:scale-90"
                      :class="halftoneColor === c.value ? 'border-white scale-110' : 'border-white/10'"
                      :style="{ background: c.value }"
                      :aria-label="`Sett rasterfarge til ${c.name}`" />
                    <label class="w-7 h-7 rounded-full border-2 border-white/10 overflow-hidden cursor-pointer relative">
                      <input type="color" :value="halftoneColor" @input="halftoneColor = $event.target.value"
                        class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                      <div class="w-full h-full" :style="{ background: `conic-gradient(red, yellow, lime, aqua, blue, magenta, red)` }" />
                    </label>
                  </div>
                </div>
              </div>
            </template>

            <!-- ── Color tab ── -->
            <template v-if="activeTab === 'color'">
              <!-- Delay slider -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Hastighet</label>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] text-white/30 shrink-0">0</span>
                  <input v-model.number="fillDelay" type="range" min="0" max="1" step="0.1"
                    class="flex-1 h-1 accent-sky-500 bg-white/10 rounded-full appearance-none" />
                  <span class="text-[10px] text-white/30 shrink-0">1s</span>
                </div>
                <p class="text-[10px] text-white/30 mt-1 text-center">{{ fillDelay === 0 ? 'Umiddelbart' : (fillDelay * 1000) + 'ms mellom hver gruppe' }}</p>
              </div>

              <!-- Batch size slider -->
              <div>
                <label class="text-[10px] text-white/40 uppercase tracking-wider mb-2 block">Omrader per steg</label>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] text-white/30 shrink-0">1</span>
                  <input v-model.number="fillBatch" type="range" min="1" max="100" step="1"
                    class="flex-1 h-1 accent-sky-500 bg-white/10 rounded-full appearance-none" />
                  <span class="text-[10px] text-white/30 shrink-0">100</span>
                </div>
                <p class="text-[10px] text-white/30 mt-1 text-center">{{ fillBatch }} omrade{{ fillBatch > 1 ? 'r' : '' }} samtidig</p>
              </div>

              <!-- Action buttons -->
              <div class="flex gap-2">
                <button @click="colorized ? stopColorize() : startColorize()" :disabled="colorizing"
                  class="flex-1 py-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
                  :class="colorized
                    ? 'bg-white/10 border border-white/20 text-white/70'
                    : 'bg-gradient-to-r from-sky-600 to-violet-600 text-white shadow-[0_0_20px_rgba(56,189,248,0.2)]'">
                  <span v-if="colorizing">Fargelegger...</span>
                  <span v-else-if="colorized">Fjern farger</span>
                  <span v-else>Auto-fargelegg</span>
                </button>
                <button @click="randomizeColors" :disabled="colorizing"
                  class="px-4 py-3 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white/60 transition-all active:scale-[0.98] hover:bg-white/10">
                  Tilfeldig
                </button>
              </div>

              <!-- Progress -->
              <div v-if="colorized && fillsData.length > 0" class="text-center">
                <p class="text-[11px] text-white/30">{{ revealedCount }} / {{ fillsData.length }} omrader</p>
                <div class="w-full h-1 bg-white/5 rounded-full mt-1 overflow-hidden">
                  <div class="h-full bg-sky-500/50 rounded-full transition-all duration-300"
                    :style="{ width: (revealedCount / fillsData.length * 100) + '%' }" />
                </div>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Solar-system setup modal — appears when sort-hull victory triggers -->
    <SolarSystemSetupModal :open="!!solarSystemPending"
                           @start="onSolarStart"
                           @cancel="onSolarCancel" />
  </div>
</template>

<style scoped>
.sidebar-enter-active,
.sidebar-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
/* Mobile: slide up from bottom */
.sidebar-enter-from,
.sidebar-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
/* Desktop: slide in from right */
@media (min-width: 768px) {
  .sidebar-enter-from,
  .sidebar-leave-to {
    transform: translateX(100%);
    opacity: 0;
  }
}
.scrollbar-none::-webkit-scrollbar { display: none; }
.scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }

/* Gamification dot styling */
.game-dot-marked {
  stroke: white;
  stroke-width: 2;
  filter: drop-shadow(0 0 6px rgba(244, 114, 182, 0.8));
}
</style>

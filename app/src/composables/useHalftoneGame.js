/**
 * useHalftoneGame — interactive gamification of halftone dots.
 *
 * Modes:
 *  - 'off'    : no interaction
 *  - 'magnet' : the grabbed circle attracts smaller circles; strength ramps up
 *               with hold time.
 *  - 'repel'  : the grabbed circle repels smaller circles ("antistoff" — bouncy
 *               physics).
 *  - 'eraser' : the grabbed circle attracts smaller circles (like 'magnet') and
 *               devours those that overlap it, growing by area conservation
 *               ("sort hull" — black hole).
 *
 * Press on any circle to "grab" it — the circle is anchored to your pointer
 * while the mode's effect plays out around it.
 *
 * Win state (solar system): when Sort hull has absorbed all but one circle,
 * the canvas transitions into a little solar system — the winning circle
 * becomes a yellow "sun" at the centre and fresh planets of varied colours
 * orbit around it. Outer orbits run slower than inner ones (Kepler-style).
 * An `onEmpty` callback still fires so the UI can react to the transition.
 */

import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import { computeHalftoneDots } from '../lib/pathFilters.js'

const SUN_COLOR = '#facc15' // knall gul
const PLANET_COUNT = 10
// Inspired by our own solar system: the sun is about 10× Jupiter's radius —
// we use 8× so planets stay readable on screen.
const MAX_PLANET_TO_SUN_RATIO = 1 / 8

// Earth-tone planet palette: greys, browns, dark greens, ochre, beige, reds
const EARTH_PALETTE = [
  '#6b7280', '#4b5563',                      // slate greys
  '#78350f', '#92400e', '#a16207',           // browns
  '#ca8a04', '#d97706', '#b45309',           // ochre / amber
  '#365314', '#4d7c0f', '#166534', '#14532d',// dark greens
  '#d4a574', '#b89968', '#c9a97c',           // beige / tan
  '#991b1b', '#7f1d1d', '#b91c1c',           // reds
]

export function useHalftoneGame({
  halftone,           // ref<boolean>   — whether halftone is active
  originalSvg,        // ref<string>    — source SVG
  halftoneScale,      // ref<number>
  halftoneMerge,      // ref<number>
  strokeColor,        // ref<string>    — used as the dot fill
  onEmpty = () => {}, // callback when the win state fires
}) {
  const mode = ref('off') // 'off' | 'magnet' | 'repel' | 'eraser'

  // Dot list — each: { id, x, y, ox, oy, radius, origRadius, color, vx, vy, opacity,
  //                    isSun?, isPlanet?, orbitRadius?, orbitAngle?, orbitSpeed? }
  const dots = ref([])
  let nextId = 0

  const gameSvgRef = ref(null)
  const svgDims = ref({ w: 600, h: 400 })

  const pointer = reactive({
    active: false,
    x: 0, y: 0,
    holdStart: 0,
    markedId: null,
    forceStrength: 0,
  })

  const solarSystem = ref(false)

  const isActive = computed(() => halftone.value && mode.value !== 'off')

  // ───────────────────────────────────────────────────────────────────
  // Dot initialisation
  // ───────────────────────────────────────────────────────────────────

  function rebuildDots() {
    if (!halftone.value || !originalSvg.value) {
      dots.value = []
      return
    }
    const { dots: raw, svgW, svgH } = computeHalftoneDots(originalSvg.value, {
      scale: halftoneScale.value,
      usePhotoColors: false,
      dotColor: strokeColor ? strokeColor.value : null,
      merge: halftoneMerge.value,
    })
    svgDims.value = { w: svgW, h: svgH }
    nextId = 0
    dots.value = raw.map(d => ({
      id: nextId++,
      x: d.x, y: d.y,
      ox: d.x, oy: d.y,
      radius: d.radius,
      origRadius: d.radius,
      color: d.color,
      vx: 0, vy: 0,
      opacity: 1,
    }))
    emptyFiredRef.value = false
    solarSystem.value = false
  }

  const emptyFiredRef = ref(false)

  watch([isActive, halftoneScale, halftoneMerge], ([active]) => {
    if (active) rebuildDots()
  })
  watch(halftone, (on) => {
    if (!on) { dots.value = []; solarSystem.value = false }
  })

  // Update dot colour in place when strokeColor changes — but don't touch the
  // sun and planets (they have their own palette in solar system mode).
  if (strokeColor) {
    watch(strokeColor, (c) => {
      for (const d of dots.value) {
        if (d.isSun || d.isPlanet || d.isMoon) continue
        d.color = c
      }
    })
  }

  // ───────────────────────────────────────────────────────────────────
  // Solar system trigger
  // ───────────────────────────────────────────────────────────────────

  function triggerSolarSystem(sun) {
    const cx = svgDims.value.w / 2
    const cy = svgDims.value.h / 2
    const minDim = Math.min(svgDims.value.w, svgDims.value.h)

    // Figure out the SVG's actual on-screen size so we can size the sun in
    // SCREEN pixels, then convert to viewBox units. Same sun appears similarly
    // sized on desktop and mobile, regardless of the underlying viewBox.
    const rect = gameSvgRef.value?.getBoundingClientRect?.()
    const elementW = rect?.width || 800
    const elementH = rect?.height || 600
    // preserveAspectRatio="xMidYMid meet" uses the SMALLER scale on both axes
    const contentScale = Math.min(
      elementW / svgDims.value.w,
      elementH / svgDims.value.h,
    ) || 1

    // Target sun radius on screen: 10% of shortest visible dim, floor 55 px
    // so it's always prominent even on phone screens.
    const targetSunScreenRadius = Math.max(
      55,
      Math.min(elementW, elementH) * 0.1,
    )
    sun.radius = targetSunScreenRadius / contentScale

    // Planets at 1/8 of the sun (solar-system proportion)
    const maxPlanetRadius = sun.radius * MAX_PLANET_TO_SUN_RATIO
    const minPlanetRadius = maxPlanetRadius * 0.35

    // Place the sun at centre and style it yellow
    sun.x = cx; sun.y = cy
    sun.ox = cx; sun.oy = cy
    sun.vx = 0; sun.vy = 0
    sun.color = SUN_COLOR
    sun.isSun = true

    // Release any active grab so the sun doesn't track the pointer
    pointer.markedId = null

    // Inner orbit far enough out that perihelion (a(1−e)) stays outside the
    // sun even at max eccentricity; outer orbit fills most of the canvas.
    const minA = sun.radius * 1.5
    const maxA = minDim * 0.48

    const planets = []
    for (let i = 0; i < PLANET_COUNT; i++) {
      // Spread semi-major axes with jitter so orbits don't line up in rings
      const t = (i + Math.random() * 0.6) / PLANET_COUNT
      const a = minA + (maxA - minA) * t
      // Eccentricity per planet — subtle ovals, never extremely stretched
      const e = 0.05 + Math.random() * 0.18
      const b = a * Math.sqrt(1 - e * e)  // semi-minor
      const c = a * e                      // focal offset
      // Random orientation of the major axis
      const orbitRotation = Math.random() * Math.PI * 2
      // Starting angle around the ellipse
      const angle = Math.random() * Math.PI * 2
      // Kepler's third law: period ∝ a^1.5 → mean angular velocity ∝ a^(-1.5)
      const baseSpeed = 0.28 // rad/s at the innermost orbit (slowed down)
      const speed = baseSpeed * Math.pow(minA / a, 1.5)
      const direction = Math.random() > 0.12 ? 1 : -1
      // Planet radius scales with the canvas (via maxPlanetRadius)
      const planetRadius = minPlanetRadius + Math.random() * (maxPlanetRadius - minPlanetRadius)
      // Earth-tone colour picked at random from the curated palette
      const color = EARTH_PALETTE[Math.floor(Math.random() * EARTH_PALETTE.length)]
      // Gravitational struggle — inner planets stick to their orbits more
      // firmly (stiffer spring, stronger pull) while outer planets wobble
      // and lag more when the sun is dragged around.
      const orbitT = (a - minA) / (maxA - minA)
      const springK = 0.04 - 0.028 * orbitT   // 0.04 inner → 0.012 outer
      const springDamp = 0.86 + 0.06 * orbitT // 0.86 inner → 0.92 outer

      planets.push({
        id: nextId++,
        x: cx, y: cy,
        ox: cx, oy: cy,
        radius: planetRadius,
        origRadius: planetRadius,
        color,
        vx: 0, vy: 0,
        opacity: 1,
        isPlanet: true,
        a, b, c,
        orbitRotation,
        orbitAngle: angle,
        orbitSpeed: speed * direction,
        springK,
        springDamp,
      })
    }

    // A few planets (the bigger ones) get moons orbiting them
    const moons = []
    const hostThreshold = maxPlanetRadius * 0.6
    const moonCandidates = planets
      .filter(p => p.radius >= hostThreshold)
      .sort(() => Math.random() - 0.5)
      .slice(0, 2 + Math.floor(Math.random() * 2)) // 2-3 host planets
    for (const host of moonCandidates) {
      const numMoons = 1 + (Math.random() > 0.6 ? 1 : 0)
      for (let m = 0; m < numMoons; m++) {
        const moonR = host.radius * (2.2 + m * 1.4) + 2
        const moonAngle = Math.random() * Math.PI * 2
        const moonSpeed = (0.9 + Math.random() * 0.5) * (Math.random() > 0.5 ? 1 : -1)
        moons.push({
          id: nextId++,
          x: host.x + moonR * Math.cos(moonAngle),
          y: host.y + moonR * Math.sin(moonAngle),
          ox: 0, oy: 0,
          radius: 0.8 + Math.random() * 0.6,
          origRadius: 0.8,
          color: '#d4d4d8',
          vx: 0, vy: 0,
          opacity: 0.9,
          isMoon: true,
          parentPlanetId: host.id,
          moonRadius: moonR,
          moonAngle,
          moonSpeed,
        })
      }
    }

    dots.value = [sun, ...planets, ...moons]
    solarSystem.value = true
    startLoop()
  }

  // ───────────────────────────────────────────────────────────────────
  // Pointer → SVG coordinate conversion + pick-marked helpers
  // ───────────────────────────────────────────────────────────────────

  function pointerToSvg(e) {
    const svg = gameSvgRef.value
    if (!svg) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const { x, y } = pt.matrixTransform(ctm.inverse())
    return { x, y }
  }

  function pickMarked(x, y) {
    let best = null
    // Sun is easy to grab (generous tolerance); regular dots use a small one.
    for (const d of dots.value) {
      if (d.isPlanet || d.isMoon) continue // show-only
      if (d.isSun && !solarSystem.value) continue // only grabbable in solar system
      const tol = d.isSun ? 12 : 4
      const dx = d.x - x, dy = d.y - y
      const r = d.radius + tol
      if (dx * dx + dy * dy <= r * r) {
        if (!best || d.radius > best.radius) best = d
      }
    }
    return best
  }

  function onPointerDown(e) {
    if (!isActive.value) return
    e.preventDefault()
    e.stopPropagation()
    const p = pointerToSvg(e)
    pointer.active = true
    pointer.x = p.x
    pointer.y = p.y
    pointer.holdStart = performance.now()

    const marked = pickMarked(p.x, p.y)
    pointer.markedId = marked ? marked.id : null

    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch {}
    startLoop()
  }

  function onPointerMove(e) {
    if (!isActive.value || !pointer.active) return
    e.stopPropagation()
    const p = pointerToSvg(e)
    pointer.x = p.x
    pointer.y = p.y
  }

  function onPointerUp(e) {
    if (!pointer.active) return
    pointer.active = false
    pointer.markedId = null

    // Solar system: no slack-strikk — orbits just keep going
    if (solarSystem.value) {
      try { e?.currentTarget?.releasePointerCapture?.(e.pointerId) } catch {}
      return
    }

    if (mode.value === 'magnet' || mode.value === 'repel') {
      const SLACK = 0.25
      for (const d of dots.value) {
        d.ox = d.x + (d.ox - d.x) * SLACK
        d.oy = d.y + (d.oy - d.y) * SLACK
      }
    } else if (mode.value === 'eraser') {
      const SLACK = 0.25
      for (const d of dots.value) {
        d.ox = d.x + (d.ox - d.x) * SLACK
        d.oy = d.y + (d.oy - d.y) * SLACK
      }
    }

    try { e?.currentTarget?.releasePointerCapture?.(e.pointerId) } catch {}
  }

  // ───────────────────────────────────────────────────────────────────
  // Physics / effect loop
  // ───────────────────────────────────────────────────────────────────

  let raf = null
  let lastTick = 0

  function startLoop() {
    if (raf) return
    lastTick = performance.now()
    raf = requestAnimationFrame(tick)
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf)
    raf = null
  }

  function tick(now) {
    raf = null
    const dt = Math.min(0.05, (now - lastTick) / 1000)
    lastTick = now

    // ── Solar system mode: grabbable sun + elliptical orbits + moons ──
    if (solarSystem.value) {
      const sun = dots.value.find(d => d.isSun)

      // Let the user grab and drag the sun — the whole planetarium follows.
      if (sun && pointer.active && pointer.markedId === sun.id) {
        sun.x += (pointer.x - sun.x) * 0.5
        sun.y += (pointer.y - sun.y) * 0.5
      }

      if (sun) {
        // Planets: target is the ideal orbital position; actual position is
        // a spring-damped chase of that target. Inner planets are tightly
        // "gravitationally bound" and follow closely; outer planets struggle
        // to keep up and wobble around their orbit when the sun moves.
        for (const d of dots.value) {
          if (!d.isPlanet) continue
          d.orbitAngle += d.orbitSpeed * dt
          const cosT = Math.cos(d.orbitAngle)
          const sinT = Math.sin(d.orbitAngle)
          const lx = d.a * cosT - d.c
          const ly = d.b * sinT
          const cosR = Math.cos(d.orbitRotation)
          const sinR = Math.sin(d.orbitRotation)
          const targetX = sun.x + lx * cosR - ly * sinR
          const targetY = sun.y + lx * sinR + ly * cosR

          // Spring-damper: accelerate toward orbit target, retain momentum
          const ax = (targetX - d.x) * d.springK
          const ay = (targetY - d.y) * d.springK
          d.vx = d.vx * d.springDamp + ax
          d.vy = d.vy * d.springDamp + ay
          d.x += d.vx
          d.y += d.vy
        }
        // Moons — snappier follow (gravitationally tighter to their host)
        for (const d of dots.value) {
          if (!d.isMoon) continue
          const host = dots.value.find(p => p.id === d.parentPlanetId)
          if (!host) continue
          d.moonAngle += d.moonSpeed * dt
          const targetX = host.x + d.moonRadius * Math.cos(d.moonAngle)
          const targetY = host.y + d.moonRadius * Math.sin(d.moonAngle)
          d.x += (targetX - d.x) * 0.35
          d.y += (targetY - d.y) * 0.35
        }
      }
      raf = requestAnimationFrame(tick)
      return
    }

    const holdDur = pointer.active ? (now - pointer.holdStart) / 1000 : 0
    const marked = pointer.markedId != null
      ? dots.value.find(d => d.id === pointer.markedId)
      : null

    if (marked && pointer.active) {
      marked.x += (pointer.x - marked.x) * 0.45
      marked.y += (pointer.y - marked.y) * 0.45
    }

    let moved = false

    if (mode.value === 'magnet' || mode.value === 'repel' || mode.value === 'eraser') {
      if (marked && pointer.active) {
        const strength = Math.min(2.0, holdDur / 1.5)
        pointer.forceStrength = strength
        const sign = mode.value === 'repel' ? 1 : -1

        for (const d of dots.value) {
          if (d.id === marked.id) continue
          if (d.radius >= marked.radius) continue
          const dx = d.x - marked.x
          const dy = d.y - marked.y
          let dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 1) dist = 1
          const f = Math.min(400, (strength * 400) / dist) * sign
          d.vx += (dx / dist) * f * dt
          d.vy += (dy / dist) * f * dt
        }

        if (mode.value === 'eraser') {
          const survivors = []
          let ate = false
          for (const d of dots.value) {
            if (d.id === marked.id) { survivors.push(d); continue }
            if (d.radius >= marked.radius) { survivors.push(d); continue }
            const dx = marked.x - d.x
            const dy = marked.y - d.y
            const minD = marked.radius + d.radius
            if (dx * dx + dy * dy < minD * minD) {
              marked.radius = Math.sqrt(marked.radius * marked.radius + d.radius * d.radius)
              ate = true
              continue
            }
            survivors.push(d)
          }
          if (ate) {
            dots.value = survivors
            moved = true
          }
        }
      }

      // Settling spring after release
      const damp = mode.value === 'repel' ? 0.94 : 0.86
      for (const d of dots.value) {
        if (marked && d.id === marked.id) continue
        if (d.vx || d.vy) moved = true
        d.x += d.vx * dt * 60
        d.y += d.vy * dt * 60
        d.vx *= damp
        d.vy *= damp

        if (!pointer.active) {
          d.x += (d.ox - d.x) * 0.04
          d.y += (d.oy - d.y) * 0.04
        }
      }

      // Win state: Sort hull has absorbed all but one circle → solar system
      if (mode.value === 'eraser' && !emptyFiredRef.value && dots.value.length === 1) {
        const lone = dots.value[0]
        if (lone.radius > lone.origRadius) {
          emptyFiredRef.value = true
          triggerSolarSystem(lone)
          onEmpty({ x: lone.x, y: lone.y, radius: lone.radius, id: lone.id })
          raf = requestAnimationFrame(tick)
          return
        }
      }
    }

    const stillSettling = dots.value.some(d =>
      Math.abs(d.vx) > 0.05 || Math.abs(d.vy) > 0.05 ||
      Math.abs(d.x - d.ox) > 0.3 || Math.abs(d.y - d.oy) > 0.3
    )
    if (pointer.active || stillSettling || moved) {
      raf = requestAnimationFrame(tick)
    }
  }

  onBeforeUnmount(stopLoop)

  function reset() {
    solarSystem.value = false
    rebuildDots()
  }

  return {
    mode,
    dots,
    pointer,
    gameSvgRef,
    isActive,
    solarSystem,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    rebuildDots,
    reset,
  }
}

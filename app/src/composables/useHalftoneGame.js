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
// Earth-tone planet palette: greys, browns, dark greens, ochre, beige, reds
const EARTH_PALETTE = [
  '#6b7280', '#4b5563',                      // slate greys
  '#78350f', '#92400e', '#a16207',           // browns
  '#ca8a04', '#d97706', '#b45309',           // ochre / amber
  '#365314', '#4d7c0f', '#166534', '#14532d',// dark greens
  '#d4a574', '#b89968', '#c9a97c',           // beige / tan
  '#991b1b', '#7f1d1d', '#b91c1c',           // reds
]

// Default planetarium configuration (user can override via setup modal)
export const DEFAULT_SOLAR_CONFIG = {
  planetCount: 10,       // 2..20
  moonPlanets: 3,        // 0..20 — how many planets get moons
  innerPeriodSec: 15,    // 10..60 — seconds per orbit at innermost
  sunSizePct: 50,        // 0..100 — 0 = small/distinct, 100 = large halo
}

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
  // While pending, the sort-hull victory has happened but the user hasn't
  // confirmed the solar-system config yet. The physics loop pauses; the UI
  // shows a modal. Holds the sun dot that's waiting to become the centre.
  const solarSystemPending = ref(null)

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

  /**
   * First phase — victory detected. Save the sun and wait for config.
   * Returns the sun so callers can display it while the modal is open.
   */
  function pendingSolarSystem(sun) {
    solarSystemPending.value = sun
  }

  /**
   * User cancelled the solar system — reset the scene to its halftone state.
   */
  function cancelSolarSystem() {
    solarSystemPending.value = null
    emptyFiredRef.value = false
    solarSystem.value = false
    rebuildDots()
  }

  /**
   * Second phase — user has chosen a configuration. Build the planetarium.
   */
  function startSolarSystem(sun, config = DEFAULT_SOLAR_CONFIG) {
    const planetCount    = clamp(config.planetCount ?? 10, 2, 20)
    const moonPlanets    = clamp(config.moonPlanets ?? 3, 0, planetCount)
    const innerPeriodSec = clamp(config.innerPeriodSec ?? 15, 5, 120)
    const sunSizePct     = clamp(config.sunSizePct ?? 50, 0, 100)

    const cx = svgDims.value.w / 2
    const cy = svgDims.value.h / 2
    const minDim = Math.min(svgDims.value.w, svgDims.value.h)

    const rect = gameSvgRef.value?.getBoundingClientRect?.()
    const elementW = rect?.width || 800
    const elementH = rect?.height || 600
    const contentScale = Math.min(
      elementW / svgDims.value.w,
      elementH / svgDims.value.h,
    ) || 1

    // Sun size — user slider maps 0 → 6%, 100 → 14% of shortest visible dim.
    // Floor at 45 px so it's always readable.
    const sunPct = 0.06 + (sunSizePct / 100) * 0.08
    const targetSunScreenRadius = Math.max(
      45,
      Math.min(elementW, elementH) * sunPct,
    )
    sun.radius = targetSunScreenRadius / contentScale

    // Planet max radius scales with sun so the "solar system" proportion holds,
    // but scales less aggressively with big suns to keep planets visible.
    const planetToSunRatio = sunSizePct > 70 ? 1 / 11 : 1 / 8
    const maxPlanetRadius = sun.radius * planetToSunRatio
    const minPlanetRadius = maxPlanetRadius * 0.35

    // Place the sun at centre and style it yellow
    sun.x = cx; sun.y = cy
    sun.ox = cx; sun.oy = cy
    sun.vx = 0; sun.vy = 0
    sun.color = SUN_COLOR
    sun.isSun = true

    // Release any active grab so the sun doesn't track the pointer
    pointer.markedId = null

    // Inner orbit far enough out that perihelion (a(1−e)) stays clear of
    // the clickable sun disc plus a margin, so tiny planets aren't swallowed
    // visually or tap-wise by the sun. Previously 1.5× was geometrically
    // outside the disc but still inside the clickable circle's hit area.
    const minA = sun.radius * 2.2
    const maxA = minDim * 0.48

    // Kepler's third law: period ∝ a^1.5. Derive base angular speed from the
    // user's chosen innermost period.
    const baseSpeed = (2 * Math.PI) / innerPeriodSec

    const planets = []
    for (let i = 0; i < planetCount; i++) {
      const t = (i + Math.random() * 0.6) / planetCount
      const a = minA + (maxA - minA) * t
      const e = 0.05 + Math.random() * 0.18
      const b = a * Math.sqrt(1 - e * e)
      const c = a * e
      const orbitRotation = Math.random() * Math.PI * 2
      const angle = Math.random() * Math.PI * 2
      const speed = baseSpeed * Math.pow(minA / a, 1.5)
      const direction = Math.random() > 0.12 ? 1 : -1
      const planetRadius = minPlanetRadius + Math.random() * (maxPlanetRadius - minPlanetRadius)
      const color = EARTH_PALETTE[Math.floor(Math.random() * EARTH_PALETTE.length)]
      const orbitT = (a - minA) / (maxA - minA)
      const springK = 0.04 - 0.028 * orbitT
      const springDamp = 0.86 + 0.06 * orbitT

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
        // Snapshot of orbit index (0=innermost) for click-to-shift handling
        orbitIndex: i,
      })
    }

    // Distribute moons among `moonPlanets` of the larger planets.
    const moons = []
    if (moonPlanets > 0) {
      const moonHosts = [...planets]
        .sort((a, b) => b.radius - a.radius)
        .slice(0, moonPlanets)
      for (const host of moonHosts) {
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
    }

    dots.value = [sun, ...planets, ...moons]
    solarSystem.value = true
    solarSystemPending.value = null
    // Store derived geometry for click-to-shift handling
    solarGeom.minA = minA
    solarGeom.maxA = maxA
    solarGeom.baseSpeed = baseSpeed
    startLoop()
  }

  /**
   * Click-to-shift: move a planet one orbit inward (direction=-1) or outward
   * (direction=+1). Any moons parented to it follow with the host.
   *
   * Implementation: we renormalise the planet's semi-major axis to the next
   * orbit slot, update its period via Kepler, and reset spring constants for
   * the new distance. Visual continuity is preserved (phase angle unchanged).
   */
  function shiftPlanetOrbit(planetId, direction) {
    if (!solarSystem.value) return
    const planets = dots.value.filter(d => d.isPlanet)
    if (planets.length < 2) return
    const target = planets.find(p => p.id === planetId)
    if (!target) return

    // Current orbit slot (sorted by semi-major axis, innermost = 0)
    const byDistance = [...planets].sort((a, b) => a.a - b.a)
    const currentSlot = byDistance.indexOf(target)
    const newSlot = clamp(currentSlot + direction, 0, byDistance.length - 1)
    if (newSlot === currentSlot) return // already at edge

    // Swap semi-major axes with the planet at the destination slot so the
    // scene stays populated at every orbit — no gap opens up.
    const other = byDistance[newSlot]
    swapOrbitParams(target, other)
  }

  function swapOrbitParams(p1, p2) {
    const keys = ['a', 'b', 'c', 'orbitRotation', 'springK', 'springDamp']
    for (const k of keys) {
      const tmp = p1[k]; p1[k] = p2[k]; p2[k] = tmp
    }
    // Recompute orbit speeds via Kepler from the new semi-major axes
    const { minA, baseSpeed } = solarGeom
    const dir1 = Math.sign(p1.orbitSpeed) || 1
    const dir2 = Math.sign(p2.orbitSpeed) || 1
    p1.orbitSpeed = baseSpeed * Math.pow(minA / p1.a, 1.5) * dir1
    p2.orbitSpeed = baseSpeed * Math.pow(minA / p2.a, 1.5) * dir2
  }

  // Cached geometry so shiftPlanetOrbit can recompute Kepler speeds
  const solarGeom = { minA: 0, maxA: 0, baseSpeed: 0 }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

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

      // Win state: Sort hull has absorbed all but one circle → pending solar system
      // (user confirms config via modal, then startSolarSystem is called)
      if (mode.value === 'eraser' && !emptyFiredRef.value && dots.value.length === 1) {
        const lone = dots.value[0]
        if (lone.radius > lone.origRadius) {
          emptyFiredRef.value = true
          pendingSolarSystem(lone)
          onEmpty({ x: lone.x, y: lone.y, radius: lone.radius, id: lone.id })
          // Stop the loop while we await user configuration
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
    solarSystemPending.value = null
    rebuildDots()
  }

  return {
    mode,
    dots,
    pointer,
    gameSvgRef,
    isActive,
    solarSystem,
    solarSystemPending,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    rebuildDots,
    reset,
    startSolarSystem,
    cancelSolarSystem,
    pendingSolarSystem,
    shiftPlanetOrbit,
  }
}

import { ref, reactive, onUnmounted } from 'vue'
import { sampleGradient } from '../lib/demSampling.js'

/**
 * Flippkart — fysikk og state machine for marble-spillet.
 *
 * Bruker semi-implisitt Euler med sub-stepping (maks ~16ms per substep) for
 * silkeglatt fysikk selv ved frame-jank. Høyere level → sterkere gravitasjon
 * og lavere friksjon.
 *
 * Composable er DOM-agnostisk: ball-posisjon er i SVG viewBox-koord (meter),
 * forbruker (FlippkartLayer.vue) håndterer rendering og event-input.
 *
 * Lakes er pre-resolvet til {paths: SVGGeometryElement[]} av kalleren — det
 * er DOM-arbeid som ikke hører hjemme her.
 */
export function useFlippkart() {
  // Persistent gjennom hele spillet
  const active = ref(false)
  const status = ref('idle')   // 'idle' | 'rolling' | 'sunk' | 'won' | 'gameover'
  const level = ref(1)
  const lives = ref(3)
  const score = ref(0)

  // Ball-tilstand i SVG viewBox-koord
  const ball = reactive({
    x: 0, y: 0,
    vx: 0, vy: 0,
    visible: false,
  })

  // Splash-effekt på drown
  const splash = reactive({
    x: 0, y: 0,
    active: false,
    t: 0,                       // 0..1 progresjon for animasjon
  })

  // Trail (ringbuffer)
  const TRAIL_LEN = 14
  const trail = reactive(
    Array.from({ length: TRAIL_LEN }, () => ({ x: 0, y: 0, age: TRAIL_LEN }))
  )
  let trailIdx = 0

  // Spill-kontekst (settes via init)
  let dem = null
  let bounds = { width: 0, height: 0 }
  let lakePaths = []
  let highestPoint = null
  const WIN_RADIUS_M = 50      // innenfor 50m fra topp = win

  let rafId = null
  let lastTime = 0

  function levelParams(n) {
    return {
      kGravity: 5 + 0.4 * (n - 1),
      friction: Math.max(0.1, 0.6 - 0.05 * (n - 1)),
    }
  }

  function physicsStep(dt) {
    if (!ball.visible || status.value !== 'rolling' || !dem) return
    const { kGravity, friction } = levelParams(level.value)
    const grad = sampleGradient(dem, ball.x, ball.y)
    const ax = -kGravity * grad.dzdx - friction * ball.vx
    const ay = -kGravity * grad.dzdy - friction * ball.vy
    ball.vx += ax * dt
    ball.vy += ay * dt
    ball.x += ball.vx * dt
    ball.y += ball.vy * dt

    if (ball.x < 0 || ball.x > bounds.width || ball.y < 0 || ball.y > bounds.height) {
      drown(ball.x, ball.y)
      return
    }
    if (isOverWater(ball.x, ball.y)) {
      drown(ball.x, ball.y)
      return
    }

    if (highestPoint) {
      const dx = ball.x - highestPoint.svgX
      const dy = ball.y - highestPoint.svgY
      if (dx * dx + dy * dy < WIN_RADIUS_M * WIN_RADIUS_M) {
        win()
      }
    }
  }

  function isOverWater(x, y) {
    if (!lakePaths.length || typeof DOMPoint === 'undefined') return false
    const pt = new DOMPoint(x, y)
    for (const p of lakePaths) {
      try {
        if (p.isPointInFill?.(pt)) return true
      } catch {
        // isPointInFill ikke støttet på alle path-typer (clipPaths etc) — ignorer
      }
    }
    return false
  }

  function updateTrail() {
    if (!ball.visible) return
    const slot = trail[trailIdx]
    slot.x = ball.x
    slot.y = ball.y
    slot.age = 0
    for (let i = 0; i < TRAIL_LEN; i++) {
      if (i !== trailIdx) trail[i].age++
    }
    trailIdx = (trailIdx + 1) % TRAIL_LEN
  }

  function frame(now) {
    if (!active.value) return
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0
    lastTime = now

    // Sub-stepping for glatt fysikk: maks 16ms per substep
    const substeps = Math.max(1, Math.ceil(dt / 0.016))
    const subDt = dt / substeps
    for (let i = 0; i < substeps && status.value === 'rolling'; i++) {
      physicsStep(subDt)
    }
    updateTrail()

    if (splash.active) {
      splash.t += dt / 0.6      // 600ms splash
      if (splash.t >= 1) splash.active = false
    }

    rafId = requestAnimationFrame(frame)
  }

  function drown(x, y) {
    splash.x = x
    splash.y = y
    splash.active = true
    splash.t = 0
    ball.visible = false
    ball.vx = 0
    ball.vy = 0
    status.value = 'sunk'
    lives.value = Math.max(0, lives.value - 1)
    if (lives.value === 0) {
      setTimeout(() => { status.value = 'gameover' }, 700)
    } else {
      setTimeout(() => {
        if (status.value === 'sunk') status.value = 'idle'
      }, 700)
    }
  }

  function win() {
    status.value = 'won'
    score.value += 100 * level.value
    setTimeout(() => {
      level.value += 1
      ball.visible = false
      status.value = 'idle'
    }, 1500)
  }

  function dropBall(x, y) {
    if (status.value === 'gameover') return
    if (status.value !== 'idle') return
    ball.x = x
    ball.y = y
    ball.vx = 0
    ball.vy = 0
    ball.visible = true
    status.value = 'rolling'
    // Reset trail til ballen sin nåværende posisjon
    for (const slot of trail) {
      slot.x = x
      slot.y = y
      slot.age = TRAIL_LEN
    }
  }

  function restart() {
    level.value = 1
    lives.value = 3
    score.value = 0
    status.value = 'idle'
    ball.visible = false
    splash.active = false
  }

  function init(ctx) {
    dem = ctx.dem
    bounds = ctx.bounds
    lakePaths = ctx.lakePaths ?? []
    highestPoint = ctx.highestPoint ?? null
  }

  function activate() {
    if (active.value) return
    active.value = true
    lastTime = 0
    rafId = requestAnimationFrame(frame)
  }

  function deactivate() {
    active.value = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = null
    ball.visible = false
    splash.active = false
  }

  onUnmounted(deactivate)

  return {
    // state
    active, status, level, lives, score,
    ball, splash, trail,
    // computed-ish
    levelParams,
    // actions
    init, activate, deactivate,
    dropBall, restart,
    // constants
    WIN_RADIUS_M,
  }
}

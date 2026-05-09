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
 * Spillmål (v7.2.4): hold ballen i live. 3 flipper-treff på et level →
 * level complete. Score per treff = 100 * level. Innsjø-deteksjon og
 * highestPoint-vinn-deteksjon ble fjernet for enklere gameplay.
 *
 * Kick-fysikk: hvert flipper har en kickLevel 0..3 som syklerer ved tap
 * (0→1→2→3→0). Multipliers [1.0, 1.5, 2.0, 3.0] mot KICK_SPEED. Bouncen
 * resetter kickLevel til 0.
 */
export function useFlippkart() {
  const active = ref(false)
  const status = ref('idle')   // 'idle' | 'rolling' | 'won' | 'gameover'
  const level = ref(1)
  const lives = ref(3)
  const score = ref(0)
  const hits = ref(0)          // flipper-treff i nåværende level

  const HITS_PER_LEVEL = 3
  const KICK_MULTIPLIERS = [1.0, 1.5, 2.0, 3.0]

  // Ball-tilstand i SVG viewBox-koord
  const ball = reactive({
    x: 0, y: 0,
    vx: 0, vy: 0,
    visible: false,
  })

  // Splash-effekt på drown (når ball passer flipper-coverage på edge)
  const splash = reactive({
    x: 0, y: 0,
    active: false,
    t: 0,
  })

  // Pong-flippere på alle fire kart-kanter. position er 0..1 langs kanten.
  // length er fraksjon av kant-lengden. kickLevel 0..3 sykles ved tap.
  const flippers = reactive({
    top:    { position: 0.5, length: 0.25, kickLevel: 0 },
    bottom: { position: 0.5, length: 0.25, kickLevel: 0 },
    left:   { position: 0.5, length: 0.25, kickLevel: 0 },
    right:  { position: 0.5, length: 0.25, kickLevel: 0 },
  })

  const BALL_RADIUS_M = 90
  const FLIPPER_INSET_M = 280    // dypere inset så paddler er enklere å gripe
                                 // (helt inn i kart-formatet, ikke ved edge)
  const BOUNCE_AMPLIFY = 1.1
  const KICK_SPEED = 300         // base — multipliseres med KICK_MULTIPLIERS

  // Trail (ringbuffer)
  const TRAIL_LEN = 14
  const trail = reactive(
    Array.from({ length: TRAIL_LEN }, () => ({ x: 0, y: 0, age: TRAIL_LEN }))
  )
  let trailIdx = 0

  // Spill-kontekst (settes via init)
  let dem = null
  let bounds = { width: 0, height: 0 }

  let rafId = null
  let lastTime = 0

  function levelParams(n) {
    // Konstantene er kraftig oppskalert for arcade-feel: physikk-meter ≠
    // ekte fysisk meter (km-stor playfield krever overdrevet gravitasjon
    // for at ballen skal bevege seg merkbart i sub-minutt-tidsskala).
    // v7.2.4: +50% fart fra v7.2.3 (1000 → 1500 base).
    return {
      kGravity: 1500 + 200 * (n - 1),
      friction: Math.max(0.15, 0.4 - 0.04 * (n - 1)),
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

    if (!handleEdges()) return
  }

  /**
   * Ball som krysser flipper-plan (inset INNOVER fra kart-kant) bouncer hvis
   * flipper-coverage dekker, drukner ellers. Bouncen "sparker" ballen ut med
   * minst KICK_SPEED * mult, der mult = KICK_MULTIPLIERS[flipper.kickLevel].
   * Hver bounce resetter flipper.kickLevel til 0 og inkrementerer hits.
   * Returnerer false ved drown.
   */
  function handleEdges() {
    const w = bounds.width, h = bounds.height
    const r = BALL_RADIUS_M
    const inset = FLIPPER_INSET_M

    if (ball.y - r < inset && ball.vy < 0) {
      const f = flippers.top
      const c = f.position * w
      const half = f.length * w * 0.5
      if (ball.x >= c - half && ball.x <= c + half) {
        ball.y = inset + r
        const mult = KICK_MULTIPLIERS[f.kickLevel]
        ball.vy = Math.max(KICK_SPEED * mult, Math.abs(ball.vy) * BOUNCE_AMPLIFY)
        registerHit(f)
      } else {
        drown(ball.x, 0)
        return false
      }
    }
    if (ball.y + r > h - inset && ball.vy > 0) {
      const f = flippers.bottom
      const c = f.position * w
      const half = f.length * w * 0.5
      if (ball.x >= c - half && ball.x <= c + half) {
        ball.y = h - inset - r
        const mult = KICK_MULTIPLIERS[f.kickLevel]
        ball.vy = -Math.max(KICK_SPEED * mult, Math.abs(ball.vy) * BOUNCE_AMPLIFY)
        registerHit(f)
      } else {
        drown(ball.x, h)
        return false
      }
    }
    if (ball.x - r < inset && ball.vx < 0) {
      const f = flippers.left
      const c = f.position * h
      const half = f.length * h * 0.5
      if (ball.y >= c - half && ball.y <= c + half) {
        ball.x = inset + r
        const mult = KICK_MULTIPLIERS[f.kickLevel]
        ball.vx = Math.max(KICK_SPEED * mult, Math.abs(ball.vx) * BOUNCE_AMPLIFY)
        registerHit(f)
      } else {
        drown(0, ball.y)
        return false
      }
    }
    if (ball.x + r > w - inset && ball.vx > 0) {
      const f = flippers.right
      const c = f.position * h
      const half = f.length * h * 0.5
      if (ball.y >= c - half && ball.y <= c + half) {
        ball.x = w - inset - r
        const mult = KICK_MULTIPLIERS[f.kickLevel]
        ball.vx = -Math.max(KICK_SPEED * mult, Math.abs(ball.vx) * BOUNCE_AMPLIFY)
        registerHit(f)
      } else {
        drown(w, ball.y)
        return false
      }
    }
    return true
  }

  function registerHit(flipper) {
    flipper.kickLevel = 0
    score.value += 100 * level.value
    hits.value += 1
    if (hits.value >= HITS_PER_LEVEL) {
      win()
    }
  }

  /** Brukeren tapper en flipper for å lade kick-multiplier (0→1→2→3→0). */
  function energize(edge) {
    const f = flippers[edge]
    if (!f) return
    f.kickLevel = (f.kickLevel + 1) % KICK_MULTIPLIERS.length
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

    const substeps = Math.max(1, Math.ceil(dt / 0.016))
    const subDt = dt / substeps
    for (let i = 0; i < substeps && status.value === 'rolling'; i++) {
      physicsStep(subDt)
    }
    updateTrail()

    if (splash.active) {
      splash.t += dt / 0.6
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
    lives.value = Math.max(0, lives.value - 1)
    if (lives.value === 0) {
      status.value = 'sunk'
      setTimeout(() => { status.value = 'gameover' }, 700)
    } else {
      status.value = 'sunk'
      setTimeout(() => {
        if (status.value === 'sunk') status.value = 'idle'
      }, 700)
    }
  }

  function win() {
    status.value = 'won'
    setTimeout(() => {
      level.value += 1
      hits.value = 0
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
    hits.value = 0
    status.value = 'idle'
    ball.visible = false
    splash.active = false
    for (const e of ['top', 'bottom', 'left', 'right']) {
      flippers[e].position = 0.5
      flippers[e].kickLevel = 0
    }
  }

  function init(ctx) {
    dem = ctx.dem
    bounds = ctx.bounds
    // lakePaths og highestPoint i ctx ignoreres bevisst — ikke lenger del av
    // gameplay (v7.2.4).
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
    active, status, level, lives, score, hits,
    ball, splash, trail, flippers,
    // computed-ish
    levelParams,
    // actions
    init, activate, deactivate,
    dropBall, restart, energize,
    // constants
    BALL_RADIUS_M,
    FLIPPER_INSET_M,
    HITS_PER_LEVEL,
    KICK_MULTIPLIERS,
  }
}

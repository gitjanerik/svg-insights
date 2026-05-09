import { ref, reactive, computed, onUnmounted } from 'vue'
import { sampleGradient, sampleElevation } from '../lib/demSampling.js'
import {
  playIntro, playKick, playEnergize, playSplash, playWin,
  playGameOver, playCountdownBeep, playDrop, playContourTick, playSmash,
} from './useFlippkartSound.js'

/**
 * Flippkart — fysikk og state machine for marble-spillet.
 *
 * v7.2.5 spillregler:
 * - Auto-drop med 3-2-1 nedtelling. Tilfeldig posisjon innenfor sentrert
 *   sirkel (R = 65% av kart-høyde) — ingen risiko for ut-av-kart-spawn.
 * - Score-basert level-progresjon: target = 500 + 600 * log2(level)
 *   (log-skala). HUD viser score / target.
 * - Kick-multipliers via tap på flipper: 2× / 4× / 6× (cyclus 0..3).
 * - Bonuspoeng:
 *     +1 per krysset høydekurve (basert på DEM-elevasjon-endring)
 *     +5 per krysset "tykk" høydekurve (hver 5.)
 *     +100 × 2^(level-1) for "smash" (paddle-treff på motsatt side)
 * - Highscore lagres i localStorage (peak total-score gjennom tidene).
 */
export function useFlippkart() {
  const active = ref(false)
  // 'idle' | 'countdown' | 'rolling' | 'sunk' | 'won' | 'gameover'
  const status = ref('idle')
  const level = ref(1)
  const lives = ref(3)
  const score = ref(0)            // current-level score
  const totalScore = ref(0)       // sum av cleared levels' scores
  const countdown = ref(0)        // 3, 2, 1 mens status='countdown'
  const highscore = ref(loadHighscore())
  const lastEvent = ref(null)     // 'smash' | 'thick-contour' | etc — for HUD-feedback

  const KICK_MULTIPLIERS = [1.0, 2.0, 4.0, 6.0]
  const SMASH_BONUS_BASE = 100
  const RANDOM_DROP_R_FRAC = 0.325   // halvparten av 65% = radius

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
    t: 0,
  })

  // Pong-flippere på alle fire kart-kanter.
  const flippers = reactive({
    top:    { position: 0.5, length: 0.25, kickLevel: 0 },
    bottom: { position: 0.5, length: 0.25, kickLevel: 0 },
    left:   { position: 0.5, length: 0.25, kickLevel: 0 },
    right:  { position: 0.5, length: 0.25, kickLevel: 0 },
  })

  const BALL_RADIUS_M = 90
  const FLIPPER_INSET_M = 280
  const BOUNCE_AMPLIFY = 1.1
  const KICK_SPEED = 300

  // Trail (ringbuffer)
  const TRAIL_LEN = 14
  const trail = reactive(
    Array.from({ length: TRAIL_LEN }, () => ({ x: 0, y: 0, age: TRAIL_LEN }))
  )
  let trailIdx = 0

  // Spill-kontekst
  let dem = null
  let bounds = { width: 0, height: 0 }
  let equidistanceM = 20    // contour-spacing, settes via init
  let lastElev = NaN
  let lastHitEdge = null    // for smash-deteksjon

  let rafId = null
  let lastTime = 0
  let countdownTimer = null

  const levelTarget = computed(() => computeLevelTarget(level.value))

  function computeLevelTarget(n) {
    // Logaritmisk-ish skala: level 1 = 500, level 2 = ~1100, level 3 = ~1450,
    // level 4 = ~1700, level 5 = ~1900, level 10 = ~2500.
    return Math.round(500 + 600 * Math.log2(Math.max(1, n)))
  }

  function loadHighscore() {
    if (typeof localStorage === 'undefined') return 0
    try {
      const v = parseInt(localStorage.getItem('flippkart-highscore') ?? '0', 10)
      return Number.isFinite(v) ? v : 0
    } catch { return 0 }
  }

  function saveHighscore(value) {
    if (typeof localStorage === 'undefined') return
    try { localStorage.setItem('flippkart-highscore', String(value)) } catch {}
  }

  function levelParams(n) {
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
    const prevX = ball.x, prevY = ball.y
    ball.x += ball.vx * dt
    ball.y += ball.vy * dt

    detectContourCrossings(prevX, prevY, ball.x, ball.y)

    if (!handleEdges()) return
  }

  /**
   * Sjekk om ballen krysset en høydekurve siden forrige sample. Bruker
   * elevasjon-endring + equidistanceM for å finne antall passerte
   * kontur-grenser. +1 per kontur, +5 hvis den var "tykk" (hver 5.).
   */
  function detectContourCrossings(/* prevX, prevY, curX, curY */ _px, _py, cx, cy) {
    if (!dem) return
    const cur = sampleElevation(dem, cx, cy)
    if (!Number.isFinite(cur)) {
      lastElev = NaN
      return
    }
    if (!Number.isFinite(lastElev)) {
      lastElev = cur
      return
    }
    const eq = equidistanceM
    if (!eq) return
    const prevContour = Math.floor(lastElev / eq)
    const curContour = Math.floor(cur / eq)
    if (prevContour !== curContour) {
      const lo = Math.min(prevContour, curContour)
      const hi = Math.max(prevContour, curContour)
      let thick = false
      for (let i = lo + 1; i <= hi; i++) {
        if (i % 5 === 0) {
          score.value += 5
          thick = true
        } else {
          score.value += 1
        }
      }
      playContourTick(thick)
      checkLevelComplete()
    }
    lastElev = cur
  }

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
        registerHit(f, 'top')
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
        registerHit(f, 'bottom')
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
        registerHit(f, 'left')
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
        registerHit(f, 'right')
      } else {
        drown(w, ball.y)
        return false
      }
    }
    return true
  }

  const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

  function registerHit(flipper, edge) {
    const kickLevel = flipper.kickLevel
    flipper.kickLevel = 0
    score.value += 100 * level.value
    playKick(kickLevel)

    // Smash-deteksjon: motsatt side enn forrige treff = smash
    if (lastHitEdge && OPPOSITE[lastHitEdge] === edge) {
      const bonus = SMASH_BONUS_BASE * Math.pow(2, level.value - 1)
      score.value += bonus
      lastEvent.value = { kind: 'smash', bonus, at: Date.now() }
      playSmash()
    }
    lastHitEdge = edge

    checkLevelComplete()
  }

  function checkLevelComplete() {
    if (score.value >= levelTarget.value && status.value === 'rolling') {
      win()
    }
  }

  function energize(edge) {
    const f = flippers[edge]
    if (!f) return
    f.kickLevel = (f.kickLevel + 1) % KICK_MULTIPLIERS.length
    playEnergize(f.kickLevel)
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
    lastHitEdge = null
    lastElev = NaN
    playSplash()

    if (lives.value === 0) {
      // Sjekk highscore
      const finalTotal = totalScore.value + score.value
      if (finalTotal > highscore.value) {
        highscore.value = finalTotal
        saveHighscore(finalTotal)
      }
      status.value = 'sunk'
      setTimeout(() => {
        status.value = 'gameover'
        playGameOver()
      }, 700)
    } else {
      status.value = 'sunk'
      setTimeout(() => {
        if (status.value === 'sunk') status.value = 'idle'
      }, 700)
    }
  }

  function win() {
    status.value = 'won'
    playWin()
    totalScore.value += score.value
    setTimeout(() => {
      level.value += 1
      score.value = 0
      ball.visible = false
      lastHitEdge = null
      lastElev = NaN
      status.value = 'idle'
    }, 1500)
  }

  /**
   * Bruker tappet "tap to continue" → start nedtelling 3, 2, 1 → drop
   * ballen på tilfeldig sted innenfor sentrert R = 65% av kart-høyde sirkel.
   */
  function startCountdown() {
    if (status.value !== 'idle') return
    if (countdownTimer) clearTimeout(countdownTimer)
    status.value = 'countdown'
    countdown.value = 3
    playCountdownBeep(0)
    countdownTimer = setTimeout(() => {
      countdown.value = 2
      playCountdownBeep(1)
      countdownTimer = setTimeout(() => {
        countdown.value = 1
        playCountdownBeep(2)
        countdownTimer = setTimeout(() => {
          countdown.value = 0
          dropRandomBall()
        }, 800)
      }, 800)
    }, 800)
  }

  function dropRandomBall() {
    if (status.value !== 'countdown') return
    const cx = bounds.width / 2
    const cy = bounds.height / 2
    const R = RANDOM_DROP_R_FRAC * Math.min(bounds.width, bounds.height)
    const angle = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * R   // sqrt for uniform distribusjon
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    ball.x = x
    ball.y = y
    ball.vx = 0
    ball.vy = 0
    ball.visible = true
    status.value = 'rolling'
    lastElev = NaN
    lastHitEdge = null
    for (const slot of trail) {
      slot.x = x
      slot.y = y
      slot.age = TRAIL_LEN
    }
    playDrop()
  }

  function restart() {
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null }
    level.value = 1
    lives.value = 3
    score.value = 0
    totalScore.value = 0
    countdown.value = 0
    status.value = 'idle'
    ball.visible = false
    splash.active = false
    lastHitEdge = null
    lastElev = NaN
    for (const e of ['top', 'bottom', 'left', 'right']) {
      flippers[e].position = 0.5
      flippers[e].kickLevel = 0
    }
  }

  function init(ctx) {
    dem = ctx.dem
    bounds = ctx.bounds
    equidistanceM = ctx.equidistanceM ?? 20
  }

  function activate() {
    if (active.value) return
    active.value = true
    lastTime = 0
    rafId = requestAnimationFrame(frame)
    playIntro()
  }

  function deactivate() {
    active.value = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = null
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null }
    ball.visible = false
    splash.active = false
  }

  onUnmounted(deactivate)

  return {
    // state
    active, status, level, lives, score, totalScore, countdown, highscore,
    levelTarget, lastEvent,
    ball, splash, trail, flippers,
    // actions
    init, activate, deactivate,
    startCountdown, restart, energize,
    levelParams,
    // constants
    BALL_RADIUS_M,
    FLIPPER_INSET_M,
    KICK_MULTIPLIERS,
  }
}

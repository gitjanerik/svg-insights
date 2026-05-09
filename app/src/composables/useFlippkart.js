import { ref, reactive, computed, onUnmounted } from 'vue'
import { sampleGradient, sampleElevation } from '../lib/demSampling.js'
import {
  playIntro, playKick, playEnergize, playSplash, playWin,
  playGameOver, playCountdownBeep, playDrop, playContourTick, playSmash,
  playStillWarning, playExplosion, playMultiSpawn,
} from './useFlippkartSound.js'

/**
 * Flippkart — fysikk og state machine for marble-spillet.
 *
 * v7.2.6 multi-ball:
 *   - balls[] erstatter single ball
 *   - Ball som står stille i ~1s → warning-mode (chargeT 0..1)
 *   - Etter ~3s stille → eksplosjon → 3 nye baller spawnes med random vel
 *   - Game continues til ALLE baller er ute (drown / out-of-edge), så -1 liv
 *   - Stillness reset på paddle-treff og bevegelse (>STILLNESS_DIST_M)
 */
export function useFlippkart() {
  const active = ref(false)
  // 'idle' | 'countdown' | 'rolling' | 'sunk' | 'won' | 'gameover'
  const status = ref('idle')
  const level = ref(1)
  const lives = ref(3)
  const score = ref(0)
  const totalScore = ref(0)
  const countdown = ref(0)
  const highscore = ref(loadHighscore())
  const lastEvent = ref(null)

  const KICK_MULTIPLIERS = [1.0, 2.0, 4.0, 6.0]
  const SMASH_BONUS_BASE = 100
  const RANDOM_DROP_R_FRAC = 0.325

  // v7.2.8: bytte fra posisjon-basert til hastighet-basert stillness-
  // deteksjon. Posisjon-deteksjon var upålitelig — ball som drev sakte
  // linjært fikk stillTime resatt før den nådde explode-terskel. Velocity-
  // basert er mer pålitelig for "ball går tom for energi".
  const STILLNESS_SPEED_M_S = 80     // under denne fart = "stille" (akkumulerer)
  const STILLNESS_WARNING_S = 1.5    // når warning starter
  const STILLNESS_EXPLODE_S = 3.5    // når eksplosjon trigger (primary ball)
  const MULTIBALL_STUCK_S = 6.0      // når multi-ball balls bare drukner stille
  const MULTIBALL_COUNT = 3
  // 900 m/s spawn-fart: rask nok til å gi merkbar bevegelse, men ikke så rask
  // at baller forsvinner ut av playfield i løpet av 1 sekund.
  const MULTIBALL_SPEED = 900

  // balls = aktive baller. Hver ball: {x,y,vx,vy,visible, stillX, stillY,
  //   stillTime, chargeT, nextWarnAt, warnIndex, canExplode}
  const balls = reactive([])

  const splash = reactive({
    x: 0, y: 0,
    active: false,
    t: 0,
    kind: 'drown',          // 'drown' | 'explode'
  })

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

  // Trail (for én ball — den med nyligst posisjons-oppdatering)
  const TRAIL_LEN = 14
  const trail = reactive(
    Array.from({ length: TRAIL_LEN }, () => ({ x: 0, y: 0, age: TRAIL_LEN }))
  )
  let trailIdx = 0

  let dem = null
  let bounds = { width: 0, height: 0 }
  let equidistanceM = 20
  let lastElev = NaN
  let lastHitEdge = null
  // Terreng-energi-multiplikator (v7.2.7): scaler friction inverst etter
  // kart-utsnittets høydeforskjell. Flate kart (lite range) → mye lavere
  // friksjon → ball glir lenger på flatmark. Bratte kart (stort range) →
  // høyere friksjon, men slope-akselerasjon kompenserer. Beregnet i init().
  let terrainEnergyMult = 1
  const TERRAIN_REF_RANGE_M = 200    // referanse — typisk variert terreng

  let rafId = null
  let lastTime = 0
  let countdownTimer = null

  const levelTarget = computed(() => computeLevelTarget(level.value))

  function computeLevelTarget(n) {
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
    // v7.2.7: senket base-friksjon 0.4 → 0.18. Skalert friction inverst
    // med terrainEnergyMult — flate kart får lavere friksjon (ball glir
    // mye lenger på flatmark, mindre stagnering).
    const baseFriction = Math.max(0.05, 0.18 - 0.02 * (n - 1))
    return {
      kGravity: 1875 + 250 * (n - 1),
      friction: baseFriction / terrainEnergyMult,
    }
  }

  /** Spawn én ny ball — returnerer ball-objektet. */
  function spawnBall(x, y, vx = 0, vy = 0, canExplode = true) {
    const b = {
      x, y, vx, vy,
      visible: true,
      stillTime: 0,
      chargeT: 0,
      warnIndex: 0,
      canExplode,
    }
    balls.push(b)
    return b
  }

  function physicsStep(dt) {
    if (!dem || status.value !== 'rolling') return
    const { kGravity, friction } = levelParams(level.value)

    // Iterate baklengs så vi kan splice trygt
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i]
      if (!b.visible) {
        balls.splice(i, 1)
        continue
      }
      const grad = sampleGradient(dem, b.x, b.y)
      const ax = -kGravity * grad.dzdx - friction * b.vx
      const ay = -kGravity * grad.dzdy - friction * b.vy
      b.vx += ax * dt
      b.vy += ay * dt
      const prevX = b.x, prevY = b.y
      b.x += b.vx * dt
      b.y += b.vy * dt

      // Trail bare for primary (først i listen) — multi-ball balls får ikke trail
      if (i === 0) detectContourCrossings(prevX, prevY, b.x, b.y)

      // Bounds-check pr ball
      if (!handleEdgesForBall(b)) {
        // Ball droknet → fjern fra array
        balls.splice(i, 1)
        continue
      }

      // Stillness-detection
      checkStillness(b, dt)
      if (b.exploded || !b.visible) {
        balls.splice(i, 1)
        continue
      }
    }

    // Hvis alle baller er borte og status fortsatt 'rolling' → drown-event
    if (balls.length === 0 && status.value === 'rolling') {
      drownAll()
    }
  }

  function checkStillness(b, dt) {
    // Velocity-basert: ball som har fart > terskel resetter stillness-state.
    // Ball som har lav fart akkumulerer stillTime — uavhengig av om den
    // driver linjært eller bare står helt i ro.
    const speed = Math.hypot(b.vx, b.vy)
    if (speed > STILLNESS_SPEED_M_S) {
      b.stillTime = 0
      b.chargeT = 0
      b.warnIndex = 0
      return
    }
    b.stillTime += dt

    if (b.canExplode) {
      // Primary ball: warn → explode flow
      if (b.stillTime >= STILLNESS_WARNING_S) {
        const range = STILLNESS_EXPLODE_S - STILLNESS_WARNING_S
        b.chargeT = Math.min(1, (b.stillTime - STILLNESS_WARNING_S) / range)
        const desiredWarn = Math.floor(b.chargeT * 4 + 0.001)
        while (b.warnIndex < desiredWarn) {
          playStillWarning(b.warnIndex)
          b.warnIndex++
        }
      }
      if (b.stillTime >= STILLNESS_EXPLODE_S) {
        explodeBall(b)
      }
    } else {
      // Multi-ball balls: ingen kaskade-eksplosjon. Forsvinner stille hvis
      // de virkelig blir stuck i en dal — slik at game-state ikke henger.
      if (b.stillTime >= MULTIBALL_STUCK_S) {
        b.visible = false   // silent cleanup, ingen splash/lyd
      }
    }
  }

  function explodeBall(b) {
    // Clamp spawn-posisjon godt inne i playfield så multi-ball-baller ikke
    // umiddelbart krysser flipper-plan og drukner. Margin = inset + r + 50.
    const margin = FLIPPER_INSET_M + BALL_RADIUS_M + 50
    const sx = Math.max(margin, Math.min(bounds.width - margin, b.x))
    const sy = Math.max(margin, Math.min(bounds.height - margin, b.y))

    splash.x = sx
    splash.y = sy
    splash.active = true
    splash.t = 0
    splash.kind = 'explode'
    playExplosion()
    setTimeout(() => playMultiSpawn(), 250)

    // Trigg HUD-flash for "MULTIBALL!"
    lastEvent.value = { kind: 'multiball', at: Date.now() }

    // Marker som ekspodert (blir splicet ut neste loop-iter)
    b.exploded = true

    // Spawn 3 nye baller fra (clamped) eksplosjonspunkt
    const baseAngle = Math.random() * Math.PI * 2
    for (let k = 0; k < MULTIBALL_COUNT; k++) {
      const angle = baseAngle + (k * 2 * Math.PI / MULTIBALL_COUNT)
      const a = angle + (Math.random() - 0.5) * 0.5
      const speed = MULTIBALL_SPEED * (0.85 + Math.random() * 0.3)
      // canExplode=false: ingen kaskade-eksplosjoner. Stuck-cleanup (8s) tar
      // over hvis multi-ball balls stagnerer.
      spawnBall(sx, sy, Math.cos(a) * speed, Math.sin(a) * speed, false)
    }
  }

  function detectContourCrossings(_px, _py, cx, cy) {
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

  /** Kant-handling pr ball. Returner false hvis ball drukner. */
  function handleEdgesForBall(b) {
    const w = bounds.width, h = bounds.height
    const r = BALL_RADIUS_M
    const inset = FLIPPER_INSET_M

    if (b.y - r < inset && b.vy < 0) {
      const f = flippers.top
      const c = f.position * w
      const half = f.length * w * 0.5
      if (b.x >= c - half && b.x <= c + half) {
        b.y = inset + r
        const mult = KICK_MULTIPLIERS[f.kickLevel]
        b.vy = Math.max(KICK_SPEED * mult, Math.abs(b.vy) * BOUNCE_AMPLIFY)
        registerHit(b, f, 'top')
      } else {
        ballDrown(b, b.x, 0)
        return false
      }
    }
    if (b.y + r > h - inset && b.vy > 0) {
      const f = flippers.bottom
      const c = f.position * w
      const half = f.length * w * 0.5
      if (b.x >= c - half && b.x <= c + half) {
        b.y = h - inset - r
        const mult = KICK_MULTIPLIERS[f.kickLevel]
        b.vy = -Math.max(KICK_SPEED * mult, Math.abs(b.vy) * BOUNCE_AMPLIFY)
        registerHit(b, f, 'bottom')
      } else {
        ballDrown(b, b.x, h)
        return false
      }
    }
    if (b.x - r < inset && b.vx < 0) {
      const f = flippers.left
      const c = f.position * h
      const half = f.length * h * 0.5
      if (b.y >= c - half && b.y <= c + half) {
        b.x = inset + r
        const mult = KICK_MULTIPLIERS[f.kickLevel]
        b.vx = Math.max(KICK_SPEED * mult, Math.abs(b.vx) * BOUNCE_AMPLIFY)
        registerHit(b, f, 'left')
      } else {
        ballDrown(b, 0, b.y)
        return false
      }
    }
    if (b.x + r > w - inset && b.vx > 0) {
      const f = flippers.right
      const c = f.position * h
      const half = f.length * h * 0.5
      if (b.y >= c - half && b.y <= c + half) {
        b.x = w - inset - r
        const mult = KICK_MULTIPLIERS[f.kickLevel]
        b.vx = -Math.max(KICK_SPEED * mult, Math.abs(b.vx) * BOUNCE_AMPLIFY)
        registerHit(b, f, 'right')
      } else {
        ballDrown(b, w, b.y)
        return false
      }
    }
    return true
  }

  const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

  function registerHit(b, flipper, edge) {
    const kickLevel = flipper.kickLevel
    flipper.kickLevel = 0
    score.value += 100 * level.value
    playKick(kickLevel)

    // Reset stillness-state på treff
    b.stillTime = 0
    b.chargeT = 0
    b.warnIndex = 0

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
    const primary = balls[0]
    if (!primary || !primary.visible) return
    const slot = trail[trailIdx]
    slot.x = primary.x
    slot.y = primary.y
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

  /** En enkelt ball druknet (out-of-bounds). Splash + fjern. Multi-ball:
   *  game fortsetter inntil alle er borte. */
  function ballDrown(b, sx, sy) {
    splash.x = sx
    splash.y = sy
    splash.active = true
    splash.t = 0
    splash.kind = 'drown'
    playSplash()
    b.visible = false
  }

  /** Alle baller er borte → -1 liv. */
  function drownAll() {
    lives.value = Math.max(0, lives.value - 1)
    lastHitEdge = null
    lastElev = NaN

    if (lives.value === 0) {
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
      balls.length = 0
      lastHitEdge = null
      lastElev = NaN
      status.value = 'idle'
    }, 1500)
  }

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
    const r = Math.sqrt(Math.random()) * R
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    balls.length = 0
    spawnBall(x, y, 0, 0, true)
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
    balls.length = 0
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
    // Beregn terrain-energy-multiplier basert på DEM-elevasjon-spenn.
    // Typisk variert terreng (200m range) → 1.0. Flatmark (50m) → 4.0
    // (kraftig redusert friksjon). Mountain (500m) → 0.4 (mer friksjon,
    // men terrenget gir naturlig akselerasjon).
    terrainEnergyMult = 1
    if (dem?.data && dem.noData != null) {
      let mn = Infinity, mx = -Infinity
      const nd = dem.noData
      for (let i = 0; i < dem.data.length; i++) {
        const z = dem.data[i]
        if (z === nd || !Number.isFinite(z)) continue
        if (z < mn) mn = z
        if (z > mx) mx = z
      }
      const range = (mx - mn) > 0 ? (mx - mn) : TERRAIN_REF_RANGE_M
      terrainEnergyMult = Math.max(0.4, Math.min(4.0, TERRAIN_REF_RANGE_M / range))
    }
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
    balls.length = 0
    splash.active = false
  }

  onUnmounted(deactivate)

  return {
    // state
    active, status, level, lives, score, totalScore, countdown, highscore,
    levelTarget, lastEvent,
    balls, splash, trail, flippers,
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

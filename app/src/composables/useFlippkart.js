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
  const PERK_INTERVAL = 3              // perk-velg hvert 3. level (3, 6, 9...)
  const MAX_LIVES = 5
  const FLIPPER_LENGTH_BOOST = 0.08    // + 8% lengde per "stor flipper"-perk

  // Perks-tilstand. Akkumuleres permanent gjennom spillet.
  const perks = reactive({
    contourMult: 1,        // multiplikator for kontur-bonus
    kickMult: 1,           // multiplikator for KICK_SPEED
    hitScoreMult: 1,       // multiplikator for paddle-treff-poeng
    smashMult: 1,          // multiplikator for smash-bonus
    frictionMult: 1,       // multiplikator for friction (lavere = mindre drag)
    chargeBonus: 0,        // free kickLevel etter ball-drop (0..3)
  })

  // 3 perk-valg som vises ved hver level-clear hvor (level % 3 === 0)
  const perkChoices = ref([])

  // Tilgjengelige perks-typer. Velges 3 tilfeldige hver gang.
  const PERK_CATALOG = [
    { id: 'flipper-top',    icon: '⬆️', label: '+8% TOPP-FLIPPER',    desc: 'Lengre paddle på toppen' },
    { id: 'flipper-bottom', icon: '⬇️', label: '+8% BUNN-FLIPPER',    desc: 'Lengre paddle nederst' },
    { id: 'flipper-left',   icon: '⬅️', label: '+8% VENSTRE-FLIPPER', desc: 'Lengre paddle til venstre' },
    { id: 'flipper-right',  icon: '➡️', label: '+8% HØYRE-FLIPPER',   desc: 'Lengre paddle til høyre' },
    { id: 'contour-x2',     icon: '〰️', label: 'KONTUR-BOOST 2×',     desc: 'Doblede kontur-poeng' },
    { id: 'kick-power',     icon: '💥', label: '+25% KICK-KRAFT',     desc: 'Kraftigere flipper-spark' },
    { id: 'smash-x2',       icon: '🌟', label: 'SMASH-BOOST 2×',      desc: 'Doblet smash-bonus' },
    { id: 'extra-life',     icon: '❤️', label: '+1 LIV',              desc: 'Maks 5 totalt' },
    { id: 'low-friction',   icon: '❄️', label: '−20% FRIKSJON',       desc: 'Ball glir lenger' },
    { id: 'pre-charged',    icon: '⚡', label: 'FORHÅNDSLADET',       desc: 'Flippere starter med +1 kick' },
  ]

  // v7.2.8: bytte fra posisjon-basert til hastighet-basert stillness-
  // deteksjon. Posisjon-deteksjon var upålitelig — ball som drev sakte
  // linjært fikk stillTime resatt før den nådde explode-terskel. Velocity-
  // basert er mer pålitelig for "ball går tom for energi".
  const STILLNESS_SPEED_M_S = 80     // under denne fart = "stille" (akkumulerer)
  const STILLNESS_WARNING_S = 1.5    // når warning starter
  const STILLNESS_EXPLODE_S = 3.5    // når eksplosjon trigger (primary ball)
  const MULTIBALL_STUCK_S = 6.0      // når multi-ball balls bare drukner stille
  const MULTIBALL_COUNT = 3

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
    // v7.2.9: bratte kurve etter level ~5. Gammel formel (500+600*log2)
    // platafonet: L10=2493, L20=3093 — for enkelt etter level 10.
    // Ny: log2-base + kvadratisk komponent for høyere levels.
    //   L1: 500, L3: 1610, L5: 2534, L10: 5733, L20: 17533
    const lv = Math.max(1, n)
    return Math.round(500 + 600 * Math.log2(lv) + 40 * Math.pow(lv - 1, 2))
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
      friction: (baseFriction / terrainEnergyMult) * perks.frictionMult,
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
    // Splash visualiseres ved ballens posisjon (det føles riktig at
    // eksplosjonen skjer DER kula sto stille).
    splash.x = b.x
    splash.y = b.y
    splash.active = true
    splash.t = 0
    splash.kind = 'explode'
    playExplosion()
    setTimeout(() => playMultiSpawn(), 250)

    // Trigg HUD-flash for "MULTIBALL!"
    lastEvent.value = { kind: 'multiball', at: Date.now() }

    // Marker som ekspodert (blir splicet ut neste loop-iter)
    b.exploded = true

    // v7.2.9: 3 nye baller "droppes" på TILFELDIGE posisjoner innenfor R=65%-
    // sirkel, med null start-fart. Som level-start: gradient-akselerasjon
    // + level-physics gir dem fart fra start. Ingen risiko for at alle 3
    // havner på samme problemtype-spot som original-kula.
    const cx = bounds.width / 2
    const cy = bounds.height / 2
    const R = RANDOM_DROP_R_FRAC * Math.min(bounds.width, bounds.height)
    for (let k = 0; k < MULTIBALL_COUNT; k++) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * R
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      // canExplode=false: ingen kaskade-eksplosjoner. Stuck-cleanup tar over
      // hvis multi-ball balls stagnerer.
      spawnBall(x, y, 0, 0, false)
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
          score.value += Math.round(5 * perks.contourMult)
          thick = true
        } else {
          score.value += Math.round(1 * perks.contourMult)
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
        b.vy = Math.max(KICK_SPEED * mult * perks.kickMult, Math.abs(b.vy) * BOUNCE_AMPLIFY)
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
        b.vy = -Math.max(KICK_SPEED * mult * perks.kickMult, Math.abs(b.vy) * BOUNCE_AMPLIFY)
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
        b.vx = Math.max(KICK_SPEED * mult * perks.kickMult, Math.abs(b.vx) * BOUNCE_AMPLIFY)
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
        b.vx = -Math.max(KICK_SPEED * mult * perks.kickMult, Math.abs(b.vx) * BOUNCE_AMPLIFY)
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
    score.value += Math.round(100 * level.value * perks.hitScoreMult)
    playKick(kickLevel)

    // Reset stillness-state på treff
    b.stillTime = 0
    b.chargeT = 0
    b.warnIndex = 0

    if (lastHitEdge && OPPOSITE[lastHitEdge] === edge) {
      const bonus = Math.round(SMASH_BONUS_BASE * Math.pow(2, level.value - 1) * perks.smashMult)
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
      // Hvert PERK_INTERVAL (3.) level: vis perk-velg-meny FØR neste level
      if ((level.value - 1) % PERK_INTERVAL === 0) {
        perkChoices.value = pickRandomPerks(3)
        status.value = 'perk-select'
      } else {
        status.value = 'idle'
      }
    }, 1500)
  }

  function pickRandomPerks(count) {
    // Trekker 'count' tilfeldige unike perks fra katalogen.
    const pool = [...PERK_CATALOG]
    const result = []
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      result.push(pool[idx])
      pool.splice(idx, 1)
    }
    return result
  }

  function applyPerk(id) {
    if (status.value !== 'perk-select') return
    switch (id) {
      case 'flipper-top':    flippers.top.length    += FLIPPER_LENGTH_BOOST; break
      case 'flipper-bottom': flippers.bottom.length += FLIPPER_LENGTH_BOOST; break
      case 'flipper-left':   flippers.left.length   += FLIPPER_LENGTH_BOOST; break
      case 'flipper-right':  flippers.right.length  += FLIPPER_LENGTH_BOOST; break
      case 'contour-x2':     perks.contourMult *= 2; break
      case 'kick-power':     perks.kickMult *= 1.25; break
      case 'smash-x2':       perks.smashMult *= 2; break
      case 'extra-life':     lives.value = Math.min(MAX_LIVES, lives.value + 1); break
      case 'low-friction':   perks.frictionMult *= 0.8; break
      case 'pre-charged':    perks.chargeBonus = Math.min(3, perks.chargeBonus + 1); break
    }
    perkChoices.value = []
    status.value = 'idle'
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
    // Pre-charged perk: alle flippere starter med +N kickLevel
    if (perks.chargeBonus > 0) {
      for (const e of ['top', 'bottom', 'left', 'right']) {
        flippers[e].kickLevel = Math.min(KICK_MULTIPLIERS.length - 1, perks.chargeBonus)
      }
    }
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
    perkChoices.value = []
    perks.contourMult = 1
    perks.kickMult = 1
    perks.hitScoreMult = 1
    perks.smashMult = 1
    perks.frictionMult = 1
    perks.chargeBonus = 0
    for (const e of ['top', 'bottom', 'left', 'right']) {
      flippers[e].position = 0.5
      flippers[e].length = 0.25     // reset til base-lengde (perk-økning gjelder kun innenfor session)
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
    perks, perkChoices,
    // actions
    init, activate, deactivate,
    startCountdown, restart, energize, applyPerk,
    levelParams,
    // constants
    BALL_RADIUS_M,
    FLIPPER_INSET_M,
    KICK_MULTIPLIERS,
  }
}

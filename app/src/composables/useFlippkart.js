import { ref, reactive, computed, onUnmounted } from 'vue'
import { sampleGradient, sampleElevation } from '../lib/demSampling.js'
import {
  playIntro, playKick, playEnergize, playSplash, playWin,
  playGameOver, playCountdownBeep, playDrop, playContourTick, playSmash,
  playStillWarning, playExplosion, playMultiSpawn, playBumperHit,
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

  // v7.3.4: midlertidig debug-flag for å verifisere multiball-pipelinen.
  // Skru til false når atferden er bekreftet stabil i prod.
  const DEBUG_MULTIBALL = true

  // v7.3.5: ring-buffer av debug-meldinger som vises i HUD-debug-panelet
  // (mobil-friendly — ingen konsoll trengs). Holder maks 12 entries.
  const debugLog = reactive([])
  function dlog(msg, data) {
    if (!DEBUG_MULTIBALL) return
    const t = new Date()
    const stamp = `${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}.${String(t.getMilliseconds()).padStart(3,'0').slice(0,2)}`
    const line = data === undefined ? `${stamp} ${msg}` : `${stamp} ${msg} ${JSON.stringify(data)}`
    console.log('[Flippkart]', msg, data ?? '')
    debugLog.push(line)
    while (debugLog.length > 12) debugLog.shift()
  }

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

  // v7.3.0: rolling-window position-history deteksjon
  const STILLNESS_HISTORY_LEN = 60   // ~1 sek ved 60 fps
  // v7.3.1: STILLNESS_DISPL_M skaleres med map-size i init() (default for 4km-kart)
  let STILLNESS_DISPL_M = 120
  const STILLNESS_WARNING_S = 1.0    // når warning starter
  const STILLNESS_EXPLODE_S = 3.0    // når eksplosjon trigger (primary ball)
  const MULTIBALL_STUCK_S = 6.0      // når multi-ball balls bare drukner stille
  const MULTIBALL_COUNT = 3

  // balls = aktive baller.
  const balls = reactive([])

  // Bumpers (v7.3.0): hus-formede stationary-objekter som ballen bouncer
  // av. Etter BUMPER_HITS_TO_MULTIBALL treff på samme bumper → multi-ball
  // trigges. Genereres bare på partalls-levels (level % 2 === 0).
  const bumpers = reactive([])
  // v7.3.1: spatial konstanter skaleres med map-size i init(). Default-verdier
  // er kalibrert for 4×4km kart.
  let BUMPER_RADIUS_M = 90          // collision-radius (i meter, viewBox)
  const BUMPER_HITS_TO_MULTIBALL = 4
  const BUMPER_HIT_SCORE = 50
  const BUMPER_BOUNCE_SPEED = 350   // minimum utgående fart fra bumper-hit
  const BUMPER_MAX_PER_LEVEL = 5
  let BUMPER_MIN_DISTANCE_M = 250   // min avstand mellom bumpers
  const BUMPER_LEVEL_MOD = 2        // bumpers genereres når level % 2 === 0

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

  // v7.3.1: spatial konstanter skaleres i init() basert på map-size
  let BALL_RADIUS_M = 90
  let FLIPPER_INSET_M = 280
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

      // Bumper-collisions
      handleBumperCollisions(b)

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
    // v7.3.2: bounding-radius rundt centroid av posisjons-historikken.
    // Tidligere "oldest vs current"-displacement (v7.3.0) klarte ikke fange
    // ball som oscillerer i en dal med rytme nær 1-sek-vinduet — oldest
    // og current er ved samme/ulik fase i oscillasjonen, så displacement
    // varierer kaotisk. Bounding-radius er rytme-uavhengig:
    //
    //   - Stillestående ball  → all history på samme sted → maxR = 0
    //   - Oscillerende ball   → centroid i midten, maxR = oscillasjons-radius
    //   - Drift (sakte linjær) → centroid følger drift, maxR = liten
    //   - Drift (rask)         → samples sprer seg utover, maxR > terskel
    //
    if (!b.history) b.history = []
    b.history.push({ x: b.x, y: b.y })
    if (b.history.length > STILLNESS_HISTORY_LEN) b.history.shift()

    if (b.history.length < STILLNESS_HISTORY_LEN) {
      b.stillTime = 0
      return
    }

    let cx = 0, cy = 0
    for (const p of b.history) { cx += p.x; cy += p.y }
    cx /= b.history.length
    cy /= b.history.length
    let maxR = 0
    for (const p of b.history) {
      const d = Math.hypot(p.x - cx, p.y - cy)
      if (d > maxR) maxR = d
    }

    if (maxR > STILLNESS_DISPL_M) {
      b.stillTime = 0
      b.chargeT = 0
      b.warnIndex = 0
      return
    }
    b.stillTime += dt

    if (b.canExplode) {
      if (b.stillTime >= STILLNESS_WARNING_S) {
        const range = STILLNESS_EXPLODE_S - STILLNESS_WARNING_S
        const prevCharge = b.chargeT
        b.chargeT = Math.min(1, (b.stillTime - STILLNESS_WARNING_S) / range)
        if (prevCharge === 0) dlog('stillness warning', { maxR: +maxR.toFixed(0) })
        const desiredWarn = Math.floor(b.chargeT * 4 + 0.001)
        while (b.warnIndex < desiredWarn) {
          playStillWarning(b.warnIndex)
          b.warnIndex++
        }
      }
      if (b.stillTime >= STILLNESS_EXPLODE_S) {
        dlog('stillness → explode', { stillTime: +b.stillTime.toFixed(2) })
        explodeBall(b)
      }
    } else {
      if (b.stillTime >= MULTIBALL_STUCK_S) {
        b.visible = false
      }
    }
  }

  /**
   * Genererer bumpers for nåværende level. Tilfeldig plassering innenfor
   * playable area, min-avstand mellom hver. 1-5 bumpers, men kun når
   * level % BUMPER_LEVEL_MOD === 0 (partalls-levels). Resetter hits-counter.
   */
  // Bumper-typer (matcher kart-annoterings-symboler i appen):
  // knaus = brun halvmåne, stein = svart trekant, brønn = blå sirkel m kryss,
  // bro = to parallelle streker. Random kind pr bumper for visuell variasjon.
  const BUMPER_KINDS = ['knaus', 'stein', 'brønn', 'bro']

  function generateBumpersForLevel() {
    bumpers.length = 0
    if (level.value % BUMPER_LEVEL_MOD !== 0) return
    const count = 1 + Math.floor(Math.random() * BUMPER_MAX_PER_LEVEL)
    const margin = FLIPPER_INSET_M + BUMPER_RADIUS_M + 100
    let attempts = 0
    while (bumpers.length < count && attempts < 100) {
      attempts++
      const x = margin + Math.random() * (bounds.width - 2 * margin)
      const y = margin + Math.random() * (bounds.height - 2 * margin)
      let ok = true
      for (const b of bumpers) {
        if (Math.hypot(b.x - x, b.y - y) < BUMPER_MIN_DISTANCE_M) {
          ok = false; break
        }
      }
      if (ok) {
        const kind = BUMPER_KINDS[Math.floor(Math.random() * BUMPER_KINDS.length)]
        bumpers.push({ x, y, hits: 0, kind })
      }
    }
  }

  /** Sjekk om ball treffer noen bumper og handter bounce + multiball-trigger. */
  function handleBumperCollisions(b) {
    const r = BALL_RADIUS_M + BUMPER_RADIUS_M
    for (const bp of bumpers) {
      const dx = b.x - bp.x
      const dy = b.y - bp.y
      const dist = Math.hypot(dx, dy)
      if (dist > r) continue
      // v7.3.2: Spesialtilfelle — ball direkte i bumper-senter (dist ≈ 0).
      // Tidligere `if (dist < 1) continue` etterlot ball stuck inne i
      // bumperen. Nå force-push i tilfeldig retning med full BOUNCE_SPEED.
      let nx, ny
      if (dist < 1) {
        const a = Math.random() * Math.PI * 2
        nx = Math.cos(a)
        ny = Math.sin(a)
        b.x = bp.x + nx * (r * 0.5)
        b.y = bp.y + ny * (r * 0.5)
        b.vx = nx * BUMPER_BOUNCE_SPEED
        b.vy = ny * BUMPER_BOUNCE_SPEED
      } else {
        nx = dx / dist
        ny = dy / dist
        // Push ball ut av bumper langs normalen
        const overlap = r - dist
        b.x += nx * overlap
        b.y += ny * overlap
        // Reflekter velocity langs normal + boost (sparker som pinball-bumper)
        const vDotN = b.vx * nx + b.vy * ny
        if (vDotN < 0) {
          const incomingMag = Math.hypot(b.vx, b.vy)
          const outMag = Math.max(BUMPER_BOUNCE_SPEED, incomingMag * 1.15)
          b.vx = nx * outMag
          b.vy = ny * outMag
        }
      }
      // Score + sound + state
      bp.hits += 1
      score.value += Math.round(BUMPER_HIT_SCORE * level.value * perks.hitScoreMult)
      const remaining = BUMPER_HITS_TO_MULTIBALL - bp.hits
      playBumperHit(remaining)

      // Reset stillness på ball (ball kollidert = ikke stuck).
      // NB: clear ikke history-array, bare stillTime — ellers blir
      // checkStillness-deteksjon kunstig forsinket i 1 sek etter hver hit.
      b.stillTime = 0
      b.chargeT = 0
      b.warnIndex = 0

      checkLevelComplete()

      if (bp.hits >= BUMPER_HITS_TO_MULTIBALL) {
        // Trigg multi-ball + reset bumperen
        bp.hits = 0
        triggerMultiballFromBumper(bp.x, bp.y)
      }
      // En ball kan kun treffe én bumper per frame
      break
    }
  }

  /** Gi en ball et tilfeldig kick (random retning, gitt fart). Brukes av
   *  tap-to-kick UI og av multiball-spawn for å unngå at nye baller står
   *  helt stille på flatmark. Resetter også stillness-state. */
  function kickBall(b, speed = KICK_SPEED) {
    if (!b || !b.visible) return
    const angle = Math.random() * Math.PI * 2
    b.vx = Math.cos(angle) * speed
    b.vy = Math.sin(angle) * speed
    b.stillTime = 0
    b.chargeT = 0
    b.warnIndex = 0
    if (b.history) b.history.length = 0
    dlog('kick', { speed: +speed.toFixed(0) })
  }

  /** Debug-utløser: tving multiball-trigger uavhengig av stillness/bumper.
   *  Lar oss verifisere at SPAWN-stien fungerer selv om DETEKSJONEN er
   *  feil. Vises som en knapp i debug-panelet. */
  function forceMultiball() {
    if (status.value !== 'rolling') {
      dlog('force-multiball skipped', { status: status.value })
      return
    }
    const b = balls[0]
    if (!b) {
      dlog('force-multiball: no ball')
      return
    }
    dlog('force-multiball')
    explodeBall(b)
  }

  /** Multiball trigget av bumper-treff (samme drop-pattern som explodeBall). */
  function triggerMultiballFromBumper(sx, sy) {
    splash.x = sx
    splash.y = sy
    splash.active = true
    splash.t = 0
    splash.kind = 'explode'
    playExplosion()
    setTimeout(() => playMultiSpawn(), 250)
    lastEvent.value = { kind: 'multiball', at: Date.now() }
    dlog('bumper → multiball', { ballsBefore: balls.length })

    // 3 baller dropped på random posisjoner med random kick — uten kick
    // ville nye baller stått stille på flatmark og blitt stuck-cleanet ut
    const cx = bounds.width / 2
    const cy = bounds.height / 2
    const R = RANDOM_DROP_R_FRAC * Math.min(bounds.width, bounds.height)
    for (let k = 0; k < MULTIBALL_COUNT; k++) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * R
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      const kickAngle = Math.random() * Math.PI * 2
      const vx = Math.cos(kickAngle) * KICK_SPEED
      const vy = Math.sin(kickAngle) * KICK_SPEED
      spawnBall(x, y, vx, vy, false)
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
    dlog('explode → multiball')

    // Marker som ekspodert (blir splicet ut neste loop-iter)
    b.exploded = true

    // v7.3.4: 3 nye baller spawnes på TILFELDIGE posisjoner med random kick
    // ved KICK_SPEED-fart. Tidligere ble de spawnet med vx=vy=0 og var
    // sårbare for å stå stille på flatmark — så multiball "døde" stille.
    const cx = bounds.width / 2
    const cy = bounds.height / 2
    const R = RANDOM_DROP_R_FRAC * Math.min(bounds.width, bounds.height)
    for (let k = 0; k < MULTIBALL_COUNT; k++) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * R
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      const kickAngle = Math.random() * Math.PI * 2
      const vx = Math.cos(kickAngle) * KICK_SPEED
      const vy = Math.sin(kickAngle) * KICK_SPEED
      // canExplode=false: ingen kaskade-eksplosjoner. Stuck-cleanup tar over
      // hvis multi-ball balls likevel stagnerer.
      spawnBall(x, y, vx, vy, false)
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

    // Reset stillness-state på treff (inkl posisjon-historikk)
    b.stillTime = 0
    b.chargeT = 0
    b.warnIndex = 0
    if (b.history) b.history.length = 0

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
      generateBumpersForLevel()    // v7.3.0: ny set bumpers for nytt level
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
    dlog('drop', { canExplode: true })
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
    bumpers.length = 0
    generateBumpersForLevel()       // for L1 vil dette bli no-op (level%2 ikke 0)
  }

  function init(ctx) {
    dem = ctx.dem
    bounds = ctx.bounds
    equidistanceM = ctx.equidistanceM ?? 20

    // v7.3.1: Skala spatial-konstanter etter kart-størrelse. Defaults var
    // tunet for 4×4km kart. Mindre kart (1km, 2km, 3km) trengte mindre
    // ball + paddler + bumpers + stillness-displacement-terskel.
    const minDim = Math.min(bounds.width || 4000, bounds.height || 4000)
    const mapScale = minDim / 4000
    BALL_RADIUS_M       = 90  * mapScale
    FLIPPER_INSET_M     = 280 * mapScale
    BUMPER_RADIUS_M     = 90  * mapScale
    BUMPER_MIN_DISTANCE_M = 250 * mapScale
    STILLNESS_DISPL_M   = 120 * mapScale

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
    balls, splash, trail, flippers, bumpers,
    perks, perkChoices,
    // actions
    init, activate, deactivate,
    startCountdown, restart, energize, applyPerk,
    kickBall, forceMultiball,
    levelParams,
    debugLog,
    DEBUG_MULTIBALL,
    STILLNESS_WARNING_S, STILLNESS_EXPLODE_S,
    get STILLNESS_DISPL_M() { return STILLNESS_DISPL_M },
    // constants — getters reads dynamic values (skaleres i init basert på map-size)
    get BALL_RADIUS_M() { return BALL_RADIUS_M },
    get FLIPPER_INSET_M() { return FLIPPER_INSET_M },
    get BUMPER_RADIUS_M() { return BUMPER_RADIUS_M },
    KICK_MULTIPLIERS,
    BUMPER_HITS_TO_MULTIBALL,
  }
}

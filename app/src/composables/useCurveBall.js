import { ref, reactive, computed, onUnmounted } from 'vue'
import { sampleGradient, sampleElevation } from '../lib/demSampling.js'
import {
  playIntro, playKick, playEnergize, playSplash, playWin,
  playGameOver, playCountdownBeep, playDrop, playContourTick, playSmash,
  playStillWarning, playExplosion, playMultiSpawn, playBumperHit,
  playMiniSpawn, playMiniHit, playInvaderSpawn, playInvaderBreakout,
} from './useCurveBallSound.js'

/**
 * CurveBall — fysikk og state machine for marble-spillet.
 *
 * (v8.0.0: rebrandet fra useFlippkart — semantikk uendret. Brand-navnet i
 * UI er Curve Invaders (med mellomrom siden v8.0.1), men codename i
 * kildekoden er CurveBall.)
 *
 * v7.2.6 multi-ball:
 *   - balls[] erstatter single ball
 *   - Ball som står stille i ~1s → warning-mode (chargeT 0..1)
 *   - Etter ~3s stille → eksplosjon → 3 nye baller spawnes med random vel
 *   - Game continues til ALLE baller er ute (drown / out-of-edge), så -1 liv
 *   - Stillness reset på paddle-treff og bevegelse (>STILLNESS_DIST_M)
 */
export function useCurveBall() {
  const active = ref(false)
  // 'idle' | 'countdown' | 'rolling' | 'sunk' | 'won' | 'gameover' | 'mode-select' | 'perk-select'
  const status = ref('idle')
  const level = ref(1)
  const lives = ref(3)
  const score = ref(0)
  const totalScore = ref(0)
  const countdown = ref(0)
  const highscore = ref(loadHighscore())
  const lastEvent = ref(null)

  // v7.4.0 turneringsmodus: settes FØR første level (mode-select-overlay).
  //   null  → ikke valgt enda (HUD viser mode-select-prompt)
  //   true  → "Neste kart"-snarvei vises ved level-clear, state bæres
  //           gjennom navigering via sessionStorage
  //   false → standard, bli på samme kart hele runden
  const tournamentMode = ref(null)

  // v7.3.4: debug-flag for å verifisere multiball-pipelinen. v7.3.7: skrudd
  // av — alt debug-stillas (panel, dlog, force-multiball) er bevart i koden
  // for senere bruk, bare gated på dette flagget.
  const DEBUG_MULTIBALL = false

  // v7.3.5: ring-buffer av debug-meldinger som vises i HUD-debug-panelet
  // (mobil-friendly — ingen konsoll trengs). Holder maks 12 entries.
  const debugLog = reactive([])
  function dlog(msg, data) {
    if (!DEBUG_MULTIBALL) return
    const t = new Date()
    const stamp = `${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}.${String(t.getMilliseconds()).padStart(3,'0').slice(0,2)}`
    const line = data === undefined ? `${stamp} ${msg}` : `${stamp} ${msg} ${JSON.stringify(data)}`
    console.log('[CurveBall]', msg, data ?? '')
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
    linkedFlippers: false, // tap → energize parret flipper også (v7.3.7)
  })

  // v7.3.7: når perks.linkedFlippers er aktiv, energiserer ett tap to flippere
  // i diagonal par. Hvis du tapper bunn lader også venstre, og omvendt — likeens
  // for topp ↔ høyre. Lar én finger drive en hel diagonal-halvdel.
  const LINKED_PAIRS = {
    bottom: 'left',
    left: 'bottom',
    top: 'right',
    right: 'top',
  }

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
    { id: 'linked-flippers',icon: '🔗', label: 'KOBLEDE PADDLES',     desc: 'Bunn+venstre og topp+høyre lader sammen' },
  ]

  // v7.3.0: rolling-window position-history deteksjon
  const STILLNESS_HISTORY_LEN = 60   // ~1 sek ved 60 fps
  // v7.3.1: STILLNESS_DISPL_M skaleres med map-size i init() (default for 4km-kart)
  let STILLNESS_DISPL_M = 120
  const STILLNESS_WARNING_S = 1.0    // når warning starter
  const STILLNESS_EXPLODE_S = 3.0    // når eksplosjon trigger (primary ball)
  const MULTIBALL_STUCK_S = 6.0      // når multi-ball balls bare drukner stille
  const MULTIBALL_COUNT = 3

  // v8.0.2: maks antall stillness-trigget multiball-eksplosjoner per level.
  // På bratte kart kunne ballen havne i en dal med slik geometri at den
  // alltid endte i samme valley, eksploderte → multiball → multiball-baller
  // drukner → primary lever videre, blir stuck igjen → ny eksplosjon →
  // cascade. Cap'er antallet til 1 per level. Påfølgende stillness-events
  // gir en «rescue-kick» (kraftig kast mot nærmeste bumper eller oppoverbakke)
  // i stedet for ny spawn-burst.
  const STILLNESS_EXPLODE_PER_LEVEL_CAP = 1
  let stillnessExplodeCount = 0

  // v8.0.2: maksimal kulehastighet med myk level-progresjon. Flate kart med
  // få høydekurver lot ballen akselerere ubegrenset (paddle BOUNCE_AMPLIFY=1.1
  // og bumper-bounce ×1.15 komponerte uten friksjons-motstand på flatmark).
  // v8.0.3: cap'en skaleres med `mapScale` så skjerm-traverseringstid blir
  // kart-størrelse-uavhengig (1km-kart fikk ellers 4× rasker visuell ball
  // enn 4km-kart). I tillegg en mild «steep-bonus» (1.0×–1.3×) basert på
  // terreng-elevasjons-spenn så bratte kart faktisk får utløp for slope-
  // akselerasjonen — gir gameplay-følelsen «bratt = raskere».
  //
  // Referanse-curven (4×4km, normal topografi):
  //   speedCap(n) = BASE + (MAX − BASE) × (1 − exp(−(n−1)/K))
  // L1: 650, L5: 781, L10: 871, L20: 953, L∞: 1000.
  const BALL_SPEED_BASE = 650
  const BALL_SPEED_MAX  = 1000
  const BALL_SPEED_LEVEL_K = 10
  const STEEP_BONUS_MAX = 0.3
  function maxBallSpeed(n) {
    const lv = Math.max(1, n)
    const growth = BALL_SPEED_MAX - BALL_SPEED_BASE
    const baseCap = BALL_SPEED_BASE + growth * (1 - Math.exp(-(lv - 1) / BALL_SPEED_LEVEL_K))
    // terrainEnergyMult er 4.0 på flatt og 0.4 på bratt. Inverter til
    // steepness-faktor (0.25 flatt, 1.0 normal, 2.5 bratt) og bruk den
    // til en mild bonus opp til +30 % over normal-cap. Flate kart får
    // ingen straff (clampet ved 0).
    const terrainSteepness = 1 / Math.max(0.4, terrainEnergyMult)
    const steepBonus = 1 + STEEP_BONUS_MAX * Math.max(0, Math.min(1, terrainSteepness - 1))
    return baseCap * mapScale * steepBonus
  }
  function clampBallSpeed(b, cap) {
    const v2 = b.vx * b.vx + b.vy * b.vy
    if (v2 <= cap * cap) return
    const k = cap / Math.sqrt(v2)
    b.vx *= k
    b.vy *= k
  }

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
  // v8.0.3: BUMPER_BOUNCE_SPEED er flyttet til velocity-blokken nedenfor og
  // skaleres med mapScale i init().
  // v7.4.0: bumpers spawnes nå på ALLE levels med 1-10 random count
  // (tidligere kun partalls-levels og 1-5 stk). Mer pinball-tett bane.
  const BUMPER_MAX_PER_LEVEL = 10
  let BUMPER_MIN_DISTANCE_M = 250   // min avstand mellom bumpers
  // v7.4.1: hard cap på baller i lufta. Stopper spawn-i-spawn-cascade
  // (rapport 10. mai: score løp opp i 7.48e+52 fordi multiball-baller
  // fortsatte å trigge nye multiballs på bumpers, eksponentielt).
  // v7.4.3: økt til 16 fordi miniball-modus spawner 12 små baller +
  // eksisterende. Cascade-prevention er fortsatt på via canExplode-gate.
  const MAX_BALLS_IN_PLAY = 16

  // v7.4.3 spawn-modi. Pool vokser med level — variasjon kommer etter hvert
  // som vanskelighetsgrad øker. Legg merke til at modusene KUN trigges av
  // canExplode=true-baller (se handleBumperCollisions), så cascade er ikke
  // mulig uavhengig av modus.
  const SPAWN_MODE_LVL = {
    multiball: 1,         // tilgjengelig fra level 1
    miniball: 3,          // fra level 3
    invaders: 6,          // fra level 6 (v8.0.0: navn forkortet fra curveInvaders)
  }
  const MINI_COUNT = 12
  const MINI_SPEED_MULT = 2.0
  const MINI_RADIUS_FRAC = 0.5        // av BALL_RADIUS_M
  const MINI_SCORE_MULT = 2

  const INVADER_MIN_COUNT = 3
  const INVADER_MAX_COUNT = 12
  const INVADER_RADIUS_FRAC = 0.6     // av BALL_RADIUS_M
  const INVADER_SCORE_MULT = 1.5
  const INVADER_ORBIT_DURATION_S = 3.0
  const INVADER_BREAKOUT_SPEED_MULT = 1.4
  const INVADER_ENERGY_VARIATION = 0.4   // ±20% per ball

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
  // v8.0.3: KICK_SPEED og BUMPER_BOUNCE_SPEED er fart i m/s. Tidligere fast,
  // men det gir radikalt ulik skjerm-traverseringstid mellom 1km- og 10km-
  // kart (på 1km-kart blastet ballen tvers over på <1s). Nå skaleres alle
  // hastigheter og akselerasjoner lineært med `mapScale` så skjerm-tid blir
  // tilnærmet kart-størrelse-uavhengig. Multipliers (KICK_MULTIPLIERS,
  // BOUNCE_AMPLIFY) og rates (friction 1/s) er fortsatt skala-invariante.
  let KICK_SPEED = 300
  let BUMPER_BOUNCE_SPEED = 350
  let mapScale = 1   // recomputed in init() — bevart som module-level for at
                     // levelParams() og maxBallSpeed() skal kunne bruke verdien

  // Trail (for én ball — den med nyligst posisjons-oppdatering)
  const TRAIL_LEN = 14
  const trail = reactive(
    Array.from({ length: TRAIL_LEN }, () => ({ x: 0, y: 0, age: TRAIL_LEN }))
  )
  let trailIdx = 0

  // v7.3.7: multiball-cascade-state. levelChain teller på hverandre følgende
  // level-clears mens multiball er aktiv. Reset ved drown / restart / normal-win.
  // pendingPerkSelect husker at vi krysset et perk-trigger-level under cascade
  // så menyen vises når multiball avsluttes.
  let levelChain = 0
  let pendingPerkSelect = false

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
    // v7.4.0: rent gradvis vekst — lineær base + svak kvadratisk hale.
    // Tidligere log2-formel (v7.2.9) ga store hopp tidlig (L1→L3 +1110)
    // og deretter slakkere stigning. Nå skalerer hver level med en jevn
    // step på +600/level pluss en smal kvadratisk akselerasjon.
    //   L1: 500, L3: 1820, L5: 3340, L10: 8550, L15: 15860, L20: 25270
    const lv = Math.max(1, n)
    return Math.round(500 + 600 * (lv - 1) + 60 * Math.pow(lv - 1, 2))
  }

  // v8.0.0 rebrand-migrering: skriv kun ny nøkkel, men les både ny og gammel
  // i en overgangsperiode så eksisterende highscores fra FlippKart-tiden
  // ikke nullstilles. Kan ryddes vekk noen versjoner senere.
  const HIGHSCORE_KEY_NEW = 'curveball-highscore'
  const HIGHSCORE_KEY_OLD = 'flippkart-highscore'

  function loadHighscore() {
    if (typeof localStorage === 'undefined') return 0
    try {
      const raw = localStorage.getItem(HIGHSCORE_KEY_NEW)
                ?? localStorage.getItem(HIGHSCORE_KEY_OLD)
                ?? '0'
      const v = parseInt(raw, 10)
      return Number.isFinite(v) ? v : 0
    } catch { return 0 }
  }

  function saveHighscore(value) {
    if (typeof localStorage === 'undefined') return
    try { localStorage.setItem(HIGHSCORE_KEY_NEW, String(value)) } catch {}
  }

  function levelParams(n) {
    // v7.2.7: senket base-friksjon 0.4 → 0.18. Skalert friction inverst
    // med terrainEnergyMult — flate kart får lavere friksjon (ball glir
    // mye lenger på flatmark, mindre stagnering).
    // v8.0.3: kGravity (slope-akselerasjon) skaleres med mapScale så
    // tiden ballen bruker på å akselerere over kartet er kart-størrelse-
    // uavhengig. Friction er en rate (1/s) og forblir skala-invariant.
    const baseFriction = Math.max(0.05, 0.18 - 0.02 * (n - 1))
    return {
      kGravity: (1875 + 250 * (n - 1)) * mapScale,
      friction: (baseFriction / terrainEnergyMult) * perks.frictionMult,
    }
  }

  /**
   * Spawn én ny ball — returnerer ball-objektet.
   *
   * v7.4.3: signaturen tar nå et opts-objekt for å støtte spawn-modi
   * (mini, invader). Backward-compatible: gamle (x, y, vx, vy, canExplode)-
   * positional-kall fortsetter å funke fordi vi sjekker om 3. arg er objekt.
   */
  function spawnBall(x, y, optsOrVx = {}, vyArg, canExplodeArg) {
    let opts
    if (typeof optsOrVx === 'object' && optsOrVx !== null) {
      opts = optsOrVx
    } else {
      // gamle positional: (x, y, vx, vy, canExplode)
      opts = { vx: optsOrVx, vy: vyArg, canExplode: canExplodeArg }
    }
    const b = {
      x, y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      visible: true,
      stillTime: 0,
      chargeT: 0,
      warnIndex: 0,
      canExplode: opts.canExplode ?? true,
      mode: opts.mode ?? 'normal',          // 'normal' | 'mini' | 'invader'
      r: opts.r ?? BALL_RADIUS_M,           // ball-radius i viewBox-units
      scoreMult: opts.scoreMult ?? 1,       // multiplier for paddle/bumper-score
      // Invaders-felter (kun satt hvis mode==='invader')
      invaderPhase: opts.invaderPhase,      // 'orbit' | 'breakout' | undefined
      orbitCenter: opts.orbitCenter,        // {x, y}
      orbitRadius: opts.orbitRadius,
      orbitAngle:  opts.orbitAngle,
      orbitSpeed:  opts.orbitSpeed,         // rad/s
      // v8.0.2: ekstra invader-felter for kontur-følging
      orbitDir:    opts.orbitDir ?? 1,      // +1 CCW, -1 CW (rotasjon rundt peak)
      orbitTarget: opts.orbitTarget,        // target-elevasjon (m) for kontur-vandring
      orbitT:      opts.orbitT ?? 0,
      breakoutVel: opts.breakoutVel,        // {vx, vy}
    }
    balls.push(b)
    return b
  }

  /**
   * Pick spawn-modus basert på nåværende level. Pool vokser progressivt.
   * v7.4.3: random pick fra pool — variasjon hver gang multiball-trigger
   * inntreffer, og nye modi blir tilgjengelig etterhvert.
   */
  function pickSpawnMode() {
    const lvl = level.value
    const pool = []
    for (const [name, minLvl] of Object.entries(SPAWN_MODE_LVL)) {
      if (lvl >= minLvl) pool.push(name)
    }
    if (pool.length === 0) return 'multiball'
    return pool[Math.floor(Math.random() * pool.length)]
  }

  /**
   * Finn central peak / kolle ved å sample DEM i sentrale 50% av kartet.
   * Brukes av invaders-modus for å plassere orbiten rundt en hill-feature.
   * Faller tilbake til geometrisk sentrum hvis DEM mangler.
   */
  function findCentralPeak() {
    const cx = bounds.width / 2
    const cy = bounds.height / 2
    if (!dem) return { x: cx, y: cy, elev: 0 }
    const halfW = bounds.width * 0.25
    const halfH = bounds.height * 0.25
    let best = { x: cx, y: cy, elev: -Infinity }
    const N = 11
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const px = cx - halfW + (i / (N - 1)) * 2 * halfW
        const py = cy - halfH + (j / (N - 1)) * 2 * halfH
        const elev = sampleElevation(dem, px, py)
        if (Number.isFinite(elev) && elev > best.elev) {
          best = { x: px, y: py, elev }
        }
      }
    }
    if (!Number.isFinite(best.elev)) return { x: cx, y: cy, elev: 0 }
    return best
  }

  /**
   * v8.0.2: ray-cast utover fra peak i `angle`-retning og finn punkt der
   * elevasjon krysser `targetZ`. Bruker liniær interpolasjon mellom de to
   * sample-punktene som omslutter targetZ. Returnerer null hvis konturen
   * ikke krysses innen kart-radius.
   */
  function findContourPosition(centerX, centerY, peakZ, targetZ, angle) {
    if (!dem) return null
    const maxR = Math.min(bounds.width, bounds.height) * 0.45
    const step = Math.max(15, Math.min(bounds.width, bounds.height) * 0.01)
    let lastZ = peakZ
    let lastR = 0
    for (let r = step; r <= maxR; r += step) {
      const x = centerX + Math.cos(angle) * r
      const y = centerY + Math.sin(angle) * r
      if (x < 0 || x > bounds.width || y < 0 || y > bounds.height) break
      const z = sampleElevation(dem, x, y)
      if (!Number.isFinite(z)) { lastZ = NaN; lastR = r; continue }
      if (Number.isFinite(lastZ)) {
        const crossed = (lastZ - targetZ) * (z - targetZ) <= 0
        if (crossed && lastR < r) {
          const t = (targetZ - lastZ) / (z - lastZ || 1e-6)
          const rEx = lastR + (r - lastR) * Math.max(0, Math.min(1, t))
          return {
            x: centerX + Math.cos(angle) * rEx,
            y: centerY + Math.sin(angle) * rEx,
            elev: targetZ,
          }
        }
      }
      lastZ = z
      lastR = r
    }
    return null
  }

  /**
   * v8.0.2: én tidssteg langs en høydekurve for en invader-ball.
   * Bruker terrenggradienten: tangent til konturen er perpendikulær på
   * gradienten. Legger på en liten korreksjon tilbake til ball.orbitTarget-
   * elevasjon så ballen ikke drifter ut av konturen over tid.
   *
   * Fall-tilbake til kinematisk sirkel-orbit hvis gradient er for liten
   * (flatt sadelpunkt eller DEM-hull).
   */
  function stepInvaderContour(b, dt) {
    const grad = sampleGradient(dem, b.x, b.y)
    const z = sampleElevation(dem, b.x, b.y)
    const gLen = Math.hypot(grad.dzdx, grad.dzdy)
    const speed = b.orbitRadius * b.orbitSpeed   // bevar opprinnelig fart-magnitude
    if (gLen < 1e-5 || !Number.isFinite(z)) {
      // Fall tilbake til kinematisk sirkel-orbit
      b.orbitAngle += b.orbitSpeed * dt * b.orbitDir
      b.x = b.orbitCenter.x + b.orbitRadius * Math.cos(b.orbitAngle)
      b.y = b.orbitCenter.y + b.orbitRadius * Math.sin(b.orbitAngle)
      b.vx = -Math.sin(b.orbitAngle) * b.orbitRadius * b.orbitSpeed * b.orbitDir
      b.vy =  Math.cos(b.orbitAngle) * b.orbitRadius * b.orbitSpeed * b.orbitDir
      return
    }
    // Tangent til kontur (90° rotasjon av gradient). orbitDir +1 = CCW
    // (mot klokken når y peker NEDOVER på skjermen, som her), −1 = CW.
    let tx = -grad.dzdy * b.orbitDir
    let ty =  grad.dzdx * b.orbitDir
    const tLen = Math.hypot(tx, ty) || 1
    tx /= tLen; ty /= tLen
    // Korreksjons-retning: gradient peker oppoverbakke, så +grad går opp,
    // −grad ned. Hvis vi er under target, gå opp; over target, gå ned.
    const dz = b.orbitTarget - z
    // Soft-clamp korreksjonen: ±1 ved |dz| ≥ 8m, mindre nær target.
    const corr = Math.max(-1, Math.min(1, dz / 8))
    const gnx = grad.dzdx / gLen
    const gny = grad.dzdy / gLen
    // Blend tangent (hoved-bevegelse) og korreksjon (drift-rettelse)
    const tangentWeight = 0.85
    const correctionWeight = 0.15
    let sx = tx * tangentWeight + gnx * corr * correctionWeight
    let sy = ty * tangentWeight + gny * corr * correctionWeight
    const sLen = Math.hypot(sx, sy) || 1
    sx /= sLen; sy /= sLen
    b.vx = sx * speed
    b.vy = sy * speed
    b.x += b.vx * dt
    b.y += b.vy * dt
    // Holdt innenfor kart-bounds (forhindrer at konturen tar oss ut av bbox)
    const r = b.r ?? BALL_RADIUS_M
    if (b.x < r) b.x = r
    else if (b.x > bounds.width - r) b.x = bounds.width - r
    if (b.y < r) b.y = r
    else if (b.y > bounds.height - r) b.y = bounds.height - r
  }

  /**
   * v8.0.2: Billiard-stil elastiske kollisjoner mellom balls. Like masser
   * (m = r², så større baller har mer treghet) bytter normal-komponenten av
   * relativ hastighet og separeres slik at de ikke overlapper.
   *
   * Skipper baller i orbit-fase (kinematisk styrt). Hopper også over par
   * hvor begge er multiball-baller (canExplode=false) med identisk mode
   * dersom de er innenfor 1 frame fra spawn — ellers ville cluster-spawn
   * fra explodeBall gi en kaos-spray umiddelbart. Vi sjekker via en
   * `spawnCooldown` (ms) som telles ned per frame.
   */
  function handleBallBallCollisions(speedCap) {
    const n = balls.length
    if (n < 2) return
    for (let i = 0; i < n; i++) {
      const a = balls[i]
      if (!a.visible) continue
      if (a.mode === 'invader' && a.invaderPhase === 'orbit') continue
      for (let j = i + 1; j < n; j++) {
        const b = balls[j]
        if (!b.visible) continue
        if (b.mode === 'invader' && b.invaderPhase === 'orbit') continue
        const ra = a.r ?? BALL_RADIUS_M
        const rb = b.r ?? BALL_RADIUS_M
        const rsum = ra + rb
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist2 = dx * dx + dy * dy
        if (dist2 >= rsum * rsum) continue
        let nx, ny, dist
        if (dist2 < 1e-6) {
          // Eksakt overlapp — separer i tilfeldig retning
          const ang = Math.random() * Math.PI * 2
          nx = Math.cos(ang); ny = Math.sin(ang)
          dist = 0
        } else {
          dist = Math.sqrt(dist2)
          nx = dx / dist; ny = dy / dist
        }
        // Separer langs normal
        const overlap = rsum - dist
        a.x -= nx * overlap * 0.5
        a.y -= ny * overlap * 0.5
        b.x += nx * overlap * 0.5
        b.y += ny * overlap * 0.5
        // Elastisk kollisjon, masse = r² (større ball mer treg)
        const ma = ra * ra
        const mb = rb * rb
        const rvx = b.vx - a.vx
        const rvy = b.vy - a.vy
        const vAlongN = rvx * nx + rvy * ny
        if (vAlongN >= 0) continue   // separerer allerede
        // Impulse for elastisk kollisjon (restitution = 1)
        const J = (2 * vAlongN) / (ma + mb)
        a.vx += J * mb * nx
        a.vy += J * mb * ny
        b.vx -= J * ma * nx
        b.vy -= J * ma * ny
        // Cap etter kollisjon (en pre-cap ball kan dele ut over cap-bevegelse)
        clampBallSpeed(a, speedCap)
        clampBallSpeed(b, speedCap)
        // Stillness skal nullstilles på begge — kollisjon = bevegelse
        a.stillTime = 0; a.chargeT = 0; a.warnIndex = 0
        b.stillTime = 0; b.chargeT = 0; b.warnIndex = 0
      }
    }
  }

  /**
   * v8.0.2: rescue-kick når ballen står stille etter at level-capen for
   * stillness-multiball er nådd. Sikter mot nærmeste bumper for å gi
   * spilleren en sjanse til poeng. Hvis ingen bumpers finnes, kastes
   * den oppoverbakke (mot gradient) eller i tilfeldig retning.
   */
  function rescueStuckBall(b) {
    let dx, dy
    let nearest = null
    let nearestD = Infinity
    for (const bp of bumpers) {
      const d = Math.hypot(bp.x - b.x, bp.y - b.y)
      if (d < nearestD) { nearestD = d; nearest = bp }
    }
    if (nearest) {
      dx = nearest.x - b.x
      dy = nearest.y - b.y
      const len = Math.hypot(dx, dy) || 1
      dx /= len; dy /= len
    } else if (dem) {
      const grad = sampleGradient(dem, b.x, b.y)
      const gLen = Math.hypot(grad.dzdx, grad.dzdy)
      if (gLen > 1e-4) {
        dx = grad.dzdx / gLen
        dy = grad.dzdy / gLen
      } else {
        const a = Math.random() * Math.PI * 2
        dx = Math.cos(a); dy = Math.sin(a)
      }
    } else {
      const a = Math.random() * Math.PI * 2
      dx = Math.cos(a); dy = Math.sin(a)
    }
    const speed = BUMPER_BOUNCE_SPEED * 1.2
    b.vx = dx * speed
    b.vy = dy * speed
    b.stillTime = 0
    b.chargeT = 0
    b.warnIndex = 0
    if (b.history) b.history.length = 0
    dlog('rescue-kick', { speed: +speed.toFixed(0), target: nearest ? 'bumper' : 'uphill' })
  }

  function physicsStep(dt) {
    if (!dem || status.value !== 'rolling') return
    const { kGravity, friction } = levelParams(level.value)
    const speedCap = maxBallSpeed(level.value)

    // Iterate baklengs så vi kan splice trygt
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i]
      if (!b.visible) {
        balls.splice(i, 1)
        continue
      }

      // v7.4.3: Invaders i orbit-fase bruker kinematisk oppdatering
      // (overstyrer gravity, friksjon og bumper-respons). Etter ORBIT-
      // varighet → bytt til breakout-fase som bruker normal physics + den
      // pre-beregnede breakoutVel.
      // v8.0.2: orbit-fasen følger en HØYDEKURVE rundt sentral peak istedenfor
      // en fast geometrisk sirkel. Hver invader styres av terrengets gradient
      // til å gå tangentielt langs konstant elevasjon. Fall-tilbake til
      // sirkulær orbit hvis gradient er for liten (flatt punkt / DEM-hull).
      if (b.mode === 'invader' && b.invaderPhase === 'orbit') {
        b.orbitT += dt
        if (b.orbitT >= INVADER_ORBIT_DURATION_S) {
          b.invaderPhase = 'breakout'
          b.vx = b.breakoutVel.vx
          b.vy = b.breakoutVel.vy
        } else {
          stepInvaderContour(b, dt)
          // Skip bumper, edge, stillness — orbit-fasen er invulnerabel
          continue
        }
      }

      const grad = sampleGradient(dem, b.x, b.y)
      const ax = -kGravity * grad.dzdx - friction * b.vx
      const ay = -kGravity * grad.dzdy - friction * b.vy
      b.vx += ax * dt
      b.vy += ay * dt
      // v8.0.2: clamp etter integrasjon (slope + friksjon kan ha pushet fart over)
      clampBallSpeed(b, speedCap)
      const prevX = b.x, prevY = b.y
      b.x += b.vx * dt
      b.y += b.vy * dt

      // Trail bare for primary (først i listen) — multi-ball balls får ikke trail
      if (i === 0) detectContourCrossings(prevX, prevY, b.x, b.y)

      // Bumper-collisions
      handleBumperCollisions(b)
      // Bumper-bounce kan også pushet fart over cap (max(min, incoming*1.15))
      clampBallSpeed(b, speedCap)

      // Bounds-check pr ball
      if (!handleEdgesForBall(b)) {
        dlog('drown', { i, canExp: b.canExplode, x: Math.round(b.x), y: Math.round(b.y) })
        balls.splice(i, 1)
        continue
      }
      // Paddle-kick kan også pushe over cap
      clampBallSpeed(b, speedCap)

      // Stillness-detection
      checkStillness(b, dt)
      if (b.exploded || !b.visible) {
        dlog('splice', { reason: b.exploded ? 'exploded' : 'invisible', i, after: balls.length - 1 })
        balls.splice(i, 1)
        continue
      }
    }

    // v8.0.2: billiard-stil ball-til-ball-kollisjoner. Kjøres etter at hver
    // ball er integrert og kollidert med bumpers/edges/stillness, så vi har
    // konsistente posisjoner og hastigheter for hele paret.
    handleBallBallCollisions(speedCap)

    // v7.4.0: Når multiball ebbet ut til én ball igjen — promoter den til
    // normal ball (canExplode = true) så stillness-detektor og videre
    // multiball-trigger fra bumper er aktiv som vanlig. Reset history-
    // bufferen så vi ikke trigger eksplosjon umiddelbart på en ball som
    // har vært stationær mens den var i multi-mode.
    if (balls.length === 1 && status.value === 'rolling' && balls[0].canExplode === false) {
      const sole = balls[0]
      sole.canExplode = true
      sole.stillTime = 0
      sole.chargeT = 0
      sole.warnIndex = 0
      if (sole.history) sole.history.length = 0
      levelChain = 0
      dlog('multiball→normal')
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
        // v8.0.2: cap stillness-trigget multiball til CAP-stk per level.
        // Etter capen er nådd, gi en rescue-kick i stedet for ny eksplosjon
        // så vi unngår cascade på bratte kart.
        if (stillnessExplodeCount >= STILLNESS_EXPLODE_PER_LEVEL_CAP) {
          dlog('stillness → rescue', { stillTime: +b.stillTime.toFixed(2), cap: STILLNESS_EXPLODE_PER_LEVEL_CAP })
          rescueStuckBall(b)
        } else {
          dlog('stillness → explode', { stillTime: +b.stillTime.toFixed(2) })
          stillnessExplodeCount += 1
          explodeBall(b)
        }
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
    // v7.4.3: ball-spesifikk radius for små miniballs / invaders
    const r = (b.r ?? BALL_RADIUS_M) + BUMPER_RADIUS_M
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
      // Score + sound + state. Score gis for ALLE treff (multiball-baller
      // også), men bare normale baller (canExplode=true) tikker hit-counter
      // mot multiball-trigger. v7.4.1: tidligere tikket alle baller, så 4
      // multiball-baller kunne trigge ny multiball på en bumper i én frame
      // → spawn-i-spawn-cascade.
      // v7.4.3: b.scoreMult (mini=2, invader=1.5, normal=1) ganger på score.
      score.value += Math.round(BUMPER_HIT_SCORE * level.value * perks.hitScoreMult * (b.scoreMult ?? 1))
      if (b.canExplode) {
        bp.hits += 1
        const remaining = BUMPER_HITS_TO_MULTIBALL - bp.hits
        playBumperHit(remaining)
      } else if (b.mode === 'mini') {
        // Lysere klang for miniball-treff (signaliserer "mer energi = mer poeng")
        playMiniHit()
      } else {
        // Multiball/invader-baller: nøytral lyd (remaining = full).
        playBumperHit(BUMPER_HITS_TO_MULTIBALL)
      }

      // Reset stillness på ball (ball kollidert = ikke stuck).
      // NB: clear ikke history-array, bare stillTime — ellers blir
      // checkStillness-deteksjon kunstig forsinket i 1 sek etter hver hit.
      b.stillTime = 0
      b.chargeT = 0
      b.warnIndex = 0

      checkLevelComplete()

      // v7.4.1: bare normale baller med canExplode=true kan trigge multiball
      // (se kommentar over). Ekstra cap på balls.length som siste forsvar
      // mot uventet cascade.
      if (b.canExplode && bp.hits >= BUMPER_HITS_TO_MULTIBALL && balls.length < MAX_BALLS_IN_PLAY) {
        bp.hits = 0
        triggerMultiballFromBumper(bp.x, bp.y)
      } else if (bp.hits >= BUMPER_HITS_TO_MULTIBALL) {
        // Hold counter på maks så vi ikke "lurer" til en gigant-spawn senere
        bp.hits = BUMPER_HITS_TO_MULTIBALL
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

  /**
   * v7.4.3: dispatcher — pick spawn-mode og kjør riktig spawner.
   * Kalt fra både bumper-trigger og stillness-explode. Backward-compat-
   * navn `triggerMultiballFromBumper` beholdt så HUD-events ikke knekker.
   */
  function triggerMultiballFromBumper(sx, sy) {
    const mode = pickSpawnMode()
    dlog('bumper → spawn', { mode, ballsBefore: balls.length })
    spawnByMode(mode, sx, sy)
  }

  function spawnByMode(mode, sx, sy) {
    switch (mode) {
      case 'miniball':      return spawnMiniballs(sx, sy)
      case 'invaders':      return spawnInvaders(sx, sy)
      case 'multiball':
      default:              return spawnMultiball(sx, sy)
    }
  }

  /** Klassisk multiball: 3 normalstore baller på random drop-radius. */
  function spawnMultiball(sx, sy) {
    splash.x = sx; splash.y = sy
    splash.active = true; splash.t = 0; splash.kind = 'explode'
    playExplosion()
    setTimeout(() => playMultiSpawn(), 250)
    lastEvent.value = { kind: 'multiball', at: Date.now() }

    const cx = bounds.width / 2
    const cy = bounds.height / 2
    const R = RANDOM_DROP_R_FRAC * Math.min(bounds.width, bounds.height)
    for (let k = 0; k < MULTIBALL_COUNT && balls.length < MAX_BALLS_IN_PLAY; k++) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * R
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      const kickAngle = Math.random() * Math.PI * 2
      spawnBall(x, y, {
        vx: Math.cos(kickAngle) * KICK_SPEED,
        vy: Math.sin(kickAngle) * KICK_SPEED,
        canExplode: false,
        mode: 'normal',
      })
    }
  }

  /**
   * Miniball: 12 små baller med 2× fart — lysere lyd, doble poeng.
   * Tilgjengelig fra level 3.
   */
  function spawnMiniballs(sx, sy) {
    splash.x = sx; splash.y = sy
    splash.active = true; splash.t = 0; splash.kind = 'explode'
    playExplosion()
    setTimeout(() => playMiniSpawn(), 200)
    lastEvent.value = { kind: 'mini', at: Date.now() }
    dlog('mini-spawn', { count: MINI_COUNT })

    const cx = bounds.width / 2
    const cy = bounds.height / 2
    const R = RANDOM_DROP_R_FRAC * Math.min(bounds.width, bounds.height)
    const miniR = BALL_RADIUS_M * MINI_RADIUS_FRAC
    const miniSpeed = KICK_SPEED * MINI_SPEED_MULT
    for (let k = 0; k < MINI_COUNT && balls.length < MAX_BALLS_IN_PLAY; k++) {
      const angle = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * R
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      const kickAngle = Math.random() * Math.PI * 2
      spawnBall(x, y, {
        vx: Math.cos(kickAngle) * miniSpeed,
        vy: Math.sin(kickAngle) * miniSpeed,
        canExplode: false,
        mode: 'mini',
        r: miniR,
        scoreMult: MINI_SCORE_MULT,
      })
    }
  }

  /**
   * Invaders: 3-12 minibanker spawner i sirkel-formasjon rundt central
   * peak (en kolle / fjell i sentrale 50%). Faser:
   *   1. ORBIT (~3s) — kinematisk: følger sirkel rundt peak, ignorerer
   *      gravity og bumpers. Denne fasen er Space-Invaders-marsjen.
   *   2. BREAKOUT — alle baller får samme retning mot en valgt ytterkant
   *      med ±20% energi-variasjon → spredning blir mer kaotisk over tid.
   * Tilgjengelig fra level 6.
   */
  function spawnInvaders(sx, sy) {
    splash.x = sx; splash.y = sy
    splash.active = true; splash.t = 0; splash.kind = 'explode'
    playExplosion()
    setTimeout(() => playInvaderSpawn(), 200)
    lastEvent.value = { kind: 'invader', at: Date.now() }

    const peak = findCentralPeak()
    const orbitR = 0.18 * Math.min(bounds.width, bounds.height)
    const count = INVADER_MIN_COUNT +
                  Math.floor(Math.random() * (INVADER_MAX_COUNT - INVADER_MIN_COUNT + 1))
    const orbitSpeed = 1.5 + Math.random() * 0.6   // rad/s
    const edges = [
      { vx:  0, vy: -1 },   // toppkant
      { vx:  0, vy:  1 },   // bunnkant
      { vx: -1, vy:  0 },   // venstre kant
      { vx:  1, vy:  0 },   // høyre kant
    ]
    const edgeDir = edges[Math.floor(Math.random() * 4)]
    const breakoutSpeed = KICK_SPEED * INVADER_BREAKOUT_SPEED_MULT
    const invaderR = BALL_RADIUS_M * INVADER_RADIUS_FRAC

    // v8.0.2: invaders går rundt en HØYDEKURVE i stedet for en fast sirkel.
    // Velg target-elevasjon under peak (typisk 30-60m under topp, eller
    // proporsjonalt med terreng-range hvis DEM er kjent). Ray-cast utover
    // fra peak i N retninger og finn punkter der elevasjonen krysser targetZ;
    // disse blir startposisjoner. Alle invaders deler samme target-elevasjon
    // og roterer i samme retning så formasjonen holder seg samlet.
    let targetZ = peak.elev - 50
    if (dem?.data && dem.noData != null) {
      let mn = Infinity, mx = -Infinity
      const nd = dem.noData
      for (let i = 0; i < dem.data.length; i++) {
        const z = dem.data[i]
        if (z === nd || !Number.isFinite(z)) continue
        if (z < mn) mn = z
        if (z > mx) mx = z
      }
      const range = (mx - mn) > 0 ? (mx - mn) : 100
      // Mellom 10 % og 25 % under peak, men minst 20 m for å unngå micro-konturer
      targetZ = peak.elev - Math.max(20, range * 0.15)
    }
    const orbitDir = Math.random() < 0.5 ? 1 : -1   // CCW eller CW

    dlog('invader-spawn', {
      count,
      peak: { x: Math.round(peak.x), y: Math.round(peak.y), z: Math.round(peak.elev) },
      targetZ: Math.round(targetZ),
      dir: orbitDir,
    })

    let placed = 0
    for (let k = 0; k < count && balls.length < MAX_BALLS_IN_PLAY; k++) {
      const angle = (k / count) * Math.PI * 2
      // Prøv å finne kontur-skjæring i denne retningen; fall til sirkel hvis intet treff
      const pos = findContourPosition(peak.x, peak.y, peak.elev, targetZ, angle)
      const x = pos ? pos.x : peak.x + orbitR * Math.cos(angle)
      const y = pos ? pos.y : peak.y + orbitR * Math.sin(angle)
      // Faktisk avstand fra peak — brukt som orbitRadius for fart-magnitude og
      // sirkulær fallback i stepInvaderContour.
      const rActual = Math.hypot(x - peak.x, y - peak.y) || orbitR
      // Energi-variasjon: ±20 % fart per ball så formasjonen sprer seg gradvis
      const energy = 1 + (Math.random() - 0.5) * INVADER_ENERGY_VARIATION
      spawnBall(x, y, {
        canExplode: false,
        mode: 'invader',
        r: invaderR,
        scoreMult: INVADER_SCORE_MULT,
        invaderPhase: 'orbit',
        orbitCenter: { x: peak.x, y: peak.y },
        orbitRadius: rActual,
        orbitAngle: angle,
        orbitSpeed,
        orbitDir,
        orbitTarget: pos ? targetZ : (Number.isFinite(peak.elev) ? peak.elev - 30 : 0),
        orbitT: 0,
        breakoutVel: {
          vx: edgeDir.vx * breakoutSpeed * energy,
          vy: edgeDir.vy * breakoutSpeed * energy,
        },
      })
      placed += 1
    }
    dlog('invader-spawn:placed', { placed })
    // Lyd-cue når formasjonen forlater orbit
    setTimeout(() => playInvaderBreakout(), INVADER_ORBIT_DURATION_S * 1000)
  }

  function explodeBall(b) {
    dlog('explodeBall:enter', { canExp: b.canExplode, before: balls.length })
    try {
      // v7.4.3: stillness-explode bruker også spawn-mode-dispatcheren
      // så ulike modi kan trigges fra både bumper og stillness.
      b.exploded = true
      const mode = pickSpawnMode()
      dlog('explode → spawn', { mode })
      spawnByMode(mode, b.x, b.y)
      dlog('explodeBall:exit', { after: balls.length })
    } catch (err) {
      dlog('!explodeBall', { e: String(err).slice(0, 80) })
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
    // v7.4.3: bruk ball-spesifikk radius (miniballs er ~50%, invaders ~60%
    // av normal). Faller tilbake til BALL_RADIUS_M for eldre baller uten r.
    const r = b.r ?? BALL_RADIUS_M
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
    // v7.4.3: scoreMult fra ball-mode (mini=2, invader=1.5, normal=1)
    score.value += Math.round(100 * level.value * perks.hitScoreMult * (b.scoreMult ?? 1))
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
    // v7.3.7 koblede paddles-perk: lad også linket flipper i samme diagonal-par
    if (perks.linkedFlippers) {
      const link = LINKED_PAIRS[edge]
      const lf = link && flippers[link]
      if (lf) lf.kickLevel = (lf.kickLevel + 1) % KICK_MULTIPLIERS.length
    }
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
    levelChain = 0

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
    // v7.3.7: cascade-mode under multiball — hvis flere baller er i lufta
    // når mål-score nås, hopper vi rett til neste level uten å pause
    // physics. Score som overstiger målet bæres over, og hver kjede gir
    // eksponentielt høyere bonus. Belønner spillere som klarer å holde
    // multiball oppe gjennom flere levels på én gang.
    if (balls.length > 1 && status.value === 'rolling') {
      levelChain += 1
      const target = levelTarget.value
      const carryOver = Math.max(0, score.value - target)

      // Bonus skalerer eksponentielt med chain-dybde, capped ved x16 (chain 5).
      // chain 1 = 1×, 2 = 2×, 3 = 4×, 4 = 8×, 5+ = 16×
      const chainMult = Math.min(16, Math.pow(2, levelChain - 1))
      const chainBonus = Math.round(500 * level.value * chainMult)

      totalScore.value += target + chainBonus
      level.value += 1
      score.value = carryOver
      lastHitEdge = null

      // Defer perk-select hvis vi krysser et perk-trigger-level mens
      // multiball er aktiv — perk-meny kan ikke åpnes mid-cascade.
      if ((level.value - 1) % PERK_INTERVAL === 0) {
        pendingPerkSelect = true
      }

      lastEvent.value = {
        kind: 'chain',
        chain: levelChain,
        bonus: chainBonus,
        mult: chainMult,
        at: Date.now(),
      }
      playWin()
      return
    }

    levelChain = 0
    status.value = 'won'
    playWin()
    totalScore.value += score.value
    setTimeout(() => {
      level.value += 1
      score.value = 0
      balls.length = 0
      lastHitEdge = null
      lastElev = NaN
      stillnessExplodeCount = 0
      generateBumpersForLevel()
      const triggerPerk = pendingPerkSelect || (level.value - 1) % PERK_INTERVAL === 0
      pendingPerkSelect = false
      if (triggerPerk) {
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
      case 'linked-flippers':perks.linkedFlippers = true; break
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
    // v7.4.0: ny runde må velge turneringsmodus først.
    tournamentMode.value = null
    status.value = 'mode-select'
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
    perks.linkedFlippers = false
    levelChain = 0
    pendingPerkSelect = false
    stillnessExplodeCount = 0
    for (const e of ['top', 'bottom', 'left', 'right']) {
      flippers[e].position = 0.5
      flippers[e].length = 0.25     // reset til base-lengde (perk-økning gjelder kun innenfor session)
      flippers[e].kickLevel = 0
    }
    bumpers.length = 0
    generateBumpersForLevel()
  }

  /** Brukerens valg fra mode-select-overlay. Når modus er valgt går vi
   *  til 'idle' så «TAP TO START»-promptet vises. */
  function setTournamentMode(value) {
    tournamentMode.value = !!value
    if (status.value === 'mode-select') status.value = 'idle'
  }

  /**
   * Serialize spill-tilstand for kryss-kart-navigering (turneringsmodus).
   * Hentes etter level-clear, før router.push til neste kart. Restore-funksjon
   * leses i ny MapView etter mount.
   */
  function serializeForTournament() {
    return {
      level: level.value,
      lives: lives.value,
      totalScore: totalScore.value,
      score: 0,                            // start frisk på neste kart
      tournamentMode: true,
      perks: { ...perks },
      flipperLengths: {
        top: flippers.top.length,
        bottom: flippers.bottom.length,
        left: flippers.left.length,
        right: flippers.right.length,
      },
      pendingPerkSelect,
    }
  }

  /** Restorer state fra serializeForTournament. Kaller etter init() men
   *  før activate(). Status settes til 'idle' så bruker kan tappe for å starte. */
  function restoreFromTournament(state) {
    if (!state) return
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null }
    level.value = state.level ?? 1
    lives.value = state.lives ?? 3
    totalScore.value = state.totalScore ?? 0
    score.value = state.score ?? 0
    countdown.value = 0
    tournamentMode.value = state.tournamentMode === true
    balls.length = 0
    splash.active = false
    lastHitEdge = null
    lastElev = NaN
    levelChain = 0
    stillnessExplodeCount = 0
    pendingPerkSelect = !!state.pendingPerkSelect
    perkChoices.value = []
    if (state.perks) Object.assign(perks, state.perks)
    if (state.flipperLengths) {
      flippers.top.length    = state.flipperLengths.top    ?? 0.25
      flippers.bottom.length = state.flipperLengths.bottom ?? 0.25
      flippers.left.length   = state.flipperLengths.left   ?? 0.25
      flippers.right.length  = state.flipperLengths.right  ?? 0.25
    }
    for (const e of ['top', 'bottom', 'left', 'right']) {
      flippers[e].position = 0.5
      flippers[e].kickLevel = 0
    }
    bumpers.length = 0
    generateBumpersForLevel()
    // pendingPerkSelect → vis perk-select med en gang istedenfor idle
    if (pendingPerkSelect) {
      perkChoices.value = pickRandomPerks(3)
      status.value = 'perk-select'
      pendingPerkSelect = false
    } else {
      status.value = 'idle'
    }
  }

  function init(ctx) {
    dem = ctx.dem
    bounds = ctx.bounds
    equidistanceM = ctx.equidistanceM ?? 20

    // v7.3.1: Skala spatial-konstanter etter kart-størrelse. Defaults var
    // tunet for 4×4km kart. Mindre kart (1km, 2km, 3km) trengte mindre
    // ball + paddler + bumpers + stillness-displacement-terskel.
    // v8.0.3: alle hastigheter og akselerasjoner skaleres også med mapScale
    // så skjerm-traverseringstid blir kart-størrelse-uavhengig.
    const minDim = Math.min(bounds.width || 4000, bounds.height || 4000)
    mapScale = minDim / 4000
    BALL_RADIUS_M       = 90  * mapScale
    FLIPPER_INSET_M     = 280 * mapScale
    BUMPER_RADIUS_M     = 90  * mapScale
    BUMPER_MIN_DISTANCE_M = 250 * mapScale
    STILLNESS_DISPL_M   = 120 * mapScale
    // v8.0.3: hastigheter — viktig for konsistent gameplay-feel
    KICK_SPEED          = 300 * mapScale
    BUMPER_BOUNCE_SPEED = 350 * mapScale

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
    tournamentMode,
    // actions
    init, activate, deactivate,
    startCountdown, restart, energize, applyPerk,
    kickBall, forceMultiball,
    setTournamentMode,
    serializeForTournament, restoreFromTournament,
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

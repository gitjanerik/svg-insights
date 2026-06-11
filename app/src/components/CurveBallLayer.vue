<script setup>
import { computed } from 'vue'
import {
  STEDSMERKE_HIT_KEY_TIMES, STEDSMERKE_HIT_DUR, STEDSMERKE_SHADOW_OPACITY_HIT,
  PIN_SCALE_VALUES_HIT, SHADOW_SCALE_VALUES_HIT,
  pinTranslateValuesHit, pinPath,
} from '../lib/stedsmerkeAnimation.js'

const props = defineProps({
  flipp: { type: Object, required: true },
  viewBox: { type: String, required: true },
  // Forskyvning (i kart-meter) fra kartets origo til spillets (0,0). Brukes
  // til å sentrere det kvadratiske spille-utsnittet på et A-format-kart:
  // spillet jobber i 0..Sm-koord, og dette translaterer alt innholdet tilbake
  // til kartets senter. (0,0) for kvadratiske kart → no-op.
  offset: { type: Object, default: () => ({ x: 0, y: 0 }) },
})

const offsetTransform = computed(
  () => `translate(${props.offset?.x ?? 0} ${props.offset?.y ?? 0})`,
)

// Hent default-ballradius fra composable. v7.4.3: enkelte baller (mini,
// invader) har sin egen `b.r` som overstyrer denne — bruk ballR(b)-helper
// til rendering, ikke ballRadius direkte for ball-elementer.
const ballRadius = computed(() => props.flipp.BALL_RADIUS_M ?? 12)
function ballR(b) { return b?.r ?? ballRadius.value }

// v8.10.0 Red Curves: hele den pre-computede katalogen rendres som
// statiske SVG-paths én gang. Per-path-aktiv-tilstand (er denne idx-en
// fortsatt rød?) skifter kun en CSS-klasse, så Vue ungår DOM-diff på
// kryssing. Felles puls + glow flyttes til <g>-nivå (CSS-keyframes +
// gruppe-filter) i stedet for 48 simultane SMIL-animasjoner + 48 blur-
// passes. Bytt utløser mini-spillet av/på.
const redCurvesActive = computed(() => (props.flipp.redContoursTotal?.value ?? 0) > 0)
const redContourPaths = computed(() => props.flipp.redContourPaths?.value ?? [])
function isRedActive(idx) {
  const set = props.flipp.redContourIndices?.value
  return !!set && set.has(idx)
}

// Stroke-skala basert på ball-radius — gir konsistent visuell tykkelse
// uansett kart-størrelse (samme som bumper-symbolene). Indekskurver
// (hver 5.) tegnes ca dobbelt så tjukke som vanlige.
const redContourMinorWidth = computed(() => ballRadius.value * 0.10)
const redContourIndexWidth = computed(() => ballRadius.value * 0.18)

// v7.4.3: ulike spawn-modi får ulik fyll. Mini = lyserød med høy luminans
// (signaliserer "energi"), invader = grønn-glød (Space Invaders-feel).
function ballFill(b) {
  if (b.mode === 'mini') return 'url(#cb-mini)'
  if (b.mode === 'invader') return 'url(#cb-invader)'
  return 'url(#cb-chrome)'
}

// Subtil grunnfarge-shift per level (v7.2.4). Level 1 = klassisk chrome,
// høyere level = progressivt varmere/kjøligere chrome via HSL-stops.
const ballGradient = computed(() => {
  const lev = props.flipp.level.value
  if (lev === 1) return { inner: '#ffffff', mid: '#cbd5e1', outer: '#0f172a' }
  const hues = [30, 350, 280, 60, 200, 120, 320]
  const h = hues[(lev - 2) % hues.length]
  return {
    inner: `hsl(${h}, 10%, 96%)`,
    mid:   `hsl(${h}, 32%, 68%)`,
    outer: `hsl(${h}, 60%, 16%)`,
  }
})

const emit = defineEmits(['drop'])

// Stedsmerke bumper. Pin-tip ved bumper-senter (0,0) — der ballen
// kolliderer. Halo (cream-ring) tegnes UNDER pin-en; v8.8.4 tredoblet
// pin-størrelsen (head-radius 0.66R i stedet for 0.22R) så stedsmerket
// skiller seg visuelt fra de andre bumpers — pin-en stikker delvis ut
// over halo-en, omtrent som ved annoterings-registrering på kartet.
// LED hits-counter rendres senere i template og legger seg ON TOP av
// pin-en så treff-tallet er synlig over pin-hodet.
//
// Animasjon trigges KUN ved treff (bp.hits endres), ikke kontinuerlig.
// :key="`sm-${i}-${bp.hits}`" tvinger Vue til å re-mounte stedsmerke-
// undertreet ved hvert treff, så SMIL-animasjonen restarter fra t=0.
// Initial mount (bp.hits=0) inkluderer ikke animateTransform-tagger →
// statisk pin. fill="freeze" holder siste keyframe (= hvile) etter slutt.
const sm_r = computed(() => ballRadius.value * 0.66)
const sm_shadowRx = computed(() => sm_r.value)
const sm_shadowRy = computed(() => sm_r.value * 0.22)
const sm_shadowPy = computed(() => sm_r.value * 0.18)
const sm_pinTranslate = computed(() => pinTranslateValuesHit(sm_r.value))
const sm_pinD = computed(() => pinPath(sm_r.value))
const sm_strokeW = computed(() => sm_r.value * 0.08)
const sm_dotR = computed(() => sm_r.value * 0.38)
const sm_dotCy = computed(() => -1.85 * sm_r.value)

// Trail-sluttgammel: TRAIL_LEN fra useCurveBall. Holder seg syncet via
// at hver slot har age 0..TRAIL_LEN.
const trailMaxAge = 14

function trailOpacity(age) {
  return Math.max(0, 0.55 * (1 - age / trailMaxAge))
}

function trailRadius(age, base) {
  return base * Math.max(0.15, 1 - age / trailMaxAge) * 0.6
}

const splashTiles = computed(() => {
  // 8-bit pixel-eksplosjon. Drown: 8 fliser, blå-tone. Explode: 16 fliser,
  // dobbel-radius, oransj-tone (større dramatikk når ballen detonerer).
  const t = props.flipp.splash.t       // 0..1
  if (!props.flipp.splash.active) return []
  const r = ballRadius.value
  const isExplode = props.flipp.splash.kind === 'explode'
  const tileCount = isExplode ? 16 : 8
  const sizeMult = isExplode ? 0.7 : 0.45
  const radiusMult = isExplode ? 8 : 4
  const baseSize = r * sizeMult
  const radius = r * 0.4 + t * r * radiusMult
  const fade = 1 - t
  const tiles = []
  for (let i = 0; i < tileCount; i++) {
    const ang = (i / tileCount) * Math.PI * 2
    const x = Math.cos(ang) * radius
    const y = Math.sin(ang) * radius
    tiles.push({
      x: x - baseSize / 2,
      y: y - baseSize / 2,
      size: baseSize,
      opacity: fade,
    })
  }
  return tiles
})

function onClick() {
  // v7.2.5: emit-en starter nedtelling. Drop-posisjon er randomisert i
  // composable, ikke fra tap-koord lenger.
  if (props.flipp.status.value !== 'idle') return
  emit('drop')
}

function onBallTap(b) {
  // v7.3.4: tap-på-ball gir et tilfeldig kick. Redningsplanke når
  // kula har slått seg til ro på flatmark uten å trigge multiball.
  if (props.flipp.status.value !== 'rolling') return
  props.flipp.kickBall?.(b)
}
</script>

<template>
  <svg v-if="flipp.active.value"
       class="absolute inset-0 w-full h-full pointer-events-auto"
       :viewBox="viewBox"
       preserveAspectRatio="xMidYMid meet"
       @click="onClick">
    <defs>
      <radialGradient id="cb-chrome" cx="35%" cy="30%">
        <stop offset="0%" :stop-color="ballGradient.inner"/>
        <stop offset="35%" :stop-color="ballGradient.mid"/>
        <stop offset="100%" :stop-color="ballGradient.outer"/>
      </radialGradient>
      <!-- v7.4.3: miniball — energisk lyserosa/cyan glød (signaliserer dobbel fart) -->
      <radialGradient id="cb-mini" cx="35%" cy="30%">
        <stop offset="0%"  stop-color="#ffe4f0"/>
        <stop offset="40%" stop-color="#ff77c8"/>
        <stop offset="100%" stop-color="#7a1f4e"/>
      </radialGradient>
      <!-- v7.4.3: invader — alien-grønn med dyp midtpunkt (Space Invaders-feel) -->
      <radialGradient id="cb-invader" cx="35%" cy="30%">
        <stop offset="0%"  stop-color="#d8ffe2"/>
        <stop offset="40%" stop-color="#22c55e"/>
        <stop offset="100%" stop-color="#0f3a1c"/>
      </radialGradient>
      <filter id="cb-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5"/>
        <feOffset dx="0.5" dy="1.5" result="shadow"/>
        <feFlood flood-color="#000" flood-opacity="0.45"/>
        <feComposite in2="shadow" operator="in"/>
        <feComposite in="SourceGraphic"/>
      </filter>
      <!-- v8.10.0 Red Curves: bløtt rødt glød rundt aktive kurver så de
           skiller seg klart fra de vanlige brunrøde konturene under.
           stdDeviation i user-units (= meter på kartet). 6 gir ~6m halo
           på et 4km-kart, godt synlig men ikke overveldende. -->
      <filter id="cb-red-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="6" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>

    <!-- Alt spill-innhold forskyves til det sentrerte kvadratiske utsnittet.
         offset = (0,0) på kvadratiske kart, så dette er en no-op der. -->
    <g :transform="offsetTransform">

    <!-- v8.10.0 Red Curves: høydekurver som glør rødt mens mini-spillet
         under invaders-modus pågår. Kryssing av en rød kurve gir 5× poeng
         og fjerner den fra settet. Når alle er borte → super-perk innkommende.

         Ytelse: paths rendres én gang fra statisk katalog, og .cb-red-on
         klassen styrer synlighet/strek. Per-kryssing oppdaterer Vue kun
         class-attributtet, ikke DOM-treet. CSS-puls + gruppe-glow gir
         én animasjon og én blur-pass i stedet for 48 av hver. -->
    <g v-if="redCurvesActive"
       class="cb-red-contours"
       pointer-events="none"
       filter="url(#cb-red-glow)"
       :style="{
         '--cb-red-w-minor': String(redContourMinorWidth),
         '--cb-red-w-index': String(redContourIndexWidth),
       }">
      <path v-for="c in redContourPaths"
            :key="c.idx"
            :d="c.d"
            :class="['cb-red-path', { 'cb-red-on': isRedActive(c.idx), 'cb-red-thick': c.isIndex }]"/>
    </g>

    <!-- Bumpers: kart-annoterings-symboler (knaus / stein / brønn / bro)
         med kremgul halo + lilla ring (matcher annotation-styling i appen).
         Hits-counter som LED-rad over symbolet (4 firkanter, lyser grønn). -->
    <g v-for="(bp, i) in flipp.bumpers" :key="`bumper-${i}`" pointer-events="none">
      <g :transform="`translate(${bp.x} ${bp.y})`">
        <!-- Halo: kremgul fyll + lilla ring (matcher annoterings-stil i
             editor-modus). v8.8.3: vises for ALLE bumpers (også fra
             annotering) etter at stedsmerke-pin-en ble krympet — halo +
             liten pin er ikke lenger visuelt for stor, og bumpers ser
             nå konsistente ut uansett om de er random-spawn eller
             user-placed. -->
        <circle cx="0" cy="0"
                :r="ballRadius * 0.95"
                fill="#fffef0"
                fill-opacity="0.92"
                stroke="#7a3aa3"
                :stroke-width="ballRadius * 0.04"/>

        <!-- v8.8.11 Phase 3 — Bumper Chain Reaction flash. Tegnes når
             en nabo-bumper får chainFlashUntil oppdatert (tier 3 super-
             perk). :key på timestamp tvinger Vue til å re-mounte elementet
             ved hvert nytt kjede-treff, så SMIL-animasjonen restarter
             fra t=0. fill="freeze" holder sluttilstand (opacity 0). -->
        <circle v-if="bp.chainFlashUntil"
                :key="`chain-${bp.chainFlashUntil}`"
                cx="0" cy="0"
                :r="ballRadius * 1.0"
                fill="none"
                stroke="#ff1744"
                :stroke-width="ballRadius * 0.12"
                opacity="0">
          <animate attributeName="opacity"
                   values="0;1;0" dur="0.4s"
                   repeatCount="1" fill="freeze"/>
          <animate attributeName="r"
                   :values="`${ballRadius * 1.0};${ballRadius * 2.2}`"
                   dur="0.4s" repeatCount="1" fill="freeze"/>
        </circle>

        <!-- Knaus: brun halvmåne -->
        <path v-if="bp.kind === 'knaus'"
              :d="`M${-ballRadius*0.6} ${ballRadius*0.4} A${ballRadius*0.6} ${ballRadius*0.4} 0 0 0 ${ballRadius*0.6} ${ballRadius*0.4}`"
              stroke="#7f4f24"
              :stroke-width="ballRadius * 0.10"
              stroke-linecap="round"
              fill="none"/>

        <!-- Stein: solid svart trekant -->
        <polygon v-else-if="bp.kind === 'stein'"
                 :points="`0,${-ballRadius*0.6} ${ballRadius*0.6},${ballRadius*0.5} ${-ballRadius*0.6},${ballRadius*0.5}`"
                 fill="#000"/>

        <!-- Brønn: cyan sirkel med kryss -->
        <g v-else-if="bp.kind === 'brønn'">
          <circle cx="0" cy="0" :r="ballRadius * 0.6"
                  fill="none"
                  stroke="#0099cc"
                  :stroke-width="ballRadius * 0.10"/>
          <line :x1="-ballRadius*0.6" y1="0" :x2="ballRadius*0.6" y2="0"
                stroke="#0099cc" :stroke-width="ballRadius * 0.10"/>
          <line x1="0" :y1="-ballRadius*0.6" x2="0" :y2="ballRadius*0.6"
                stroke="#0099cc" :stroke-width="ballRadius * 0.10"/>
        </g>

        <!-- Bro / klopp: to parallelle svarte streker -->
        <g v-else-if="bp.kind === 'bro'">
          <line :x1="-ballRadius*0.6" :y1="-ballRadius*0.3"
                :x2="ballRadius*0.6"  :y2="-ballRadius*0.3"
                stroke="#000" :stroke-width="ballRadius * 0.12"/>
          <line :x1="-ballRadius*0.6" :y1="ballRadius*0.3"
                :x2="ballRadius*0.6"  :y2="ballRadius*0.3"
                stroke="#000" :stroke-width="ballRadius * 0.12"/>
        </g>

        <!-- Stedsmerke — liten rød dråpe-pin inne i halo-en. Spretter én
             gang pr treff (squash & stretch over 1.1s), ikke kontinuerlig.
             Treff trigger fortsatt Invaders-modus direkte. :key på
             bp.hits tvinger remount så SMIL restarter ved hvert treff.
             v-if på animasjons-tagene hindrer animasjon på initial mount
             (hits=0) og etter Invaders-reset (hits → 0 igjen). -->
        <g v-else-if="bp.kind === 'stedsmerke'" :key="`sm-${i}-${bp.hits}`">
          <g :transform="`translate(0 ${sm_shadowPy}) scale(${sm_shadowRx} ${sm_shadowRy})`">
            <g>
              <animateTransform v-if="bp.hits > 0"
                                attributeName="transform" type="scale"
                                :values="SHADOW_SCALE_VALUES_HIT"
                                :keyTimes="STEDSMERKE_HIT_KEY_TIMES"
                                :dur="STEDSMERKE_HIT_DUR" repeatCount="1"
                                begin="0s" fill="freeze"/>
              <ellipse cx="0" cy="0" rx="1" ry="1" fill="#000" opacity="0.55">
                <animate v-if="bp.hits > 0"
                         attributeName="opacity"
                         :values="STEDSMERKE_SHADOW_OPACITY_HIT"
                         :keyTimes="STEDSMERKE_HIT_KEY_TIMES"
                         :dur="STEDSMERKE_HIT_DUR" repeatCount="1"
                         begin="0s" fill="freeze"/>
              </ellipse>
            </g>
          </g>
          <g>
            <animateTransform v-if="bp.hits > 0"
                              attributeName="transform" type="translate"
                              :values="sm_pinTranslate"
                              :keyTimes="STEDSMERKE_HIT_KEY_TIMES"
                              :dur="STEDSMERKE_HIT_DUR" repeatCount="1"
                              begin="0s" fill="freeze"/>
            <g>
              <animateTransform v-if="bp.hits > 0"
                                attributeName="transform" type="scale"
                                :values="PIN_SCALE_VALUES_HIT"
                                :keyTimes="STEDSMERKE_HIT_KEY_TIMES"
                                :dur="STEDSMERKE_HIT_DUR" repeatCount="1"
                                begin="0s" fill="freeze"/>
              <path :d="sm_pinD" fill="#dc2626" stroke="#7f1d1d"
                    :stroke-width="sm_strokeW" stroke-linejoin="round"/>
              <circle cx="0" :cy="sm_dotCy" :r="sm_dotR" fill="#fff"/>
            </g>
          </g>
        </g>

        <!-- Hits-counter: 4 LED-firkanter over halo (matcher annotation-stil)  -->
        <g :transform="`translate(${-ballRadius * 0.55}, ${-ballRadius * 1.25})`">
          <rect v-for="n in flipp.BUMPER_HITS_TO_MULTIBALL"
                :key="`hit-${n}`"
                :x="(n - 1) * ballRadius * 0.30"
                y="0"
                :width="ballRadius * 0.22"
                :height="ballRadius * 0.16"
                :fill="n <= bp.hits ? '#22c55e' : 'rgba(0,0,0,0.35)'"
                stroke="#fffef0"
                stroke-width="1.5"/>
        </g>
      </g>
    </g>

    <!-- Trail: faded tail bak primary ball (balls[0]) -->
    <g v-if="flipp.balls.length > 0">
      <circle v-for="(t, i) in flipp.trail" :key="`trail-${i}`"
              :cx="t.x" :cy="t.y"
              :r="trailRadius(t.age, ballRadius)"
              :opacity="trailOpacity(t.age)"
              fill="#cbd5e1"
              pointer-events="none"/>
    </g>

    <!-- Baller (multi-ball-støtte). Charging-pulse-ring renderes UNDER ballen
         når chargeT > 0 (rød advarsel om snarlig eksplosjon). v7.3.4: marble
         er klikkbar (kicker ballen i tilfeldig retning) — redningsplanke når
         ball har slått seg til ro på flatmark.
         v7.4.3: per-ball radius (ballR) + mode-spesifikk gradient. Invaders
         i orbit-fase får en subtil sirkulær orbit-indikator. -->
    <g v-for="(b, i) in flipp.balls" :key="`ball-${i}`">
      <!-- Invader orbit-indikator: tegnet sirkel rundt peak under orbit-fase -->
      <circle v-if="b.mode === 'invader' && b.invaderPhase === 'orbit' && i === 0"
              :cx="b.orbitCenter.x" :cy="b.orbitCenter.y"
              :r="b.orbitRadius"
              fill="none"
              stroke="#22c55e"
              stroke-opacity="0.35"
              :stroke-width="ballRadius * 0.08"
              stroke-dasharray="6 6"
              pointer-events="none"/>
      <!-- Charging warning ring -->
      <circle v-if="b.chargeT > 0"
              :cx="b.x" :cy="b.y"
              :r="ballR(b) * (1.15 + b.chargeT * 0.6)"
              :fill="`rgba(239, 68, 68, ${0.15 + b.chargeT * 0.25})`"
              :stroke="b.chargeT >= 0.95 ? '#fde047' : '#ef4444'"
              :stroke-width="3 + b.chargeT * 6"
              :stroke-dasharray="b.chargeT >= 0.5 ? '8 4' : 'none'"
              pointer-events="none">
        <animate v-if="b.chargeT >= 0.5"
                 attributeName="r"
                 :values="`${ballR(b) * (1.15 + b.chargeT * 0.6)};${ballR(b) * (1.4 + b.chargeT * 0.6)};${ballR(b) * (1.15 + b.chargeT * 0.6)}`"
                 dur="0.3s"
                 repeatCount="indefinite"/>
      </circle>
      <!-- Marble -->
      <circle :cx="b.x" :cy="b.y" :r="ballR(b)"
              :fill="ballFill(b)"
              filter="url(#cb-shadow)"
              :style="{
                filter: b.chargeT > 0.7 ? `hue-rotate(${(b.chargeT - 0.7) * 600}deg) brightness(${1 + b.chargeT * 0.3})` : '',
                cursor: 'pointer',
              }"
              @click.stop="onBallTap(b)"/>
    </g>

    <!-- Splash / explosion -->
    <g v-if="flipp.splash.active"
       :transform="`translate(${flipp.splash.x} ${flipp.splash.y})`"
       pointer-events="none">
      <rect v-for="(tile, i) in splashTiles" :key="`splash-${i}`"
            :x="tile.x" :y="tile.y"
            :width="tile.size" :height="tile.size"
            :opacity="tile.opacity"
            :fill="flipp.splash.kind === 'explode' ? '#fb923c' : '#38bdf8'"/>
    </g>
    </g>
  </svg>
</template>

<style>
/* v8.10.0 Red Curves — CSS-baserte erstattere for de tidligere SMIL-
   animasjonene og per-path-filteret. Én puls på gruppen i stedet for
   48 simultane stroke-opacity-SMIL-er, og blur kun rendret én gang
   via gruppe-filteret. Lookup på .cb-red-on (klasse-toggle pr path)
   er gratis i Vue diff. */
.cb-red-contours {
  animation: cb-red-pulse 1.2s ease-in-out infinite;
}
.cb-red-path {
  fill: none;
  stroke: none;
}
.cb-red-path.cb-red-on {
  stroke: #ff1744;
  stroke-width: var(--cb-red-w-minor, 5);
  stroke-linejoin: round;
  stroke-linecap: round;
}
.cb-red-path.cb-red-on.cb-red-thick {
  stroke-width: var(--cb-red-w-index, 9);
}
@keyframes cb-red-pulse {
  0%, 100% { opacity: 0.95; }
  50%      { opacity: 0.55; }
}
</style>


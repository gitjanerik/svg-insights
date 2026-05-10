<script setup>
import { computed, ref, watch, onUnmounted } from 'vue'
import { t } from '../lib/i18n.js'

const props = defineProps({
  flipp: { type: Object, required: true },
  // v7.4.0: turneringsmodus + share — drives av MapView, HUD bare emitter
  // og rendrer UI. tournamentNext: { id, navn } eller null hvis ingen
  // egne kart finnes / vi er på siste kart.
  tournamentNext: { type: Object, default: null },
  // shareInfo: { lat, lon, sizeKm, equidistanceM, baseUrl } — alt HUD trenger
  // for å bygge en delings-URL ved game over. Null hvis ikke tilgjengelig.
  shareInfo: { type: Object, default: null },
})

const emit = defineEmits(['restart', 'exit', 'continue', 'tournamentNext'])

const levelStr = computed(() => t('hud.level', { n: String(props.flipp.level.value).padStart(2, '0') }))
// v7.4.1: defensiv formatering — for veldig store tall blir String() til
// scientific notation. Bruk toLocaleString så HUD alltid viser ekte siffer.
function formatScore(n) {
  const v = Math.min(Math.max(0, Math.round(Number(n) || 0)), Number.MAX_SAFE_INTEGER)
  if (v < 100000) return String(v).padStart(5, '0')
  return v.toLocaleString('no-NO')
}
const scoreStr = computed(() => {
  const s = formatScore(props.flipp.score.value).padStart(4, '0')
  const t = formatScore(props.flipp.levelTarget.value).padStart(4, '0')
  return `${s}/${t}`
})
const heartCount = computed(() => Math.max(0, props.flipp.lives.value))

const overlay = computed(() => {
  const s = props.flipp.status.value
  if (s === 'gameover') {
    const hs = props.flipp.highscore.value
    // v7.4.0: tapText fjernet — vi har eksplisitte RESTART/DEL-knapper i
    // overlayet nå, så hele bakgrunnen skal IKKE trigge restart ved tap.
    // v7.4.1: bruk integer-formatering med tusenskille (ikke scientific
    // notation) ved store tall. Cap'es ved Number.MAX_SAFE_INTEGER for
    // defensiv beskyttelse mot eldre cascade-bugs.
    return {
      text: t('overlay.gameOver'),
      sub: t('overlay.highscore', { value: formatScore(hs) }),
      color: 'red',
    }
  }
  if (s === 'won') return { text: t('overlay.levelClear'), sub: '', color: 'yellow' }
  if (s === 'sunk') return { text: t('overlay.miss'), sub: '', color: 'cyan' }
  if (s === 'countdown') {
    const n = props.flipp.countdown.value
    return { text: n > 0 ? String(n) : t('overlay.go'), sub: '', color: 'yellow', big: true }
  }
  if (s === 'idle' && props.flipp.lives.value > 0) {
    const isFresh = props.flipp.lives.value === 3 &&
                    props.flipp.score.value === 0 &&
                    props.flipp.level.value === 1 &&
                    props.flipp.totalScore.value === 0
    return {
      text: '',
      sub: isFresh ? t('overlay.tapToStart') : t('overlay.tapToContinue'),
      color: 'cyan',
      tappable: true,
    }
  }
  return null
})

function onOverlayTap() {
  const s = props.flipp.status.value
  // v7.4.0: gameover har nå eksplisitte knapper (RESTART/DEL); kun idle
  // beholder tap-anywhere-to-start-flowen.
  if (s === 'idle' && props.flipp.lives.value > 0) emit('continue')
}

function onPerkChoice(id) {
  props.flipp.applyPerk(id)
}

// Smash-flash: vises kort når lastEvent.kind === 'smash'
const smashFlash = computed(() => {
  const e = props.flipp.lastEvent.value
  if (!e || e.kind !== 'smash') return null
  if (Date.now() - e.at > 1500) return null
  return e
})

// Multiball-flash: ref + watch i stedet for computed.
// v7.3.4: tidligere computed reagerte ikke på Date.now()-utløp, og ble heller
// aldri synlig hvis lastEvent ble satt mens en annen reaktiv oppdatering
// ikke trigget recompute. Watch + setTimeout garanterer minst 2s visning.
const multiballFlash = ref(null)
let multiballTimer = null

// v7.3.7: cascade-level-up under multiball — eget flash med chain-mult og bonus
const chainFlash = ref(null)
let chainTimer = null

watch(() => props.flipp.lastEvent.value, (e) => {
  if (e?.kind === 'multiball') {
    multiballFlash.value = e
    if (multiballTimer) clearTimeout(multiballTimer)
    multiballTimer = setTimeout(() => {
      multiballFlash.value = null
      multiballTimer = null
    }, 2000)
  } else if (e?.kind === 'chain') {
    chainFlash.value = e
    if (chainTimer) clearTimeout(chainTimer)
    chainTimer = setTimeout(() => {
      chainFlash.value = null
      chainTimer = null
    }, 1800)
  }
})

onUnmounted(() => {
  if (multiballTimer) clearTimeout(multiballTimer)
  if (chainTimer) clearTimeout(chainTimer)
})

// v7.3.5: debug-panel — togglebar, persisterer i localStorage. Vises kun
// når DEBUG_MULTIBALL er på (fjernes med flag i useCurveBall.js når bug
// er bekreftet løst).
// v7.5.0 rebrand-migrering: les ny + gammel nøkkel, skriv kun ny.
const DEBUG_KEY_NEW = 'curveball-debug-panel'
const DEBUG_KEY_OLD = 'flippkart-debug-panel'
const debugOpen = ref((() => {
  try {
    const v = localStorage.getItem(DEBUG_KEY_NEW) ?? localStorage.getItem(DEBUG_KEY_OLD)
    return v !== '0'
  } catch { return true }
})())
function toggleDebug() {
  debugOpen.value = !debugOpen.value
  try { localStorage.setItem(DEBUG_KEY_NEW, debugOpen.value ? '1' : '0') } catch {}
}

// Live-state ticker — re-render hver 100 ms så stillTime-tellingen er synlig
const tick = ref(0)
let tickTimer = null
tickTimer = setInterval(() => { tick.value++ }, 100)
onUnmounted(() => { if (tickTimer) clearInterval(tickTimer) })

const ballState = computed(() => {
  void tick.value
  const b = props.flipp.balls[0]
  if (!b) return null
  const v = Math.hypot(b.vx ?? 0, b.vy ?? 0)
  return {
    n: props.flipp.balls.length,
    still: (b.stillTime ?? 0).toFixed(2),
    charge: (b.chargeT ?? 0).toFixed(2),
    canExp: b.canExplode ? 'Y' : 'n',
    v: v.toFixed(0),
    hist: b.history?.length ?? 0,
  }
})

function onForceMultiball() {
  props.flipp.forceMultiball?.()
}

// ── v7.4.0 turneringsmodus ─────────────────────────────────────────────────
function pickTournament(yes) {
  props.flipp.setTournamentMode?.(yes)
}
function onTournamentNext() {
  if (!props.tournamentNext) return
  emit('tournamentNext', props.tournamentNext)
}

// ── v7.4.0 share-modal ─────────────────────────────────────────────────────
const shareOpen = ref(false)
const shareName = ref('')
const shareCopied = ref(false)
let shareCopyTimer = null

function openShare() {
  if (!props.shareInfo) return
  shareName.value = ''
  shareCopied.value = false
  shareOpen.value = true
}
function closeShare() {
  shareOpen.value = false
  if (shareCopyTimer) { clearTimeout(shareCopyTimer); shareCopyTimer = null }
}
function onShareNameInput(e) {
  // 3 bokstaver, A–Z, store. Klipp til 3 tegn.
  const v = String(e.target.value || '').toUpperCase().replace(/[^A-ZÆØÅ]/g, '').slice(0, 3)
  shareName.value = v
  e.target.value = v
}
const shareUrl = computed(() => {
  if (!props.shareInfo || shareName.value.length < 3) return ''
  const s = props.shareInfo
  const lat = Number(s.lat).toFixed(5)
  const lon = Number(s.lon).toFixed(5)
  const km = Number(s.sizeKm)
  const eq = Number(s.equidistanceM)
  const score = Number(props.flipp.totalScore.value || 0)
  const lv = Number(props.flipp.level.value || 1)
  const params = new URLSearchParams({
    n: shareName.value,
    lat, lon,
    km: String(km),
    eq: String(eq),
    score: String(score),
    lv: String(lv),
  })
  const base = (s.baseUrl ?? '').replace(/\/$/, '')
  return `${base}/kart/nytt?${params.toString()}`
})
async function copyShareUrl() {
  const url = shareUrl.value
  if (!url) return
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url)
    } else {
      // fallback for eldre browsere
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch {}
      document.body.removeChild(ta)
    }
    shareCopied.value = true
    if (shareCopyTimer) clearTimeout(shareCopyTimer)
    shareCopyTimer = setTimeout(() => { shareCopied.value = false }, 1800)
  } catch (err) {
    shareCopied.value = false
  }
}
</script>

<template>
  <div v-if="flipp.active.value" class="cb-hud">
    <!-- Top bar -->
    <div class="cb-bar">
      <div class="cb-cell cb-cyan">{{ levelStr }}</div>
      <div class="cb-cell cb-yellow">{{ scoreStr }}</div>
      <div class="cb-cell cb-hearts">
        <svg v-for="i in heartCount" :key="`h-${i}`" viewBox="0 0 9 8" class="cb-heart">
          <rect x="1" y="1" width="2" height="1" fill="#ff3b3b"/>
          <rect x="6" y="1" width="2" height="1" fill="#ff3b3b"/>
          <rect x="0" y="2" width="9" height="2" fill="#ff3b3b"/>
          <rect x="1" y="4" width="7" height="1" fill="#ff3b3b"/>
          <rect x="2" y="5" width="5" height="1" fill="#ff3b3b"/>
          <rect x="3" y="6" width="3" height="1" fill="#ff3b3b"/>
          <rect x="4" y="7" width="1" height="1" fill="#ff3b3b"/>
        </svg>
        <svg v-for="i in (3 - heartCount)" :key="`he-${i}`" viewBox="0 0 9 8" class="cb-heart cb-heart-empty">
          <rect x="1" y="1" width="2" height="1" fill="#444"/>
          <rect x="6" y="1" width="2" height="1" fill="#444"/>
          <rect x="0" y="2" width="9" height="2" fill="#444"/>
          <rect x="1" y="4" width="7" height="1" fill="#444"/>
          <rect x="2" y="5" width="5" height="1" fill="#444"/>
          <rect x="3" y="6" width="3" height="1" fill="#444"/>
          <rect x="4" y="7" width="1" height="1" fill="#444"/>
        </svg>
      </div>
    </div>

    <!-- Smash-bonus flash -->
    <div v-if="smashFlash" class="cb-smash-flash">
      <div class="cb-smash-text">{{ t('flash.smash') }}</div>
      <div class="cb-smash-sub">+{{ smashFlash.bonus }}</div>
    </div>

    <!-- Multiball-flash når kula eksploderer i 3 -->
    <div v-if="multiballFlash" class="cb-multiball-flash">
      <div class="cb-multiball-text">{{ t('flash.multiball') }}</div>
    </div>

    <!-- Chain-flash når multiball-cascade clearer flere levels på rad -->
    <div v-if="chainFlash" class="cb-chain-flash">
      <div class="cb-chain-mini">{{ t('flash.chain.label') }}</div>
      <div class="cb-chain-text">{{ t('flash.chain.text', { mult: chainFlash.mult }) }}</div>
      <div class="cb-chain-sub">+{{ chainFlash.bonus }}</div>
    </div>

    <!-- Bottom-right: exit-knapp -->
    <button class="cb-exit" @click="emit('exit')">{{ t('button.exit') }}</button>

    <!-- v7.3.5 DEBUG-panel for multiball-feilsøking. Togglebar via DBG-knapp. -->
    <template v-if="flipp.DEBUG_MULTIBALL">
      <button class="cb-dbg-toggle" @click="toggleDebug">
        {{ debugOpen ? '▾ DBG' : '▸ DBG' }}
      </button>
      <div v-if="debugOpen" class="cb-dbg-panel">
        <div class="cb-dbg-row">
          <span>balls:{{ flipp.balls.length }}</span>
          <span v-if="ballState">v:{{ ballState.v }}</span>
          <span v-if="ballState">still:{{ ballState.still }}/{{ flipp.STILLNESS_EXPLODE_S }}s</span>
        </div>
        <div v-if="ballState" class="cb-dbg-row">
          <span>charge:{{ ballState.charge }}</span>
          <span>canExp:{{ ballState.canExp }}</span>
          <span>hist:{{ ballState.hist }}/60</span>
        </div>
        <div class="cb-dbg-row">
          <span>displ-thr:{{ Math.round(flipp.STILLNESS_DISPL_M) }}m</span>
          <span>status:{{ flipp.status.value }}</span>
        </div>
        <button class="cb-dbg-force" @click="onForceMultiball">FORCE MULTIBALL</button>
        <div class="cb-dbg-log">
          <div v-for="(l, i) in flipp.debugLog" :key="`l-${i}`" class="cb-dbg-line">{{ l }}</div>
          <div v-if="!flipp.debugLog.length" class="cb-dbg-line cb-dbg-empty">(no events yet)</div>
        </div>
      </div>
    </template>

    <!-- Center overlay -->
    <div v-if="overlay"
         class="cb-overlay"
         :class="{ 'cb-tappable': overlay.tappable }"
         @click="onOverlayTap">
      <div v-if="overlay.text"
           class="cb-overlay-main"
           :class="[`cb-${overlay.color}`, overlay.big ? 'cb-overlay-huge' : '']">
        {{ overlay.text }}
      </div>
      <div v-if="overlay.sub"
           class="cb-overlay-sub"
           :class="`cb-${overlay.color}`">
        {{ overlay.sub }}
      </div>
      <div v-if="overlay.tapText"
           class="cb-overlay-sub cb-cyan">
        {{ overlay.tapText }}
      </div>

      <!-- v7.4.0: Game-over har «DEL»-knapp ved siden av TAP TO RESTART. Egne
           handlere så tap på Del ikke trigger restart. -->
      <div v-if="flipp.status.value === 'gameover'" class="cb-go-actions">
        <button class="cb-go-btn cb-go-restart"
                @click.stop="emit('restart')">{{ t('button.restart') }}</button>
        <button v-if="shareInfo"
                class="cb-go-btn cb-go-share"
                @click.stop="openShare">{{ t('button.share') }} ▣</button>
      </div>

      <!-- v7.4.0: Turneringsmodus-snarvei — ekstra knapp ved level-clear/idle -->
      <button v-if="flipp.status.value === 'idle'
                    && flipp.lives.value > 0
                    && flipp.tournamentMode.value === true
                    && tournamentNext"
              class="cb-tournament-next"
              @click.stop="onTournamentNext">
        {{ t('button.nextMap') }}
        <span class="cb-tournament-next-name">{{ tournamentNext.navn }}</span>
      </button>
    </div>

    <!-- v7.4.0: Mode-select-overlay — vises FØR første level. To valg: standard
         eller turnering (krever at brukeren har egne kart). -->
    <div v-if="flipp.status.value === 'mode-select'" class="cb-mode-overlay">
      <div class="cb-mode-title cb-yellow">{{ t('mode.title') }}</div>
      <div class="cb-mode-sub cb-cyan">{{ t('mode.subtitle') }}</div>
      <div class="cb-mode-grid">
        <button class="cb-mode-btn" @click="pickTournament(false)">
          <div class="cb-mode-icon">🎯</div>
          <div class="cb-mode-label">{{ t('mode.standard.label') }}</div>
          <div class="cb-mode-desc">{{ t('mode.standard.desc') }}</div>
        </button>
        <button class="cb-mode-btn cb-mode-tour"
                :disabled="!tournamentNext"
                @click="pickTournament(true)">
          <div class="cb-mode-icon">🏆</div>
          <div class="cb-mode-label">{{ t('mode.tournament.label') }}</div>
          <div v-if="tournamentNext" class="cb-mode-desc">
            {{ t('mode.tournament.desc') }}
          </div>
          <div v-else class="cb-mode-desc cb-mode-desc-disabled">
            {{ t('mode.tournament.disabled') }}
          </div>
        </button>
      </div>
    </div>

    <!-- v7.4.0: Share-modal (vises når DEL-knappen er trykket på game over) -->
    <div v-if="shareOpen" class="cb-share-overlay" @click.self="closeShare">
      <div class="cb-share-card">
        <div class="cb-share-title cb-yellow">{{ t('share.title') }}</div>
        <div class="cb-share-sub cb-cyan">
          {{ t('share.subtitle', {
            score: formatScore(flipp.totalScore.value),
            level: String(flipp.level.value).padStart(2, '0'),
          }) }}
        </div>
        <label class="cb-share-label">{{ t('share.nameLabel') }}</label>
        <input type="text"
               class="cb-share-input"
               maxlength="3"
               :value="shareName"
               :placeholder="t('share.namePlaceholder')"
               autocomplete="off"
               autocapitalize="characters"
               spellcheck="false"
               @input="onShareNameInput">
        <div v-if="shareUrl" class="cb-share-url-wrap">
          <div class="cb-share-url">{{ shareUrl }}</div>
          <button class="cb-share-copy" @click="copyShareUrl">
            {{ shareCopied ? t('button.copied') : t('button.copyLink') }}
          </button>
        </div>
        <div v-else class="cb-share-hint">{{ t('share.hint') }}</div>
        <button class="cb-share-close" @click="closeShare">{{ t('button.close') }}</button>
      </div>
    </div>

    <!-- Perk-select-overlay (vises hvert 3. level) -->
    <div v-if="flipp.status.value === 'perk-select'" class="cb-perk-overlay">
      <div class="cb-perk-title cb-yellow">{{ t('perk.title') }}</div>
      <div class="cb-perk-sub cb-cyan">{{ t('perk.level', { n: String(flipp.level.value).padStart(2, '0') }) }}</div>
      <div class="cb-perk-grid">
        <button v-for="p in flipp.perkChoices.value"
                :key="p.id"
                class="cb-perk-btn"
                @click="onPerkChoice(p.id)">
          <div class="cb-perk-icon">{{ p.icon }}</div>
          <div class="cb-perk-label">{{ p.label }}</div>
          <div class="cb-perk-desc">{{ p.desc }}</div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@font-face {
  font-family: 'Press Start 2P';
  src: url('../assets/PressStart2P-Regular.woff2') format('woff2');
  font-display: swap;
}

.cb-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  font-family: 'Press Start 2P', 'Courier New', monospace;
  -webkit-font-smoothing: none;
  font-smoothing: none;
}

.cb-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 12px;
  background: #000;
  font-size: 10px;
  letter-spacing: 0.6px;
  border-bottom: 2px solid #222;
}

.cb-cell {
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
}

.cb-hearts {
  gap: 3px;
}

.cb-heart {
  width: 18px;
  height: 16px;
  image-rendering: pixelated;
}

.cb-cyan { color: #5cefff; }
.cb-yellow { color: #ffe24d; }
.cb-red { color: #ff3b3b; }

.cb-exit {
  position: absolute;
  bottom: 16px; right: 16px;
  pointer-events: auto;
  background: #000;
  color: #5cefff;
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.6px;
  padding: 8px 12px;
  border: 2px solid #5cefff;
  border-radius: 0;
  cursor: pointer;
}
.cb-exit:active {
  background: #5cefff;
  color: #000;
}

.cb-overlay {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.6em;
  padding: 16px;
  text-align: center;
}
.cb-overlay.cb-tappable {
  pointer-events: auto;
  cursor: pointer;
}

.cb-overlay-main {
  font-size: 28px;
  text-shadow: 4px 4px 0 #000;
  animation: cb-blink 0.6s steps(2, end) infinite;
}
.cb-overlay-huge {
  font-size: 96px;
  text-shadow: 6px 6px 0 #000;
  animation: cb-pulse 0.4s ease-out;
}

.cb-overlay-sub {
  font-size: 10px;
  text-shadow: 2px 2px 0 #000;
  animation: cb-blink 0.9s steps(2, end) infinite;
}

@keyframes cb-blink {
  0% { opacity: 1; }
  50% { opacity: 0.4; }
  100% { opacity: 1; }
}
@keyframes cb-pulse {
  0%   { transform: scale(0.4); opacity: 0; }
  50%  { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(1.0); opacity: 1; }
}

/* Smash bonus flash midt på skjermen */
.cb-smash-flash {
  position: absolute;
  top: 30%; left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
  animation: cb-smash-rise 1.5s ease-out forwards;
}
.cb-smash-text {
  font-size: 36px;
  color: #ffe24d;
  text-shadow: 4px 4px 0 #b91c1c, 8px 8px 0 #000;
}
.cb-smash-sub {
  font-size: 16px;
  color: #ff3b3b;
  margin-top: 0.4em;
  text-shadow: 3px 3px 0 #000;
}
@keyframes cb-smash-rise {
  0%   { transform: translate(-50%, 50%); opacity: 0; }
  20%  { transform: translate(-50%, -50%); opacity: 1; }
  80%  { transform: translate(-50%, -80%); opacity: 1; }
  100% { transform: translate(-50%, -120%); opacity: 0; }
}

/* Multiball-flash midt på skjermen — eksplosivt 8-bit-stil tekst */
.cb-multiball-flash {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
  animation: cb-multiball-shake 2s ease-out forwards;
}
.cb-multiball-text {
  font-size: 56px;
  color: #fde047;
  text-shadow:
    4px 4px 0 #fb923c,
    8px 8px 0 #ef4444,
    12px 12px 0 #000;
  letter-spacing: 0.08em;
  animation: cb-multiball-pulse 0.25s steps(2, end) infinite;
}
@keyframes cb-multiball-shake {
  0%   { transform: translate(-50%, -50%) scale(0.2); opacity: 0; }
  15%  { transform: translate(-50%, -50%) scale(1.4); opacity: 1; }
  20%  { transform: translate(-52%, -50%) scale(1.2); opacity: 1; }
  25%  { transform: translate(-48%, -50%) scale(1.2); opacity: 1; }
  30%  { transform: translate(-50%, -50%) scale(1.0); opacity: 1; }
  85%  { transform: translate(-50%, -50%) scale(1.0); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1.2); opacity: 0; }
}
@keyframes cb-multiball-pulse {
  0%   { filter: brightness(1.0); }
  50%  { filter: brightness(1.4); }
  100% { filter: brightness(1.0); }
}

/* Chain-flash — vises når multiball-cascade clearer et level (v7.3.7).
   Stiger fra bunn med rainbow-pulserende tekst, scaler med chain-dybde. */
.cb-chain-flash {
  position: absolute;
  top: 38%; left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
  animation: cb-chain-burst 1.8s ease-out forwards;
}
.cb-chain-mini {
  font-size: 14px;
  color: #5cefff;
  letter-spacing: 0.1em;
  text-shadow: 2px 2px 0 #000;
  margin-bottom: 0.4em;
}
.cb-chain-text {
  font-size: 48px;
  color: #fde047;
  text-shadow:
    3px 3px 0 #f97316,
    6px 6px 0 #ef4444,
    9px 9px 0 #a855f7,
    12px 12px 0 #000;
  letter-spacing: 0.06em;
  animation: cb-chain-pulse 0.2s steps(2, end) infinite;
}
.cb-chain-sub {
  font-size: 22px;
  color: #4ade80;
  margin-top: 0.5em;
  text-shadow: 3px 3px 0 #000;
  letter-spacing: 0.04em;
}
@keyframes cb-chain-burst {
  0%   { transform: translate(-50%, 30%) scale(0.3); opacity: 0; }
  15%  { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
  20%  { transform: translate(-52%, -50%) scale(1.15); opacity: 1; }
  25%  { transform: translate(-48%, -50%) scale(1.15); opacity: 1; }
  30%  { transform: translate(-50%, -50%) scale(1.0); opacity: 1; }
  85%  { transform: translate(-50%, -50%) scale(1.0); opacity: 1; }
  100% { transform: translate(-50%, -110%) scale(1.1); opacity: 0; }
}
@keyframes cb-chain-pulse {
  0%   { filter: brightness(1.0) hue-rotate(0deg); }
  50%  { filter: brightness(1.5) hue-rotate(20deg); }
  100% { filter: brightness(1.0) hue-rotate(0deg); }
}

/* Perk-select overlay — vises ved level-clear hvert 3. level */
.cb-perk-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1em;
  padding: 1em;
}
.cb-perk-title {
  font-size: 22px;
  letter-spacing: 0.1em;
  text-shadow: 3px 3px 0 #000;
}
.cb-perk-sub {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-shadow: 2px 2px 0 #000;
  margin-bottom: 0.5em;
}
.cb-perk-grid {
  display: flex;
  flex-direction: column;
  gap: 0.7em;
  width: min(320px, 90%);
}
.cb-perk-btn {
  font-family: inherit;
  background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
  color: #fff;
  border: 2px solid #5cefff;
  padding: 12px;
  display: grid;
  grid-template-columns: 38px 1fr;
  grid-template-rows: auto auto;
  gap: 4px 12px;
  align-items: center;
  cursor: pointer;
  transition: transform 80ms, filter 80ms;
}
.cb-perk-btn:active {
  transform: scale(0.98);
  filter: brightness(1.3);
}
.cb-perk-icon {
  grid-row: 1 / span 2;
  font-size: 26px;
  text-align: center;
}
.cb-perk-label {
  font-size: 10px;
  letter-spacing: 0.05em;
  color: #ffe24d;
  text-shadow: 1px 1px 0 #000;
}
.cb-perk-desc {
  font-size: 8px;
  letter-spacing: 0.05em;
  color: #cbd5e1;
  text-transform: lowercase;
}

/* DEBUG-panel (v7.3.5 — fjern når DEBUG_MULTIBALL settes til false) */
.cb-dbg-toggle {
  position: absolute;
  top: 56px;
  right: 8px;
  pointer-events: auto;
  background: #000;
  color: #fde047;
  border: 1px solid #fde047;
  font-family: inherit;
  font-size: 9px;
  padding: 4px 6px;
  cursor: pointer;
  z-index: 60;
}
.cb-dbg-panel {
  position: absolute;
  top: 88px;
  right: 8px;
  width: min(220px, 60vw);
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid #fde047;
  padding: 6px;
  font-family: monospace;
  font-size: 10px;
  color: #fde047;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cb-dbg-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.cb-dbg-row span {
  white-space: nowrap;
}
.cb-dbg-force {
  pointer-events: auto;
  background: #7f1d1d;
  color: #fff;
  border: 1px solid #ef4444;
  font-family: inherit;
  font-size: 10px;
  padding: 6px 4px;
  cursor: pointer;
  margin-top: 2px;
}
.cb-dbg-force:active { background: #ef4444; }
.cb-dbg-log {
  border-top: 1px dashed #444;
  padding-top: 4px;
  max-height: 140px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  color: #cbd5e1;
  font-size: 9px;
  line-height: 1.2;
}
.cb-dbg-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cb-dbg-empty { color: #666; font-style: italic; }

/* ── v7.4.0 mode-select-overlay (FØR første level) ───────────────────────── */
.cb-mode-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6em;
  padding: 1em;
  z-index: 70;
}
.cb-mode-title {
  font-size: 22px;
  letter-spacing: 0.1em;
  text-shadow: 3px 3px 0 #000;
}
.cb-mode-sub {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-shadow: 2px 2px 0 #000;
  margin-bottom: 0.6em;
}
.cb-mode-grid {
  display: flex;
  flex-direction: column;
  gap: 0.7em;
  width: min(320px, 90%);
}
.cb-mode-btn {
  font-family: inherit;
  background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
  color: #fff;
  border: 2px solid #5cefff;
  padding: 14px 12px;
  display: grid;
  grid-template-columns: 38px 1fr;
  grid-template-rows: auto auto;
  gap: 4px 12px;
  align-items: center;
  cursor: pointer;
  transition: transform 80ms, filter 80ms;
}
.cb-mode-btn:active:not(:disabled) {
  transform: scale(0.98);
  filter: brightness(1.3);
}
.cb-mode-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.cb-mode-tour {
  background: linear-gradient(135deg, #4a044e 0%, #db2777 100%);
  border-color: #fde047;
}
.cb-mode-icon {
  grid-row: 1 / span 2;
  font-size: 28px;
  text-align: center;
}
.cb-mode-label {
  font-size: 12px;
  letter-spacing: 0.06em;
  color: #ffe24d;
  text-shadow: 1px 1px 0 #000;
}
.cb-mode-desc {
  font-size: 8px;
  letter-spacing: 0.05em;
  color: #cbd5e1;
  text-transform: lowercase;
}
.cb-mode-desc-disabled { color: #f87171; text-transform: none; }

/* ── v7.4.0 game-over actions (RESTART + DEL) ────────────────────────────── */
.cb-go-actions {
  display: flex;
  gap: 12px;
  margin-top: 0.8em;
}
.cb-go-btn {
  pointer-events: auto;
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.08em;
  padding: 10px 18px;
  border: 2px solid currentColor;
  background: #000;
  cursor: pointer;
  transition: filter 80ms, transform 80ms;
}
.cb-go-btn:active { transform: scale(0.96); filter: brightness(1.4); }
.cb-go-restart { color: #5cefff; }
.cb-go-share   { color: #fde047; }

/* ── v7.4.0 turnerings-snarvei (level-clear) ─────────────────────────────── */
.cb-tournament-next {
  pointer-events: auto;
  margin-top: 1.2em;
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.08em;
  padding: 10px 16px;
  background: linear-gradient(135deg, #4a044e 0%, #db2777 100%);
  color: #fde047;
  border: 2px solid #fde047;
  text-shadow: 1px 1px 0 #000;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  max-width: 260px;
  transition: filter 80ms, transform 80ms;
}
.cb-tournament-next:active { transform: scale(0.97); filter: brightness(1.3); }
.cb-tournament-next-name {
  font-size: 9px;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

/* ── v7.4.0 share-modal ──────────────────────────────────────────────────── */
.cb-share-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 80;
  padding: 1em;
}
.cb-share-card {
  width: min(360px, 100%);
  background: #0b1019;
  border: 2px solid #fde047;
  padding: 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cb-share-title {
  font-size: 16px;
  letter-spacing: 0.08em;
  text-shadow: 2px 2px 0 #000;
}
.cb-share-sub {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-shadow: 1px 1px 0 #000;
}
.cb-share-label {
  font-size: 9px;
  color: #cbd5e1;
  letter-spacing: 0.08em;
  margin-top: 4px;
}
.cb-share-input {
  font-family: inherit;
  font-size: 28px;
  letter-spacing: 0.4em;
  text-align: center;
  padding: 10px 6px;
  background: #000;
  color: #fde047;
  border: 2px solid #5cefff;
  text-transform: uppercase;
  outline: none;
}
.cb-share-input:focus { border-color: #fde047; }
.cb-share-url-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.cb-share-url {
  font-family: 'Courier New', monospace;
  font-size: 10px;
  color: #5cefff;
  background: #000;
  padding: 8px;
  border: 1px solid #334;
  word-break: break-all;
  user-select: all;
  line-height: 1.35;
}
.cb-share-copy {
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.08em;
  padding: 10px;
  background: #000;
  color: #4ade80;
  border: 2px solid #4ade80;
  cursor: pointer;
  transition: filter 80ms, transform 80ms;
}
.cb-share-copy:active { transform: scale(0.97); filter: brightness(1.4); }
.cb-share-hint {
  font-size: 9px;
  color: #94a3b8;
  letter-spacing: 0.05em;
  text-align: center;
  padding: 10px;
  border: 1px dashed #334;
}
.cb-share-close {
  font-family: inherit;
  font-size: 10px;
  letter-spacing: 0.08em;
  padding: 8px;
  background: transparent;
  color: #94a3b8;
  border: 1px solid #334;
  cursor: pointer;
  margin-top: 4px;
}
.cb-share-close:active { color: #fff; border-color: #94a3b8; }
</style>

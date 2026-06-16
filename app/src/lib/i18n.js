/**
 * i18n.js — Lett-vekt lokalisering for SVG Insights.
 *
 * Default-språk er norsk bokmål ('no'). Andre språk kan legges til ved å
 * supplere `dictionaries`-objektet. Spillnavnet «Curve Invaders» (med
 * mellomrom — v8.0.1) er bevisst konstant på tvers av locales — det er en
 * brand, ikke en oversettelse.
 *
 * Bruk:
 *   import { t } from '../lib/i18n.js'
 *   ...
 *   {{ t('button.startGame') }}
 *
 * I template er `t()` reaktivt fordi `currentLocale` er en ref og Vue
 * sporer .value-aksess under render. I script må du bruke computed eller
 * kalle t() direkte i en reactive context — ikke pre-evaluer til en
 * vanlig variabel hvis du vil ha språkbytte uten remount.
 *
 * Manglende nøkler faller tilbake til norsk-dictet, og deretter til
 * nøkkelen selv (så man ser umiddelbart i UI hva som mangler).
 */

import { ref } from 'vue'

const STORAGE_KEY = 'locale'
const DEFAULT_LOCALE = 'no'   // norsk bokmål

/**
 * Norsk bokmål — referanse-dictet. Alle nye strenger skal legges til her
 * først; deretter speiler du dem i andre locales etter behov. Ny-tilføyde
 * nøkler som mangler i andre språk faller pent tilbake til norsk.
 *
 * Brand-navnet «Curve Invaders» (v8.0.1: med mellomrom — tidligere skrevet
 * sammen som «CurveInvaders») er bevisst konstant i alle dicts. Interne
 * identifiers (filnavn, funksjoner, CSS-klasser, storage-keys) er fortsatt
 * «CurveBall» — det er et codename, ikke en brand.
 */
const no = {
  // ── Brand ────────────────────────────────────────────────────────────
  'game.name': 'Curve Invaders',
  'game.emoji': '🎮',
  'game.tagline': 'flipperspill-fysikk over et ekte turkart',

  // ── Knapper / generelt ──────────────────────────────────────────────
  'button.startGame': 'Start Curve Invaders',
  'button.exit': 'EXIT',
  'button.restart': 'RESTART',
  'button.share': 'DEL',
  'button.close': 'LUKK',
  'button.copyLink': 'KOPIER LENKE',
  'button.copied': 'KOPIERT ✓',
  'button.nextMap': 'NESTE KART →',

  // ── Mode-select (før første level) ──────────────────────────────────
  'mode.title': 'VELG MODUS',
  'mode.subtitle': 'FØR FØRSTE LEVEL',
  'mode.standard.label': 'STANDARD',
  'mode.standard.desc': 'spill alle levels på dette kartet',
  'mode.tournament.label': 'TURNERING',
  'mode.tournament.desc': 'snarvei til neste eget kart ved level-clear',
  'mode.tournament.disabled': 'krever minst ett eget kart i mappa',

  // ── Status-overlays ─────────────────────────────────────────────────
  'overlay.gameOver': 'GAME OVER',
  'overlay.highscore': 'HIGHSCORE: {value}',
  'overlay.levelClear': 'LEVEL CLEAR!',
  'overlay.miss': 'MISS!',
  'overlay.go': 'GO!',
  'overlay.tapToStart': 'TAP TO START',
  'overlay.tapToContinue': 'TAP TO CONTINUE',

  // ── HUD bar ─────────────────────────────────────────────────────────
  'hud.level': 'LEVEL {n}',
  // v8.10.0 Red Curves: progress-badge mens mini-spillet pågår
  'hud.redCurves': 'RØDE KURVER',
  // v8.8.10 Phase 2 — aktiv super-perk-badge med tier-navn
  'hud.perkBasic':    'PERK',
  'hud.perkEnhanced': 'ENHANCED',
  'hud.perkSuper':    'SUPER',

  // ── Flash-meldinger ─────────────────────────────────────────────────
  'flash.smash': 'SMASH!',
  'flash.multiball': 'MULTIBALL!',
  // v7.4.3 spawn-modi (Miniball + Curve Invaders) — NB: flash-teksten «INVADERS!»
  // refererer til spawn-modusen (invader-formasjon), ikke spillnavnet. Holdes
  // kort så den ikke kolliderer med brandnavnet «Curve Invaders».
  'flash.mini': 'MINIBALL!',
  'flash.miniSub': '×12 · 2× SPEED · 2× POENG',
  'flash.invader': 'INVADERS!',
  'flash.invaderSub': 'FORMATION INCOMING',
  'flash.chain.label': 'LEVEL UP!',
  'flash.chain.text': 'CHAIN ×{mult}',
  // v8.10.0 / v8.10.1 Red Curves tier-tekster — 60 / 80 / 100 % gir
  // tre ulike perk-tiers. Phase 2/3 vil koble disse til faktiske
  // perk-effekter (sync flippers, bullets, timer).
  'flash.redCurvesBasic':       'PERK!',
  'flash.redCurvesBasicSub':    '60 % RYDDET',
  'flash.redCurvesEnhanced':    'ENHANCED PERK!',
  'flash.redCurvesEnhancedSub': '80 % RYDDET',
  'flash.redCurvesSuper':       'SUPER PERK!',
  'flash.redCurvesSuperSub':    'ALLE KURVER RYDDET',

  // ── Perks ───────────────────────────────────────────────────────────
  'perk.title': 'CHOOSE PERK',
  'perk.level': 'LEVEL {n}',

  // ── Share-modal ─────────────────────────────────────────────────────
  'share.title': 'DEL UTFORDRINGEN',
  'share.subtitle': 'DIN SCORE: {score} · LEVEL {level}',
  'share.nameLabel': 'DITT NAVN (3 BOKSTAVER)',
  'share.namePlaceholder': 'ABC',
  'share.hint': 'Skriv 3 bokstaver for å lage lenke',

  // ── Challenge-banner (mottaker av delingslenke) ────────────────────
  'challenge.from': 'Utfordring fra {name}',
  'challenge.score': 'Score: {score}',
  'challenge.scoreLevel': 'Score: {score} · level {level}',
  'challenge.intro': 'Spillet er {gameName} — flipperspill-fysikk over et ekte turkart. Trill kula over høydekurver for poeng, treff bumpere, hold den i lufta med paddles på alle fire kanter. Trykk «{startBtn}» for å spille på samme kart som {name} — og se om du kan slå scoren.',
  'challenge.locked': 'Sentrum, kartstørrelse og ekvidistanse er låst til utfordrerens oppsett. Trykk ✕ øverst for å avbryte og lage et eget kart.',
  'challenge.cancel': 'Avbryt utfordring',

  // ── Del-kart-banner (shareInvite — mottaker av et delt kart) ───────
  'share.invite.title': 'Noen har delt et kart med deg!',
  'share.invite.titlePlace': 'Noen har delt et kart og et sted med deg!',
  'share.invite.body': 'Trykk «Lag turkart», så får du en nøyaktig kopi. God tur!',
  'share.invite.bodyPlace': 'Trykk «Lag turkart» — du får en nøyaktig kopi med stedet markert. Utsnittet er låst så stedet ikke går tapt.',
  'share.invite.marking': 'Markering: {name}',
  'share.invite.cancel': 'Avbryt delt kart',
  'share.invite.installCheckbox': 'Installer kartappen for en bedre opplevelse',
  'share.invite.installInfoLabel': 'Hva betyr det?',
  'share.invite.installInfo': 'Installasjon legger kartappen på hjemskjermen din, så den åpner i fullskjerm og fungerer offline. Du kan også gjøre dette senere fra forsiden.',

  // ── MapView drawer-knapper og referanser til spillet ───────────────
  'mapview.gameButton': '{emoji} {gameName}',
  'mapview.gameLoading': 'Laster høydedata …',
  'mapview.gameError': 'Kunne ikke hente høydedata',

  // ── MapPickerView ───────────────────────────────────────────────────
  'picker.previewLockedHint': 'Forhåndsvisning — låst til utfordrerens kartutsnitt',
  'picker.previewLockedHintShared': 'Forhåndsvisning — låst til det delte kartutsnittet',
  'picker.searchLockedPlaceholder': 'Søk låst i utfordringsmodus',
  'picker.searchLockedPlaceholderShared': 'Søk låst — du åpner et delt kart',
  'picker.makeMap': 'Lag turkart',
  'picker.makeMapInstall': 'Installer som app og lag kart',
}

/**
 * English — beginnelser. Ikke uttømmende; manglende nøkler faller tilbake
 * til norsk via `t()`-helperen. Brand-navnet er det samme.
 */
const en = {
  'game.name': 'Curve Invaders',
  'game.emoji': '🎮',
  'game.tagline': 'pinball physics on a real hiking map',

  'button.startGame': 'Start Curve Invaders',
  'button.exit': 'EXIT',
  'button.restart': 'RESTART',
  'button.share': 'SHARE',
  'button.close': 'CLOSE',
  'button.copyLink': 'COPY LINK',
  'button.copied': 'COPIED ✓',
  'button.nextMap': 'NEXT MAP →',

  'mode.title': 'CHOOSE MODE',
  'mode.subtitle': 'BEFORE FIRST LEVEL',
  'mode.standard.label': 'STANDARD',
  'mode.standard.desc': 'play all levels on this map',
  'mode.tournament.label': 'TOURNAMENT',
  'mode.tournament.desc': 'shortcut to your next own map on level-clear',
  'mode.tournament.disabled': 'requires at least one of your own maps',

  'overlay.gameOver': 'GAME OVER',
  'overlay.highscore': 'HIGHSCORE: {value}',
  'overlay.levelClear': 'LEVEL CLEAR!',
  'overlay.miss': 'MISS!',
  'overlay.go': 'GO!',
  'overlay.tapToStart': 'TAP TO START',
  'overlay.tapToContinue': 'TAP TO CONTINUE',

  'hud.level': 'LEVEL {n}',
  'hud.redCurves': 'RED CURVES',
  'hud.perkBasic':    'PERK',
  'hud.perkEnhanced': 'ENHANCED',
  'hud.perkSuper':    'SUPER',

  'flash.smash': 'SMASH!',
  'flash.multiball': 'MULTIBALL!',
  'flash.mini': 'MINIBALL!',
  'flash.miniSub': '×12 · 2× SPEED · 2× POINTS',
  'flash.invader': 'INVADERS!',
  'flash.invaderSub': 'FORMATION INCOMING',
  'flash.chain.label': 'LEVEL UP!',
  'flash.chain.text': 'CHAIN ×{mult}',
  'flash.redCurvesBasic':       'PERK!',
  'flash.redCurvesBasicSub':    '60 % CLEARED',
  'flash.redCurvesEnhanced':    'ENHANCED PERK!',
  'flash.redCurvesEnhancedSub': '80 % CLEARED',
  'flash.redCurvesSuper':       'SUPER PERK!',
  'flash.redCurvesSuperSub':    'ALL CURVES CLEARED',

  'perk.title': 'CHOOSE PERK',
  'perk.level': 'LEVEL {n}',

  'share.title': 'SHARE THE CHALLENGE',
  'share.subtitle': 'YOUR SCORE: {score} · LEVEL {level}',
  'share.nameLabel': 'YOUR NAME (3 LETTERS)',
  'share.namePlaceholder': 'ABC',
  'share.hint': 'Type 3 letters to generate the link',

  'challenge.from': 'Challenge from {name}',
  'challenge.score': 'Score: {score}',
  'challenge.scoreLevel': 'Score: {score} · level {level}',
  'challenge.intro': 'The game is {gameName} — pinball physics on a real hiking map. Roll the ball across contour lines for points, hit bumpers, keep it alive with the paddles on all four edges. Tap «{startBtn}» to play the same map as {name} — and see if you can beat their score.',
  'challenge.locked': 'Center, map size and contour interval are locked to the challenger\'s setup. Tap ✕ at the top to cancel and build your own map.',
  'challenge.cancel': 'Cancel challenge',

  'share.invite.title': 'Someone shared a map with you!',
  'share.invite.titlePlace': 'Someone shared a map and a place with you!',
  'share.invite.body': 'Tap «Generate map» to get an exact copy. Enjoy the trip!',
  'share.invite.bodyPlace': 'Tap «Generate map» to get an exact copy with the place marked. The map area is locked so the place is never lost.',
  'share.invite.marking': 'Marking: {name}',
  'share.invite.cancel': 'Dismiss shared map',
  'share.invite.installCheckbox': 'Install the map app for a better experience',
  'share.invite.installInfoLabel': 'What does that mean?',
  'share.invite.installInfo': 'Installing adds the map app to your home screen so it opens full-screen and works offline. You can also do this later from the home page.',

  'mapview.gameButton': '{emoji} {gameName}',
  'mapview.gameLoading': 'Loading elevation data …',
  'mapview.gameError': 'Could not fetch elevation data',

  'picker.previewLockedHint': 'Preview — locked to the challenger\'s map area',
  'picker.previewLockedHintShared': 'Preview — locked to the shared map area',
  'picker.searchLockedPlaceholder': 'Search disabled in challenge mode',
  'picker.searchLockedPlaceholderShared': 'Search disabled — opening a shared map',
  'picker.makeMap': 'Generate map',
  'picker.makeMapInstall': 'Install as app and generate map',
}

const dictionaries = { no, en }

function loadStoredLocale() {
  if (typeof localStorage === 'undefined') return DEFAULT_LOCALE
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && dictionaries[stored]) return stored
  } catch { /* ignore */ }
  return DEFAULT_LOCALE
}

/**
 * Aktivt språk. Reaktiv ref — `t()` kalt i template/computed re-rendrer
 * automatisk når denne endres. Persistert i localStorage så valget
 * overlever sesjon.
 */
export const currentLocale = ref(loadStoredLocale())

/**
 * Hent oversatt streng for `key`. `params` er valgfri map for
 * `{name}`-substitusjon. Manglende nøkler faller tilbake til norsk-dictet,
 * og deretter til nøkkelen selv.
 */
export function t(key, params) {
  const dict = dictionaries[currentLocale.value] ?? dictionaries[DEFAULT_LOCALE]
  let text = dict[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v))
    }
  }
  return text
}

/** Bytt språk runtime. Persisterer valget. No-op hvis locale ikke er definert. */
export function setLocale(locale) {
  if (!dictionaries[locale]) return
  currentLocale.value = locale
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, locale) } catch { /* ignore */ }
}

/** Liste over locales som er definert. Bruk til UI-velger. */
export function availableLocales() {
  return Object.keys(dictionaries)
}

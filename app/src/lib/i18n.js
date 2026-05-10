/**
 * i18n.js — Lett-vekt lokalisering for SVG Insights.
 *
 * Default-språk er norsk bokmål ('no'). Andre språk kan legges til ved å
 * supplere `dictionaries`-objektet. Spillnavnet «CurveBall» er bevisst
 * konstant på tvers av locales — det er en brand, ikke en oversettelse.
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
 * Brand-navnet «CurveBall» er bevisst konstant i alle dicts.
 */
const no = {
  // ── Brand ────────────────────────────────────────────────────────────
  // v7.5.1: Brand-navnet endret fra «CurveBall» → «CurveInvaders».
  // Det fanger spawn-modus-paletten bedre (multiball + miniball + invaders)
  // og har mer schwung. Interne identifiers (useCurveBall, .cb-*, storage-
  // keys) beholdes som CurveBall — det er et codename, ikke en brand.
  'game.name': 'CurveInvaders',
  'game.emoji': '🎮',
  'game.tagline': 'flipperspill-fysikk over et ekte turkart',

  // ── Knapper / generelt ──────────────────────────────────────────────
  'button.startGame': 'Start CurveInvaders',
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

  // ── Flash-meldinger ─────────────────────────────────────────────────
  'flash.smash': 'SMASH!',
  'flash.multiball': 'MULTIBALL!',
  'flash.chain.label': 'LEVEL UP!',
  'flash.chain.text': 'CHAIN ×{mult}',

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

  // ── MapView drawer-knapper og referanser til spillet ───────────────
  'mapview.gameButton': '{emoji} {gameName}',
  'mapview.gameLoading': 'Laster høydedata …',
  'mapview.gameError': 'Kunne ikke hente høydedata',

  // ── MapPickerView ───────────────────────────────────────────────────
  'picker.previewLockedHint': 'Forhåndsvisning — låst til utfordrerens kartutsnitt',
  'picker.searchLockedPlaceholder': 'Søk låst i utfordringsmodus',
  'picker.makeMap': 'Lag turkart',
}

/**
 * English — beginnelser. Ikke uttømmende; manglende nøkler faller tilbake
 * til norsk via `t()`-helperen. Brand-navnet er det samme.
 */
const en = {
  'game.name': 'CurveInvaders',
  'game.emoji': '🎮',
  'game.tagline': 'pinball physics on a real hiking map',

  'button.startGame': 'Start CurveInvaders',
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

  'flash.smash': 'SMASH!',
  'flash.multiball': 'MULTIBALL!',
  'flash.chain.label': 'LEVEL UP!',
  'flash.chain.text': 'CHAIN ×{mult}',

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

  'mapview.gameButton': '{emoji} {gameName}',
  'mapview.gameLoading': 'Loading elevation data …',
  'mapview.gameError': 'Could not fetch elevation data',

  'picker.previewLockedHint': 'Preview — locked to the challenger\'s map area',
  'picker.searchLockedPlaceholder': 'Search disabled in challenge mode',
  'picker.makeMap': 'Generate map',
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

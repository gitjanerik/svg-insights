/**
 * i18n.js — Lett-vekt lokalisering.
 *
 * Default-språk er norsk bokmål ('no'). Andre språk kan legges til ved å
 * supplere `dictionaries`-objektet.
 *
 * Bruk:
 *   import { t } from '../lib/i18n.js'
 *   ...
 *   {{ t('picker.makeMap') }}
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
 */
const no = {
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

  // ── MapPickerView ───────────────────────────────────────────────────
  'picker.previewLockedHintShared': 'Forhåndsvisning — låst til det delte kartutsnittet',
  'picker.searchLockedPlaceholderShared': 'Søk låst — du åpner et delt kart',
  'picker.makeMap': 'Lag turkart',
  'picker.makeMapInstall': 'Installer som app og lag kart',
}

/**
 * English — beginnelser. Ikke uttømmende; manglende nøkler faller tilbake
 * til norsk via `t()`-helperen.
 */
const en = {
  'share.invite.title': 'Someone shared a map with you!',
  'share.invite.titlePlace': 'Someone shared a map and a place with you!',
  'share.invite.body': 'Tap «Generate map» to get an exact copy. Enjoy the trip!',
  'share.invite.bodyPlace': 'Tap «Generate map» to get an exact copy with the place marked. The map area is locked so the place is never lost.',
  'share.invite.marking': 'Marking: {name}',
  'share.invite.cancel': 'Dismiss shared map',
  'share.invite.installCheckbox': 'Install the map app for a better experience',
  'share.invite.installInfoLabel': 'What does that mean?',
  'share.invite.installInfo': 'Installing adds the map app to your home screen so it opens full-screen and works offline. You can also do this later from the home page.',

  'picker.previewLockedHintShared': 'Preview — locked to the shared map area',
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

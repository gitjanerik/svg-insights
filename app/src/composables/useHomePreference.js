/**
 * useHomePreference — «hjem-app» (Fase 0 av suite-planen).
 *
 * Lar brukeren velge hvilken av de tre funksjonene appen åpner på ved kald
 * oppstart (PWA-launch / cold load). Default er 'portal' — den vanlige
 * forsiden der man velger hver gang.
 *
 * Selve redirigeringen skjer i en router-guard (se router.js) og gjelder
 * KUN kald oppstart til '/'. In-app-navigasjon til forsiden viser fortsatt
 * portalen, så brukeren aldri låses inne i ett spor.
 *
 * Preferansen persisteres i localStorage. `homeApp` er en modul-singleton
 * ref slik at UI (chip-velgeren i HomeView) og guarden alltid ser samme
 * verdi i samme sesjon.
 */

import { ref } from 'vue'

const STORAGE_KEY = 'svgInsights.homeApp'

/**
 * Gyldige valg → rutenavnet de peker på + kort etikett til UI.
 * 'portal' er spesiell: ingen redirect, vis vanlig forside.
 */
export const HOME_APPS = {
  portal: { route: 'home',            label: 'Forsiden' },
  draw:   { route: 'capture',         label: 'Illustrasjon' },
  kart:   { route: 'kart-hjem',       label: 'Turkart' },
  rute:   { route: 'ruteplanlegger',  label: 'Rute' },
  font:   { route: 'font-chooser',    label: 'Webfont' },
}

function read() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && HOME_APPS[v]) return v
  } catch { /* ignore — utilgjengelig storage */ }
  return 'portal'
}

// Modul-singleton: delt mellom alle som kaller useHomePreference().
const homeApp = ref(read())

export function useHomePreference() {
  function setHomeApp(key) {
    if (!HOME_APPS[key]) return
    homeApp.value = key
    try { localStorage.setItem(STORAGE_KEY, key) } catch { /* ignore */ }
  }
  return { homeApp, setHomeApp, HOME_APPS }
}

/**
 * Rutenavnet brukeren har valgt som hjem, eller null hvis 'portal' (= vis
 * forsiden). Brukes av router-guarden, som kjører utenfor komponent-kontekst.
 */
export function defaultHomeRoute() {
  const entry = HOME_APPS[homeApp.value]
  return entry && homeApp.value !== 'portal' ? entry.route : null
}

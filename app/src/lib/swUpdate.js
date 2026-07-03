import { ref } from 'vue'

// Reaktiv tilstand for «ny versjon tilgjengelig»-banneret. main.js fyller denne
// når service workeren har installert en ny, ventende versjon; App.vue viser
// banneret og kaller applyUpdate() når brukeren trykker «Oppdater».
//
// Tidligere skiftet SW-en aggressivt og reloadet siden stille (skipWaiting i
// install + auto-SKIP_WAITING). Det fungerte stort sett, men kunne 1) reloade
// midt i bruk og 2) glippe helt når appen sto åpen UNDER en deploy (nettleseren
// hadde ikke re-sjekket SW-registreringen ennå). Nå venter den nye versjonen til
// brukeren bekrefter, og main.js sjekker periodisk etter oppdateringer.
export const updateAvailable = ref(false)

let waitingWorker = null

// Kalles av main.js når en ny SW står klar (ventende) og en gammel SW fortsatt
// kontrollerer siden — altså en ekte oppdatering, ikke første installasjon.
export function setWaitingWorker(worker) {
  waitingWorker = worker
  updateAvailable.value = true
}

// Brukeren trykket «Oppdater»: be den ventende workeren ta over. Det utløser
// 'controllerchange' i main.js, som reloader siden inn i den nye bundlen.
export function applyUpdate() {
  if (waitingWorker) {
    waitingWorker.postMessage('SKIP_WAITING')
  } else {
    // Ingen referanse (sjelden race) — reload uansett. Navigasjons-fetchen er
    // network-first på index.html, så ny bundle hentes.
    window.location.reload()
  }
}

// Manuell «Se etter oppdatering» (Om-siden, v12.1.13): tving en SW-sjekk NÅ og
// rapporter utfallet, i stedet for å vente på time-intervallet/forgrunns-
// sjekken i main.js. Returnerer:
//   'update-ready' — ny versjon står klar (kall applyUpdate() for å bytte)
//   'up-to-date'   — serveren har samme versjon som den som kjører
//   'unsupported'  — ingen SW-støtte/registrering (dev-modus, http, iframe)
// MERK: GitHub Pages cacher med ~10 min HTTP-cache; rett etter en deploy kan
// 'up-to-date' derfor være noen minutter forsinket — det er server-cache, ikke
// klient-tilstand, og løses av å prøve igjen litt senere.
export async function checkForUpdateNow() {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null)
  if (!reg) return 'unsupported'
  await reg.update().catch(() => { /* nettfeil — bedøm ut fra reg-tilstanden */ })
  if (reg.waiting && navigator.serviceWorker.controller) {
    setWaitingWorker(reg.waiting)
    return 'update-ready'
  }
  // update() fant ny versjon som fortsatt installerer — vent til den lander
  // (bounded: 15 s), ellers regn som oppdatert.
  const installing = reg.installing
  if (installing) {
    const state = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(installing.state), 15000)
      installing.addEventListener('statechange', () => {
        if (installing.state !== 'installing') { clearTimeout(t); resolve(installing.state) }
      })
    })
    if (state === 'installed' && navigator.serviceWorker.controller) {
      setWaitingWorker(reg.waiting ?? installing)
      return 'update-ready'
    }
  }
  return 'up-to-date'
}

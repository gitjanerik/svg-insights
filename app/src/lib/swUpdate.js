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

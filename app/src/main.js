import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { setWaitingWorker } from './lib/swUpdate.js'

createApp(App).use(router).mount('#app')

// Register service worker for PWA / offline support. Production only — in dev
// the SW would cache stale Vite HMR bundles and make rebuilds confusing.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        // En ny SW kan allerede stå og vente før updatefound-listeneren kobles
        // på (registrerings-race). Hvis en gammel SW kontrollerer siden er det
        // en ekte oppdatering → vis banner.
        if (reg.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(reg.waiting)
        }
        // Ny versjon dukket opp under kjøring (deploy mens appen var åpen).
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing
          if (!nw) return
          nw.addEventListener('statechange', () => {
            // Ferdig installert OG en gammel SW kontrollerer siden = oppdatering
            // (ikke første installasjon). Vent på brukerens «Oppdater».
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingWorker(nw)
            }
          })
        })
        // Sjekk etter ny versjon periodisk + når appen kommer i forgrunnen, så
        // banneret dukker opp selv om appen står åpen lenge (typisk PWA på
        // mobil) — uten dette ville en deploy mens appen var åpen gått upåaktet.
        const checkForUpdate = () => { reg.update().catch(() => {}) }
        setInterval(checkForUpdate, 60 * 60 * 1000)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate()
        })
      })
      .catch(() => { /* ignore — PWA features just won't be available */ })
  })
  // Reload når den nye SW-en tar kontroll (etter at brukeren bekreftet via
  // applyUpdate() → SKIP_WAITING). Henter den nye bundlen.
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
}

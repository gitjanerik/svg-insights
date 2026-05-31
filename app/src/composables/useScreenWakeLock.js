// useScreenWakeLock.js — global skjerm-våken-state via Screen Wake Lock API.
//
// Brukes for å hindre at telefonen låser skjermen mens brukeren bruker kartet
// til orientering ute. Setting persisteres i localStorage (default: PÅ) og
// re-requestes automatisk når fanen blir synlig igjen (browseren slipper
// alltid wake-locks ved fane-bytte).
//
// Inaktivitets-timer: i stedet for å holde skjermen våken i det uendelige,
// slippes wake-locken etter `idleTimeoutMs` UTEN bruker-aktivitet, så
// telefonen kan sove og spare batteri når den legges fra seg. «enabled» blir
// værende PÅ — locken re-acquires automatisk ved neste aktivitet (poke) eller
// når fanen får fokus igjen. Aktivitet = pointerdown/touchstart/keydown/wheel
// (lyttes globalt mens modusen er aktiv); hvert event fornyer timeren.
//
// Skiller seg fra wake-lock inne i useTrackRecorder: den er kun aktiv mens
// brukeren tar opp et spor (og uten timeout — skjermen skal være våken hele
// turen); denne her er en generell visnings-modus.

import { ref, watch } from 'vue'

const STORAGE_KEY = 'svg-insights-keep-screen-awake'
const IDLE_TIMEOUT_MS = 2 * 60 * 1000   // 2 min uten aktivitet → slipp locken
const ACTIVITY_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel']

function readSetting() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === null) return true   // default PÅ
    return v === 'true'
  } catch {
    return true
  }
}

function writeSetting(value) {
  try { localStorage.setItem(STORAGE_KEY, String(value)) } catch { /* noop */ }
}

export function useScreenWakeLock({ idleTimeoutMs = IDLE_TIMEOUT_MS } = {}) {
  const enabled = ref(readSetting())
  const active = ref(false)
  const supported = typeof navigator !== 'undefined' && !!navigator.wakeLock

  let sentinel = null
  let visibilityAttached = false
  let activityAttached = false
  let idleTimer = null

  function clearIdleTimer() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  }

  // Start nedtellingen på nytt; når den løper ut slippes locken (men enabled
  // forblir PÅ, så neste poke/fokus tar den igjen).
  function armIdleTimer() {
    clearIdleTimer()
    if (idleTimeoutMs <= 0 || typeof setTimeout === 'undefined') return
    idleTimer = setTimeout(() => { idleTimer = null; void release() }, idleTimeoutMs)
  }

  async function request() {
    if (!supported || !enabled.value) return
    if (sentinel) return
    try {
      sentinel = await navigator.wakeLock.request('screen')
      active.value = true
      armIdleTimer()
      sentinel.addEventListener?.('release', () => {
        active.value = false
        sentinel = null
      })
    } catch {
      sentinel = null
      active.value = false
    }
  }

  async function release() {
    clearIdleTimer()
    if (!sentinel) {
      active.value = false
      return
    }
    try { await sentinel.release() } catch { /* noop */ }
    sentinel = null
    active.value = false
  }

  // Bruker-aktivitet: re-acquire hvis locken ble idle-sluppet, ellers forny
  // bare timeren. Billig nok til å kalles på hvert event.
  function poke() {
    if (!supported || !enabled.value) return
    if (!sentinel) void request()
    else armIdleTimer()
  }

  function onVisibilityChange() {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'visible' && enabled.value) {
      // Fokus tilbake teller som aktivitet: ta locken igjen + forny timer.
      poke()
    }
  }

  function attachVisibilityListener() {
    if (visibilityAttached || typeof document === 'undefined') return
    document.addEventListener('visibilitychange', onVisibilityChange)
    visibilityAttached = true
  }

  function detachVisibilityListener() {
    if (!visibilityAttached || typeof document === 'undefined') return
    document.removeEventListener('visibilitychange', onVisibilityChange)
    visibilityAttached = false
  }

  function attachActivityListeners() {
    if (activityAttached || typeof document === 'undefined') return
    for (const ev of ACTIVITY_EVENTS) {
      document.addEventListener(ev, poke, { passive: true })
    }
    activityAttached = true
  }

  function detachActivityListeners() {
    if (!activityAttached || typeof document === 'undefined') return
    for (const ev of ACTIVITY_EVENTS) {
      document.removeEventListener(ev, poke, { passive: true })
    }
    activityAttached = false
  }

  function setEnabled(v) {
    enabled.value = !!v
    writeSetting(enabled.value)
    if (enabled.value) {
      attachVisibilityListener()
      attachActivityListeners()
      void request()
    } else {
      void release()
      detachVisibilityListener()
      detachActivityListeners()
    }
  }

  function start() {
    if (!enabled.value) return
    attachVisibilityListener()
    attachActivityListeners()
    void request()
  }

  function stop() {
    void release()
    detachVisibilityListener()
    detachActivityListeners()
  }

  watch(enabled, (v) => writeSetting(v))

  return { enabled, active, supported, idleTimeoutMs, setEnabled, start, stop, poke }
}

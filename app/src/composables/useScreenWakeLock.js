// useScreenWakeLock.js — global skjerm-våken-state via Screen Wake Lock API.
//
// Brukes for å hindre at telefonen låser skjermen mens brukeren bruker kartet
// til orientering ute. Setting persisteres i localStorage (default: PÅ) og
// re-requestes automatisk når fanen blir synlig igjen (browseren slipper
// alltid wake-locks ved fane-bytte).
//
// Skiller seg fra wake-lock inne i useTrackRecorder: den er kun aktiv mens
// brukeren tar opp et spor; denne her er en generell visnings-modus som
// brukeren kan slå av når batteri-bruken må prioriteres.

import { ref, watch } from 'vue'

const STORAGE_KEY = 'svg-insights-keep-screen-awake'

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

export function useScreenWakeLock() {
  const enabled = ref(readSetting())
  const active = ref(false)
  const supported = typeof navigator !== 'undefined' && !!navigator.wakeLock

  let sentinel = null
  let visibilityAttached = false

  async function request() {
    if (!supported || !enabled.value) return
    if (sentinel) return
    try {
      sentinel = await navigator.wakeLock.request('screen')
      active.value = true
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
    if (!sentinel) {
      active.value = false
      return
    }
    try { await sentinel.release() } catch { /* noop */ }
    sentinel = null
    active.value = false
  }

  function onVisibilityChange() {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'visible' && enabled.value && !sentinel) {
      void request()
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

  function setEnabled(v) {
    enabled.value = !!v
    writeSetting(enabled.value)
    if (enabled.value) {
      attachVisibilityListener()
      void request()
    } else {
      void release()
      detachVisibilityListener()
    }
  }

  function start() {
    if (!enabled.value) return
    attachVisibilityListener()
    void request()
  }

  function stop() {
    void release()
    detachVisibilityListener()
  }

  watch(enabled, (v) => writeSetting(v))

  return { enabled, active, supported, setEnabled, start, stop }
}

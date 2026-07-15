import { ref, reactive, watch, onUnmounted } from 'vue'

const KEY = 'svg-insights-proximity'
const ACTIVE_KEY = 'svg-insights-proximity-active'
const TICK_MS = 2000
const NOTIF_TAG = 'proximity-alert'

const DISTANCE_OPTIONS = [50, 25, 10]

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY))
    if (raw && typeof raw === 'object') return raw
  } catch { /* private mode / korrupt */ }
  return {}
}

// Det aktive varselet persisteres i GEOGRAFISKE koordinater (lat/lon), ikke
// SVG-meter — så det overlever en reload uavhengig av at kart-metaen re-deriveres.
// MapView re-projiserer lat/lon → svgX/svgY mot gjeldende meta ved gjenoppretting.
export function getPersistedAlert() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVE_KEY))
    if (raw && typeof raw === 'object' && Number.isFinite(raw.lat) && Number.isFinite(raw.lon)) {
      return raw
    }
  } catch { /* private mode / korrupt */ }
  return null
}

function savePersistedAlert(d) {
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(d)) } catch { /* ignore */ }
}
function clearPersistedAlert() {
  try { localStorage.removeItem(ACTIVE_KEY) } catch { /* ignore */ }
}

// Ren terskel-avgjørelse — eksportert for enhetstest. Sann når posisjonen er
// innenfor radius. dist === null/NaN betyr ingen GPS-fix → aldri sann.
export function shouldFire(dist, distanceM) {
  if (dist == null || !Number.isFinite(dist)) return false
  return dist <= distanceM
}

/**
 * Nærhetsvarsel: ett aktivt varsel om gangen. Når brukerens GPS-posisjon
 * kommer innenfor valgt avstand fra et punkt, slår alarmen seg PÅ (latch) og
 * ringer kontinuerlig (lyd og/eller vibrering) til brukeren avbryter. Når
 * tillatelse er gitt vises også en vedvarende system-notification med en
 * «Avbryt»-knapp, slik at alarmen kan stoppes fra låseskjermen.
 *
 * @param {() => ({ svgX, svgY, isWatching }|null)} getUserPos
 */
export function useProximityAlert(getUserPos) {
  const prefsRaw = loadPrefs()
  const prefs = reactive({
    distanceM: DISTANCE_OPTIONS.includes(prefsRaw.distanceM) ? prefsRaw.distanceM : 10,
    sound: prefsRaw.sound !== false,
    vibration: prefsRaw.vibration !== false,
  })
  watch(prefs, () => {
    try { localStorage.setItem(KEY, JSON.stringify({ ...prefs })) } catch { /* ignore */ }
  })

  const active = ref(null)            // { svgX, svgY, lat, lon, label, distanceM, useSound, useVibration, mapId }
  const status = ref('idle')          // 'idle' | 'armed' | 'triggered'
  const currentDistanceM = ref(null)

  let timer = null
  let audioCtx = null

  // Egen, lav-volum AudioContext så ingen andre lyd-flagg kan kvele et nav-varsel.
  function playChime() {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext
      if (!Ctor) return
      if (!audioCtx) audioCtx = new Ctor()
      if (audioCtx.state === 'suspended') audioCtx.resume()
      const t0 = audioCtx.currentTime
      const tones = [
        [880, 0.0],
        [1318.5, 0.16],
      ]
      for (const [freq, off] of tones) {
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, t0 + off)
        gain.gain.setValueAtTime(0.0001, t0 + off)
        gain.gain.exponentialRampToValueAtTime(0.5, t0 + off + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.32)
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.start(t0 + off)
        osc.stop(t0 + off + 0.36)
      }
    } catch { /* lyd er ikke-essensiell */ }
  }

  // Ett ring-pass — kalles hver tick mens status === 'triggered'.
  function ringOnce() {
    const a = active.value
    if (!a) return
    if (a.useSound) playChime()
    if (a.useVibration && typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate([200, 100, 200]) } catch { /* ignore */ }
    }
  }

  // ── Notifications ────────────────────────────────────────────────────────
  function notifSupported() {
    return typeof window !== 'undefined' && 'Notification' in window &&
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  }

  function requestNotificationPermission() {
    if (!notifSupported()) return
    try {
      if (Notification.permission === 'default') Notification.requestPermission()
    } catch { /* ignore */ }
  }

  async function showAlarmNotification(label) {
    if (!notifSupported() || Notification.permission !== 'granted') return
    try {
      const reg = await navigator.serviceWorker.ready
      if (!reg || !reg.showNotification) return
      const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
      await reg.showNotification('Nærhetsvarsel', {
        body: `${label} — du er framme. Trykk Avbryt for å stoppe.`,
        tag: NOTIF_TAG,
        renotify: true,
        requireInteraction: true,
        vibrate: [300, 150, 300, 150, 300],
        icon: `${base}icon-192.png`,
        badge: `${base}icon-192.png`,
        actions: [{ action: 'avbryt', title: 'Avbryt' }],
        data: { type: 'proximity' },
      })
    } catch { /* notification er ikke-essensiell */ }
  }

  async function clearAlarmNotification() {
    if (!notifSupported()) return
    try {
      const reg = await navigator.serviceWorker.ready
      const list = await reg.getNotifications({ tag: NOTIF_TAG })
      list.forEach((n) => n.close())
    } catch { /* ignore */ }
  }

  // SW melder tilbake når brukeren trykker «Avbryt» i notification-en.
  function onSwMessage(e) {
    if (e?.data?.type === 'PROXIMITY_CANCEL') cancel()
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', onSwMessage)
  }

  function tick() {
    const a = active.value
    if (!a) return
    const pos = getUserPos?.()
    if (pos && pos.isWatching && pos.svgX != null && pos.svgY != null) {
      currentDistanceM.value = Math.hypot(a.svgX - pos.svgX, a.svgY - pos.svgY)
    } else {
      currentDistanceM.value = null
    }
    // Latch: krysser vi terskelen går alarmen PÅ og blir stående til cancel().
    if (status.value === 'armed' && shouldFire(currentDistanceM.value, a.distanceM)) {
      status.value = 'triggered'
      showAlarmNotification(a.label)
    }
    if (status.value === 'triggered') ringOnce()
  }

  function startTimer() {
    if (timer) return
    timer = setInterval(tick, TICK_MS)
  }
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null }
  }

  function arm({ svgX, svgY, lat, lon, label, distanceM, useSound, useVibration, mapId }) {
    prefs.distanceM = distanceM
    prefs.sound = useSound
    prefs.vibration = useVibration
    const safeLabel = label || 'punktet'
    active.value = {
      svgX, svgY, lat, lon,
      label: safeLabel,
      distanceM,
      useSound,
      useVibration,
      mapId,
    }
    status.value = 'armed'
    currentDistanceM.value = null
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      savePersistedAlert({ lat, lon, label: safeLabel, distanceM, useSound, useVibration, mapId })
    }
    requestNotificationPermission()
    startTimer()
    tick()
  }

  function cancel() {
    stopTimer()
    active.value = null
    status.value = 'idle'
    currentDistanceM.value = null
    clearPersistedAlert()
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(0) } catch { /* ignore */ }
    }
    clearAlarmNotification()
  }

  onUnmounted(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', onSwMessage)
    }
    cancel()
  })

  return { prefs, active, status, currentDistanceM, arm, cancel, DISTANCE_OPTIONS }
}

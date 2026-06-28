import { ref, reactive, watch, onUnmounted } from 'vue'

const KEY = 'svg-insights-proximity'
const TICK_MS = 2000

const DISTANCE_OPTIONS = [50, 25, 10]

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY))
    if (raw && typeof raw === 'object') return raw
  } catch { /* private mode / korrupt */ }
  return {}
}

// Ren terskel-avgjørelse — eksportert for enhetstest. Fyrer når posisjonen er
// innenfor radius OG vi ikke har brukt opp varslings-budsjettet (1 for «én gang»,
// 3 for «gjenta»). dist === null betyr ingen GPS-fix → aldri fyr.
export function shouldFire(dist, distanceM, firedCount, maxAlerts) {
  if (dist == null || !Number.isFinite(dist)) return false
  if (firedCount >= maxAlerts) return false
  return dist <= distanceM
}

/**
 * Nærhetsvarsel: ett aktivt varsel om gangen. Når brukerens GPS-posisjon
 * kommer innenfor valgt avstand fra et punkt, varsles det med lyd og/eller
 * vibrering. «Gjenta» pulser opp til 3 ganger totalt; «én gang» kun én.
 *
 * @param {() => ({ svgX, svgY, isWatching }|null)} getUserPos
 */
export function useProximityAlert(getUserPos) {
  const prefsRaw = loadPrefs()
  const prefs = reactive({
    distanceM: DISTANCE_OPTIONS.includes(prefsRaw.distanceM) ? prefsRaw.distanceM : 10,
    sound: prefsRaw.sound !== false,
    vibration: prefsRaw.vibration !== false,
    repeat: prefsRaw.repeat === true,
  })
  watch(prefs, () => {
    try { localStorage.setItem(KEY, JSON.stringify({ ...prefs })) } catch { /* ignore */ }
  })

  const active = ref(null)            // { svgX, svgY, label, distanceM, useSound, useVibration, maxAlerts }
  const status = ref('idle')          // 'idle' | 'armed' | 'triggered'
  const currentDistanceM = ref(null)
  const firedCount = ref(0)

  let timer = null
  let audioCtx = null

  // Egen, lav-volum AudioContext — bevisst frikoblet fra useCurveBallSound så
  // spillets mute-flagg ikke kan kvele et nav-varsel.
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

  function fire() {
    const a = active.value
    if (!a) return
    if (a.useSound) playChime()
    if (a.useVibration && typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate([200, 100, 200]) } catch { /* ignore */ }
    }
    firedCount.value += 1
    status.value = 'triggered'
  }

  function tick() {
    const a = active.value
    if (!a) return
    const pos = getUserPos?.()
    if (!pos || !pos.isWatching || pos.svgX == null || pos.svgY == null) {
      currentDistanceM.value = null
      return
    }
    const dist = Math.hypot(a.svgX - pos.svgX, a.svgY - pos.svgY)
    currentDistanceM.value = dist
    if (shouldFire(dist, a.distanceM, firedCount.value, a.maxAlerts)) fire()
  }

  function startTimer() {
    if (timer) return
    timer = setInterval(tick, TICK_MS)
  }
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null }
  }

  function arm({ svgX, svgY, label, distanceM, useSound, useVibration, repeat }) {
    prefs.distanceM = distanceM
    prefs.sound = useSound
    prefs.vibration = useVibration
    prefs.repeat = repeat
    active.value = {
      svgX, svgY,
      label: label || 'punktet',
      distanceM,
      useSound,
      useVibration,
      maxAlerts: repeat ? 3 : 1,
    }
    status.value = 'armed'
    firedCount.value = 0
    currentDistanceM.value = null
    startTimer()
    tick()
  }

  function cancel() {
    stopTimer()
    active.value = null
    status.value = 'idle'
    currentDistanceM.value = null
    firedCount.value = 0
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(0) } catch { /* ignore */ }
    }
  }

  onUnmounted(cancel)

  return { prefs, active, status, currentDistanceM, firedCount, arm, cancel, DISTANCE_OPTIONS }
}

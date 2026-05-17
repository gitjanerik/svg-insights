import { reactive, onUnmounted } from 'vue'
import { wgs84ToSvg } from '../lib/utm.js'

/**
 * GPS-posisjon konvertert til SVG-koordinater. Tar en getter for meta
 * slik at composablen kan kalles på toppnivå før kartet er lastet.
 * Returnerer et reactive objekt slik at properties auto-unwrappes i template.
 *
 * @param {() => ({minE, minN, widthM, heightM} | null)} getMeta
 */
export function useUserPosition(getMeta) {
  const state = reactive({
    svgX: null,
    svgY: null,
    latRaw: null,      // siste rapporterte WGS84-lat (for debug-readout)
    lonRaw: null,      // siste rapporterte WGS84-lon
    accuracyM: null,
    headingDeg: null,
    speedMs: null,
    error: null,
    isWatching: false,
    isOutsideMap: false,
    lastFixAt: null,    // ms (Date.now) da fix-en ble brukt
    lastFixSource: null, // 'watch' | 'poll' — for debug
    rejectedCount: 0,    // hvor mange polls vi har avvist pga dårlig accuracy
  })

  let watchId = null
  let pollTimer = null
  let lastCoords = null

  function recompute() {
    if (!lastCoords) return
    const meta = getMeta()
    if (!meta) return
    const p = wgs84ToSvg(lastCoords.latitude, lastCoords.longitude, meta)
    state.svgX = p.x
    state.svgY = p.y
    state.isOutsideMap =
      p.x < 0 || p.x > meta.widthM || p.y < 0 || p.y > meta.heightM
  }

  // v8.5.5: avvis fix-er som ville overskrive en fersk, bedre lesning.
  // Hypotese: getCurrentPosition med maximumAge:0 timer ofte ut når GPS
  // ikke svarer på 5s, og browseren returnerer wifi/celle-basert fallback
  // med 200–500 m nøyaktighet. Det ga 200–300m systematisk offset selv
  // når watchPosition leverte god GPS sekundet før.
  function shouldReject(newAccM) {
    if (state.accuracyM == null || state.lastFixAt == null) return false
    const ageMs = Date.now() - state.lastFixAt
    if (ageMs >= 10000) return false        // gammel ankerfix → alt nytt aksepteres
    if (newAccM <= state.accuracyM) return false  // nytt er like bra eller bedre
    if (newAccM <= 75) return false         // < 75m er fortsatt brukbart
    return newAccM > state.accuracyM * 1.8
  }

  function applyPos(pos, source = 'watch') {
    const c = pos.coords
    const newAcc = c.accuracy ?? Infinity
    if (shouldReject(newAcc)) {
      state.rejectedCount = (state.rejectedCount ?? 0) + 1
      return
    }
    lastCoords = { latitude: c.latitude, longitude: c.longitude }
    state.latRaw = c.latitude
    state.lonRaw = c.longitude
    state.accuracyM = Number.isFinite(newAcc) ? newAcc : null
    state.headingDeg = Number.isFinite(c.heading) ? c.heading : null
    state.speedMs = Number.isFinite(c.speed) ? c.speed : null
    state.error = null
    state.lastFixAt = Date.now()
    state.lastFixSource = source
    recompute()
  }

  function start() {
    if (!navigator.geolocation) {
      state.error = 'Nettleseren støtter ikke GPS'
      return
    }
    if (watchId !== null) return
    state.isWatching = true
    state.error = null

    watchId = navigator.geolocation.watchPosition(
      (pos) => applyPos(pos, 'watch'),
      (err) => {
        const map = {
          1: 'Du har avvist GPS-tillatelse',
          2: 'GPS-posisjon ikke tilgjengelig',
          3: 'GPS-forespørsel tok for lang tid',
        }
        state.error = map[err.code] ?? 'GPS-feil'
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    )

    // v8.5.4: Active polling for å motvirke at watchPosition throttles på
    // mobile nettlesere. På toget er watchPosition observert å henge på
    // gammel posisjon i flere minutter (= 1 km+ feil ved 60 km/t). En
    // eksplisitt getCurrentPosition hvert 3. sekund tvinger ny GPS-fix
    // og holder lastCoords ferskt selv om watchPosition ikke fyrer.
    pollTimer = setInterval(() => {
      if (!navigator.geolocation) return
      navigator.geolocation.getCurrentPosition(
        (pos) => applyPos(pos, 'poll'),
        () => { /* ignorer enkelt-feil, watchPosition fanger varige */ },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      )
    }, 3000)
  }

  // Manuell fersk-fix (one-shot) — utløst av FAB-en. Polling-loopen gir
  // automatisk friske fix-er, men brukeren kan trykke knappen for å tvinge
  // en før neste poll.
  function refresh() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => applyPos(pos, 'poll'),
      () => { /* behold forrige posisjon hvis fersk fix feiler */ },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
    )
  }

  function stop() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    state.isWatching = false
  }

  onUnmounted(stop)

  return Object.assign(state, { start, stop, recompute, refresh })
}

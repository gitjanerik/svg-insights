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
    accuracyM: null,
    headingDeg: null,
    speedMs: null,
    error: null,
    isWatching: false,
    isOutsideMap: false,
  })

  let watchId = null
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

  function start() {
    if (!navigator.geolocation) {
      state.error = 'Nettleseren støtter ikke GPS'
      return
    }
    if (watchId !== null) return
    state.isWatching = true
    state.error = null

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords
        lastCoords = { latitude: c.latitude, longitude: c.longitude }
        state.accuracyM = c.accuracy ?? null
        state.headingDeg = Number.isFinite(c.heading) ? c.heading : null
        state.speedMs = Number.isFinite(c.speed) ? c.speed : null
        state.error = null
        recompute()
      },
      (err) => {
        const map = {
          1: 'Du har avvist GPS-tillatelse',
          2: 'GPS-posisjon ikke tilgjengelig',
          3: 'GPS-forespørsel tok for lang tid',
        }
        state.error = map[err.code] ?? 'GPS-feil'
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    )
  }

  function stop() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    state.isWatching = false
  }

  onUnmounted(stop)

  return Object.assign(state, { start, stop, recompute })
}

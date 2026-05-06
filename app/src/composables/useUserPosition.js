import { ref, onUnmounted } from 'vue'
import { wgs84ToSvg } from '../lib/utm.js'

/**
 * GPS-posisjon konvertert til SVG-koordinater. Tar en getter for meta
 * slik at composablen kan kalles på toppnivå før kartet er lastet.
 * @param {() => ({minE, minN, widthM, heightM} | null)} getMeta
 */
export function useUserPosition(getMeta) {
  const svgX = ref(null)
  const svgY = ref(null)
  const accuracyM = ref(null)
  const headingDeg = ref(null)
  const speedMs = ref(null)
  const error = ref(null)
  const isWatching = ref(false)
  const isOutsideMap = ref(false)

  let watchId = null
  let lastCoords = null

  function recompute() {
    if (!lastCoords) return
    const meta = getMeta()
    if (!meta) return
    const p = wgs84ToSvg(lastCoords.latitude, lastCoords.longitude, meta)
    svgX.value = p.x
    svgY.value = p.y
    isOutsideMap.value =
      p.x < 0 || p.x > meta.widthM || p.y < 0 || p.y > meta.heightM
  }

  function start() {
    if (!navigator.geolocation) {
      error.value = 'Nettleseren støtter ikke GPS'
      return
    }
    if (watchId !== null) return
    isWatching.value = true
    error.value = null

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords
        lastCoords = { latitude: c.latitude, longitude: c.longitude }
        accuracyM.value = c.accuracy ?? null
        headingDeg.value = Number.isFinite(c.heading) ? c.heading : null
        speedMs.value = Number.isFinite(c.speed) ? c.speed : null
        error.value = null
        recompute()
      },
      (err) => {
        const map = {
          1: 'Du har avvist GPS-tillatelse',
          2: 'GPS-posisjon ikke tilgjengelig',
          3: 'GPS-forespørsel tok for lang tid',
        }
        error.value = map[err.code] ?? 'GPS-feil'
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    )
  }

  function stop() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    isWatching.value = false
  }

  onUnmounted(stop)

  return {
    svgX, svgY, accuracyM, headingDeg, speedMs,
    error, isWatching, isOutsideMap,
    start, stop, recompute,
  }
}

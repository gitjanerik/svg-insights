import { ref, onUnmounted } from 'vue'

/**
 * Kompass-retning fra DeviceOrientationEvent. iOS krever eksplisitt
 * permission via brukerklikk; Android leverer hendelser uten request.
 */
export function useCompass() {
  const headingDeg = ref(null)         // 0 = nord, 90 = øst
  const error = ref(null)
  const isActive = ref(false)
  const needsPermission = ref(
    typeof DeviceOrientationEvent !== 'undefined'
    && typeof DeviceOrientationEvent.requestPermission === 'function'
  )

  function onOrientation(e) {
    let h = null
    if (typeof e.webkitCompassHeading === 'number') {
      h = e.webkitCompassHeading                          // iOS: 0=N, vokser med klokken
    } else if (typeof e.alpha === 'number') {
      h = (360 - e.alpha) % 360                           // Android: alpha mot klokken
    }
    if (h !== null) headingDeg.value = h
  }

  async function start() {
    try {
      if (needsPermission.value) {
        const status = await DeviceOrientationEvent.requestPermission()
        if (status !== 'granted') {
          error.value = 'Kompass-tillatelse avvist'
          return
        }
      }
      const event = 'ondeviceorientationabsolute' in window
        ? 'deviceorientationabsolute'
        : 'deviceorientation'
      window.addEventListener(event, onOrientation, true)
      isActive.value = true
      error.value = null
    } catch (e) {
      error.value = e.message ?? 'Kompass utilgjengelig'
    }
  }

  function stop() {
    window.removeEventListener('deviceorientation', onOrientation, true)
    window.removeEventListener('deviceorientationabsolute', onOrientation, true)
    isActive.value = false
  }

  onUnmounted(stop)

  return { headingDeg, error, isActive, needsPermission, start, stop }
}

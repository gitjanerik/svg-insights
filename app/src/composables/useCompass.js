import { reactive, onUnmounted } from 'vue'

/**
 * Kompass-retning fra DeviceOrientationEvent. iOS krever eksplisitt
 * permission via brukerklikk; Android leverer hendelser uten request.
 * Returnerer et reactive objekt for naturlig template-binding.
 */
export function useCompass() {
  const state = reactive({
    headingDeg: null,
    error: null,
    isActive: false,
    needsPermission:
      typeof DeviceOrientationEvent !== 'undefined'
      && typeof DeviceOrientationEvent.requestPermission === 'function',
  })

  function onOrientation(e) {
    let h = null
    if (typeof e.webkitCompassHeading === 'number') {
      h = e.webkitCompassHeading
    } else if (typeof e.alpha === 'number') {
      h = (360 - e.alpha) % 360
    }
    if (h !== null) state.headingDeg = h
  }

  async function start() {
    try {
      if (state.needsPermission) {
        const status = await DeviceOrientationEvent.requestPermission()
        if (status !== 'granted') {
          state.error = 'Kompass-tillatelse avvist'
          return
        }
      }
      const event = 'ondeviceorientationabsolute' in window
        ? 'deviceorientationabsolute'
        : 'deviceorientation'
      window.addEventListener(event, onOrientation, true)
      state.isActive = true
      state.error = null
    } catch (e) {
      state.error = e.message ?? 'Kompass utilgjengelig'
    }
  }

  function stop() {
    window.removeEventListener('deviceorientation', onOrientation, true)
    window.removeEventListener('deviceorientationabsolute', onOrientation, true)
    state.isActive = false
  }

  onUnmounted(stop)

  return Object.assign(state, { start, stop })
}

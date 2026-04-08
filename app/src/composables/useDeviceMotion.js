import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Tracks device orientation (gyroscope) for parallax/perspective shifts.
 * Falls back to mouse position on desktop.
 */
export function useDeviceMotion() {
  const tiltX = ref(0) // -1 to 1
  const tiltY = ref(0) // -1 to 1
  const supported = ref(false)

  let baseAlpha = null
  let baseBeta = null

  function handleOrientation(e) {
    supported.value = true

    if (baseBeta === null) {
      baseBeta = e.beta ?? 0
      baseAlpha = e.gamma ?? 0
    }

    // Normalize to -1..1 range (±30° range)
    const rawX = ((e.gamma ?? 0) - baseAlpha) / 30
    const rawY = ((e.beta ?? 0) - baseBeta) / 30

    tiltX.value = Math.max(-1, Math.min(1, rawX))
    tiltY.value = Math.max(-1, Math.min(1, rawY))
  }

  function handleMouse(e) {
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    tiltX.value = (e.clientX - cx) / cx
    tiltY.value = (e.clientY - cy) / cy
  }

  function recalibrate() {
    baseAlpha = null
    baseBeta = null
  }

  onMounted(async () => {
    // iOS 13+ requires permission
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission()
        if (perm === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation)
          return
        }
      } catch {
        // fall through to mouse
      }
    }

    if (typeof DeviceOrientationEvent !== 'undefined') {
      window.addEventListener('deviceorientation', handleOrientation)
    }

    // Desktop fallback
    window.addEventListener('mousemove', handleMouse)
  })

  onUnmounted(() => {
    window.removeEventListener('deviceorientation', handleOrientation)
    window.removeEventListener('mousemove', handleMouse)
  })

  return { tiltX, tiltY, supported, recalibrate }
}

import { ref } from 'vue'

// Logger DeviceMotion- og DeviceOrientation-eventer med timestamps slik at vi
// senere kan integrere rotasjon (gyro) og finne tyngdekraft-retning. Lar
// videoframer og IMU-samples kobles via felles tids-basis (performance.now()).

export function useMotionRecorder() {
  const isRecording = ref(false)
  const supported = ref(false)
  const samples = ref([])
  const permissionState = ref('unknown') // 'granted' | 'denied' | 'unsupported' | 'unknown'

  let startTimestamp = 0
  let onMotion = null
  let onOrientation = null

  async function requestPermission() {
    // iOS 13+ krever eksplisitt brukergeste
    const motionPerm = typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    const orientPerm = typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'

    if (!motionPerm && !orientPerm) {
      // Android/desktop: ikke nødvendig med eksplisitt permission
      supported.value = typeof DeviceMotionEvent !== 'undefined'
      permissionState.value = supported.value ? 'granted' : 'unsupported'
      return supported.value
    }

    try {
      const results = await Promise.all([
        motionPerm ? DeviceMotionEvent.requestPermission() : Promise.resolve('granted'),
        orientPerm ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted'),
      ])
      const ok = results.every(r => r === 'granted')
      supported.value = ok
      permissionState.value = ok ? 'granted' : 'denied'
      return ok
    } catch {
      permissionState.value = 'denied'
      return false
    }
  }

  function start() {
    samples.value = []
    startTimestamp = performance.now()
    isRecording.value = true

    onMotion = (e) => {
      if (!isRecording.value) return
      const t = performance.now() - startTimestamp
      const acc = e.accelerationIncludingGravity || e.acceleration || {}
      const rot = e.rotationRate || {}
      samples.value.push({
        kind: 'motion',
        t,
        ax: acc.x ?? 0,
        ay: acc.y ?? 0,
        az: acc.z ?? 0,
        // rotationRate er i deg/s — konverter til rad/s nedstrøms
        gx: rot.alpha ?? 0,
        gy: rot.beta ?? 0,
        gz: rot.gamma ?? 0,
      })
    }

    onOrientation = (e) => {
      if (!isRecording.value) return
      const t = performance.now() - startTimestamp
      samples.value.push({
        kind: 'orientation',
        t,
        alpha: e.alpha ?? 0,
        beta: e.beta ?? 0,
        gamma: e.gamma ?? 0,
      })
    }

    window.addEventListener('devicemotion', onMotion)
    window.addEventListener('deviceorientation', onOrientation)
  }

  function stop() {
    isRecording.value = false
    if (onMotion) window.removeEventListener('devicemotion', onMotion)
    if (onOrientation) window.removeEventListener('deviceorientation', onOrientation)
    onMotion = null
    onOrientation = null
    return samples.value
  }

  return {
    isRecording,
    supported,
    samples,
    permissionState,
    requestPermission,
    start,
    stop,
  }
}

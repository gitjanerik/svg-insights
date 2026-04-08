import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Multi-touch pinch-to-zoom and pan for an element.
 * Returns reactive transform values.
 */
export function usePinchZoom(elementRef) {
  const scale = ref(1)
  const translateX = ref(0)
  const translateY = ref(0)

  let lastDist = 0
  let lastCenterX = 0
  let lastCenterY = 0
  let isPinching = false
  let isPanning = false
  let startX = 0
  let startY = 0

  function dist(t1, t2) {
    const dx = t1.clientX - t2.clientX
    const dy = t1.clientY - t2.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  function center(t1, t2) {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    }
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      isPinching = true
      isPanning = false
      lastDist = dist(e.touches[0], e.touches[1])
      const c = center(e.touches[0], e.touches[1])
      lastCenterX = c.x
      lastCenterY = c.y
    } else if (e.touches.length === 1 && scale.value > 1) {
      isPanning = true
      startX = e.touches[0].clientX - translateX.value
      startY = e.touches[0].clientY - translateY.value
    }
  }

  function onTouchMove(e) {
    if (isPinching && e.touches.length === 2) {
      e.preventDefault()
      const d = dist(e.touches[0], e.touches[1])
      const ratio = d / lastDist
      scale.value = Math.max(0.5, Math.min(8, scale.value * ratio))
      lastDist = d

      const c = center(e.touches[0], e.touches[1])
      translateX.value += c.x - lastCenterX
      translateY.value += c.y - lastCenterY
      lastCenterX = c.x
      lastCenterY = c.y
    } else if (isPanning && e.touches.length === 1) {
      e.preventDefault()
      translateX.value = e.touches[0].clientX - startX
      translateY.value = e.touches[0].clientY - startY
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) isPinching = false
    if (e.touches.length < 1) isPanning = false
  }

  // Desktop: scroll to zoom
  function onWheel(e) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    scale.value = Math.max(0.5, Math.min(8, scale.value * delta))
  }

  function reset() {
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
  }

  onMounted(() => {
    const el = elementRef.value
    if (!el) return
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('wheel', onWheel, { passive: false })
  })

  onUnmounted(() => {
    const el = elementRef.value
    if (!el) return
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('wheel', onWheel)
  })

  return { scale, translateX, translateY, reset }
}

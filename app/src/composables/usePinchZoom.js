import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Multi-touch pinch-to-zoom + pan + double-tap-to-zoom-on-point.
 *
 * v6.9.0-polish: pinch zoomer rundt finger-senter (tidligere zoomet rundt
 * elementets midt = uvant for brukeren), wheel zoomer rundt mus-pos, og
 * dobbeltklikk/dobbel-tap zoomer 2x på treffpunkt med kort transition.
 */
export function usePinchZoom(elementRef) {
  const scale = ref(1)
  const translateX = ref(0)
  const translateY = ref(0)
  // Rotasjon kun via to-finger-pinch (mobil). Desktop får ikke rotasjon
  // siden det krever multi-touch-input som ikke finnes på mus.
  const rotation = ref(0)  // grader, 0 = ikke rotert
  const animating = ref(false)

  const MIN_SCALE = 0.5
  const MAX_SCALE = 20

  let lastDist = 0
  let lastAngle = 0
  let lastCenterX = 0
  let lastCenterY = 0
  let isPinching = false
  let isPanning = false
  let startX = 0
  let startY = 0
  let lastTapAt = 0
  let lastTapX = 0
  let lastTapY = 0
  let animTimer = null

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

  function angle(t1, t2) {
    return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI
  }

  // Zoom rundt et fokuspunkt (fx, fy) i client-koord, så punktet
  // forblir under fingeren mens skalaen endres.
  function zoomAtPoint(newScale, fx, fy) {
    const el = elementRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    // Posisjon i element-rom (uten transform): client - rect.origin - translate
    const localX = fx - rect.left - translateX.value
    const localY = fy - rect.top - translateY.value
    const ratio = newScale / scale.value
    // Etter zoom skal local punkt fortsatt være under (fx, fy)
    translateX.value = fx - rect.left - localX * ratio
    translateY.value = fy - rect.top - localY * ratio
    scale.value = newScale
  }

  function clampScale(s) {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))
  }

  function animate() {
    animating.value = true
    if (animTimer) clearTimeout(animTimer)
    animTimer = setTimeout(() => { animating.value = false }, 220)
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      isPinching = true
      isPanning = false
      lastDist = dist(e.touches[0], e.touches[1])
      lastAngle = angle(e.touches[0], e.touches[1])
      const c = center(e.touches[0], e.touches[1])
      lastCenterX = c.x
      lastCenterY = c.y
    } else if (e.touches.length === 1) {
      // Double-tap detection
      const now = Date.now()
      const t = e.touches[0]
      const dx = t.clientX - lastTapX
      const dy = t.clientY - lastTapY
      const within = Math.hypot(dx, dy) < 40
      if (now - lastTapAt < 300 && within) {
        // Doubble-tap: zoom 2x mot tap-punkt, eller reset hvis allerede zoomet
        if (scale.value >= 15.9) {
          // Allerede zoomet inn → reset
          animate()
          scale.value = 1
          translateX.value = 0
          translateY.value = 0
        } else {
          animate()
          zoomAtPoint(clampScale(scale.value * 2), t.clientX, t.clientY)
        }
        lastTapAt = 0
        return
      }
      lastTapAt = now
      lastTapX = t.clientX
      lastTapY = t.clientY
      if (scale.value > 1) {
        isPanning = true
        startX = t.clientX - translateX.value
        startY = t.clientY - translateY.value
      }
    }
  }

  function onTouchMove(e) {
    if (isPinching && e.touches.length === 2) {
      e.preventDefault()
      const d = dist(e.touches[0], e.touches[1])
      const ratio = d / lastDist
      const c = center(e.touches[0], e.touches[1])
      // Zoom rundt finger-senter
      const newScale = clampScale(scale.value * ratio)
      zoomAtPoint(newScale, c.x, c.y)
      // Pan med center-bevegelse mellom frames
      translateX.value += c.x - lastCenterX
      translateY.value += c.y - lastCenterY
      // Rotasjon: differanse i finger-vinkel akkumuleres. Bruker en liten
      // dødsone (1.5°) for å unngå skjelving fra to-finger-zoom uten rotasjon.
      const a = angle(e.touches[0], e.touches[1])
      let dAngle = a - lastAngle
      if (dAngle > 180) dAngle -= 360
      else if (dAngle < -180) dAngle += 360
      if (Math.abs(dAngle) > 1.5) {
        rotation.value += dAngle
      }
      lastDist = d
      lastAngle = a
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

  // Desktop: scroll to zoom rundt mus-pos
  function onWheel(e) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    zoomAtPoint(clampScale(scale.value * delta), e.clientX, e.clientY)
  }

  // Desktop: dobbeltklikk = double-tap-ekvivalent
  function onDblClick(e) {
    e.preventDefault()
    if (scale.value >= 15.9) {
      animate()
      scale.value = 1
      translateX.value = 0
      translateY.value = 0
    } else {
      animate()
      zoomAtPoint(clampScale(scale.value * 2), e.clientX, e.clientY)
    }
  }

  function reset() {
    animate()
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
    rotation.value = 0
  }

  onMounted(() => {
    const el = elementRef.value
    if (!el) return
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('dblclick', onDblClick)
  })

  onUnmounted(() => {
    const el = elementRef.value
    if (!el) return
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('dblclick', onDblClick)
    if (animTimer) clearTimeout(animTimer)
  })

  // Programmatisk zoom rundt sentrum av elementet (brukes av FAB-knapper).
  function zoomBy(factor) {
    const el = elementRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    animate()
    zoomAtPoint(clampScale(scale.value * factor), rect.left + rect.width / 2, rect.top + rect.height / 2)
  }
  function zoomIn() { zoomBy(1.5) }
  function zoomOut() { zoomBy(1 / 1.5) }

  return { scale, translateX, translateY, rotation, reset, zoomIn, zoomOut, animating }
}

import { ref, unref, onMounted, onUnmounted } from 'vue'

/**
 * Multi-touch pinch-to-zoom + pan + rotate + double-tap-to-zoom-on-point.
 *
 * State {translateX, translateY, scale, rotation} representerer den unified
 * transformen M = T(tx,ty) ∘ R(rotation) ∘ S(scale) med transform-origin (0,0).
 * Konsumenten skal applisere transformen på ÉN element:
 *   transform: translate(tx,ty) rotate(rot deg) scale(s)
 *   transform-origin: 0 0
 *
 * Det er kritisk å bruke en enkelt unified transform — to nested transformer
 * (én for translate+scale, én for rotate rundt center) gjør at rotasjon
 * alltid sentrerer på elementets midt. Med unified matrix kan vi rotere
 * rundt vilkårlig finger-pivot ved å oppdatere translate, scale OG rotation
 * samtidig (v8.9.2).
 *
 * options.enabled (ref|computed|bool) — handlere skipper input når false.
 * options.rotateEnabled (default true) — sett false for å fryse rotasjon
 *   (brukes i ViewerView som ikke har rotasjons-UI).
 */
export function usePinchZoom(elementRef, options = {}) {
  const enabledOpt = options.enabled
  const rotateEnabled = options.rotateEnabled !== false
  function isEnabled() {
    return enabledOpt == null ? true : !!unref(enabledOpt)
  }

  const scale = ref(1)
  const translateX = ref(0)
  const translateY = ref(0)
  const rotation = ref(0)  // grader, 0 = ikke rotert
  const animating = ref(false)
  // isGesturing: true mens brukeren pinch-zoomer, panorerer eller wheel-zoomer.
  // Brukes av MapView for å midlertidig slå av kostbare CSS-effekter
  // (vector-effect: non-scaling-stroke) under gesten — strokene re-tessellerer
  // ikke per frame, og snapper tilbake til riktig bredde når gesten slutter.
  const isGesturing = ref(false)
  let wheelEndTimer = null

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

  function clampScale(s) {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))
  }

  /**
   * Påfør combined delta-transform M_delta = T(c1) ∘ R(dr) ∘ S(ds) ∘ T(-c0)
   * på state-en. M_old: T(tx,ty) R(rot) S(scale). Resultat:
   *   new_tx = c1.x + ds*((tx-c0.x)*cos(dr) - (ty-c0.y)*sin(dr))
   *   new_ty = c1.y + ds*((tx-c0.x)*sin(dr) + (ty-c0.y)*cos(dr))
   *   new_scale = scale * ds   (clampet)
   *   new_rotation = rotation + dr
   * c0/c1 i samme client-koord-rom som translateX/Y.
   */
  function applyDelta(c0, c1, ds, dr) {
    const oldScale = scale.value
    const newScale = clampScale(oldScale * ds)
    const effDs = oldScale === 0 ? 1 : newScale / oldScale
    const drRad = dr * Math.PI / 180
    const cosDr = Math.cos(drRad)
    const sinDr = Math.sin(drRad)
    const ox = translateX.value - c0.x
    const oy = translateY.value - c0.y
    const rotOx = ox * cosDr - oy * sinDr
    const rotOy = ox * sinDr + oy * cosDr
    translateX.value = c1.x + effDs * rotOx
    translateY.value = c1.y + effDs * rotOy
    scale.value = newScale
    if (rotateEnabled) rotation.value += dr
  }

  // Zoom rundt et fokuspunkt (fx, fy) i client-koord — single-point variant
  // (dr=0). Brukes av wheel / double-tap / programmatiske FAB-er.
  function zoomAtPoint(newScale, fx, fy) {
    const target = clampScale(newScale)
    const ds = scale.value === 0 ? 1 : target / scale.value
    const c = { x: fx, y: fy }
    applyDelta(c, c, ds, 0)
  }

  function animate() {
    animating.value = true
    if (animTimer) clearTimeout(animTimer)
    animTimer = setTimeout(() => { animating.value = false }, 220)
  }

  function onTouchStart(e) {
    if (!isEnabled()) return
    if (e.touches.length === 2) {
      isPinching = true
      isPanning = false
      isGesturing.value = true
      lastDist = dist(e.touches[0], e.touches[1])
      lastAngle = angle(e.touches[0], e.touches[1])
      const c = center(e.touches[0], e.touches[1])
      lastCenterX = c.x
      lastCenterY = c.y
    } else if (e.touches.length === 1) {
      const now = Date.now()
      const t = e.touches[0]
      const dx = t.clientX - lastTapX
      const dy = t.clientY - lastTapY
      const within = Math.hypot(dx, dy) < 40
      if (now - lastTapAt < 300 && within) {
        if (scale.value >= 15.9) {
          // Allerede zoomet inn → full reset (også rotasjon, så bruker
          // får et rent uvridd kart som referansepunkt)
          animate()
          scale.value = 1
          translateX.value = 0
          translateY.value = 0
          rotation.value = 0
        } else {
          animate()
          zoomAtPoint(scale.value * 2, t.clientX, t.clientY)
        }
        lastTapAt = 0
        return
      }
      lastTapAt = now
      lastTapX = t.clientX
      lastTapY = t.clientY
      if (scale.value > 1 || rotation.value !== 0) {
        // Pan fungerer som rent translate (rotasjon og skala uendret)
        isPanning = true
        isGesturing.value = true
        startX = t.clientX - translateX.value
        startY = t.clientY - translateY.value
      }
    }
  }

  function onTouchMove(e) {
    if (!isEnabled()) return
    if (isPinching && e.touches.length === 2) {
      e.preventDefault()
      const d = dist(e.touches[0], e.touches[1])
      const a = angle(e.touches[0], e.touches[1])
      const c = center(e.touches[0], e.touches[1])
      const ds = lastDist === 0 ? 1 : d / lastDist
      // Rotasjons-delta med wraparound + dødsone (1.5°) mot skjelving
      let dAngle = a - lastAngle
      if (dAngle > 180) dAngle -= 360
      else if (dAngle < -180) dAngle += 360
      const dr = rotateEnabled && Math.abs(dAngle) > 1.5 ? dAngle : 0
      applyDelta(
        { x: lastCenterX, y: lastCenterY },
        { x: c.x, y: c.y },
        ds, dr,
      )
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
    if (!isPinching && !isPanning) isGesturing.value = false
  }

  function onWheel(e) {
    if (!isEnabled()) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    zoomAtPoint(scale.value * delta, e.clientX, e.clientY)
    // Wheel mangler en explicit "slutt"-event så vi debouncer til 200ms etter
    // siste tick. Verdt det: under en lang wheel-spin spares tusenvis av
    // re-tessellate-passes.
    isGesturing.value = true
    if (wheelEndTimer) clearTimeout(wheelEndTimer)
    wheelEndTimer = setTimeout(() => { isGesturing.value = false }, 200)
  }

  function onDblClick(e) {
    if (!isEnabled()) return
    e.preventDefault()
    if (scale.value >= 15.9) {
      animate()
      scale.value = 1
      translateX.value = 0
      translateY.value = 0
      rotation.value = 0
    } else {
      animate()
      zoomAtPoint(scale.value * 2, e.clientX, e.clientY)
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
    if (wheelEndTimer) clearTimeout(wheelEndTimer)
  })

  function zoomBy(factor) {
    const el = elementRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    animate()
    zoomAtPoint(scale.value * factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }
  function zoomIn() { zoomBy(1.5) }
  function zoomOut() { zoomBy(1 / 1.5) }

  /**
   * Panorer + skaler så viewBox-punktet (vbX, vbY) ender midt i wrapperen.
   * Brukes av søke-flowen for å sentrere på et stedsnavn-treff. Resetter
   * rotasjon til 0 (enklere matte, og brukeren forventer at «kart-nord opp»
   * etter et søk).
   *
   * Forutsetninger:
   *   - SVG-en inne i wrapperen bruker preserveAspectRatio="xMidYMid meet"
   *     med samme viewBox-bredde/-høyde som overført her
   *   - Unified transform M = T(tx,ty) ∘ R(rot) ∘ S(s) påføres ÉN node inni
   *     wrapperen (slik som i MapView)
   */
  function panTo(vbX, vbY, { vbWidth, vbHeight, targetScale = scale.value } = {}) {
    const el = elementRef.value
    if (!el || !vbWidth || !vbHeight) return
    const r = el.getBoundingClientRect()
    const w = r.width
    const h = r.height
    if (!w || !h) return
    const fit = Math.min(w / vbWidth, h / vbHeight)
    const offsetX = (w - vbWidth * fit) / 2
    const offsetY = (h - vbHeight * fit) / 2
    const px = offsetX + vbX * fit
    const py = offsetY + vbY * fit
    const s = clampScale(targetScale)
    animate()
    scale.value = s
    rotation.value = 0
    translateX.value = w / 2 - s * px
    translateY.value = h / 2 - s * py
  }

  return { scale, translateX, translateY, rotation, reset, zoomIn, zoomOut, panTo, animating, isGesturing }
}

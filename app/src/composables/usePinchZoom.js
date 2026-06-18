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
 * options.panAtRest (default false) — tillat én-finger-pan også ved scale=1 og
 *   rotasjon=0 (default «hvile»). MapView slår dette på så kartet kan dras rundt
 *   i et canvas-rom selv ved nullstilt zoom; ViewerView lar det stå av.
 */
export function usePinchZoom(elementRef, options = {}) {
  const enabledOpt = options.enabled
  const rotateEnabled = options.rotateEnabled !== false
  const panAtRest = options.panAtRest === true
  // options.minScale (number | ref | () => number) — dynamisk zoom-ut-gulv. Lar
  // konsumenten senke gulvet så hele en mosaikk kan zoomes ut til (se MapView).
  // Faller tilbake til MIN_SCALE når ikke satt / ugyldig.
  const minScaleOpt = options.minScale
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
  // v9.1.19: hevet maks-zoom fra 20 → 60 så man kan zoome helt inn på
  // detaljer (stedsnavn, dybdetall, kompliserte stikryss). Dobbel-tapp
  // dobler (×2) til man passerer DOUBLE_TAP_RESET, da nullstilles zoom.
  const MAX_SCALE = 60
  const DOUBLE_TAP_RESET = 45

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
  // Mus-pan (desktop uten touch): venstre-knapp-dra panorerer. Vi starter ikke
  // pan før fingeren/musa har flyttet seg forbi en liten terskel, så et rent
  // klikk (annotering, long-press-meny, POI-tap) går uberørt gjennom.
  let isMouseDown = false
  let mouseMoved = false
  let mouseDownX = 0
  let mouseDownY = 0
  let panStartTX = 0
  let panStartTY = 0
  const MOUSE_PAN_THRESHOLD = 4

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
    let v
    try { v = typeof minScaleOpt === 'function' ? minScaleOpt() : unref(minScaleOpt) } catch { v = undefined }
    const min = (typeof v === 'number' && v > 0) ? Math.min(v, MAX_SCALE) : MIN_SCALE
    return Math.max(min, Math.min(MAX_SCALE, s))
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
        if (scale.value >= DOUBLE_TAP_RESET) {
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
      if (panAtRest || scale.value > 1 || rotation.value !== 0) {
        // Pan fungerer som rent translate (rotasjon og skala uendret). Ved
        // panAtRest tillates det også i hvile (scale=1, rot=0) — en stillestående
        // tap beveger ingenting, så tap/long-press påvirkes ikke.
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
    if (scale.value >= DOUBLE_TAP_RESET) {
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

  // Mus-pan: kun venstre knapp, og kun når pan er tillatt (samme regel som
  // touch: panAtRest, eller innzoomet, eller rotert). Lytterne for move/up
  // ligger på window så draget fortsetter også utenfor elementet.
  function onMouseDown(e) {
    if (!isEnabled() || e.button !== 0) return
    if (isPinching || isPanning) return
    if (!(panAtRest || scale.value > 1 || rotation.value !== 0)) return
    isMouseDown = true
    mouseMoved = false
    mouseDownX = e.clientX
    mouseDownY = e.clientY
    panStartTX = translateX.value
    panStartTY = translateY.value
  }

  function onMouseMove(e) {
    if (!isMouseDown) return
    const dx = e.clientX - mouseDownX
    const dy = e.clientY - mouseDownY
    if (!mouseMoved && Math.hypot(dx, dy) < MOUSE_PAN_THRESHOLD) return
    mouseMoved = true
    isGesturing.value = true
    translateX.value = panStartTX + dx
    translateY.value = panStartTY + dy
  }

  function onMouseUp() {
    if (!isMouseDown) return
    isMouseDown = false
    if (!isPinching && !isPanning) isGesturing.value = false
  }

  // Roter kartet til en absolutt vinkel (grader) rundt elementets SENTER. Brukes
  // av desktop-rotasjons-slideren (touch bruker to-finger-rotasjon). Pivot =
  // viewport-senter (ikke transform-origin 0,0) så kartet ikke svinger ut av syne.
  function rotateTo(deg) {
    const el = elementRef.value
    if (!el || !rotateEnabled) return
    const r = el.getBoundingClientRect()
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    applyDelta(c, c, 1, deg - rotation.value)
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
    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  })

  onUnmounted(() => {
    const el = elementRef.value
    if (el) {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('dblclick', onDblClick)
      el.removeEventListener('mousedown', onMouseDown)
    }
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
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
   * Panorer + skaler så viewBox-punktet (vbX, vbY) ender på et fokuspunkt i
   * wrapperen. Brukes av søke-flowen for å sentrere på et stedsnavn-treff, og
   * av long-press-menyen for å «into-focuse» punktet inn i det synlige kart-
   * arealet over bottom-sheeten.
   *
   * Standard: fokus = wrapper-senter, rotasjon nullstilles til 0 (enklere
   * matte, og brukeren forventer «kart-nord opp» etter et søk).
   *
   * Options:
   *   - focusX / focusY (wrapper-lokale px) — hvor punktet skal lande.
   *     Default wrapper-senter (w/2, h/2).
   *   - keepRotation (bool) — behold gjeldende rotasjon i stedet for å
   *     nullstille. Da brukes full rotasjons-matte for å plassere punktet.
   *
   * Forutsetninger:
   *   - SVG-en inne i wrapperen bruker preserveAspectRatio="xMidYMid meet"
   *     med samme viewBox-bredde/-høyde som overført her
   *   - Unified transform M = T(tx,ty) ∘ R(rot) ∘ S(s) påføres ÉN node inni
   *     wrapperen (slik som i MapView)
   */
  function panTo(vbX, vbY, { vbWidth, vbHeight, targetScale = scale.value, focusX, focusY, keepRotation = false } = {}) {
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
    const fx = focusX != null ? focusX : w / 2
    const fy = focusY != null ? focusY : h / 2
    animate()
    scale.value = s
    if (!keepRotation) rotation.value = 0
    // M(px,py) = T(tx,ty) + R(rot)·S(s)·(px,py). Løs for tx,ty så punktet
    // lander på (fx,fy). Ved keepRotation=false er rot=0 → cos=1,sin=0 og
    // dette degenererer til den enkle translate-formelen (bakoverkompatibelt).
    const rot = rotation.value * Math.PI / 180
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    translateX.value = fx - s * (px * cos - py * sin)
    translateY.value = fy - s * (px * sin + py * cos)
  }

  return { scale, translateX, translateY, rotation, reset, zoomIn, zoomOut, panTo, rotateTo, animating, isGesturing }
}

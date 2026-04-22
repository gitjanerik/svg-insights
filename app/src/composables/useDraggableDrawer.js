/**
 * useDraggableDrawer — mobile bottom panel with drag-to-minimize.
 *
 * The drawer has two stable snap points: expanded (≈50% of viewport height)
 * and minimized (just tall enough for the handle + tab bar to peek above the
 * safe area). The user can drag the handle to move continuously between the
 * two; if they release without clearing the 1/3 threshold, the magnet pulls
 * the panel back to its original state.
 *
 * This composable owns:
 *   - translate (in pixels, 0 at expanded, positive values push it down)
 *   - isMinimized state
 *   - drag event handlers you attach to the handle
 *   - handleOpacity: fades the handle in/out based on drag progress
 *
 * It does NOT know anything about the drawer's actual content height, colour
 * or tab bar — the caller wires those up.
 */

import { ref, reactive, computed, onBeforeUnmount } from 'vue'

export function useDraggableDrawer({
  expandedHeight = 0.45,  // fraction of viewport height when expanded
  minimizedPeek = 28,     // px of the handle strip still visible when minimized
  snapThreshold = 1 / 3,  // magnet: release < this fraction snaps back
  springMs = 220,         // snap animation duration
} = {}) {
  // translateY in pixels. 0 = expanded position; positive = pushed down.
  const translateY = ref(0)
  const isMinimized = ref(false)
  const isDragging = ref(false)

  // Current full drag range: from expanded (0) to minimized (expandedPx - peek)
  const dragRangePx = ref(0)
  // Full expanded drawer height in pixels (for callers that need to know
  // how much vertical space the drawer occupies right now).
  const expandedPx = ref(0)

  // Drag state
  const drag = reactive({
    startY: 0,
    startTranslate: 0,
    startedMinimized: false,
  })

  // Compute the effective drag range based on viewport
  function computeRange() {
    const vh = window.innerHeight || 800
    expandedPx.value = Math.max(minimizedPeek + 100, vh * expandedHeight)
    dragRangePx.value = expandedPx.value - minimizedPeek
  }
  computeRange()
  window.addEventListener('resize', computeRange, { passive: true })
  onBeforeUnmount(() => window.removeEventListener('resize', computeRange))

  // Progress in [0, 1] — 0 at expanded, 1 at minimized
  const progress = computed(() => {
    if (dragRangePx.value <= 0) return 0
    return Math.max(0, Math.min(1, translateY.value / dragRangePx.value))
  })

  // How many px of drawer are currently visible above the bottom of the
  // viewport. Callers use this to position floating buttons above the drawer
  // and to expand the SVG canvas when the drawer is (partially) minimized.
  const visibleHeightPx = computed(() => {
    return Math.max(0, expandedPx.value - translateY.value)
  })

  // Handle opacity fades as the drawer approaches the "other" snap point —
  // feels natural: grip is solid when you're at rest, ghosts out mid-drag.
  const handleOpacity = computed(() => {
    // Full opacity at both endpoints, slightly reduced in the middle
    const p = progress.value
    return 0.5 + 0.5 * Math.abs(p - 0.5) * 2
  })

  // Inline transform style for the drawer root element. No transition while
  // dragging (would fight the finger), smooth snap-spring otherwise.
  const drawerStyle = computed(() => ({
    transform: `translateY(${translateY.value}px)`,
    transition: isDragging.value ? 'none' : `transform ${springMs}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
  }))

  // ── Drag handlers ─────────────────────────────────────────────────────

  function onPointerDown(e) {
    isDragging.value = true
    drag.startY = e.clientY ?? e.touches?.[0]?.clientY ?? 0
    drag.startTranslate = translateY.value
    drag.startedMinimized = isMinimized.value
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch {}
    e.preventDefault()
  }

  function onPointerMove(e) {
    if (!isDragging.value) return
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0
    const dy = y - drag.startY
    // Clamp within [0, dragRangePx]
    translateY.value = Math.max(
      0,
      Math.min(dragRangePx.value, drag.startTranslate + dy)
    )
  }

  function onPointerUp() {
    if (!isDragging.value) return
    isDragging.value = false

    // Magnet: did the user move more than `snapThreshold` of the full range
    // AWAY from their starting snap point? If yes, commit; otherwise snap back.
    const travelled = Math.abs(translateY.value - drag.startTranslate)
    const TAP_THRESHOLD = 4 // px — below this is a tap, not a drag
    if (travelled < TAP_THRESHOLD) {
      // Tap without movement → toggle snap state
      setMinimized(!drag.startedMinimized)
      return
    }
    const committed = travelled > dragRangePx.value * snapThreshold
    if (committed) {
      setMinimized(!drag.startedMinimized)
    } else {
      setMinimized(drag.startedMinimized)
    }
  }

  function setMinimized(min) {
    isMinimized.value = min
    translateY.value = min ? dragRangePx.value : 0
  }

  // Convenience toggle — bind to the handle's tap gesture
  function toggle() { setMinimized(!isMinimized.value) }

  // When the drawer is unmounted (panel closed) reset to expanded so the
  // next mount starts in a known state.
  function reset() {
    translateY.value = 0
    isMinimized.value = false
    isDragging.value = false
  }

  return {
    translateY,
    progress,
    isMinimized,
    isDragging,
    dragRangePx,
    expandedPx,
    visibleHeightPx,
    drawerStyle,
    handleOpacity,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    setMinimized,
    toggle,
    reset,
  }
}

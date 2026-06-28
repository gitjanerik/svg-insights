/**
 * useDraggableDrawer — mobile bottom panel with drag-to-resize snap points.
 *
 * The drawer has up to three stable snap points: expanded (≈45% of viewport
 * height, the default), optionally maximized (≈85%, dragged up via the handle)
 * and optionally minimized (just tall enough for the handle to peek above the
 * safe area, dragged down). The user drags the handle continuously between the
 * available snaps; on release it lands on whichever snap point is nearest.
 *
 * This composable owns:
 *   - translate (in pixels; 0 at expanded, positive pushes down toward
 *     minimized, negative pulls up toward maximized)
 *   - isMinimized / isMaximized state
 *   - drag event handlers you attach to the handle
 *   - handleOpacity: fades the handle in/out based on drag progress
 *
 * It does NOT know anything about the drawer's actual content height, colour
 * or tab bar — the caller wires those up.
 *
 * Backwards compatible: callers that pass no `maxHeight` get the original
 * two-state behaviour (expanded ↔ minimized) unchanged.
 */

import { ref, reactive, computed, onBeforeUnmount } from 'vue'

// Retnings-basert snap-valg. I stedet for å lande på nærmeste snap (krever drag
// forbi 50 %-midtpunktet) committer vi til neste snap i dra-retningen så snart
// `commitFraction` av gapet dit er passert — lettere å bytte størrelse. Posisjons-
// basert (ikke akkumulert travel): et fullt drag forbi et snap lander alltid på
// (minst) det snap-et. Ren funksjon → enhetstestbar.
export function pickSnapTarget(translateY, startTranslate, snapPoints, commitFraction = 0.25) {
  if (!snapPoints || snapPoints.length === 0) return startTranslate
  // fromSnap = snap-et vi startet draget fra (nærmeste til startTranslate).
  let fromSnap = snapPoints[0]
  let bestD = Infinity
  for (const p of snapPoints) {
    const d = Math.abs(startTranslate - p)
    if (d < bestD) { bestD = d; fromSnap = p }
  }
  const delta = translateY - fromSnap
  if (delta === 0) return fromSnap
  const dir = delta < 0 ? -1 : 1
  // Snaps strengt forbi fromSnap i dra-retningen, nærmest først.
  const ordered = snapPoints
    .filter((p) => (dir < 0 ? p < fromSnap : p > fromSnap))
    .sort((a, b) => (dir < 0 ? b - a : a - b))
  let target = fromSnap
  let prev = fromSnap
  for (const s of ordered) {
    const boundary = prev + dir * commitFraction * Math.abs(s - prev)
    const passed = dir < 0 ? translateY <= boundary : translateY >= boundary
    if (!passed) break
    target = s
    prev = s
  }
  return target
}

export function useDraggableDrawer({
  expandedHeight = 0.45,  // fraction of viewport height when expanded (default)
  minimizedPeek = 28,     // px of the handle strip still visible when minimized
  maxHeight = null,       // fraction of viewport height when maximized (null = no maximize snap)
  maxTopGapPx = null,     // px of map left visible at the top when maximized (overrides maxHeight)
  allowMinimize = true,   // whether the drawer can be dragged down to the peek
  commitFraction = 0.25,  // fraction of the gap toward the next snap before it commits
  springMs = 220,         // snap animation duration
} = {}) {
  // translateY in pixels. 0 = expanded position; positive = pushed down
  // (toward minimized); negative = pulled up (toward maximized).
  const translateY = ref(0)
  const isMinimized = ref(false)
  const isMaximized = ref(false)
  const isDragging = ref(false)

  // Drag range downward: from expanded (0) to minimized (expandedPx - peek)
  const dragRangePx = ref(0)
  // Full expanded drawer height in pixels (for callers that need to know
  // how much vertical space the drawer occupies right now).
  const expandedPx = ref(0)
  // Maximized height in pixels (0 when no maximize snap configured).
  const maxPx = ref(0)

  // Drag state
  const drag = reactive({
    startY: 0,
    startTranslate: 0,
  })

  // Clamp bounds for translateY. minTranslate is negative when a maximize snap
  // exists (pull up); maxTranslate is the minimized peek when minimize allowed.
  const minTranslate = computed(() =>
    maxPx.value > 0 ? -(maxPx.value - expandedPx.value) : 0
  )
  const maxTranslate = computed(() => (allowMinimize ? dragRangePx.value : 0))

  // Snap points in translateY space, smallest (most negative / tallest) first.
  const snapPoints = computed(() => {
    const pts = [0] // expanded (default) always available
    if (maxPx.value > 0) pts.push(minTranslate.value) // maximized
    if (allowMinimize) pts.push(dragRangePx.value)    // minimized
    return pts.sort((a, b) => a - b)
  })

  // Compute the effective drag range based on viewport
  function computeRange() {
    const vh = window.innerHeight || 800
    expandedPx.value = Math.max(minimizedPeek + 100, vh * expandedHeight)
    dragRangePx.value = expandedPx.value - minimizedPeek
    maxPx.value = maxTopGapPx != null
      ? Math.max(expandedPx.value, vh - maxTopGapPx)
      : (maxHeight ? Math.max(expandedPx.value, vh * maxHeight) : 0)
  }
  computeRange()
  window.addEventListener('resize', computeRange, { passive: true })
  onBeforeUnmount(() => window.removeEventListener('resize', computeRange))

  // Progress in [0, 1] — 0 at expanded, 1 at minimized (downward travel only,
  // for the handle-fade heuristic). Negative (maximized) travel reads as 0.
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

  // Handle opacity fades as the drawer moves away from a rest point — feels
  // natural: grip is solid when parked, ghosts out mid-drag.
  const handleOpacity = computed(() => {
    if (!isDragging.value) return 1
    return 0.6
  })

  // Inline style for the drawer root element. We animate `height` instead
  // of transform so the drawer participates in normal flex-layout: as the
  // drawer shrinks, the sibling canvas with `flex: 1` expands to fill the
  // gap automatically. No padding or absolute-positioning hacks required.
  const drawerHeightStyle = computed(() => {
    const h = Math.max(minimizedPeek, expandedPx.value - translateY.value)
    return {
      height: h + 'px',
      transition: isDragging.value ? 'none' : `height ${springMs}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
    }
  })

  // ── Drag handlers ─────────────────────────────────────────────────────

  function onPointerDown(e) {
    isDragging.value = true
    drag.startY = e.clientY ?? e.touches?.[0]?.clientY ?? 0
    drag.startTranslate = translateY.value
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch {}
    e.preventDefault()
  }

  function onPointerMove(e) {
    if (!isDragging.value) return
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0
    const dy = y - drag.startY
    translateY.value = Math.max(
      minTranslate.value,
      Math.min(maxTranslate.value, drag.startTranslate + dy)
    )
  }

  function onPointerUp() {
    if (!isDragging.value) return
    isDragging.value = false

    // Tap (no real movement) → snap back to where we started.
    const travelled = Math.abs(translateY.value - drag.startTranslate)
    const TAP_THRESHOLD = 4
    if (travelled < TAP_THRESHOLD) {
      snapTo(drag.startTranslate)
      return
    }
    // Directional commit: switch to the next snap once `commitFraction` of the
    // gap toward it has been crossed (lighter than nearest-neighbour).
    snapTo(pickSnapTarget(translateY.value, drag.startTranslate, snapPoints.value, commitFraction))
  }

  function snapTo(t) {
    translateY.value = t
    isMinimized.value = allowMinimize && Math.abs(t - dragRangePx.value) < 1
    isMaximized.value = maxPx.value > 0 && Math.abs(t - minTranslate.value) < 1
  }

  function setMinimized(min) {
    snapTo(min ? dragRangePx.value : 0)
  }

  function setMaximized(max) {
    snapTo(max && maxPx.value > 0 ? minTranslate.value : 0)
  }

  // When the drawer is unmounted (panel closed) reset to expanded so the
  // next mount starts in a known state.
  function reset() {
    translateY.value = 0
    isMinimized.value = false
    isMaximized.value = false
    isDragging.value = false
  }

  return {
    translateY,
    progress,
    isMinimized,
    isMaximized,
    isDragging,
    dragRangePx,
    expandedPx,
    visibleHeightPx,
    drawerHeightStyle,
    handleOpacity,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    setMinimized,
    setMaximized,
    reset,
  }
}

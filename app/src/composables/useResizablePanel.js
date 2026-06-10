/**
 * useResizablePanel — desktop side-panel width with drag-to-resize.
 *
 * Both the illustration track (ViewerView) and the map track (MapView) render
 * their controls drawer as a right-aligned full-height side panel on desktop
 * (≥768px). This composable lets the user grab the panel's LEFT edge and drag
 * it wider or narrower. The chosen width is clamped to [MIN_W, 50vw] and
 * persisted to localStorage per panel, so it survives reloads (pure client UI
 * state — origin-of-truth sync doesn't apply to view preferences).
 *
 * The mobile bottom-sheet layout is unaffected; callers gate the width binding
 * on their own desktop flag and keep using useDraggableDrawer there.
 *
 * Returns:
 *   - width        ref<number>  current panel width in px
 *   - isResizing   ref<boolean> true while the user drags the handle
 *   - onResizeStart(e)          pointerdown handler for the left-edge handle
 */
import { ref, onBeforeUnmount } from 'vue'

const MIN_W = 360            // px — never narrower than this
const MAX_FRACTION = 0.5     // px — never wider than 50vw

export function useResizablePanel(storageKey, { defaultWidth = MIN_W } = {}) {
  function maxW() {
    const vw = window.innerWidth || 1024
    return Math.max(MIN_W, Math.round(vw * MAX_FRACTION))
  }
  function clamp(w) {
    return Math.max(MIN_W, Math.min(maxW(), Math.round(w)))
  }
  function load() {
    try {
      const raw = localStorage.getItem(storageKey)
      const n = raw == null ? NaN : parseFloat(raw)
      if (Number.isFinite(n)) return clamp(n)
    } catch {}
    return clamp(defaultWidth)
  }

  const width = ref(load())
  const isResizing = ref(false)
  let startX = 0
  let startWidth = 0

  function onResizeMove(e) {
    if (!isResizing.value) return
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0
    // Handle sits on the panel's LEFT edge; dragging left (negative dx) widens.
    width.value = clamp(startWidth - (x - startX))
  }

  function persist() {
    try { localStorage.setItem(storageKey, String(width.value)) } catch {}
  }

  function onResizeEnd() {
    if (!isResizing.value) return
    isResizing.value = false
    window.removeEventListener('pointermove', onResizeMove)
    window.removeEventListener('pointerup', onResizeEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    persist()
  }

  function onResizeStart(e) {
    isResizing.value = true
    startX = e.clientX ?? e.touches?.[0]?.clientX ?? 0
    startWidth = width.value
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', onResizeEnd)
    // Lock the cursor + suppress text selection globally while dragging.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  // Re-clamp when the viewport shrinks so the 50vw ceiling stays honoured.
  function onWindowResize() {
    const c = clamp(width.value)
    if (c !== width.value) {
      width.value = c
      persist()
    }
  }
  window.addEventListener('resize', onWindowResize, { passive: true })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', onWindowResize)
    window.removeEventListener('pointermove', onResizeMove)
    window.removeEventListener('pointerup', onResizeEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  return { width, isResizing, onResizeStart }
}

import { ref, computed } from 'vue'
import { STROKE_GROUPS, NEUTRAL_MULTIPLIER } from '../lib/strokeOverrides.js'

// Per-element strek-tuning (Strek-FAB-panelet, v12.0.18). Verdier lagres PER
// KART med en GLOBAL standard som fallback — samme modell som useLabelDensity:
//   - slider-endring → per-kart-overstyring for kartet som vises nå
//   - «Angi som standard» → gjeldende verdier løftes til global standard
//     (og kartets egen overstyring slettes, så det følger standarden videre)
//   - «Nullstill» → kartets verdier settes eksplisitt til 1× (nøytral), slik
//     at alt igjen følger den globale Strek-knotten — også når den globale
//     standarden er ≠ 1.
// Modul-nivå refs ⇒ delt singleton som overlever MapView-remount.

const GLOBAL_KEY = 'svg-insights-stroke-tuning'        // { [groupId]: number }
const BYMAP_KEY = 'svg-insights-stroke-tuning-bymap'   // { [mapId]: { [groupId]: number } }

export const STROKE_TUNING_MIN = 0.4
export const STROKE_TUNING_MAX = 3

const validIds = new Set(STROKE_GROUPS.map((g) => g.id))

function sanitize(obj) {
  const out = {}
  if (!obj || typeof obj !== 'object') return out
  for (const [id, v] of Object.entries(obj)) {
    const n = Number(v)
    if (!validIds.has(id) || !Number.isFinite(n)) continue
    out[id] = Math.min(STROKE_TUNING_MAX, Math.max(STROKE_TUNING_MIN, n))
  }
  return out
}

function loadJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}

function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

const globalTuning = ref(sanitize(loadJson(GLOBAL_KEY)))
const byMap = ref(Object.fromEntries(
  Object.entries(loadJson(BYMAP_KEY)).map(([id, v]) => [id, sanitize(v)]),
))
const currentMapId = ref(null)

const allNeutral = () => Object.fromEntries(STROKE_GROUPS.map((g) => [g.id, NEUTRAL_MULTIPLIER]))

// Effektive multiplikatorer for kartet som vises nå: per-kart > global > 1.
const effective = computed(() => ({
  ...allNeutral(),
  ...globalTuning.value,
  ...(byMap.value[currentMapId.value] ?? {}),
}))

function setCurrentMap(id) { currentMapId.value = id || null }

function setGroup(groupId, value) {
  if (!validIds.has(groupId) || !currentMapId.value) return
  const n = Number(value)
  if (!Number.isFinite(n)) return
  const clamped = Math.min(STROKE_TUNING_MAX, Math.max(STROKE_TUNING_MIN, n))
  byMap.value = {
    ...byMap.value,
    [currentMapId.value]: { ...effective.value, [groupId]: clamped },
  }
  persist(BYMAP_KEY, byMap.value)
}

function saveAsDefault() {
  globalTuning.value = { ...effective.value }
  if (currentMapId.value) {
    const next = { ...byMap.value }
    delete next[currentMapId.value]
    byMap.value = next
    persist(BYMAP_KEY, byMap.value)
  }
  persist(GLOBAL_KEY, globalTuning.value)
}

function resetToNeutral() {
  if (!currentMapId.value) return
  byMap.value = { ...byMap.value, [currentMapId.value]: allNeutral() }
  persist(BYMAP_KEY, byMap.value)
}

export function useStrokeTuning() {
  return { effective, setCurrentMap, setGroup, saveAsDefault, resetToNeutral }
}

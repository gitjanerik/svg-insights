import { ref, computed, watch } from 'vue'

// Relieff-innstillinger (Relieff-FAB-panelet, v12.0.18). På/av og stil var
// tidligere rene globale innstillinger i MapView; nå er de PER KART med den
// globale verdien som fallback:
//   - FAB-panelet leser/skriver de EFFEKTIVE verdiene (per-kart-overstyring)
//   - Innstillinger-fanen leser/skriver de GLOBALE verdiene (som før)
//   - «Angi som standard» → effektive verdier løftes til global (og kartets
//     overstyring slettes)
//   - «Nullstill» → kartet settes til app-default: på + 'vektor'
// De globale localStorage-nøklene er UENDRET fra før, så eksisterende
// brukervalg overlever uten migrering. Modul-nivå refs ⇒ delt singleton.

const ENABLED_KEY = 'svg-insights-relief-enabled'   // '1' | '0' (global, eksisterende)
const MODE_KEY = 'svg-insights-relief-mode'         // 'vektor' | 'mjuk' (global, eksisterende)
const BYMAP_KEY = 'svg-insights-relief-bymap'       // { [mapId]: { enabled?, mode? } }

const DEFAULT_ENABLED = true
const DEFAULT_MODE = 'vektor'

const isMode = (v) => v === 'vektor' || v === 'mjuk'

function loadByMap() {
  try {
    const o = JSON.parse(localStorage.getItem(BYMAP_KEY) || '{}')
    if (o && typeof o === 'object') return o
  } catch { /* ignore */ }
  return {}
}

function loadGlobalEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) !== '0' } catch { return DEFAULT_ENABLED }
}

function loadGlobalMode() {
  try { const v = localStorage.getItem(MODE_KEY); if (isMode(v)) return v } catch { /* ignore */ }
  return DEFAULT_MODE
}

const globalReliefEnabled = ref(loadGlobalEnabled())
const globalReliefMode = ref(loadGlobalMode())
const byMap = ref(loadByMap())
const currentMapId = ref(null)

watch(globalReliefEnabled, (v) => { try { localStorage.setItem(ENABLED_KEY, v ? '1' : '0') } catch { /* ignore */ } })
watch(globalReliefMode, (v) => { try { localStorage.setItem(MODE_KEY, v) } catch { /* ignore */ } })

function writeOverride(patch) {
  if (!currentMapId.value) return
  byMap.value = {
    ...byMap.value,
    [currentMapId.value]: { ...(byMap.value[currentMapId.value] ?? {}), ...patch },
  }
  try { localStorage.setItem(BYMAP_KEY, JSON.stringify(byMap.value)) } catch { /* ignore */ }
}

const override = computed(() => byMap.value[currentMapId.value] ?? {})

// Effektive verdier (per-kart ?? global) — det runtime-konsumentene skal lese.
const reliefEnabled = computed({
  get: () => (typeof override.value.enabled === 'boolean' ? override.value.enabled : globalReliefEnabled.value),
  set: (v) => writeOverride({ enabled: !!v }),
})

const reliefMode = computed({
  get: () => (isMode(override.value.mode) ? override.value.mode : globalReliefMode.value),
  set: (v) => { if (isMode(v)) writeOverride({ mode: v }) },
})

function setCurrentMap(id) { currentMapId.value = id || null }

function saveReliefAsDefault() {
  globalReliefEnabled.value = reliefEnabled.value
  globalReliefMode.value = reliefMode.value
  if (currentMapId.value) {
    const next = { ...byMap.value }
    delete next[currentMapId.value]
    byMap.value = next
    try { localStorage.setItem(BYMAP_KEY, JSON.stringify(byMap.value)) } catch { /* ignore */ }
  }
}

function resetRelief() {
  writeOverride({ enabled: DEFAULT_ENABLED, mode: DEFAULT_MODE })
}

export function useReliefSettings() {
  return {
    reliefEnabled, reliefMode,
    globalReliefEnabled, globalReliefMode,
    setCurrentMap, saveReliefAsDefault, resetRelief,
  }
}

import { ref, computed, watch } from 'vue'

// Navnetetthet — brukervalg under Innstillinger. Styrer tetthets-budsjettets
// rutenett-kvote: celle-størrelse (px) + maks navn K per celle per klassegruppe.
// Lavere celle + høyere K ⇒ flere navn.
//
// To moduser, styrt av «Bruk på alle kart» (applyToAll, default PÅ):
//   PÅ  → selector setter GLOBAL tetthet (konsekvent: dette kartet + alle nye +
//         eksisterende uten egen overstyring).
//   AV  → selector setter en PER-KART-overstyring (kun kartet du ser på nå);
//         den globale standarden røres ikke for andre kart.
//
// Modul-nivå refs ⇒ delt singleton som overlever MapView-remount, persistert.
const GLOBAL_KEY = 'svg-insights-name-density'          // global preset-id
const APPLYALL_KEY = 'svg-insights-name-density-all'    // '1' | '0'
const BYMAP_KEY = 'svg-insights-name-density-bymap'     // { [mapId]: presetId }

// cellPx/K kalibrert for 1:10 000 (CD-handoff §4.3).
export const DENSITY_PRESETS = Object.freeze([
  { id: 'lav',     label: 'Lav',     cellPx: 320, K: 1 },
  { id: 'middels', label: 'Middels', cellPx: 240, K: 2 },
  { id: 'hoy',     label: 'Høy',     cellPx: 175, K: 3 },
])
export const DEFAULT_DENSITY = 'middels'

const isValid = (id) => DENSITY_PRESETS.some((p) => p.id === id)

function loadGlobal() {
  try { const v = localStorage.getItem(GLOBAL_KEY); if (isValid(v)) return v } catch { /* ignore */ }
  return DEFAULT_DENSITY
}
function loadApplyAll() {
  try { const v = localStorage.getItem(APPLYALL_KEY); if (v === '0') return false } catch { /* ignore */ }
  return true   // default PÅ
}
function loadByMap() {
  try { const o = JSON.parse(localStorage.getItem(BYMAP_KEY) || '{}'); if (o && typeof o === 'object') return o } catch { /* ignore */ }
  return {}
}

const globalDensityId = ref(loadGlobal())
const applyToAll = ref(loadApplyAll())
const byMap = ref(loadByMap())
const currentMapId = ref(null)

watch(globalDensityId, (v) => { try { localStorage.setItem(GLOBAL_KEY, v) } catch { /* ignore */ } })
watch(applyToAll, (v) => { try { localStorage.setItem(APPLYALL_KEY, v ? '1' : '0') } catch { /* ignore */ } })

// Effektiv tetthet for kartet som vises nå.
const effectiveId = computed(() => {
  if (applyToAll.value) return globalDensityId.value
  const id = currentMapId.value
  return (id && isValid(byMap.value[id])) ? byMap.value[id] : globalDensityId.value
})

// Selector-modell: leser effektiv verdi, skriver til global eller per-kart.
const densityId = computed({
  get: () => effectiveId.value,
  set: (v) => {
    if (!isValid(v)) return
    if (applyToAll.value || !currentMapId.value) {
      globalDensityId.value = v
    } else {
      byMap.value = { ...byMap.value, [currentMapId.value]: v }
      try { localStorage.setItem(BYMAP_KEY, JSON.stringify(byMap.value)) } catch { /* ignore */ }
    }
  },
})

const preset = computed(() => DENSITY_PRESETS.find((p) => p.id === effectiveId.value) || DENSITY_PRESETS[1])
const cellPx = computed(() => preset.value.cellPx)
const K = computed(() => preset.value.K)

function setCurrentMap(id) { currentMapId.value = id || null }

export function useLabelDensity() {
  return { densityId, applyToAll, cellPx, K, DENSITY_PRESETS, setCurrentMap }
}

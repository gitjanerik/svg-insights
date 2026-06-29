import { ref, computed, watch } from 'vue'

// Navnetetthet — brukervalg under Innstillinger. Styrer tetthets-budsjettets
// rutenett-kvote: celle-størrelse (px) + maks navn K per celle per klassegruppe.
// Lavere celle + høyere K ⇒ flere navn. Default Høy (brukeren liker tette kart).
//
// Modul-nivå ref ⇒ delt singleton som overlever MapView-remount, persistert.
const KEY = 'svg-insights-mapview-name-density'

// cellPx/K kalibrert for 1:10 000 (CD-handoff §4.3).
export const DENSITY_PRESETS = Object.freeze([
  { id: 'lav',     label: 'Lav',     cellPx: 320, K: 1 },
  { id: 'middels', label: 'Middels', cellPx: 240, K: 2 },
  { id: 'hoy',     label: 'Høy',     cellPx: 175, K: 3 },
])
export const DEFAULT_DENSITY = 'hoy'

function loadSaved() {
  try {
    const v = localStorage.getItem(KEY)
    if (v && DENSITY_PRESETS.some((p) => p.id === v)) return v
  } catch { /* private mode — ignore */ }
  return DEFAULT_DENSITY
}

const densityId = ref(loadSaved())

const preset = computed(() => DENSITY_PRESETS.find((p) => p.id === densityId.value) || DENSITY_PRESETS[2])
const cellPx = computed(() => preset.value.cellPx)
const K = computed(() => preset.value.K)

watch(densityId, (v) => {
  try { localStorage.setItem(KEY, v) } catch { /* private mode / quota — ignore */ }
})

export function useLabelDensity() {
  return { densityId, cellPx, K, DENSITY_PRESETS, DEFAULT_DENSITY }
}

import { ref, watch } from 'vue'

// Brukerstyrt standard-kartstørrelse for NYE kart laget via forsidens søk/GPS-
// flyt (MapHomeView). Default (null) = skjerm-utledet kvadrat (~4 km, autoMapSquare).
// Brukeren kan i stedet velge et fast kvadrat på 10–20 km bredde — nyttig for å
// teste detalj-LOD-en på store, navn-/kurve-tette kart. Settes i «Innstillinger»-
// fanen i kart-visningen (MapView). Persisteres i localStorage.
//
// Modul-nivå ref ⇒ delt singleton mellom MapHomeView (leser) og MapView (skriver).
const KEY = 'svg-insights-map-size-km'
export const MAP_SIZE_OPTIONS = [10, 12, 14, 16, 18, 20]   // km bredde (kvadrat)

function load() {
  try {
    const v = localStorage.getItem(KEY)
    if (v == null) return null
    const n = parseInt(v, 10)
    return MAP_SIZE_OPTIONS.includes(n) ? n : null
  } catch { return null }
}

const mapSizeKm = ref(load())

watch(mapSizeKm, (v) => {
  try {
    if (v == null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(v))
  } catch { /* private mode / quota — ignore */ }
})

export function useMapSizePreference() {
  return { mapSizeKm, MAP_SIZE_OPTIONS }
}

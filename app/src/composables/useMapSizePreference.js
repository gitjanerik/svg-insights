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

// Auto-ekvidistanse: på store kart drukner 20 m-kurver i en svart graut (sub-
// piksel-tette ved utzoom). Vi trapper opp høydekurve-intervallet med bredden så
// kartet holder seg lesbart — standard topo-konvensjon (større område → grovere
// ekvidistanse). null/Standard (~4 km) beholder 20 m som før.
//   < 9 km   → 20 m
//   9–13 km  → 25 m
//   ≥ 14 km  → 50 m
export function equidistanceForWidthKm(km) {
  if (!km) return 20
  if (km >= 14) return 50
  if (km >= 9) return 25
  return 20
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

import { ref, watch } from 'vue'

// Brukerstyrt standard-kartstørrelse for NYE kart laget via forsidens søk/GPS-
// flyt (MapHomeView). Default (null) = et fast 4 km kvadrat (DEFAULT_MAP_WIDTH_KM).
// Brukeren kan i stedet velge et fast kvadrat på 10–20 km bredde — nyttig for å
// teste detalj-LOD-en på store, navn-/kurve-tette kart. Settes i «Innstillinger»-
// fanen i kart-visningen (MapView). Persisteres i localStorage.
//
// v11.0.59: «Standard» var tidligere `autoMapSquare(2)` = et skjerm-skalert
// kvadrat (4 km × viewportAspect). På en høy mobil-skjerm (h/w ≈ 2,2) ble det
// et ~8,7 km kvadrat — ~5× arealet av et 4 km-kart, og dermed en mye tyngre
// OSM-/DEM-bygging. Kommentarene sa «~4 km» men koden leverte nær 9 km.
// Standard er nå et ekte 4 km kvadrat: rask å bygge, og fortsatt rikelig for
// en tur-/padle-økt. Vil man ha større, finnes 10–20 km i samme velger.
//
// Modul-nivå ref ⇒ delt singleton mellom MapHomeView (leser) og MapView (skriver).
const KEY = 'svg-insights-map-size-km'
export const MAP_SIZE_OPTIONS = [10, 12, 14, 16, 18, 20]   // km bredde (kvadrat)

// «Standard»-bredden (km) for nye kart når brukeren ikke har valgt en fast
// størrelse. Fast kvadrat — IKKE skjerm-skalert (se v11.0.59-merknaden over).
export const DEFAULT_MAP_WIDTH_KM = 4

// Dimensjoner for «Standard»-kartet: et DEFAULT_MAP_WIDTH_KM-bredt kvadrat.
// Samme form som de eksplisitte størrelsene (aspect = 1) så velgeren er konsistent.
export function defaultMapDims() {
  return { halfKm: DEFAULT_MAP_WIDTH_KM / 2, aspect: 1 }
}

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

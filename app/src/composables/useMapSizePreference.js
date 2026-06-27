import { ref, watch } from 'vue'

// Brukerstyrt standard-kartstørrelse for NYE kart laget via forsidens søk/GPS-
// flyt (MapHomeView). Verdien er en fri km-bredde (kvadrat) satt med en slider
// i «Innstillinger»-fanen (MapView). null = DEFAULT_MAP_WIDTH_KM (10 km).
// Persisteres i localStorage.
//
// v11.0.59: «Standard» var `autoMapSquare(2)` = et skjerm-skalert kvadrat
// (4 km × viewportAspect). På en høy mobil-skjerm (h/w ≈ 2,2) ble det ~8,7 km.
// Erstattet med et fast kvadrat (defaultMapDims).
// v11.0.60: faste valg 4/6/8 km, default 10 km, utdatert 20 km-preferanse
// ugyldiggjort i load().
// v11.0.61: størrelsen er nå en fri SLIDER 1–20 km (default 10). Auto-
// ekvidistansen følger «Flere valg»-gulvet (minste TILLATTE = fineste):
// < 4 km → 5 m, 4–6 km → 10 m, ≥ 6 km → 20 m (samme tabell som
// MapPickerView.minEquidistance). En lagret verdi utenfor [1, maks] klampes/
// ignoreres i load() → faller til DEFAULT.
// v11.0.70: maks redusert fra 20 til 12 km (samme grense som «Flere valg»).
//
// Modul-nivå ref ⇒ delt singleton mellom MapHomeView (leser) og MapView (skriver).
const KEY = 'svg-insights-map-size-km'

export const MAP_SIZE_MIN_KM = 1
export const MAP_SIZE_MAX_KM = 12
// «Standard»-bredden (km) for nye kart når brukeren ikke har valgt noe.
// Fast kvadrat — IKKE skjerm-skalert (se v11.0.59-merknaden over).
export const DEFAULT_MAP_WIDTH_KM = 10

// Dimensjoner for «Standard»-kartet: et DEFAULT_MAP_WIDTH_KM-bredt kvadrat.
// Samme form som en valgt størrelse (aspect = 1) så velgeren er konsistent.
export function defaultMapDims() {
  return { halfKm: DEFAULT_MAP_WIDTH_KM / 2, aspect: 1 }
}

function load() {
  try {
    const n = parseInt(localStorage.getItem(KEY), 10)
    if (Number.isFinite(n) && n >= MAP_SIZE_MIN_KM && n <= MAP_SIZE_MAX_KM) return n
  } catch { /* private mode */ }
  return null   // null = DEFAULT_MAP_WIDTH_KM
}

// Auto-ekvidistanse for snarvei-kart (søk/GPS). Speiler «Flere valg»-gulvet
// (MapPickerView.minEquidistance) og gir brukeren den FINESTE tillatte
// ekvidistansen for bredden — tette kurver der det er plass, grovere først når
// kartet blir så stort at fine kurver drukner:
//   < 4 km  → 5 m
//   4–6 km  → 10 m
//   ≥ 6 km  → 20 m
export function equidistanceForWidthKm(km) {
  const w = km || DEFAULT_MAP_WIDTH_KM
  if (w >= 6) return 20
  if (w >= 4) return 10
  return 5
}

const mapSizeKm = ref(load())

watch(mapSizeKm, (v) => {
  try {
    if (v == null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(v))
  } catch { /* private mode / quota — ignore */ }
})

export function useMapSizePreference() {
  return { mapSizeKm }
}

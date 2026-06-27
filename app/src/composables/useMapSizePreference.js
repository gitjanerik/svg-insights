import { ref, watch } from 'vue'

// Brukerstyrt standard-kartstørrelse for NYE kart laget via forsidens søk/GPS-
// flyt (MapHomeView). Default (null) = et fast 10 km kvadrat (DEFAULT_MAP_WIDTH_KM).
// Brukeren kan i stedet velge et MINDRE kvadrat (4/6/8 km) for raskere bygging.
// Settes i «Innstillinger»-fanen i kart-visningen (MapView). Persisteres i localStorage.
//
// v11.0.59: «Standard» var `autoMapSquare(2)` = et skjerm-skalert kvadrat
// (4 km × viewportAspect). På en høy mobil-skjerm (h/w ≈ 2,2) ble det et
// ~8,7 km kvadrat. Erstattet med et fast kvadrat (defaultMapDims).
//
// v11.0.60: «Standard» satt til 10 km (var 4), og de store testvalgene
// (12–20 km) er fjernet — de var trege i tette kyst-/byområder og var rot for
// vanlig bruk. VIKTIG: dette ugyldiggjør samtidig en gammel, lagret 20 km-
// preferanse: load() returnerer null for en verdi som ikke lenger er i
// MAP_SIZE_OPTIONS, så «Lag nytt kart»-snarveien faller tilbake til Standard
// (10 km) i stedet for å bygge et 20 km-kart fra en utdatert localStorage-verdi.
//
// Modul-nivå ref ⇒ delt singleton mellom MapHomeView (leser) og MapView (skriver).
const KEY = 'svg-insights-map-size-km'
// Faste MINDRE valg (km bredde, kvadrat) enn Standard, for raskere bygging.
// Standard (null) = DEFAULT_MAP_WIDTH_KM. Ingen verdi > 10: store kart er
// tunge i tette områder (se v11.0.58 Overpass-fiks) og er ikke et vanlig behov.
export const MAP_SIZE_OPTIONS = [4, 6, 8]

// «Standard»-bredden (km) for nye kart når brukeren ikke har valgt en fast
// størrelse. Fast kvadrat — IKKE skjerm-skalert (se v11.0.59-merknaden over).
export const DEFAULT_MAP_WIDTH_KM = 10

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
    // Ikke-gjenkjente (f.eks. utdaterte 12–20 km) → null = Standard.
    return MAP_SIZE_OPTIONS.includes(n) ? n : null
  } catch { return null }
}

// Auto-ekvidistanse: på store kart drukner 20 m-kurver i en svart graut (sub-
// piksel-tette ved utzoom). Vi trapper opp høydekurve-intervallet med bredden så
// kartet holder seg lesbart — standard topo-konvensjon (større område → grovere
// ekvidistanse). null/Standard (10 km) og de mindre valgene (4/6/8 km) holder
// 20 m. (12–25 m-tierne beholdes for andre kilder, f.eks. picker-en.)
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

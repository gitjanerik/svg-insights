import { ref, computed, watch } from 'vue'

// Brukervalgbart font-par for kart-etiketter (Innstillinger-fanen i MapView).
// Land-fonten (sans) brukes på bebyggelse/topp/område/hytte; vann-fonten
// (kursiv serif) på vann-navn. MapView setter --land-font / --water-font på
// SVG-host-en → fonten byttes LIVE uten å bygge kartet på nytt.
//
// Self-hostet via @fontsource-variable (importert i style.css). Modul-nivå ref
// ⇒ delt singleton som overlever MapView-remount og persisteres i localStorage.
const KEY = 'svg-insights-mapview-label-fonts'

const SANS = (family) => `'${family}', ui-sans-serif, system-ui, sans-serif`
const SERIF = (family) => `'${family}', Georgia, serif`

// id = synlig navn i velgeren (matcher CD-designets fontPair-meny).
export const FONT_PAIRS = Object.freeze([
  { id: 'Hanken Grotesk + Newsreader', land: SANS('Hanken Grotesk Variable'), water: SERIF('Newsreader Variable') },
  { id: 'Figtree + Source Serif',      land: SANS('Figtree Variable'),        water: SERIF('Source Serif 4 Variable') },
  { id: 'Instrument Sans + Literata',  land: SANS('Instrument Sans Variable'), water: SERIF('Literata Variable') },
  { id: 'Inter + Source Serif',        land: SANS('Inter Variable'),           water: SERIF('Source Serif 4 Variable') },
])
export const DEFAULT_FONT_PAIR = FONT_PAIRS[0].id

function loadSaved() {
  try {
    const v = localStorage.getItem(KEY)
    if (v && FONT_PAIRS.some((p) => p.id === v)) return v
  } catch { /* private mode — ignore */ }
  return DEFAULT_FONT_PAIR
}

const fontPairId = ref(loadSaved())

const pair = computed(() => FONT_PAIRS.find((p) => p.id === fontPairId.value) || FONT_PAIRS[0])
const landFont = computed(() => pair.value.land)
const waterFont = computed(() => pair.value.water)

watch(fontPairId, (v) => {
  try { localStorage.setItem(KEY, v) } catch { /* private mode / quota — ignore */ }
})

function resetLabelFonts() {
  fontPairId.value = DEFAULT_FONT_PAIR
}

export function useLabelFonts() {
  return { fontPairId, landFont, waterFont, FONT_PAIRS, DEFAULT_FONT_PAIR, resetLabelFonts }
}

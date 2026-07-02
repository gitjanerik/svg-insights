// Annotering på et kart — brukeren kan plassere ISOM-symboler
// (knaus, stein, brønn osv.) over auto-genererte data. Annotations
// lagres i IndexedDB sammen med kartet.
//
// Annotation-typer (foreløpig kun point):
//   { id, type: 'point', isomCode, x, y, label?, opprettet }
//
// Dataformat lagres som array på kartet sin entry.annotations.

import { ref, computed } from 'vue'
import { loadMap, saveMap } from '../lib/mapStorage.js'

/** Tilgjengelige punktsymboler i annoteringsmodus. */
export const ANNOTATION_SYMBOLS = [
  { code: '213', symbolKey: 'knaus', label: 'Knaus' },
  { code: '212', symbolKey: 'stein', label: 'Stein' },
  { code: '310', symbolKey: 'brønn', label: 'Brønn / kilde' },
  { code: '509', symbolKey: 'bro',   label: 'Bro / klopp' },
  // Bonus — ikke en ISOM-kode. Rød dråpe-pin som spretter når den blir
  // truffet av en ball i CurveInvaders + trigger Invaders-modus etter
  // 4 treff. Code 999 reserverer plass utenfor ISOM-rommet. symbolKey
  // matcher brand: 'stedsmerke'. (Eldre kode kalte den 'geocache' —
  // ryddet i v8.8.3 fordi navnet ikke lenger reflekterer funksjonen.)
  { code: '999', symbolKey: 'stedsmerke', label: 'Stedsmerke' },
]

export function useMapAnnotations(mapId) {
  const annotations = ref([])
  const isAnnotateMode = ref(false)
  const selectedSymbol = ref(null)        // 'knaus' | 'stein' | 'brønn' | null
  const isDirty = ref(false)
  // Per-type synlighet — brukeren kan skjule f.eks. alle plasserte
  // «Knaus»-symboler uten å slette dem. Default: alt synlig.
  const visibleTypes = ref(new Set(ANNOTATION_SYMBOLS.map(s => s.symbolKey)))

  // preloaded: allerede-lest IndexedDB-entry fra kallerens loadMap — sparer en
  // full deserialisering av multi-MB SVG-strengen når kartet nettopp er lest.
  async function load(preloaded) {
    if (!mapId || mapId.startsWith('vardasen')) {
      annotations.value = []
      return
    }
    const entry = preloaded ?? await loadMap(mapId)
    annotations.value = entry?.annotations ?? []
    isDirty.value = false
  }

  async function persist() {
    if (!mapId || mapId.startsWith('vardasen')) return
    const entry = await loadMap(mapId)
    if (!entry) return
    // Unwrap Vue reactive proxy før IndexedDB serialiserer. structuredClone
    // håndterer Proxy i moderne nettlesere, men eldre Safari/iOS-versjoner
    // har throwet «DataCloneError» på reactive arrays. JSON-round-trip gir
    // garantert plain JS-objekter og er trivielt billig på en håndfull
    // punkt-annoteringer.
    entry.annotations = JSON.parse(JSON.stringify(annotations.value))
    await saveMap(entry)
    isDirty.value = false
  }

  function addPoint(isomCode, x, y, label = '') {
    annotations.value = [...annotations.value, {
      id: 'a' + Math.random().toString(36).slice(2, 10),
      type: 'point', isomCode, x, y, label,
      opprettet: Date.now(),
    }]
    isDirty.value = true
  }

  function remove(id) {
    annotations.value = annotations.value.filter(a => a.id !== id)
    isDirty.value = true
  }

  function clearAll() {
    annotations.value = []
    isDirty.value = true
  }

  function toggleTypeVisibility(symbolKey) {
    const next = new Set(visibleTypes.value)
    if (next.has(symbolKey)) next.delete(symbolKey)
    else next.add(symbolKey)
    visibleTypes.value = next
  }

  /** Antall plasserte annoteringer pr symbolKey ({ knaus: 2, stein: 0, ... }). */
  const countByType = computed(() => {
    const result = {}
    for (const sym of ANNOTATION_SYMBOLS) result[sym.symbolKey] = 0
    for (const a of annotations.value) {
      const sym = ANNOTATION_SYMBOLS.find(s => s.code === a.isomCode)
      if (sym) result[sym.symbolKey]++
    }
    return result
  })

  return {
    annotations, isAnnotateMode, selectedSymbol, isDirty, visibleTypes,
    countByType,
    load, persist, addPoint, remove, clearAll, toggleTypeVisibility,
  }
}

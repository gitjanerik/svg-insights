import { ref, watch } from 'vue'
import { geocodePlace } from '../lib/geocode.js'

// Stedssøk via OpenStreetMap Nominatim. Free service, krever User-Agent og
// rate-limit-vennlig bruk. Vi debouncer og begrenser til Norge. Selve søket +
// normaliseringen bor i lib/geocode.js (delt med MCP-serveren).

export function useNominatim({ debounceMs = 350, countryCode = 'no' } = {}) {
  const query = ref('')
  const results = ref([])
  const isSearching = ref(false)
  const error = ref(null)

  let timeout = null
  let abortController = null

  async function search(q) {
    if (!q || q.trim().length < 2) {
      results.value = []
      return
    }
    abortController?.abort()
    abortController = new AbortController()
    isSearching.value = true
    error.value = null

    try {
      results.value = await geocodePlace(q, { countryCode, signal: abortController.signal })
    } catch (e) {
      if (e.name !== 'AbortError') {
        error.value = e.message ?? 'Søk feilet'
        results.value = []
      }
    } finally {
      isSearching.value = false
    }
  }

  watch(query, (q) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => search(q), debounceMs)
  })

  return { query, results, isSearching, error, search }
}

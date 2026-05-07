import { ref, watch } from 'vue'

// Stedssøk via OpenStreetMap Nominatim. Free service, krever User-Agent
// og rate-limit-vennlig bruk. Vi debouncer og begrenser til Norge.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

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
      const params = new URLSearchParams({
        q,
        format: 'jsonv2',
        limit: '8',
        addressdetails: '1',
        countrycodes: countryCode,
      })
      const res = await fetch(`${NOMINATIM}?${params}`, {
        signal: abortController.signal,
        headers: {
          'Accept': 'application/json',
        },
      })
      if (!res.ok) throw new Error(`Nominatim ${res.status}`)
      const data = await res.json()
      results.value = data.map(d => ({
        id: d.place_id,
        name: d.display_name,
        shortName: shortNameFor(d),
        type: d.type,
        importance: d.importance,
        lat: parseFloat(d.lat),
        lon: parseFloat(d.lon),
        bbox: d.boundingbox?.map(parseFloat) ?? null,
      }))
    } catch (e) {
      if (e.name !== 'AbortError') {
        error.value = e.message ?? 'Søk feilet'
        results.value = []
      }
    } finally {
      isSearching.value = false
    }
  }

  function shortNameFor(d) {
    const a = d.address ?? {}
    const place = a.suburb || a.village || a.town || a.city || a.municipality || a.county || ''
    const parts = []
    if (d.name) parts.push(d.name)
    else if (a.road) parts.push(a.road)
    else if (a.postcode) parts.push(a.postcode)
    if (place && place !== parts[0]) parts.push(place)
    return parts.join(', ') || d.display_name.split(',').slice(0, 2).join(',')
  }

  watch(query, (q) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => search(q), debounceMs)
  })

  return { query, results, isSearching, error, search }
}

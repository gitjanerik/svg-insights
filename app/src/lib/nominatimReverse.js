// Nærmeste stedsnavn for et punkt — Nominatim /reverse (jsonv2). Brukes til
// navneforslag på grusruter («Fra <sted> til <sted>») når A/B er anonyme
// koordinat-punkter fra kart-tap. zoom=14 gir grend-/bygdenivå — vi vil ha
// STEDET, ikke gateadressen. Samme frie tjeneste og nett-profil som
// stedssøket (useNominatim); ett kall per punkt, ingen polling.

const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse'

/**
 * Plukk det mest lokale steds-leddet fra et jsonv2 reverse-svar. Rekkefølgen
 * er «minst → størst» (grenda før byen) — det er nabolaget man kjører fra,
 * ikke kommunen. Fallback til objektets eget navn (f.eks. et vann eller en
 * plass) når adress-leddene mangler.
 */
export function pickReverseShortName(d = {}) {
  const a = d.address ?? {}
  const place = a.hamlet || a.village || a.farm || a.isolated_dwelling ||
    a.neighbourhood || a.suburb || a.locality || a.town || a.city || a.municipality || null
  const name = place || d.name || null
  return name ? String(name).trim() || null : null
}

export async function reverseNearestPlace(lat, lon, { zoom = 14, timeoutMs = 5000, fetchFn = fetch } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: lat.toFixed(6),
      lon: lon.toFixed(6),
      zoom: String(zoom),
      addressdetails: '1',
      'accept-language': 'no',
    })
    const res = await fetchFn(`${NOMINATIM_REVERSE}?${params}`, {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`Nominatim reverse ${res.status}`)
    return pickReverseShortName(await res.json())
  } finally {
    clearTimeout(timer)
  }
}

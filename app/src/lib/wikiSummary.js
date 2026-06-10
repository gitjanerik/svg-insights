// Wikipedia REST summary — valgfri ingress + lenke for et verneområde.
//
// Sekundær kilde (ikke kritisk): gir en kort beskrivelse og en lenke når en
// artikkel finnes. Prøver norsk Wikipedia først, faller tilbake til engelsk.
// CORS er aktivert på REST-summary-endepunktet. Feiler/mangler → null.

const WIKI_HOSTS = [
  import.meta.env?.VITE_WIKI_NO_URL ?? 'https://no.wikipedia.org',
  import.meta.env?.VITE_WIKI_EN_URL ?? 'https://en.wikipedia.org',
]

async function fetchSummaryFrom(host, title, signal) {
  const url = `${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  if (!res.ok) return null
  const json = await res.json()
  // Tomme treff / flertydige sider gir ikke en brukbar ingress.
  if (!json || json.type === 'disambiguation') return null
  const extract = (json.extract ?? '').trim()
  if (!extract) return null
  return {
    title: json.title ?? title,
    extract,
    url: json.content_urls?.desktop?.page ?? `${host}/wiki/${encodeURIComponent(title)}`,
    thumbnail: json.thumbnail?.source ?? null,
  }
}

/**
 * Hent et Wikipedia-sammendrag for et verneområde-navn. Returnerer
 * `{ title, extract, url, thumbnail }` eller null.
 *
 * @param {string} name
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 */
export async function fetchWikiSummary(name, opts = {}) {
  if (!name || typeof name !== 'string') return null
  const { signal, timeoutMs = 6000 } = opts

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) return null
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    for (const host of WIKI_HOSTS) {
      try {
        const hit = await fetchSummaryFrom(host, name, ctrl.signal)
        if (hit) return hit
      } catch (e) {
        if (ctrl.signal.aborted) return null
        // prøv neste språk
      }
    }
    return null
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

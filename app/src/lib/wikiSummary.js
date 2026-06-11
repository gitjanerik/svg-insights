// Wikipedia REST summary — valgfri ingress + lenke for et verneområde.
//
// Sekundær kilde (ikke kritisk): gir en kort beskrivelse og en lenke når en
// artikkel finnes. Prøver norsk Wikipedia først, faller tilbake til engelsk.
// CORS er aktivert på REST-summary-endepunktet. Feiler/mangler → null.

export const WIKI_HOSTS = [
  import.meta.env?.VITE_WIKI_NO_URL ?? 'https://no.wikipedia.org',
  import.meta.env?.VITE_WIKI_EN_URL ?? 'https://en.wikipedia.org',
]

function norm(s) {
  return String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Naturbase oppgir verneform med varierende ordlyd («Biotopvern»,
// «Naturreservat», «Landskapsvernområde» …). Wikipedia-artikler for
// verneområder følger en fast navnekonvensjon: «<Navn> <verneform>».
// Kartlegg Naturbase-verneformen til ordet Wikipedia faktisk bruker i tittelen.
const VERNEFORM_SUFFIX = [
  [/reservat/i, 'naturreservat'],
  [/nasjonalpark/i, 'nasjonalpark'],
  [/landskap/i, 'landskapsvernområde'],
  [/biotop/i, 'biotopvernområde'],
  [/plante/i, 'plantefredningsområde'],
  [/dyre/i, 'dyrelivsfredning'],
  [/naturminne/i, 'naturminne'],
]

export function verneformSuffix(verneform) {
  const s = String(verneform ?? '').trim()
  if (!s) return null
  for (const [re, word] of VERNEFORM_SUFFIX) if (re.test(s)) return word
  return null
}

// Et navn som allerede bærer en verneform-suffiks skal ikke få en til.
const NAME_HAS_VERNEFORM =
  /\s(naturreservat|nasjonalpark|landskapsvernområde|biotopvernområde|verneområde|fredningsområde|naturminne)$/i

// Kandidat-titler i synkende spesifisitet. Det fulle offisielle navnet
// («Storøya biotopvernområde») disambiguerer mot stedsnavn/øyer med samme
// bare navn («Storøya» = øy på Svalbard) — derfor først.
export function buildWikiTitles(name, verneform) {
  const base = String(name ?? '').normalize('NFC').trim()
  if (!base) return []
  const titles = []
  const suffix = verneformSuffix(verneform)
  if (suffix && !NAME_HAS_VERNEFORM.test(base)) titles.push(`${base} ${suffix}`)
  titles.push(base)
  return titles
}

// Det bare stedsnavnet er flertydig (øy, gård, fjell …). Når vi vet at
// oppslaget gjelder et verneområde, godtas en treff-artikkel på det bare
// navnet bare hvis den faktisk handler om vern — ellers lenker vi til feil
// sak (Storøya-øya på Svalbard istedenfor Storøya biotopvernområde).
const VERN_HINT = /vern|reservat|nasjonalpark|fredning|biotop|landskapsvern|naturminne/i

// Aksepter et Wikipedia-treff bare når artikkeltittelen faktisk samsvarer med
// oppslaget. KRITISK: å/ø/æ holdes DISTINKT fra a/o/ae — ellers matcher
// «Mardalen» (naturreservat) feilaktig artikkelen «Mårdalen» (et etternavn).
// Tillater at navnet bærer en verneform-suffiks (… naturreservat) eller at
// artikkelen har en parentes-disambiguering.
export function titleMatches(query, articleTitle) {
  const strip = /\s+(naturreservat|nasjonalpark|landskapsvernområde|verneområde|biotopvernområde)$/
  const q = norm(query).replace(strip, '')
  const t = norm(articleTitle).replace(/\s*\([^)]*\)\s*$/, '').replace(strip, '')
  if (!q || !t) return false
  return t === q || t.startsWith(q + ' ') || q.startsWith(t + ' ')
}

async function fetchSummaryFrom(host, title, signal, requireVernHint = false) {
  const url = `${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  if (!res.ok) return null
  const json = await res.json()
  // Tomme treff / flertydige sider gir ikke en brukbar ingress.
  if (!json || json.type === 'disambiguation') return null
  // Avvis feil-treff (redirect/normalisering til et annet ord, f.eks. å↔a).
  if (!titleMatches(title, json.title ?? title)) return null
  const extract = (json.extract ?? '').trim()
  if (!extract) return null
  // Bare-navn-fallback for et verneområde: aksepter kun en artikkel som
  // faktisk handler om vern (ellers er det stedet/øya med samme navn).
  if (requireVernHint && !VERN_HINT.test(`${json.title ?? ''} ${json.description ?? ''} ${extract}`)) {
    return null
  }
  return {
    source: 'wikipedia',
    title: json.title ?? title,
    extract,
    url: json.content_urls?.desktop?.page ?? `${host}/wiki/${encodeURIComponent(title)}`,
    thumbnail: json.thumbnail?.source ?? null,
  }
}

/**
 * Hent et Wikipedia-sammendrag for et verneområde. Prøver det fulle offisielle
 * navnet (navn + verneform) før det bare navnet, så en øy/et sted med samme
 * navn ikke vinner. Returnerer `{ title, extract, url, thumbnail }` eller null.
 *
 * @param {string} name
 * @param {{ signal?: AbortSignal, timeoutMs?: number, verneform?: string }} [opts]
 */
export async function fetchWikiSummary(name, opts = {}) {
  if (!name || typeof name !== 'string') return null
  const { signal, timeoutMs = 6000, verneform = null } = opts
  const titles = buildWikiTitles(name, verneform)
  if (!titles.length) return null

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) return null
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    for (const host of WIKI_HOSTS) {
      for (const title of titles) {
        // Det bare navnet (siste kandidat når vi har en verneform) er flertydig
        // → krev at artikkelen faktisk handler om vern.
        const requireVernHint = !!verneform && titles.length > 1 && title === titles[titles.length - 1]
        try {
          const hit = await fetchSummaryFrom(host, title, ctrl.signal, requireVernHint)
          if (hit) return hit
        } catch (e) {
          if (ctrl.signal.aborted) return null
          // prøv neste tittel/språk
        }
      }
    }
    return null
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

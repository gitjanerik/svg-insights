// Store norske leksikon (SNL) — foretrukket kilde for navne-oppslag.
//
// SNL er et anerkjent, kuratert norsk oppslagsverk. Ved navne-oppslag (long-press
// i kartet) prøver vi SNL FØRST og faller tilbake til Wikipedia. SNL har INGEN
// koordinater / ingen geosearch, så det kan kun svare på et KJENT navn — aldri
// «hvilken artikkel ligger nærmest dette punktet» (det forblir Wikipedia-geosearch).
//
// API: åpent, ingen nøkkel. Søk: `https://snl.no/api/v1/search?query=<q>&limit=<1-10>`
// → JSON-array, rangert (`rank`). Relevante felt: headword/title, clarification,
// first_two_sentences (ren ingress), snippet (treff-utdrag, IKKE ingress),
// first_image_url, article_url, license (pr. artikkel — «begrenset eller fri»),
// encyclopedia_id (1=SNL, 3=SML, 4=NBL). Tekst er CC BY-SA (fri bruk m/kildehenvisning).
//
// CORS: SNL-API-et må svare med CORS-headere for at klient-fetch skal virke. Gjør
// det ikke, kaster fetch → vi returnerer null → kaller faller tilbake til Wikipedia.
// Ingenting knekker; SNL vises bare ikke.

import { titleMatches } from './wikiSummary.js'

export const SNL_API = import.meta.env?.VITE_SNL_API_URL ?? 'https://snl.no/api/v1'

const SEARCH_LIMIT = 5
const EXTRACT_MAX_CHARS = 280

// Fjern HTML (SNL-snippet har <mark>…</mark>-uthevinger), dekod vanlige entiteter,
// kollaps mellomrom og trim. Kutt til en kort blurb ved ord-/setningsgrense.
export function stripSnlHtml(s) {
  const t = String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()
  if (t.length <= EXTRACT_MAX_CHARS) return t
  const cut = t.slice(0, EXTRACT_MAX_CHARS)
  const dot = cut.lastIndexOf('. ')
  if (dot > EXTRACT_MAX_CHARS * 0.5) return cut.slice(0, dot + 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > 0 ? cut.slice(0, sp) : cut).trim() + ' …'
}

// Er artikkel-lisensen fri nok til å gjengi ingress-teksten? SNL-tekst er som
// hovedregel CC BY-SA, men enkelte artikler er «begrenset». Defensivt: fri kun
// når lisensen tydelig er åpen (cc/by/fri) og ikke markert begrenset/restriktiv.
export function snlLicenseIsFree(license) {
  if (license == null) return false
  const s = (typeof license === 'string' ? license : (license.name ?? license.code ?? '')).toLowerCase()
  if (!s) return false
  if (/begrenset|restricted|all rights|©|opphavsrett/.test(s)) return false
  return /\bcc\b|creative commons|by-sa|by\b|fri\b|free\b|offentlig/.test(s)
}

// Bygg vårt resultat-objekt fra ett SNL-søketreff.
function snlItemToResult(item) {
  const url = item.article_url || (item.permalink ? `https://snl.no/${item.permalink}` : null)
  // Ingress fra first_two_sentences (ren), ellers snippet (treff-utdrag). Vis tekst
  // kun når lisensen er fri — ellers tittel + lenke (men ingen gjengitt tekst).
  const raw = item.first_two_sentences || item.snippet || ''
  const extract = snlLicenseIsFree(item.license) ? stripSnlHtml(raw) : ''
  return {
    source: 'snl',
    title: item.title || item.headword,
    extract,
    url,
    thumbnail: item.first_image_url ?? null,
    clarification: item.clarification ?? null,
    license: item.license ?? null,
  }
}

/**
 * REN: velg beste SNL-treff fra et `/search`-array.
 *  - kun SNL-verket (encyclopedia_id === 1) — dropp SML/NBL (biografier irrelevant)
 *  - kun treff der `accept(query, headword || title)` er sann (injisert matcher)
 *  - krever en brukbar URL
 *  - returnerer FØRSTE aksepterte (SNL er allerede rangert på `rank`)
 *
 * @param {Array} arr   rå SNL-søkerespons
 * @param {string} query  navnet vi søkte på
 * @param {(q:string,t:string)=>boolean} accept  matcher (titleMatches/placeNameMatches)
 * @returns {{source:'snl',title,extract,url,thumbnail,clarification,license}|null}
 */
export function parseSnlSearch(arr, query, accept = titleMatches) {
  if (!Array.isArray(arr) || arr.length === 0) return null
  for (const item of arr) {
    if (!item || item.encyclopedia_id !== 1) continue
    const head = item.headword || item.title
    if (!head || !accept(query, head)) continue
    const res = snlItemToResult(item)
    if (!res.url) continue
    return res
  }
  return null
}

/**
 * Slå opp et navn i SNL. Returnerer `{ source:'snl', ... }` eller null
 * (intet treff / utilgjengelig / CORS-blokkert).
 *
 * @param {string} name
 * @param {{ signal?: AbortSignal, timeoutMs?: number, accept?: Function, limit?: number }} [opts]
 */
export async function fetchSnlSummary(name, opts = {}) {
  if (!name || typeof name !== 'string') return null
  const { signal, timeoutMs = 6000, accept = titleMatches, limit = SEARCH_LIMIT } = opts

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) return null
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const url = `${SNL_API}/search?query=${encodeURIComponent(name)}&limit=${limit}`
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) return null
    return parseSnlSearch(await res.json(), name, accept)
  } catch (e) {
    return null
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

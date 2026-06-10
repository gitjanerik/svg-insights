// Norsk rødliste for arter (Artsdatabanken 2021) — klient-side oppslag.
//
// GBIFs innebygde rødliste-filter er GLOBAL IUCN, ikke den norske vurderingen.
// Den norske rødlista er en egen ekspert-dom (CR/EN/VU/NT i Norge) og må komme
// fra Artsdatabanken. Vi løser det uten ekstra klikk-kall:
//
//   1. Ved bygg (CI, scripts/build-redlist.js) leses Artsdatabankens offisielle
//      Norsk rødliste 2021 (tools/redlist-2021.csv) og lagres som
//      `public/data/redlist-no.json` — et flatt oppslag
//      { gbif-backbone-speciesKey: "CR"|"EN"|"VU"|"NT" }. GBIF brukes kun til å
//      oversette artsnavn → backbone-nøkkel ved bygg.
//   2. Ved long-press gir GBIF-arts-oppslaget allerede speciesKeys i polygonet.
//      Vi snitter dem lokalt mot bundelen — null ekstra nettkall.
//
// Bundelen er valgfri: finnes den ikke (ennå ikke generert / 404), er funksjonen
// i dvale og rødliste-linja vises ikke. Aldri en oppdiktet verdi.

const CATEGORIES = ['CR', 'EN', 'VU', 'NT']

// Lazy, én gang pr økt. null = ikke lastet ennå; {} = lastet men tom/utilgjengelig.
let lookupPromise = null

function bundleUrl() {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/')
  return `${base}data/redlist-no.json`
}

/**
 * Last den norske rødliste-bundelen (cachet for økten). Returnerer et objekt
 * { speciesKey: kategori }, eller {} hvis bundelen mangler/feiler (dvale).
 * @returns {Promise<Record<string, string>>}
 */
export function loadRedList() {
  if (lookupPromise) return lookupPromise
  lookupPromise = fetch(bundleUrl())
    .then((res) => (res.ok ? res.json() : {}))
    .then((data) => (data && typeof data === 'object' ? data : {}))
    .catch(() => ({}))
  return lookupPromise
}

/**
 * Tell rødlistede arter blant et sett GBIF-speciesKeys ved oppslag i bundelen.
 * Ren funksjon — testbar uten nett.
 *
 * @param {number[]} speciesKeys
 * @param {Record<string|number, string>} lookup  { speciesKey: "CR"|… }
 * @returns {{ count: number, byCategory: Record<string, number> }}
 */
export function countRedListed(speciesKeys, lookup) {
  const byCategory = { CR: 0, EN: 0, VU: 0, NT: 0 }
  let count = 0
  if (!Array.isArray(speciesKeys) || !lookup) return { count, byCategory }
  for (const key of speciesKeys) {
    const cat = lookup[key]
    if (cat && CATEGORIES.includes(cat)) {
      byCategory[cat] += 1
      count += 1
    }
  }
  return { count, byCategory }
}

/**
 * Bekvemmelighet: last bundelen og tell på én gang. Returnerer null når
 * bundelen er i dvale (ingen data) så kalleren kan skille «ingen rødlistede»
 * fra «rødliste utilgjengelig».
 * @param {number[]} speciesKeys
 * @returns {Promise<{ count: number, byCategory: Record<string, number> } | null>}
 */
export async function summarizeRedListed(speciesKeys) {
  const lookup = await loadRedList()
  if (!lookup || Object.keys(lookup).length === 0) return null
  return countRedListed(speciesKeys, lookup)
}

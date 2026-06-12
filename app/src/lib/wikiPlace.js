// Nærmeste Wikipedia-sted for et vilkårlig punkt — geotaggede artikler om
// innsjøer, fjelltopper, grender, elver og stedsnavn.
//
// Mens `wikiSummary.js` slår opp et KJENT navn (et verneområde), svarer denne
// på det omvendte spørsmålet: «hvilken Wikipedia-artikkel ligger nærmest disse
// koordinatene?» Det gjør long-press hvor som helst på kartet nyttig, ikke bare
// inne i de grønne verneområdene.
//
// To komplementære strategier (begge MediaWiki Action API, CORS-trygt med
// `origin=*` — samme nett-profil som REST-summary-endepunktet vi alt bruker):
//
//   1. GEOSEARCH (generator=geosearch): nærmeste geotaggede artikkel etter
//      PUNKT-koordinat. Presist for små features (hytter, varder) med eksakt
//      punkt — men store features (innsjøer, fjell) har ett senterpunkt som kan
//      ligge km unna der man trykket, så de under-rangeres.
//   2. NAVN-SØK (generator=search): når vi har et stedsnavn-hint (nærmeste
//      kartlabel), søk på navnet og velg den TITTEL-MATCHENDE artikkelen som
//      ligger nærmest punktet. Fanger «Glitre (innsjø)» selv om hytta ved siden
//      av har et nærmere punkt, og disambiguerer mellom flere «Glitre».
//
// Vi foretrekker navne-treffet når geosearch sitt nærmeste IKKE er det navngitte
// stedet (ellers står man «på Glitre» men kortet viser nabohytta). Feiler/ingen
// treff → null, og kalleren viser ingen sted-seksjon.

import { WIKI_HOSTS, titleMatches } from './wikiSummary.js'

const SEARCH_RADIUS_M = 10000   // geosearch maks-radius (API-grense er 10 km)
const SEARCH_LIMIT = 10
const NAME_MATCH_MAX_M = 8000   // navn-treff må ligge innen 8 km av punktet
const EXTRACT_MAX_CHARS = 280

// Haversine-avstand i meter mellom to WGS84-punkter.
export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// Kutt ingressen til en kort blurb ved en setnings-/ordgrense.
function trimExtract(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= EXTRACT_MAX_CHARS) return t
  const cut = t.slice(0, EXTRACT_MAX_CHARS)
  // Foretrekk siste setningsslutt, ellers siste mellomrom.
  const dot = cut.lastIndexOf('. ')
  if (dot > EXTRACT_MAX_CHARS * 0.5) return cut.slice(0, dot + 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > 0 ? cut.slice(0, sp) : cut).trim() + ' …'
}

// En Action API-side (formatversion=2) → vårt resultat-objekt. Avstand regnes
// fra sidens egne koordinater til oppslags-punktet (null hvis ugeotagget).
function pageToResult(p, lat, lon) {
  const coord = Array.isArray(p.coordinates) ? p.coordinates[0] : null
  const hasCoord = coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lon)
  return {
    source: 'wikipedia',
    title: p.title,
    extract: trimExtract(p.extract),
    url: p.fullurl || p.canonicalurl || null,
    thumbnail: p.thumbnail?.source ?? null,
    lat: hasCoord ? coord.lat : null,
    lon: hasCoord ? coord.lon : null,
    distanceM: hasCoord ? Math.round(haversineM(lat, lon, coord.lat, coord.lon)) : null,
  }
}

// Brukbar artikkel-side: har tittel, finnes, og er ikke en peker-/flertydig side.
function isUsablePage(p) {
  return p && p.title && !p.missing && p.pageprops?.disambiguation === undefined
}

// Norske terreng-/vann-ord i bestemt/ubestemt og dialektform, normalisert til
// én felles stamme så formene kollapser sammen ved matching. Anker til slutten
// av navnet (ordet er typisk siste ledd: «Bondivannet», «Svartputten»,
// «Storelva»). Lengste/mest spesifikke varianter først så de vinner.
const FEATURE_FORMS = [
  [/(vatnet|vannet|vatn|vann)$/, 'vatn'],          // vann/vatn/-et
  [/(tjernet|tjønna|tjønn|tjenn|tjern)$/, 'tjern'], // tjern/tjønn/-et
  [/(putten|pytten|putte|putt|pytt)$/, 'putt'],    // putt/pytt/-en
  [/(sjøen|sjø)$/, 'sjø'],                          // sjø/-en
  [/(myra|myren|myr)$/, 'myr'],                     // myr/-a/-en
  [/(bekken|bekk)$/, 'bekk'],                       // bekk/-en
  [/(elven|elva|elv)$/, 'elv'],                     // elv/-en/-a
]

// Norsk stedsnavn-stamme for løs matching: dropp parentes-disambiguering,
// normaliser terreng-/vann-ord (FEATURE_FORMS) og generell nøytrum bestemt form
// (-et/-ene). Slik matcher «Bondivannet»~«Bondivann», «Langtjernet»~«Langtjern»,
// «Storelva»~«Storelv», «Bjørnemyra»~«Bjørnemyr», «Fjellet»~«Fjell». Brukt KUN
// for stedsoppslag (geosearch-kortet), der koordinat-nærhet uansett verifiserer
// treffet — ikke for verneområde-matchingen i wikiSummary, som holder seg streng
// (å/ø/æ-distinkt).
export function placeStem(s) {
  let t = String(s ?? '')
    .normalize('NFC').toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')          // dropp «(innsjø)»-disambiguering
    .replace(/\s+/g, ' ').trim()
  for (const [re, canon] of FEATURE_FORMS) {
    if (re.test(t)) { t = t.replace(re, canon); return t }
  }
  return t.replace(/(et|ene)$/, '')           // nøytrum bestemt form: Fjellet→Fjell
}

// Matcher et stedsnavn mot en artikkeltittel. Først streng (titleMatches: håndterer
// verneform-suffiks + holder å/ø/æ distinkt), så løs norsk stedsnavn-stamme.
export function placeNameMatches(query, title) {
  if (titleMatches(query, title)) return true
  const q = placeStem(query)
  const t = placeStem(title)
  return !!q && !!t && q === t
}

// «Første del» av et flerleddet stedsnavn: stammen uten siste ord. «Hjerkinn
// stasjon» → «hjerkinn», «Gaustatoppen» → '' (ettords-navn → ingen bredere del).
// Brukt til å finne den OVERORDNEDE artikkelen (selve stedet) ved siden av den
// spesifikke (stasjonen/toppen) når begge har egne oppslag.
export function firstPartStem(title) {
  const s = placeStem(title)
  const i = s.lastIndexOf(' ')
  return i > 0 ? s.slice(0, i).trim() : ''
}

/**
 * Finn en OVERORDNET «første del»-artikkel i en liste kandidat-sider (geosearch
 * + navn-søk): stedet hvis stamme er lik primær-artikkelens første del
 * («Hjerkinn» ved siden av «Hjerkinn stasjon»). Returnerer nærmeste DISTINKTE
 * treff, eller null når ingen slik artikkel finnes. Ren funksjon (testbar).
 *
 * @param {Array} pages   rå kandidat-sider (formatversion=2)
 * @param {{title:string,url:string}} primary  den valgte primær-artikkelen
 * @param {number} lat
 * @param {number} lon
 */
export function pickBroaderPlace(pages, primary, lat, lon) {
  if (!primary || !Array.isArray(pages)) return null
  const target = firstPartStem(primary.title)
  if (!target) return null
  let best = null
  for (const p of pages) {
    if (!isUsablePage(p) || placeStem(p.title) !== target) continue
    const r = pageToResult(p, lat, lon)
    if (!r.url || r.url === primary.url) continue
    if (!best || (r.distanceM ?? Infinity) < (best.distanceM ?? Infinity)) best = r
  }
  return best
}

/**
 * Plukk den nærmeste geotaggede artikkelen fra et geosearch-svar
 * (formatversion=2 → `query.pages` er et array med `index` i avstands-rekkefølge).
 * Foretrekker nærmeste artikkel som faktisk har en ingress; faller tilbake til
 * nærmeste uansett. Returnerer null hvis ingen brukbar side finnes.
 */
export function parseNearestPlace(json, lat, lon) {
  const pages = json?.query?.pages
  if (!Array.isArray(pages) || pages.length === 0) return null
  const sorted = pages
    .filter(isUsablePage)
    .sort((a, b) => (a.index ?? 1e9) - (b.index ?? 1e9))
  if (sorted.length === 0) return null
  const withExtract = sorted.find((p) => String(p.extract ?? '').trim())
  return pageToResult(withExtract ?? sorted[0], lat, lon)
}

/**
 * Plukk den tittel-matchende artikkelen som ligger nærmest punktet fra et
 * navn-søk-svar. Disambiguerer flere «Glitre» via koordinat-nærhet (innen
 * NAME_MATCH_MAX_M). Hvis ingen kandidat er geotagget men nøyaktig én tittel
 * matcher, godtas den (best effort — typisk en unik, ugeotagget artikkel).
 */
export function parseNamedNearest(json, lat, lon, name) {
  const pages = json?.query?.pages
  if (!Array.isArray(pages) || pages.length === 0) return null
  const matches = pages.filter((p) => isUsablePage(p) && placeNameMatches(name, p.title))
  if (matches.length === 0) return null

  let best = null
  for (const p of matches) {
    const c = Array.isArray(p.coordinates) ? p.coordinates[0] : null
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue
    const d = haversineM(lat, lon, c.lat, c.lon)
    if (d <= NAME_MATCH_MAX_M && (!best || d < best.d)) best = { p, d }
  }
  if (best) return pageToResult(best.p, lat, lon)
  // Entydig-navn-fallback gjelder KUN ugeotaggede kandidater (umulig å verifisere
  // avstand). En geotagget kandidat som ikke nådde `best` er verifisert for langt
  // unna → avvis (feil feature med samme navn).
  if (matches.length === 1) {
    const c = Array.isArray(matches[0].coordinates) ? matches[0].coordinates[0] : null
    const geotagged = c && Number.isFinite(c.lat) && Number.isFinite(c.lon)
    if (!geotagged) return pageToResult(matches[0], lat, lon)
  }
  return null
}

// Felles prop-sett: ingress + koordinater + miniatyr + url + flertydig-flagg.
const PROP_PARAMS = {
  prop: 'extracts|coordinates|pageimages|info|pageprops',
  exintro: '1',
  explaintext: '1',
  piprop: 'thumbnail',
  pithumbsize: '200',
  inprop: 'url',
  ppprop: 'disambiguation',
}

function geosearchUrl(host, lat, lon) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2',
    generator: 'geosearch',
    ggscoord: `${lat}|${lon}`,
    ggsradius: String(SEARCH_RADIUS_M),
    ggslimit: String(SEARCH_LIMIT),
    ggsnamespace: '0',
    ...PROP_PARAMS,
    origin: '*',
  })
  return `${host}/w/api.php?${params}`
}

function namedSearchUrl(host, name) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2',
    generator: 'search',
    gsrsearch: name,
    gsrlimit: String(SEARCH_LIMIT),
    gsrnamespace: '0',
    ...PROP_PARAMS,
    origin: '*',
  })
  return `${host}/w/api.php?${params}`
}

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  if (!res.ok) return null
  return res.json()
}

/**
 * Finn den mest relevante Wikipedia-artikkelen nær et WGS84-punkt. Kombinerer
 * geosearch (nærmeste punkt) med et valgfritt navn-søk (`hintName`, typisk
 * nærmeste kartlabel) og foretrekker navne-treffet når geosearch ikke landet på
 * det navngitte stedet. Prøver norsk Wikipedia først, så engelsk. Returnerer
 * `{ title, extract, url, thumbnail, lat, lon, distanceM }` eller null.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {{ signal?: AbortSignal, timeoutMs?: number, hintName?: string }} [opts]
 */
export async function fetchNearestWikiPlace(lat, lon, opts = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const { signal, timeoutMs = 7000, hintName = null } = opts
  const hint = typeof hintName === 'string' ? hintName.trim() : ''

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) return null
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    for (const host of WIKI_HOSTS) {
      let geo = null
      let named = null
      let pages = []   // alle kandidat-sider (geosearch + navn-søk) for «bredere»-oppslag
      try {
        const j = await fetchJson(geosearchUrl(host, lat, lon), ctrl.signal)
        if (j) { geo = parseNearestPlace(j, lat, lon); pages = pages.concat(j?.query?.pages ?? []) }
      } catch (e) { if (ctrl.signal.aborted) return null }

      if (hint) {
        try {
          const j = await fetchJson(namedSearchUrl(host, hint), ctrl.signal)
          if (j) { named = parseNamedNearest(j, lat, lon, hint); pages = pages.concat(j?.query?.pages ?? []) }
        } catch (e) { if (ctrl.signal.aborted) return null }
      }

      // PRIMÆR (mest spesifikk): foretrekk navne-treffet med mindre geosearch sitt
      // nærmeste ER nøyaktig samme feature (stamme-likt) — ikke bare en bredere
      // prefiks. «Hjerkinn» er ikke «Hjerkinn stasjon». Tidligere brukte vi
      // placeNameMatches her, men den godtar prefiks-subsumering («Hjerkinn» ~
      // «Hjerkinn stasjon») og lot det brede stedet sluke det spesifikke navnet,
      // så geosearch sitt nærmeste («Hjerkinn») vant over det eksakte treffet.
      const geoExact = !!geo && placeStem(hint) === placeStem(geo.title)
      const primary = (named && !geoExact) ? named : (geo ?? named)
      if (!primary) continue   // intet treff på dette språket → prøv neste

      // SEKUNDÆR: den overordnede «første del»-artikkelen (selve stedet) når den
      // har et eget oppslag, så kortet kan vise lenke til BEGGE («Hjerkinn stasjon»
      // som tekst + lenke, og «Hjerkinn» som ekstra lenke).
      const secondary = pickBroaderPlace(pages, primary, lat, lon)
      return secondary ? { ...primary, secondary } : primary
    }
    return null
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

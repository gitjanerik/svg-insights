// Kulturminner fra Kulturminnesøk «brukerminner» (Riksantikvaren).
//
// Åpen OGC API Features-tjeneste (ldproxy): brukerregistrerte kulturminner som
// GeoJSON-punkter. Vi henter alle funn innenfor kartutsnittets bbox og viser dem
// som klikkbare ikoner, klassifisert på type utledet fra tittelen (tjenesten har
// ikke noe eget kategori-felt).
//
// To kall:
//   fetchKulturminner(bbox)      → lett liste (id/lat/lon/tittel/kategori) for
//                                  rendering. Følger `next`-paginering til et tak.
//   fetchKulturminneById(id)     → fullt detalj-objekt (beskrivelse, sted, bilder)
//                                  hentet lazy når brukeren klikker et ikon.
//
// CORS er verifisert: api.ra.no sender `access-control-allow-origin: *`, så alt
// kjører rent klient-side (som Overpass/Kartverket/NVE). Feiler tjenesten →
// returner []/null, aldri kast (samme kontrakt som verneFetcher/nveLakeFetcher).

const ITEMS_URL =
  import.meta.env?.VITE_KULTURMINNE_URL ??
  'https://api.ra.no/brukerminner/collections/brukerminner/items'

// Klassifiserings-regler: tittel-nøkkelord → kategori. Rekkefølgen er signifikant
// — «dyregrav»/«fangstgrav» inneholder «grav» men er FANGST, så fangst-reglene må
// prøves før gravminne. Første treff vinner.
const KATEGORI_REGLER = [
  ['fangst', ['fangstgrop', 'fangstgrav', 'fangstlok', 'fangstanlegg', 'dyregrav', 'bogastelle', 'ledegjerde', 'fangst']],
  ['gravminne', ['gravhaug', 'gravfelt', 'gravrøys', 'gravminne', 'gravplass', 'haug', 'røys', 'grav']],
  ['stein', ['bautastein', 'helleristning', 'steinsetning', 'rodestein', 'steinkors', 'reist stein', 'bergkunst', 'ristning']],
  ['bygning', ['bygning', 'hustuft', 'tuft', 'murer', 'mur', 'kirke', 'kai', 'brygge', 'kvern', 'sag', 'hus']],
]

const GYLDIGE_KATEGORIER = new Set([...KATEGORI_REGLER.map(([k]) => k), 'annet'])

/**
 * Utled kategori fra en kulturminne-tittel via nøkkelord.
 * @param {string} tittel
 * @returns {'fangst'|'gravminne'|'stein'|'bygning'|'annet'}
 */
export function kulturminneKategori(tittel) {
  const s = String(tittel ?? '').toLowerCase()
  for (const [kat, ord] of KATEGORI_REGLER) {
    if (ord.some((o) => s.includes(o))) return kat
  }
  return 'annet'
}

// Rydd i beskrivelse-teksten fra API-et. Kulturminnesøk serialiserer et
// felt-mal-oppsett inn i `beskrivelse`, og tomme underfelt havner som den
// LITERALE strengen «null» — f.eks. «Beskrivelse: null» øverst når kort-
// beskrivelsen mangler. Vi fjerner slike «<etikett>: null»-linjer (kun når
// verdien er nøyaktig «null»), men lar ekte tekst stå urørt.
export function cleanBeskrivelse(raw) {
  if (raw == null) return ''
  return String(raw)
    .split('\n')
    .filter((line) => !/^\s*[^\n:]{1,40}:\s*null\s*$/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function coordsToLatLon(geometry) {
  const c = geometry?.coordinates
  if (!Array.isArray(c) || c.length < 2) return null
  const lon = Number(c[0])
  const lat = Number(c[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon }
}

// Lett objekt for rendering — kun det bygge-passet trenger (posisjon + klasse).
// Detaljer hentes lazy ved klikk (fetchKulturminneById) for å holde kart-SVG-en
// liten (self-contained kart lagres som full SVG-tekst).
function mapFeatureLight(f) {
  const ll = coordsToLatLon(f?.geometry)
  if (!ll) return null
  const id = f?.id
  if (!id) return null
  const tittel = f?.properties?.tittel ?? ''
  return { id: String(id), lat: ll.lat, lon: ll.lon, tittel, kategori: kulturminneKategori(tittel) }
}

// Fullt detalj-objekt for detalj-skuffen.
function mapFeatureFull(f) {
  const light = mapFeatureLight(f)
  if (!light) return null
  const p = f.properties ?? {}
  const bilder = Array.isArray(p.bilder)
    ? p.bilder
        .filter((b) => b && typeof b.url === 'string' && b.url)
        .map((b) => ({
          url: b.url,
          fotograf: b.fotograf ?? null,
          lisens: b.lisens ?? null,
          beskrivelse: b.beskrivelse ?? null,
        }))
    : []
  return {
    ...light,
    beskrivelse: cleanBeskrivelse(p.beskrivelse),
    fylke: p.fylke ?? null,
    kommune: p.kommune ?? null,
    opprettet: p.opprettet ?? null,
    opprettetAv: p.opprettet_av ?? null,
    link: typeof p.linkkulturminnesok === 'string' ? p.linkkulturminnesok : null,
    bilder,
  }
}

function buildBboxUrl(bbox, limit) {
  const { south, west, north, east } = bbox ?? {}
  const params = new URLSearchParams({
    bbox: `${west},${south},${east},${north}`,
    f: 'json',
    limit: String(limit),
  })
  return `${ITEMS_URL}?${params}`
}

function nextLink(json) {
  const links = json?.links
  if (!Array.isArray(links)) return null
  const n = links.find((l) => l?.rel === 'next' && typeof l.href === 'string')
  return n?.href ?? null
}

// Felles abort+timeout-wrapper (samme mønster som verneFetcher), med retry.
// Returnerer `fallback` ved feil/abort/timeout — kaster aldri. `retries` gir
// ett ekstra forsøk ved transient nett-/timeout-feil (mobilnett er flakete —
// et enkelt timeout ved bygging bakte ellers 0 kulturminner inn i kartet).
async function safeFetchJson(url, { signal, timeoutMs, retries = 2 }, fallback) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) return fallback
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/geo+json' } })
      if (res.ok) return await res.json()
      // ikke-ok (evt. transient 5xx) → prøv igjen
    } catch (e) {
      if (signal?.aborted) return fallback
      if (attempt === retries) console.warn(`[Kulturminne] Henting feilet (${retries + 1} forsøk): ${e?.message ?? e}`)
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    if (attempt < retries && !signal?.aborted) await new Promise((r) => setTimeout(r, 600))
  }
  return fallback
}

/**
 * Hent alle kulturminner (brukerminner) innenfor en bbox.
 * @param {{south:number, west:number, north:number, east:number}} bbox
 * @param {{ signal?: AbortSignal, timeoutMs?: number, limit?: number, maxTotal?: number }} [opts]
 * @returns {Promise<Array<{id:string, lat:number, lon:number, tittel:string, kategori:string}>>}
 */
export async function fetchKulturminner(bbox, opts = {}) {
  if (!bbox || ![bbox.south, bbox.west, bbox.north, bbox.east].every(Number.isFinite)) return []
  const { signal, timeoutMs = 12000, limit = 250, maxTotal = 500 } = opts

  const out = []
  let url = buildBboxUrl(bbox, limit)
  let guard = 0
  let truncated = false
  while (url && out.length < maxTotal && guard < 20) {
    guard++
    const json = await safeFetchJson(url, { signal, timeoutMs }, null)
    if (!json) break
    const feats = Array.isArray(json.features) ? json.features : []
    for (const f of feats) {
      const m = mapFeatureLight(f)
      if (m) out.push(m)
      if (out.length >= maxTotal) break
    }
    const next = nextLink(json)
    if (out.length >= maxTotal) {
      truncated = !!next   // vi stoppet pga taket, men flere sider fantes
      url = null
    } else {
      url = next
    }
  }

  if (truncated) {
    console.warn(`[Kulturminne] Nådde taket på ${maxTotal} funn i bbox — flere finnes, men vises ikke (unngår rot).`)
  }
  return out
}

/**
 * Hent fullt detalj-objekt for ett kulturminne (til detalj-skuffen).
 * @param {string} id  UUID
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<object | null>}
 */
export async function fetchKulturminneById(id, opts = {}) {
  if (!id) return null
  const { signal, timeoutMs = 9000 } = opts
  const url = `${ITEMS_URL}/${encodeURIComponent(id)}?f=json`
  const json = await safeFetchJson(url, { signal, timeoutMs }, null)
  if (!json || json.type !== 'Feature') return null
  return mapFeatureFull(json)
}

export { GYLDIGE_KATEGORIER }

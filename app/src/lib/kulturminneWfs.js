// Offisielle fredede kulturminner (Riksantikvaren/Askeladden) som EKTE VEKTOR
// via Geonorge WFS — https://wfs.geonorge.no/skwms1/wfs.kulturminner
//
// Dette er kilden vi lette lenge etter: WFS 2.0.0 (deegree), CORS `*`, bbox-
// filter, geometri, rike felt OG `resultType=hits` for eksakt antall. Erstatter
// det tidligere WMS-raster-forsøket (se minne «askeladden-no-vector-api»).
//
// Vi henter LOKALITETER (sted-nivå = færre, ryddigere enn enkeltminner) i
// kartets bbox, regner et sentroide fra flate-geometrien, og MapView tegner dem
// som egne vektor-ikoner (roterer/zoomer/print-trygt) med klikk → detalj + lenke.
//
// Output er GML 3.2 (ikke GeoJSON) — vi parser med regex (DOM-fri, testbar).
// EPSG:4258 (ETRS89) ≈ WGS84; akserekkefølge lat,lon (både i bbox og posList).

const WFS_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_KULTURMINNE_WFS_URL) ||
  'https://wfs.geonorge.no/skwms1/wfs.kulturminner'
const APP_NS = 'http://skjema.geonorge.no/SOSI/produktspesifikasjon/LokaliteterEnkeltminnerOgSikringssoner/20210217'
// Enkeltminne (ikke Lokalitet): gir detalj PR KOORDINAT — hvert enkeltminne har
// eget navn (f.eks. «Kasernen», «Ammunisjonsarbeidshus», bunker/stilling) og egen
// `informasjon`. Lokalitet-nivå ga samme tekst for hele f.eks. «Oscarsborg festning».
const TYPE = 'app:Enkeltminne'
const CRS = 'urn:ogc:def:crs:EPSG::4258'

function bboxParam(bbox) {
  // EPSG:4258 → lat,lon-rekkefølge, med CRS-URI som femte ledd (WFS 2.0.0).
  return `${bbox.south},${bbox.west},${bbox.north},${bbox.east},${CRS}`
}

/**
 * Bygg WFS GetFeature-URL. `hits: true` gir kun antall (numberMatched), ellers
 * hentes inntil `count` features med geometri.
 */
export function buildWfsUrl(bbox, { hits = false, count = 400 } = {}) {
  const p = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: TYPE,
    namespaces: `xmlns(app,${APP_NS})`,
    srsName: CRS,
    bbox: bboxParam(bbox),
  })
  if (hits) p.set('resultType', 'hits')
  else p.set('count', String(count))
  return `${WFS_BASE}?${p}`
}

async function safeFetchText(url, { signal, timeoutMs = 12000, retries = 1 }) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) return null
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (res.ok) return await res.text()
    } catch (e) {
      if (signal?.aborted) return null
      if (attempt === retries) console.warn(`[Fredet-kulturminne] WFS feilet (${retries + 1} forsøk): ${e?.message ?? e}`)
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    if (attempt < retries && !signal?.aborted) await new Promise((r) => setTimeout(r, 600))
  }
  return null
}

/** Rask teller (numberMatched) for kartets bbox — liten payload, ingen geometri. */
export async function fetchFredaCount(bbox, opts = {}) {
  if (!bbox || ![bbox.south, bbox.west, bbox.north, bbox.east].every(Number.isFinite)) return null
  const txt = await safeFetchText(buildWfsUrl(bbox, { hits: true }), opts)
  if (!txt) return null
  const m = txt.match(/numberMatched="?(\d+)"?/)
  return m ? Number(m[1]) : null
}

/**
 * Hent lokaliteter i bbox som flate objekter.
 * @returns {Promise<Array<{id,lat,lon,navn,art,vernetype,kommune,link,kategori}>>}
 */
export async function fetchFredaKulturminner(bbox, opts = {}) {
  if (!bbox || ![bbox.south, bbox.west, bbox.north, bbox.east].every(Number.isFinite)) return []
  const txt = await safeFetchText(buildWfsUrl(bbox, { count: opts.maxTotal ?? 600 }), opts)
  if (!txt) return []
  return parseWfsKulturminner(txt)
}

// Enkel klynging: dropp punkter som ligger nærmere enn `minM` meter fra et
// allerede beholdt punkt (greedy, i input-rekkefølge). Tette lokalitet-felt
// (Håøya har 244) blir ellers en uleselig klump ved oversikts-zoom.
export function clusterByMinMeters(items, minM = 45) {
  const kept = []
  const R = 6371000, toRad = Math.PI / 180
  const near = (a, b) => {
    const lat0 = ((a.lat + b.lat) / 2) * toRad
    const dLat = (b.lat - a.lat) * toRad
    const dLon = (b.lon - a.lon) * toRad * Math.cos(lat0)
    return R * Math.hypot(dLat, dLon) < minM
  }
  for (const it of items) {
    if (!kept.some((k) => near(k, it))) kept.push(it)
  }
  return kept
}

// Sentroide (gjennomsnitt) fra en gml:posList «lat lon lat lon …» (EPSG:4258).
export function centroidFromPosList(posList) {
  if (!posList) return null
  const nums = posList.trim().split(/\s+/).map(Number)
  if (nums.length < 2) return null
  let sLat = 0, sLon = 0, n = 0
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const lat = nums[i], lon = nums[i + 1]
    if (Number.isFinite(lat) && Number.isFinite(lon)) { sLat += lat; sLon += lon; n++ }
  }
  if (!n) return null
  return { lat: sLat / n, lon: sLon / n }
}

// `informasjon` på et enkeltminne er ofte «Beskrivelse fra lokalitet: <felles>
// [nl][nl] Beskrivelse fra Enkeltminne: <unik>». Del i to så vi kan vise den
// UNIKE (enkeltminne-)teksten tydelig og lokalitet-teksten som sekundær kontekst
// — ellers ser alle punktene i f.eks. «Oscarsborg festning» like ut på toppen.
export function splitInformasjon(raw) {
  if (!raw) return { enkeltminne: null, lokalitet: null }
  const s = String(raw)
  const enkIdx = s.search(/Beskrivelse fra Enkeltminne\s*:/i)
  const lokIdx = s.search(/Beskrivelse fra lokalitet\s*:/i)
  if (enkIdx >= 0) {
    const enk = s.slice(enkIdx).replace(/^Beskrivelse fra Enkeltminne\s*:\s*/i, '').trim()
    let lok = null
    if (lokIdx >= 0 && lokIdx < enkIdx) {
      lok = s.slice(lokIdx, enkIdx).replace(/^Beskrivelse fra lokalitet\s*:\s*/i, '').trim() || null
    }
    return { enkeltminne: enk || null, lokalitet: lok }
  }
  const whole = s.replace(/^Beskrivelse fra lokalitet\s*:\s*/i, '').trim()
  return { enkeltminne: whole || null, lokalitet: null }
}

function firstTag(block, tag) {
  // Tåler æ/ø/å i tagnavn (linkKulturminnesøk, område …).
  const re = new RegExp(`<app:${tag}>([^<]*)</app:${tag}>`, 'i')
  const m = block.match(re)
  return m ? decodeEntities(m[1].trim()) : null
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

// WFS-en gir vernetype som SOSI-KODE (ikke tekst). Kartlegg til lesbar tekst +
// farge-kategori. (Observerte koder: AUT, VED, LIST, UAV, IKKEV, FJE, FPG.)
const VERNETYPE = {
  AUT: ['Automatisk fredet', 'automatisk'],
  VED: ['Vedtaksfredet', 'vedtak'],
  MFR: ['Midlertidig fredet', 'vedtak'],
  FPG: ['Fredet', 'vedtak'],
  LIST: ['Listeført', 'listefort'],
  FJE: ['Fjernet', 'annet'],
  UAV: ['Uavklart vern', 'annet'],
  IKKEV: ['Ikke fredet', 'annet'],
}
export function vernInfo(code) {
  const k = String(code ?? '').toUpperCase()
  const v = VERNETYPE[k]
  return { text: v ? v[0] : (code || null), kategori: v ? v[1] : 'annet' }
}

/**
 * Parse GML 3.2 fra WFS til enkeltminne-objekter. Ett pr <app:Enkeltminne>.
 * Hvert enkeltminne har eget navn + informasjon → detalj pr koordinat.
 * @param {string} gml
 */
export function parseWfsKulturminner(gml) {
  if (!gml || typeof gml !== 'string') return []
  const out = []
  const blockRe = /<app:Enkeltminne\b[\s\S]*?<\/app:Enkeltminne>/g
  let m
  while ((m = blockRe.exec(gml))) {
    const block = m[0]
    const posMatch = block.match(/<gml:posList[^>]*>([^<]+)<\/gml:posList>/)
    let c = posMatch ? centroidFromPosList(posMatch[1]) : null
    if (!c) {
      const pt = block.match(/<gml:pos[^>]*>([^<]+)<\/gml:pos>/)
      c = pt ? centroidFromPosList(pt[1]) : null
    }
    if (!c) continue
    const idm = block.match(/gml:id="([^"]+)"/)
    const link = firstTag(block, 'linkKulturminnesøk')
    const vi = vernInfo(firstTag(block, 'vernetype'))
    out.push({
      id: firstTag(block, 'kulturminneId') || firstTag(block, 'lokalId') || idm?.[1] || null,
      lat: c.lat,
      lon: c.lon,
      navn: firstTag(block, 'navn'),
      // lokalitetsart er en tallkode i WFS-en (ikke lesbar) → utelatt; full
      // lesbar info ligger i `informasjon` og bak kulturminnesok-lenken.
      vernetype: vi.text,
      kategori: vi.kategori,
      ...(() => { const s = splitInformasjon(firstTag(block, 'informasjon')); return { informasjon: s.enkeltminne, lokalitetInfo: s.lokalitet } })(),
      kommune: firstTag(block, 'kommune'),
      link: link && /^https?:\/\//i.test(link) ? link : null,
    })
  }
  return out
}

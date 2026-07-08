// Berik en rute med det som finnes LANGS den: fredede kulturminner, verne-
// områder (naturreservat o.l.) den går gjennom, og biologisk mangfold /
// rødlistede arter i korridoren rundt. Gjenbruker de eksisterende, DOM-frie
// fetcherne (kulturminneWfs, verneFetcher, gbifSpecies, redListNo) — dette er
// ren orkestrering + geometri, så både MCP-serveren (berik_rute / turrapport)
// og appen kan bruke det.
//
// Testbart: fetcherne injiseres (`fetchers`), og koordinat-konvertering
// (`toWgs84`/`toSvg`) tas inn, så kjernen kjører uten nett. Nett-feil i en
// enkeltkilde svelges (try/catch) → seksjonen blir tom + `kilder`-flagget false,
// aldri en oppdiktet verdi.

// Rute-koordinater er i SVG-meter (viewBox = meter), så avstander regnes rett
// i det rommet.

// Kumulativ lengde til hvert rute-punkt (meter).
function cumulativeLengths(route) {
  const out = [0]
  for (let i = 1; i < route.length; i++) {
    out.push(out[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]))
  }
  return out
}

// Minste avstand fra punkt p til rute-polylinjen + hvor langt LANGS ruten
// (meter) fotpunktet ligger. Ren geometri i SVG-meter.
export function distanceToRoute(p, route, cum = cumulativeLengths(route)) {
  let best = Infinity, bestAlong = 0
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i], b = route[i + 1]
    const vx = b[0] - a[0], vy = b[1] - a[1]
    const len2 = vx * vx + vy * vy
    let t = len2 === 0 ? 0 : ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2
    if (t < 0) t = 0; else if (t > 1) t = 1
    const px = a[0] + t * vx, py = a[1] + t * vy
    const d = Math.hypot(p[0] - px, p[1] - py)
    if (d < best) { best = d; bestAlong = cum[i] + t * Math.hypot(vx, vy) }
  }
  return { distM: best, alongM: bestAlong }
}

// Punkter jevnt langs ruten (hvert `stepM`, inkl. start/slutt), maks `maxN`.
// Brukes til å sample verneområde-oppslag (punkt-baserte kall) langs traséen.
export function samplePointsAlong(route, stepM, maxN = 16) {
  if (route.length < 2) return route.slice()
  const cum = cumulativeLengths(route)
  const total = cum[cum.length - 1]
  const n = Math.min(maxN, Math.max(2, Math.floor(total / stepM) + 1))
  const out = []
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total
    let i = 1
    while (i < cum.length && cum[i] < target) i++
    const a = route[i - 1], b = route[Math.min(i, route.length - 1)]
    const seg = cum[Math.min(i, cum.length - 1)] - cum[i - 1] || 1
    const t = Math.max(0, Math.min(1, (target - cum[i - 1]) / seg))
    out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), target])
  }
  return out
}

// WGS84-bbox rundt ruten, utvidet med `bufferM`. `routeWgs` = [[lon,lat],...].
export function routeBboxWgs84(routeWgs, bufferM = 150) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity
  for (const [lon, lat] of routeWgs) {
    if (lat < s) s = lat; if (lat > n) n = lat
    if (lon < w) w = lon; if (lon > e) e = lon
  }
  if (!Number.isFinite(s)) return null
  const dLat = bufferM / 111000
  const midLat = (s + n) / 2
  const dLon = bufferM / (111000 * Math.max(0.1, Math.cos(midLat * Math.PI / 180)))
  return { south: s - dLat, west: w - dLon, north: n + dLat, east: e + dLon }
}

// Bbox → CCW lukket ring [[lon,lat],...] (for GBIF-geometri).
export function bboxToRing(bbox) {
  const { south: s, west: w, north: n, east: e } = bbox
  return [[w, s], [e, s], [e, n], [w, n], [w, s]]
}

// Fjern dublett-verneområder (samme navn), behold første forekomst.
export function dedupeByName(areas) {
  const seen = new Set()
  const out = []
  for (const a of areas) {
    const key = (a?.navn ?? '').toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

/**
 * Berik en rute. Alt nettverk er injisert via `fetchers` og svelges ved feil.
 *
 * @param {Array<[number,number]>} routeSvg  rute i SVG-meter
 * @param {{
 *   toWgs84:(x:number,y:number)=>{lat:number,lon:number},
 *   toSvg:(lat:number,lon:number)=>{x:number,y:number},
 *   bufferM?:number, sampleStepM?:number, maxAreaSamples?:number, maxSpecies?:number,
 *   fetchers:{ fetchFredaKulturminner:Function, fetchProtectedArea:Function, fetchSpeciesSummary:Function },
 *   collectRedListed:Function, redListLookup?:object|null, signal?:AbortSignal,
 * }} opts
 * @returns {Promise<{kulturminner:Array, reservater:Array, arter:object|null, kilder:object}>}
 */
export async function enrichRoute(routeSvg, opts) {
  const {
    toWgs84, toSvg, bufferM = 150, sampleStepM = 350, maxAreaSamples = 10, maxSpecies = 12,
    areaTimeoutMs = 5000, fetchers, collectRedListed, redListLookup = null, signal,
  } = opts
  const route = routeSvg
  const cum = cumulativeLengths(route)
  const routeWgs = route.map(([x, y]) => { const ll = toWgs84(x, y); return [ll.lon, ll.lat] })
  const bbox = routeBboxWgs84(routeWgs, bufferM)
  const kilder = { kulturminne: false, vern: false, arter: false }

  // 1. Fredede kulturminner i bbox → behold de innen bufferM fra traséen.
  let kulturminner = []
  try {
    const raw = await fetchers.fetchFredaKulturminner(bbox, { signal })
    kilder.kulturminne = Array.isArray(raw)
    for (const k of raw ?? []) {
      const s = toSvg(k.lat, k.lon)
      const { distM, alongM } = distanceToRoute([s.x, s.y], route, cum)
      if (distM <= bufferM) {
        kulturminner.push({
          navn: k.navn, vernetype: k.vernetype, kategori: k.kategori,
          kommune: k.kommune, link: k.link,
          avstandM: Math.round(distM), langsM: Math.round(alongM),
        })
      }
    }
    kulturminner.sort((a, b) => a.langsM - b.langsM)
  } catch { /* kilde nede → tom */ }

  // 2. Verneområder langs traséen (punkt-oppslag på jevne prøvepunkter).
  // Parallelt med kort timeout — sekvensielt ville en nede tjeneste henge
  // maxAreaSamples × timeout (offline: ~1 min); parallelt er det ~én timeout.
  let reservater = []
  try {
    const samples = samplePointsAlong(route, sampleStepM, maxAreaSamples)
    const hits = (await Promise.all(samples.map(async ([x, y, along]) => {
      if (signal?.aborted) return null
      const ll = toWgs84(x, y)
      const area = await fetchers.fetchProtectedArea(ll.lat, ll.lon, { signal, timeoutMs: areaTimeoutMs })
      return area?.navn ? { ...area, langsM: Math.round(along) } : null
    }))).filter(Boolean).sort((a, b) => a.langsM - b.langsM)
    kilder.vern = true
    reservater = dedupeByName(hits).map(a => ({
      navn: a.navn, verneform: a.verneform, vernedato: a.vernedato,
      arealKm2: a.arealKm2, forvaltning: a.forvaltning, faktaarkUrl: a.faktaarkUrl,
      langsM: a.langsM,
    }))
  } catch { /* kilde nede → tom */ }

  // 3. Arter / rødliste i korridoren (GBIF på bbox-ring, snittet mot norsk rødliste).
  let arter = null
  try {
    const ring = bboxToRing(bbox)
    const midLat = (bbox.south + bbox.north) / 2, midLon = (bbox.west + bbox.east) / 2
    const summary = await fetchers.fetchSpeciesSummary(
      { rings: [ring], lat: midLat, lon: midLon, areaKm2: 4 }, { signal })
    if (summary) {
      kilder.arter = true
      const red = redListLookup ? collectRedListed(summary.speciesKeys ?? [], redListLookup) : null
      arter = {
        observasjoner: summary.observationCount ?? 0,
        arter: summary.speciesCount ?? 0,
        arterCappet: !!summary.speciesCapped,
        rodliste: red ? {
          antall: red.count,
          perKategori: red.byCategory,
          arter: (red.species ?? []).slice(0, maxSpecies).map(s => ({
            kategori: s.category, vitenskapelig: s.sci, norsk: s.vern, gruppe: s.group,
          })),
        } : null,
      }
    }
  } catch { /* kilde nede → null */ }

  return { kulturminner, reservater, arter, kilder }
}

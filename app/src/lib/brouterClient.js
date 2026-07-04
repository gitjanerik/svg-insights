// BRouter-klient for Ruteplanleggeren: profil-opplasting + ruteberegning mot
// den offentlige brouter.de-serveren (samme API som bikerouter.de bruker fra
// nettleser — CORS er åpent).
//
// Fair use: donasjonsdrevet tjeneste — ett kall per brukerhandling, ingen
// polling. Attribusjon vises i UI-et («Ruting: BRouter (brouter.de)»).
//
// MERK (sandkasse): brouter.de er ikke nåbar fra CI-/utviklingssandkassen
// (proxy-blokkert), så parseren er skrevet mot dokumentert responsformat med
// syntetisk fixture (brouterFixture.json) — live-verifisering gjøres fra
// klient/mobil.

export const BROUTER_BASE = 'https://brouter.de/brouter'
// Bumpes når grusprofil.brf endres → invaliderer cachet profileid så neste
// rutekall laster opp ny profil.
export const PROFILE_VERSION = 7
export const BROUTER_TIMEOUT_MS = 20000
const PROFILE_CACHE_KEY = 'grus-brouter-profile'

export class ProfileExpiredError extends Error {
  constructor(msg) { super(msg); this.name = 'ProfileExpiredError' }
}

// POST profilteksten → {profileid: "custom_…"}.
export async function uploadProfile(profileText, { fetchFn = fetch } = {}) {
  const res = await fetchFn(`${BROUTER_BASE}/profile`, { method: 'POST', body: profileText })
  if (!res.ok) throw new Error(`BRouter profil-opplasting feilet (${res.status})`)
  const data = await res.json()
  // BRouter svarer 200 med {error: "…"} ved syntaksfeil i profilen — uten
  // denne sjekken degraderer vi stille til fallback-profil uten å vite hvorfor.
  if (data?.error) throw new Error(`BRouter avviste profilen: ${String(data.error).slice(0, 200)}`)
  if (!data?.profileid) throw new Error(`BRouter profil-opplasting ga uventet svar: ${JSON.stringify(data).slice(0, 120)}`)
  return data.profileid
}

// Hent (evt. cachet) profileid. Cache i sessionStorage overlever navigering
// men ikke ny fane — profileid-er på serveren er uansett kortlevde, så en
// re-opplasting ved ny økt er riktig oppførsel. `key` skiller flere profiler
// (grus-maks / balansert) i samme cache-navnerom.
export async function ensureProfileId(loadProfileText, { fetchFn = fetch, storage, key = 'grus' } = {}) {
  const store = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
  const cacheKey = `${PROFILE_CACHE_KEY}:${key}`
  try {
    const cached = JSON.parse(store?.getItem(cacheKey) ?? 'null')
    if (cached?.id && cached.v === PROFILE_VERSION) return cached.id
  } catch { /* korrupt cache — last opp på nytt */ }
  const text = await loadProfileText()
  const id = await uploadProfile(text, { fetchFn })
  try { store?.setItem(cacheKey, JSON.stringify({ id, v: PROFILE_VERSION, t: 0 })) } catch { /* noop */ }
  return id
}

export function clearProfileCache(storage, key = 'grus') {
  const store = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
  try { store?.removeItem(`${PROFILE_CACHE_KEY}:${key}`) } catch { /* noop */ }
}

// Klient-side templating av profil-flagg (v7): .brf-filene sjekkes inn med
// `assign inkluder_antatt_grus = true`; denne bytter verdien før opplasting
// etter UI-sjekkboksen «Inkluder antatt grusvei». Kaster hvis markøren
// mangler — en stille miss ville gitt ruteforslag med feil regelverk.
export function applyProfileFlags(profileText, { inkluderAntattGrus = true } = {}) {
  const re = /^assign inkluder_antatt_grus = (?:true|false)\b/m
  if (!re.test(profileText)) {
    throw new Error('Profilteksten mangler inkluder_antatt_grus-flagget')
  }
  return profileText.replace(re, `assign inkluder_antatt_grus = ${inkluderAntattGrus ? 'true' : 'false'}`)
}

// RELATIV snap-toleranse (v12.1.7 — var absolutt 200 m-grense): et forslag
// droppes kun når det snapper mer enn dette DÅRLIGERE enn det beste forslaget.
// Absolutt grense feilet på generelle stedssøk («Dombås» → «Lesja») der
// sentrums-punktet kan ligge et stykke fra nærmeste rutbare vei for ALLE
// profiler — det er greit, alle er like «off». Signalet vi vil luke er
// bilprofilen som snapper til en HELT ANNEN vei enn de andre forslagene.
export const MAX_SNAP_DIST_M = 200

// ABSOLUTT fornufts-grense (v12.1.10): den relative sjekken over beholder
// alltid det beste forslaget — men når A/B står i veiløst terreng snapper
// BRouter sin kost-vektede «dynamic range»-matching ALLE forslag til nærmeste
// billige grusvei, gjerne flere km unna (observert: rute 6,2 km med luftlinje
// 13,2 km). En rute som verken starter eller slutter i nærheten av punktene
// er verre enn ingen rute. Grensen er relativ til luftlinja med et gulv, så
// korte turer ikke får urimelig slingringsmonn.
export const SNAP_HARD_MIN_M = 500
export function snapHardLimitM(directM) {
  return Math.max(SNAP_HARD_MIN_M, 0.25 * (directM || 0))
}

// «312 m» / «3,2 km» — brukes i snap-varsler og feilmeldinger.
export function fmtAvstandM(m) {
  return m >= 995 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

/**
 * Avstand (meter) fra ønsket A/B til rutas faktiske start-/sluttpunkt.
 * parsed = parseRoute-resultat, waypoints = [{lat,lon}, …] (A først, B sist).
 */
export function snapDistances(parsed, waypoints) {
  const first = parsed.points[0]
  const last = parsed.points[parsed.points.length - 1]
  return {
    start: haversineM(waypoints[0], { lat: first[1], lon: first[0] }),
    end: haversineM(waypoints[waypoints.length - 1], { lat: last[1], lon: last[0] }),
  }
}

/**
 * Geometri-overlapp (v12.1.20): andelen av `samples` punkter jevnt fordelt
 * langs a (etter kumulativ distanse) som ligger innenfor toleranceM fra b sin
 * polylinje. Avstanden måles punkt-til-SEGMENT i en equirektangulær projeksjon
 * rundt midt-latituden — BRouter-geometri kan ha noder flere hundre meter fra
 * hverandre på rette strekk, så nærmeste-vertex alene overestimerer.
 */
export function routeOverlapShare(a, b, { toleranceM = 50, samples = 32 } = {}) {
  const ap = a.points, bp = b.points
  if (!ap?.length || !bp?.length) return 0
  const latRef = ap[Math.floor(ap.length / 2)][1]
  const mPerLon = 111320 * Math.cos(latRef * Math.PI / 180)
  const proj = ([lon, lat]) => [lon * mPerLon, lat * 111320]
  const A = ap.map(proj)
  const B = bp.map(proj)

  // Kumulative segmentlengder langs A for jevn distanse-sampling.
  const cum = [0]
  for (let i = 1; i < A.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(A[i][0] - A[i - 1][0], A[i][1] - A[i - 1][1]))
  }
  const total = cum[cum.length - 1]

  function pointSegDist(p, s1, s2) {
    const dx = s2[0] - s1[0], dy = s2[1] - s1[1]
    const len2 = dx * dx + dy * dy
    let t = len2 ? ((p[0] - s1[0]) * dx + (p[1] - s1[1]) * dy) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p[0] - (s1[0] + t * dx), p[1] - (s1[1] + t * dy))
  }
  function distToB(p) {
    if (B.length === 1) return Math.hypot(p[0] - B[0][0], p[1] - B[0][1])
    let best = Infinity
    for (let i = 1; i < B.length; i++) {
      const d = pointSegDist(p, B[i - 1], B[i])
      if (d < best) best = d
    }
    return best
  }
  function sampleAt(dist) {
    let i = 1
    while (i < cum.length - 1 && cum[i] < dist) i++
    const segLen = cum[i] - cum[i - 1]
    const t = segLen > 0 ? (dist - cum[i - 1]) / segLen : 0
    return [
      A[i - 1][0] + t * (A[i][0] - A[i - 1][0]),
      A[i - 1][1] + t * (A[i][1] - A[i - 1][1]),
    ]
  }

  let inside = 0
  for (let s = 0; s < samples; s++) {
    const p = total > 0 ? sampleAt(total * (s + 0.5) / samples) : A[0]
    if (distToB(p) <= toleranceM) inside++
  }
  return inside / samples
}

/**
 * Ser to ruteforslag identiske ut for brukeren? v12.1.19-varianten (lengde
 * ±10 m + midtpunkt <30 m) var for svak — to forslag med nesten lik geometri
 * men en liten omvei midtveis slapp begge gjennom («tilnærmet identiske
 * ruter» i felttest). Nå: symmetrisk geometri-overlapp ≥ 90 % innenfor 50 m
 * (routeOverlapShare), med lengde-hurtigsjekk (>25 % forskjell → ulike) så vi
 * slipper geometrisammenlikning for åpenbart ulike forslag.
 */
export function routesLookIdentical(a, b) {
  const la = a.lengthM ?? 0
  const lb = b.lengthM ?? 0
  if (la > 0 && lb > 0 && Math.max(la, lb) > 1.25 * Math.min(la, lb)) return false
  return Math.min(routeOverlapShare(a, b), routeOverlapShare(b, a)) >= 0.9
}

/**
 * Presentasjon av ruteforslag (v12.1.14): profilnavnene («Mest grus» /
 * «Balansert» / «Kortest») var misvisende — «Kortest»-profilen er f.eks. ikke
 * garantert kortest når snap-filteret har herjet. Nøytrale navn i liste-
 * rekkefølge («Rute 1» …) + DATA-avledede badges i stedet. Badges settes kun
 * når det finnes mer enn ett forslag (én rute trenger ingen sammenlikning):
 *   MEST GRUS — høyest grusandel (krever kjent andel > 0)
 *   KORTEST   — kortest lengde, uavhengig av underlag
 *   RASKEST   — lavest tidsestimat (grønn tone)
 * Ett forslag kan bære flere badges; ved likhet vinner første i lista.
 */
export function decorateProposals(list) {
  const out = list.map((p, i) => ({ ...p, label: `Rute ${i + 1}`, badges: [] }))
  if (out.length > 1) {
    const best = (cands, better) => cands.reduce((a, b) => (better(b, a) ? b : a))
    const grus = out.filter((p) => Number.isFinite(p.gravelShare) && p.gravelShare > 0)
    if (grus.length) best(grus, (b, a) => b.gravelShare > a.gravelShare).badges.push({ text: 'MEST GRUS', tone: 'sky' })
    const kort = out.filter((p) => Number.isFinite(p.lengthM))
    if (kort.length) best(kort, (b, a) => b.lengthM < a.lengthM).badges.push({ text: 'KORTEST', tone: 'sky' })
    const rask = out.filter((p) => Number.isFinite(p.estimatedTimeS))
    if (rask.length) best(rask, (b, a) => b.estimatedTimeS < a.estimatedTimeS).badges.push({ text: 'RASKEST', tone: 'green' })
  }
  return out
}

// MC-tur-tidsestimat (v12.1.10). BRouter sin total-time er UBRUKELIG på tvers
// av forslagene våre: custom-profilene arver BRouters sykkel-kinematikk
// (default maxSpeed 45 km/t uansett underlag), mens innebygde bilprofiler
// bruker en annen modell — observert 2 km/t på grus («6,3 km · 3 t 04 min»
// side om side med «6,2 km · 8 min»). Ett konsistent klient-estimat fra
// underlagsmiksen i stedet; total-time beholdes i data men vises ikke.
export const MC_SPEED_KMH = { gravel: 40, paved: 65, unknown: 50 }

/**
 * Estimert kjøretid i sekunder for tur-MC. gravelM null → hele lengden i
 * ukjent-fart; ellers grus/ukjent/asfalt hver med sin fart (resten etter
 * grus og ukjent regnes som fast dekke).
 */
export function estimateMcTimeS(lengthM, { gravelM = null, unknownM = 0 } = {}) {
  if (!(lengthM > 0)) return null
  if (gravelM == null) return Math.round(lengthM / (MC_SPEED_KMH.unknown / 3.6))
  const g = Math.min(gravelM, lengthM)
  const u = Math.min(unknownM || 0, lengthM - g)
  const p = lengthM - g - u
  return Math.round(
    g / (MC_SPEED_KMH.gravel / 3.6) +
    u / (MC_SPEED_KMH.unknown / 3.6) +
    p / (MC_SPEED_KMH.paved / 3.6),
  )
}

// Luftlinje-avstand (haversine) i meter — «Luftlinje»-flisa i rute-resultatet.
export function haversineM(a, b) {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Hent rute. waypoints = [{lat, lon}, …] (A, evt. via-punkter, B).
 * MERK: BRouter vil ha LON FØRST i lonlats-parameteret.
 * Kaster ProfileExpiredError ved 4xx med profil-relatert feiltekst, slik at
 * kalleren kan re-laste profilen og prøve én gang til.
 */
export async function fetchRoute(waypoints, profileId, { fetchFn = fetch, signal } = {}) {
  const lonlats = waypoints.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join('|')
  const url = `${BROUTER_BASE}?lonlats=${encodeURIComponent(lonlats)}&profile=${encodeURIComponent(profileId)}&alternativeidx=0&format=geojson`
  const res = await fetchFn(url, { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status >= 400 && res.status < 500 && /profile/i.test(text)) {
      throw new ProfileExpiredError(`BRouter avviste profilen (${res.status}): ${text.slice(0, 160)}`)
    }
    throw new Error(`BRouter-feil ${res.status}: ${text.slice(0, 160)}`)
  }
  return res.json()
}

// Grus-familien slik BRouter/OSM-tags rapporterer den i WayTags.
const GRAVELISH = new Set(['gravel', 'compacted', 'fine_gravel', 'unpaved', 'ground', 'dirt', 'pebblestone', 'sand', 'grass'])
const PAVEDISH = new Set(['asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'cobblestone', 'metal', 'wood'])

// 'highway=track surface=gravel …' → 'gravel' | 'paved' | 'unknown'
export function classifyWayTags(wayTagsString) {
  const tags = {}
  for (const kv of String(wayTagsString ?? '').split(/\s+/)) {
    const i = kv.indexOf('=')
    if (i > 0) tags[kv.slice(0, i)] = kv.slice(i + 1)
  }
  if (tags.surface) {
    if (GRAVELISH.has(tags.surface)) return 'gravel'
    if (PAVEDISH.has(tags.surface)) return 'paved'
    return 'unknown'
  }
  // Track uten surface = antatt grus (samme stance som gravelOverlay).
  if (tags.highway === 'track') return 'gravel'
  return 'unknown'
}

/**
 * Parse BRouter-geojson → {points, lengthM, segments|null, gravelShare|null, gravelM}.
 *
 * Responsformat (dokumentert/bikerouter-kjent, fixture-testet — verifiseres
 * live fra klient): features[0] er en LineString med
 *   properties['track-length'] = total lengde i meter (streng)
 *   properties.messages = [headerRad, …dataRader] der hver dataRad beskriver
 *     way-seksjonen FREM TIL punktet (Longitude/Latitude i MIKROGRADER,
 *     Distance i meter, WayTags som mellomrom-separert key=value-streng).
 *
 * Defensivt: mangler messages, eller < 80 % av distansen lar seg mappe mot
 * linjegeometrien → segments:null / gravelShare:null (UI viser uniform farge
 * og skjuler grusandelen).
 */
export function parseRoute(geojson) {
  const feat = geojson?.features?.[0]
  const coords = feat?.geometry?.coordinates
  if (!Array.isArray(coords) || coords.length < 2) {
    throw new Error('BRouter-svaret mangler rutegeometri')
  }
  const points = coords.map((c) => [c[0], c[1], c[2]])
  const lengthM = Number(feat.properties?.['track-length']) || 0
  const totalTimeS = Number(feat.properties?.['total-time']) || null

  const noSurface = () => ({
    points, lengthM, totalTimeS, segments: null, gravelShare: null, gravelM: null,
    estimatedTimeS: estimateMcTimeS(lengthM),
  })

  const messages = feat.properties?.messages
  if (!Array.isArray(messages) || messages.length < 2) return noSurface()

  const header = messages[0].map((h) => String(h).toLowerCase())
  const iLon = header.indexOf('longitude')
  const iLat = header.indexOf('latitude')
  const iDist = header.indexOf('distance')
  const iTags = header.indexOf('waytags')
  if (iLon < 0 || iLat < 0 || iDist < 0 || iTags < 0) return noSurface()

  // Indeksér linjepunktene på avrundet lon/lat for nærmeste-punkt-match.
  const key = (lon, lat) => `${lon.toFixed(5)},${lat.toFixed(5)}`
  const idxByKey = new Map()
  points.forEach(([lon, lat], i) => { if (!idxByKey.has(key(lon, lat))) idxByKey.set(key(lon, lat), i) })

  const segments = []
  let prevIdx = 0
  let matchedM = 0
  let gravelM = 0
  let unknownM = 0
  let totalMsgM = 0
  for (let r = 1; r < messages.length; r++) {
    const row = messages[r]
    const lon = Number(row[iLon]) / 1e6
    const lat = Number(row[iLat]) / 1e6
    const distM = Number(row[iDist]) || 0
    const cls = classifyWayTags(row[iTags])
    totalMsgM += distM
    const toIdx = idxByKey.get(key(lon, lat))
    if (toIdx != null && toIdx >= prevIdx) {
      segments.push({ fromIdx: prevIdx, toIdx, distM, surface: cls, gravel: cls === 'gravel' })
      prevIdx = toIdx
      matchedM += distM
    }
    if (cls === 'gravel') gravelM += distM
    else if (cls === 'unknown') unknownM += distM
  }

  // Underlagsmiksen skaleres til track-length så tidsestimatet bruker samme
  // total som lengde-visningen (messages-summen kan avvike marginalt).
  const timeEst = (denom) => estimateMcTimeS(lengthM, {
    gravelM: (gravelM / denom) * lengthM,
    unknownM: (unknownM / denom) * lengthM,
  })

  const denom = totalMsgM || lengthM
  if (!denom || matchedM / denom < 0.8) {
    // Geometri-mappingen er upålitelig — behold andelen kun hvis distansene
    // i det minste summerer fornuftig mot totalen, ellers alt null.
    const shareOk = denom > 0 && Math.abs(denom - lengthM) / Math.max(lengthM, 1) < 0.05
    return {
      points, lengthM, totalTimeS,
      segments: null,
      gravelShare: shareOk ? gravelM / denom : null,
      gravelM: shareOk ? gravelM : null,
      estimatedTimeS: shareOk ? timeEst(denom) : estimateMcTimeS(lengthM),
    }
  }
  return {
    points, lengthM, totalTimeS, segments,
    gravelShare: gravelM / denom, gravelM,
    estimatedTimeS: timeEst(denom),
  }
}
